// Typed client for /api/admin/budget/*. Every request carries the admin token
// as X-Admin-Token, matching the existing AdminOnly middleware.

export type Category = {
  key: string;
  label: string;
  group: CategoryGroup;
  default_cents: number;
};

export type CategoryGroup =
  | "housing"
  | "transport"
  | "food"
  | "subscriptions"
  | "savings"
  | "investments"
  | "personal"
  | "misc";

export type Transaction = {
  id: number;
  month: string;
  date: string;
  description: string;
  amount_cents: number;
  category: string;
  account_id: number; // 0 = unassigned
};

export type AccountKind = "checking" | "savings" | "credit" | "investment" | "other";

export type Account = {
  id: number;
  name: string;
  kind: AccountKind;
  sort: number;
  archived: boolean;
  starting_balance_cents: number;
  starting_month: string; // "YYYY-MM" — anchors when the starting balance applied
  /** Running balance as of the currently viewed month. Server-computed;
   * present when loaded via month state, 0 for a just-created account
   * until the next state refetch. Credit accounts: amount owed. */
  balance_cents: number;
};

export type Transfer = {
  id: number;
  month: string;
  date: string;
  from_account: number;
  to_account: number;
  amount_cents: number;
  note: string;
};

export type NetWorth = {
  month: string;
  hysa_cents: number;
  brokerage_cents: number;
  k401_vested_cents: number;
  k401_unvested_cents: number;
  months_remaining: number;
  goal_cents: number;
};

export type MonthState = {
  month: string;
  income_cents: number;
  three_paycheck: boolean;
  match_401k_cents: number;
  budgets: Record<string, number>;
  transactions: Transaction[];
  net_worth: NetWorth;
  accounts: Account[];
  transfers: Transfer[];
};

export type HistoryPoint = {
  month: string;
  income_cents: number;
  spent_cents: number;
  saved_cents: number;
  net_worth_cents: number;
};

export type Suggestion = {
  description: string;
  category: string;
  count: number;
};

export type CategoryCatalog = {
  categories: Category[];
  defaults: {
    income_cents: number;
    three_paycheck_income_cents: number;
    match_401k_cents: number;
    goal_cents: number;
  };
};

/** Thrown for any non-2xx response so callers can show the server's message. */
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

/** Exchanges the admin password for a token via the existing auth route. */
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
  categories: (token: string) => request<CategoryCatalog>(token, "/api/admin/budget/categories"),

  month: (token: string, month: string) =>
    request<MonthState>(token, `/api/admin/budget/month?m=${encodeURIComponent(month)}`),

  saveMonth: (
    token: string,
    body: { month: string; income_cents: number; three_paycheck: boolean; match_401k_cents: number }
  ) =>
    request<{ message: string }>(token, "/api/admin/budget/month", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  saveBudgets: (token: string, month: string, budgets: Record<string, number>) =>
    request<{ message: string }>(token, "/api/admin/budget/budgets", {
      method: "PUT",
      body: JSON.stringify({ month, budgets }),
    }),

  saveNetWorth: (token: string, netWorth: NetWorth) =>
    request<{ message: string }>(token, "/api/admin/budget/networth", {
      method: "PUT",
      body: JSON.stringify(netWorth),
    }),

  createTransaction: (token: string, tx: Omit<Transaction, "id">) =>
    request<Transaction>(token, "/api/admin/budget/transactions", {
      method: "POST",
      body: JSON.stringify(tx),
    }),

  updateTransaction: (token: string, tx: Transaction) =>
    request<Transaction>(token, "/api/admin/budget/transactions", {
      method: "PUT",
      body: JSON.stringify(tx),
    }),

  deleteTransaction: (token: string, id: number) =>
    request<{ message: string }>(token, `/api/admin/budget/transactions?id=${id}`, {
      method: "DELETE",
    }),

  history: (token: string, limit = 24) =>
    request<{ history: HistoryPoint[] }>(token, `/api/admin/budget/history?limit=${limit}`),

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

  createTransfer: (token: string, transfer: Omit<Transfer, "id">) =>
    request<Transfer>(token, "/api/admin/budget/transfers", {
      method: "POST",
      body: JSON.stringify(transfer),
    }),

  updateTransfer: (token: string, transfer: Transfer) =>
    request<Transfer>(token, "/api/admin/budget/transfers", {
      method: "PUT",
      body: JSON.stringify(transfer),
    }),

  deleteTransfer: (token: string, id: number) =>
    request<{ message: string }>(token, `/api/admin/budget/transfers?id=${id}`, {
      method: "DELETE",
    }),

  suggest: (token: string, q: string) =>
    request<{ suggestions: Suggestion[] }>(
      token,
      `/api/admin/budget/suggest?q=${encodeURIComponent(q)}`
    ),

  /** Full SQL dump as text (restore: pipe into `turso db shell`). */
  dump: async (token: string): Promise<string> => {
    const res = await fetch("/api/admin/budget/dump", {
      headers: { "X-Admin-Token": token },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
    }
    return res.text();
  },
};
