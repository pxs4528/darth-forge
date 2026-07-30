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

export type Split = {
  id?: number;
  account_id: number;
  amount_cents: number;
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
  amount_cents: number;
  balance_cents: number;
};

export type Meta = {
  account_types: AccountType[];
  budget_groups: string[];
  asset_classes: AssetClass[];
  defaults: { goal_cents: number; target_month: string };
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
    request<{ rows: RegisterRow[] }>(token, `/api/admin/budget/register?account=${accountId}`),

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
