import { createMemo, createResource, createSignal } from "solid-js";
import {
  api,
  ApiError,
  authenticate,
  clearToken,
  loadToken,
  saveToken,
  type Account,
  type Transfer,
  type CategoryCatalog,
  type HistoryPoint,
  type MonthState,
  type NetWorth,
  type Transaction,
} from "./api";
import { currentMonth, shiftMonth } from "./format";

// ── colors ───────────────────────────────────────────────────────────────────
// Category groups carry identity colors (user-picked); progress fills carry
// status. Group colors always render next to a text label, so the low-contrast
// navy/grey entries are acceptable. Chart series use the validated trio
// #3987e5/#d95926/#1baf7a (passes CVD + contrast gates on #0d1117).

export const GROUP_META: Record<string, { label: string; color: string }> = {
  housing: { label: "Housing", color: "#3987e5" },
  transport: { label: "Transport", color: "#1baf7a" },
  food: { label: "Food", color: "#d95926" },
  subscriptions: { label: "Subscriptions", color: "#9085e9" },
  savings: { label: "Savings", color: "#1c5cab" },
  investments: { label: "Investments", color: "#008300" },
  personal: { label: "Personal", color: "#898781" },
  misc: { label: "Misc", color: "#5f5d58" },
};

export const STATUS_COLORS = {
  good: "#0ca30c", // < 75% of budget
  warn: "#fab219", // 75–99%
  over: "#d03b3b", // >= 100%
};

export const CHART_COLORS = {
  income: "#3987e5",
  spent: "#d95926",
  saved: "#1baf7a",
};

export const budgetStatus = (spent: number, budget: number): keyof typeof STATUS_COLORS => {
  if (budget <= 0) return spent > 0 ? "over" : "good";
  const pct = (spent / budget) * 100;
  if (pct >= 100) return "over";
  if (pct >= 75) return "warn";
  return "good";
};

// ── derived metrics ──────────────────────────────────────────────────────────

export type Metrics = {
  totalOutCents: number; // every transaction this month
  savedTxCents: number; // HYSA + index fund transactions
  spendCents: number; // consumption = totalOut - savedTx
  investedCents: number; // savedTx + 401k match
  surplusCents: number; // income - totalOut
  savingsRate: number; // invested / (income + match), 0..1
  spentByCategory: Record<string, number>;
  netWorthTotalCents: number;
  targetMonthlyCents: number; // (goal - net worth) / months remaining
  plannedContribCents: number; // budgeted HYSA + index + match
  onTrackDeltaCents: number; // invested - target
  projections: { none: number; realistic: number; optimistic: number };
};

/** Future value of base + monthly contributions at an annual rate. */
const futureValue = (
  baseCents: number,
  contribCents: number,
  months: number,
  annualRate: number
): number => {
  if (annualRate === 0) return baseCents + contribCents * months;
  const i = annualRate / 12;
  const growth = Math.pow(1 + i, months);
  return Math.round(baseCents * growth + contribCents * ((growth - 1) / i));
};

export const computeMetrics = (state: MonthState, savingsKeys: Set<string>): Metrics => {
  const spentByCategory: Record<string, number> = {};
  let totalOut = 0;
  let savedTx = 0;

  for (const tx of state.transactions) {
    spentByCategory[tx.category] = (spentByCategory[tx.category] ?? 0) + tx.amount_cents;
    totalOut += tx.amount_cents;
    if (savingsKeys.has(tx.category)) savedTx += tx.amount_cents;
  }

  const nw = state.net_worth;
  const netWorthTotal =
    nw.hysa_cents + nw.brokerage_cents + nw.k401_vested_cents + nw.k401_unvested_cents;
  const months = Math.max(1, nw.months_remaining);
  const remaining = nw.goal_cents - netWorthTotal;
  const target = Math.max(0, Math.round(remaining / months));

  const invested = savedTx + state.match_401k_cents;
  const denom = state.income_cents + state.match_401k_cents;

  let planned = state.match_401k_cents;
  for (const key of savingsKeys) planned += state.budgets[key] ?? 0;

  return {
    totalOutCents: totalOut,
    savedTxCents: savedTx,
    spendCents: totalOut - savedTx,
    investedCents: invested,
    surplusCents: state.income_cents - totalOut,
    savingsRate: denom > 0 ? invested / denom : 0,
    spentByCategory,
    netWorthTotalCents: netWorthTotal,
    targetMonthlyCents: target,
    plannedContribCents: planned,
    onTrackDeltaCents: invested - target,
    projections: {
      none: futureValue(netWorthTotal, planned, months, 0),
      realistic: futureValue(netWorthTotal, planned, months, 0.07),
      optimistic: futureValue(netWorthTotal, planned, months, 0.1),
    },
  };
};

// ── store ────────────────────────────────────────────────────────────────────

export type BudgetStore = ReturnType<typeof createBudgetStore>;

export function createBudgetStore() {
  const [token, setToken] = createSignal(loadToken());
  const [month, setMonth] = createSignal(currentMonth());
  const [histVersion, setHistVersion] = createSignal(0);
  const [toast, setToast] = createSignal("");
  const [apiError, setApiError] = createSignal("");

  let toastTimer: number | undefined;
  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(""), 2600);
  };

  const logout = () => {
    clearToken();
    setToken("");
  };

  /**
   * Runs an API call. A 401 kicks back to the password gate; any other
   * failure surfaces in the banner. The banner clears when the month
   * resource next loads successfully (see below) — not on any success,
   * since e.g. the static categories route succeeds even with the DB down.
   */
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        flash("Session rejected — sign in again");
      } else {
        setApiError(e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
  };

  const [catalog] = createResource<CategoryCatalog | undefined, string>(
    () => token() || undefined,
    (t) => guard(() => api.categories(t))
  );

  const [state, { mutate: mutateState }] = createResource<
    MonthState | undefined,
    { t: string; m: string }
  >(
    () => (token() ? { t: token(), m: month() } : undefined),
    async ({ t, m }) => {
      const loaded = await guard(() => api.month(t, m));
      setApiError(""); // primary resource healthy → clear the banner
      return loaded;
    }
  );

  const [history] = createResource<
    { history: HistoryPoint[] } | undefined,
    { t: string; v: number }
  >(
    () => (token() ? { t: token(), v: histVersion() } : undefined),
    ({ t }) => guard(() => api.history(t, 24))
  );

  const bumpHistory = () => setHistVersion((v) => v + 1);

  // category key → group, and the set of net-worth-building categories
  const groupOf = createMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const c of catalog()?.categories ?? []) map[c.key] = c.group;
    return map;
  });

  const savingsKeys = createMemo<Set<string>>(() => {
    const keys = new Set<string>();
    for (const c of catalog()?.categories ?? []) {
      if (c.group === "savings" || c.group === "investments") keys.add(c.key);
    }
    return keys;
  });

  const metrics = createMemo<Metrics | null>(() => {
    const s = state();
    if (!s) return null;
    return computeMetrics(s, savingsKeys());
  });

  // ── auth ──
  const login = async (password: string, remember: boolean) => {
    const t = await authenticate(password);
    saveToken(t, remember);
    setToken(t);
  };

  // ── month nav ──
  const goMonth = (delta: number) => setMonth((m) => shiftMonth(m, delta));
  const goToday = () => setMonth(currentMonth());

  // ── transactions ──
  /** Keeps the list in date-desc, id-desc order after local inserts. */
  const insertSorted = (list: Transaction[], tx: Transaction): Transaction[] => {
    const out = [...list];
    const at = out.findIndex((x) => x.date < tx.date || (x.date === tx.date && x.id < tx.id));
    if (at === -1) out.push(tx);
    else out.splice(at, 0, tx);
    return out;
  };

  const addTransaction = async (input: Omit<Transaction, "id" | "month">) => {
    const created = await guard(() =>
      api.createTransaction(token(), { ...input, month: input.date.slice(0, 7) })
    );
    if (created.month === month()) {
      mutateState((s) => (s ? { ...s, transactions: insertSorted(s.transactions, created) } : s));
    } else {
      flash(`Added to ${created.month} (different month)`);
    }
    bumpHistory();
    return created;
  };

  const updateTransaction = async (tx: Transaction) => {
    const saved = await guard(() => api.updateTransaction(token(), tx));
    mutateState((s) => {
      if (!s) return s;
      const rest = s.transactions.filter((x) => x.id !== saved.id);
      return {
        ...s,
        transactions: saved.month === s.month ? insertSorted(rest, saved) : rest,
      };
    });
    if (saved.month !== month()) flash(`Moved to ${saved.month}`);
    bumpHistory();
  };

  const deleteTransaction = async (id: number) => {
    await guard(() => api.deleteTransaction(token(), id));
    mutateState((s) => (s ? { ...s, transactions: s.transactions.filter((x) => x.id !== id) } : s));
    bumpHistory();
  };

  // ── month settings ──
  const saveMonthSettings = async (
    incomeCents: number,
    threePaycheck: boolean,
    matchCents: number
  ) => {
    const m = month();
    await guard(() =>
      api.saveMonth(token(), {
        month: m,
        income_cents: incomeCents,
        three_paycheck: threePaycheck,
        match_401k_cents: matchCents,
      })
    );
    mutateState((s) =>
      s
        ? {
            ...s,
            income_cents: incomeCents,
            three_paycheck: threePaycheck,
            match_401k_cents: matchCents,
          }
        : s
    );
    bumpHistory();
    flash("Income saved");
  };

  const setThreePaycheck = async (on: boolean) => {
    const s = state();
    const defaults = catalog()?.defaults;
    if (!s || !defaults) return;
    const income = on ? defaults.three_paycheck_income_cents : defaults.income_cents;
    await saveMonthSettings(income, on, s.match_401k_cents);
  };

  // ── budgets ──
  const saveBudget = async (category: string, cents: number) => {
    const m = month();
    await guard(() => api.saveBudgets(token(), m, { [category]: cents }));
    mutateState((s) => (s ? { ...s, budgets: { ...s.budgets, [category]: cents } } : s));
    flash("Budget saved");
  };

  // ── net worth ──
  const saveNetWorth = async (nw: NetWorth) => {
    await guard(() => api.saveNetWorth(token(), nw));
    mutateState((s) => (s ? { ...s, net_worth: nw } : s));
    bumpHistory();
    flash("Net worth saved");
  };

  // ── accounts ──
  const accounts = createMemo<Account[]>(() => state()?.accounts ?? []);
  const activeAccounts = createMemo<Account[]>(() => accounts().filter((a) => !a.archived));

  /** id → display name ("—" for unassigned/unknown). */
  const accountName = (id: number): string =>
    id === 0 ? "—" : (accounts().find((a) => a.id === id)?.name ?? "—");

  const createAccount = async (name: string, kind: Account["kind"]) => {
    const created = await guard(() =>
      api.createAccount(token(), { name, kind, sort: accounts().length, archived: false })
    );
    mutateState((s) => (s ? { ...s, accounts: [...s.accounts, created] } : s));
    flash("Account added");
  };

  const updateAccount = async (account: Account) => {
    const saved = await guard(() => api.updateAccount(token(), account));
    mutateState((s) =>
      s ? { ...s, accounts: s.accounts.map((a) => (a.id === saved.id ? saved : a)) } : s
    );
    flash("Account saved");
  };

  // ── transfers ──
  const insertTransferSorted = (list: Transfer[], t: Transfer): Transfer[] => {
    const out = [...list];
    const at = out.findIndex((x) => x.date < t.date || (x.date === t.date && x.id < t.id));
    if (at === -1) out.push(t);
    else out.splice(at, 0, t);
    return out;
  };

  const addTransfer = async (input: Omit<Transfer, "id" | "month">) => {
    const created = await guard(() =>
      api.createTransfer(token(), { ...input, month: input.date.slice(0, 7) })
    );
    if (created.month === month()) {
      mutateState((s) => (s ? { ...s, transfers: insertTransferSorted(s.transfers, created) } : s));
    } else {
      flash(`Transfer added to ${created.month} (different month)`);
    }
    return created;
  };

  const updateTransfer = async (transfer: Transfer) => {
    const saved = await guard(() => api.updateTransfer(token(), transfer));
    mutateState((s) => {
      if (!s) return s;
      const rest = s.transfers.filter((x) => x.id !== saved.id);
      return {
        ...s,
        transfers: saved.month === s.month ? insertTransferSorted(rest, saved) : rest,
      };
    });
  };

  const deleteTransfer = async (id: number) => {
    await guard(() => api.deleteTransfer(token(), id));
    mutateState((s) => (s ? { ...s, transfers: s.transfers.filter((x) => x.id !== id) } : s));
  };

  // ── autosuggest ──
  const suggest = (q: string) => guard(() => api.suggest(token(), q)).then((r) => r.suggestions);

  return {
    // state
    token,
    month,
    setMonth,
    state,
    catalog,
    history,
    metrics,
    groupOf,
    savingsKeys,
    toast,
    apiError,
    flash,
    // actions
    login,
    logout,
    goMonth,
    goToday,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    saveMonthSettings,
    setThreePaycheck,
    saveBudget,
    saveNetWorth,
    suggest,
    accounts,
    activeAccounts,
    accountName,
    createAccount,
    updateAccount,
    addTransfer,
    updateTransfer,
    deleteTransfer,
  };
}
