// Typed client for /api/admin/budget/*. Every request carries the admin token
// as X-Admin-Token, matching the existing AdminOnly middleware.

export type AccountType = "asset" | "liability" | "income" | "expense" | "equity";

export type Account = {
  id: number;
  name: string;
  type: AccountType;
  subtype: string;
  budget_group: string;
  sort: number;
  archived: boolean;
  /** Counts toward the goal tracker. Off for depreciating assets and their debt. */
  in_goal: boolean;
};

/** An account plus its balance through the viewed month. */
export type AccountBalance = Account & {
  balance_cents: number;
  change_cents: number;
};

/**
 * Reconciliation, GnuCash-style. Per split rather than per transaction: a
 * Chase → Groceries entry has its Chase side reconciled against the Chase
 * statement while the Groceries side never is.
 *
 *   n — not reconciled
 *   c — cleared: seen on the bank's record
 *   y — locked: part of a statement proved to zero; refuses edits
 */
export type ReconcileState = "n" | "c" | "y";

export type Split = {
  id?: number;
  account_id: number;
  amount_cents: number;
  reconcile_state?: ReconcileState;
};

/** One transaction. Splits always sum to zero. */
export type Entry = {
  id: number;
  date: string;
  month: string;
  description: string;
  splits: Split[];
};

export type Goal = {
  goal_cents: number;
  target_month: string;
  /** Months of spending to hold in cash before treating cash as deployable. */
  emergency_months: number;
};

export type AssetClass = "cash" | "invested" | "retirement" | "other" | "";

export type Summary = {
  income_cents: number;
  expense_cents: number;
  surplus_cents: number;
  net_worth_cents: number;
  goal_net_worth_cents: number;
  net_worth_change_cents: number;
  months_remaining: number;
  target_monthly_cents: number;
};

export type MonthState = {
  month: string;
  accounts: AccountBalance[];
  entries: Entry[];
  budgets: Record<string, number>; // account id → monthly target
  goal: Goal;
  summary: Summary;
};

export type HistoryPoint = {
  month: string;
  income_cents: number;
  expense_cents: number;
  net_worth_cents: number;
};

export type Suggestion = {
  description: string;
  from_account_id: number;
  to_account_id: number;
  amount_cents: number;
  uses: number;
};

export type RegisterRow = Entry & {
  /** This account's own split — what reconciling addresses. */
  split_id: number;
  amount_cents: number;
  balance_cents: number;
  reconcile_state: ReconcileState;
};

export type Meta = {
  account_types: AccountType[];
  budget_groups: string[];
  asset_classes: AssetClass[];
  defaults: { goal_cents: number; target_month: string };
};

// ── Plaid ────────────────────────────────────────────────────────────────────

/** How a linked account syncs. See docs/budget.md. */
export type SyncMode = "transactions" | "balance" | "ignore";

export type PlaidItem = {
  item_id: string;
  institution_id: string;
  institution_name: string;
  /** ok | login_required | error */
  status: string;
  last_sync: string;
  created_at: string;
};

export type PlaidAccount = {
  plaid_account_id: string;
  item_id: string;
  /** The ledger account this feeds; 0 means unmapped. */
  account_id: number;
  name: string;
  mask: string;
  type: string;
  subtype: string;
  sync_mode: SyncMode;
  balance_cents: number;
  balance_at: string;
};

/** An imported transaction awaiting review. */
export type StagedTxn = {
  plaid_txn_id: string;
  plaid_account_id: string;
  date: string;
  name: string;
  merchant: string;
  category: string;
  /** Our sign convention: negative when money left the account. */
  amount_cents: number;
  pending: boolean;
  status: string;
  txn_id: number;
  /** Proposed other leg; 0 when we won't guess. */
  counter_account_id: number;
  /** The opposite side of a matched internal transfer. */
  transfer_pair: string;
};

export type PlaidStatus = {
  configured: boolean;
  env?: string;
  items: PlaidItem[];
  accounts: PlaidAccount[];
};

export type SyncReport = {
  imported: number;
  queued: number;
  transfers: number;
  balances: number;
  problems: string[];
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = "budget_admin_token";

export const loadToken = (): string =>
  sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? "";

export const saveToken = (token: string, remember: boolean) => {
  if (remember) localStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.setItem(TOKEN_KEY, token);
};

export const clearToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
};

export const authenticate = async (password: string): Promise<string> => {
  const res = await fetch("/api/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new ApiError(res.status, data.error ?? "invalid password");
  }
  return data.token as string;
};

const request = async <T>(token: string, path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return data as T;
};

export const api = {
  meta: (token: string) => request<Meta>(token, "/api/admin/budget/meta"),

  month: (token: string, month: string) =>
    request<MonthState>(token, `/api/admin/budget/month?m=${encodeURIComponent(month)}`),

  createAccount: (token: string, account: Omit<Account, "id">) =>
    request<Account>(token, "/api/admin/budget/accounts", {
      method: "POST",
      body: JSON.stringify(account),
    }),

  updateAccount: (token: string, account: Account) =>
    request<Account>(token, "/api/admin/budget/accounts", {
      method: "PUT",
      body: JSON.stringify(account),
    }),

  createEntry: (token: string, entry: Omit<Entry, "id">) =>
    request<Entry>(token, "/api/admin/budget/entries", {
      method: "POST",
      body: JSON.stringify(entry),
    }),

  updateEntry: (token: string, entry: Entry) =>
    request<Entry>(token, "/api/admin/budget/entries", {
      method: "PUT",
      body: JSON.stringify(entry),
    }),

  deleteEntry: (token: string, id: number) =>
    request<{ message: string }>(token, `/api/admin/budget/entries?id=${id}`, {
      method: "DELETE",
    }),

  saveBudget: (token: string, month: string, accountId: number, amountCents: number) =>
    request<{ message: string }>(token, "/api/admin/budget/budgets", {
      method: "PUT",
      body: JSON.stringify({ month, account_id: accountId, amount_cents: amountCents }),
    }),

  saveGoal: (token: string, goal: Goal) =>
    request<Goal>(token, "/api/admin/budget/goal", { method: "PUT", body: JSON.stringify(goal) }),

  history: (token: string, limit = 24) =>
    request<{ history: HistoryPoint[] }>(token, `/api/admin/budget/history?limit=${limit}`),

  register: (token: string, accountId: number) =>
    request<{ rows: RegisterRow[]; cleared_cents: number }>(
      token,
      `/api/admin/budget/register?account=${accountId}`
    ),

  /** Tick or untick splits against a statement. */
  setReconcile: (token: string, splitIds: number[], state: ReconcileState) =>
    request<{ changed: number }>(token, "/api/admin/budget/reconcile", {
      method: "PUT",
      body: JSON.stringify({ split_ids: splitIds, state }),
    }),

  /** End a proved statement (lock) or reopen one (unlock). */
  reconcileAccount: (token: string, accountId: number, action: "lock" | "unlock") =>
    request<{ changed: number }>(token, "/api/admin/budget/reconcile", {
      method: "PUT",
      body: JSON.stringify({ account_id: accountId, action }),
    }),

  /**
   * Deletes every entry, keeping accounts, budgets and the goal — how you open
   * a fresh book. The confirmation phrase is checked server-side too.
   */
  reset: (token: string, confirm: string) =>
    request<{ entries_deleted: number }>(token, "/api/admin/budget/reset", {
      method: "POST",
      body: JSON.stringify({ confirm }),
    }),

  // ── Plaid ──

  plaidStatus: (token: string) => request<PlaidStatus>(token, "/api/admin/budget/plaid/status"),

  /** With itemId, opens Link in update mode to repair an expired login. */
  plaidLinkToken: (token: string, itemId?: string) =>
    request<{ link_token: string }>(token, "/api/admin/budget/plaid/link-token", {
      method: "POST",
      body: JSON.stringify(itemId ? { item_id: itemId } : {}),
    }),

  plaidExchange: (token: string, publicToken: string) =>
    request<{ item_id: string; institution: string; accounts: number }>(
      token,
      "/api/admin/budget/plaid/exchange",
      { method: "POST", body: JSON.stringify({ public_token: publicToken }) }
    ),

  plaidMapAccount: (token: string, plaidAccountId: string, accountId: number, syncMode: SyncMode) =>
    request<{ message: string }>(token, "/api/admin/budget/plaid/accounts", {
      method: "PUT",
      body: JSON.stringify({
        plaid_account_id: plaidAccountId,
        account_id: accountId,
        sync_mode: syncMode,
      }),
    }),

  plaidUnlink: (token: string, itemId: string) =>
    request<{ message: string }>(
      token,
      `/api/admin/budget/plaid/items?item_id=${encodeURIComponent(itemId)}`,
      { method: "DELETE" }
    ),

  plaidSync: (token: string) =>
    request<SyncReport>(token, "/api/admin/budget/plaid/sync", { method: "POST" }),

  plaidStaged: (token: string) =>
    request<{ staged: StagedTxn[] }>(token, "/api/admin/budget/plaid/staged"),

  plaidAccept: (token: string, plaidTxnId: string, counterAccountId: number, description: string) =>
    request<Entry>(token, "/api/admin/budget/plaid/accept", {
      method: "POST",
      body: JSON.stringify({
        plaid_txn_id: plaidTxnId,
        counter_account_id: counterAccountId,
        description,
      }),
    }),

  plaidIgnore: (token: string, plaidTxnIds: string[]) =>
    request<{ ignored: number }>(token, "/api/admin/budget/plaid/ignore", {
      method: "POST",
      body: JSON.stringify({ plaid_txn_ids: plaidTxnIds }),
    }),

  suggest: (token: string, q: string) =>
    request<{ suggestions: Suggestion[] }>(
      token,
      `/api/admin/budget/suggest?q=${encodeURIComponent(q)}`
    ),

  dump: async (token: string): Promise<string> => {
    const res = await fetch("/api/admin/budget/dump", { headers: { "X-Admin-Token": token } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
    }
    return res.text();
  },
};
