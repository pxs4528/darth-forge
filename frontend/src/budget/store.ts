import { createMemo, createResource, createSignal } from "solid-js";
import {
  api,
  ApiError,
  authenticate,
  clearToken,
  loadToken,
  saveToken,
  type Account,
  type AccountBalance,
  type AccountType,
  type Entry,
  type Goal,
  type HistoryPoint,
  type Meta,
  type MonthState,
  type Split,
} from "./api";
import { currentMonth, shiftMonth } from "./format";

// ── display vocabulary ───────────────────────────────────────────────────────
//
// Under double-entry the sign of a balance is determined by account type
// (see the schema comment in backend/internal/db/db.go). Users shouldn't have
// to think in credits and debits, so the helpers below translate stored signs
// into "how much do I have / owe / earn / spend".

export const TYPE_META: Record<AccountType, { label: string; plural: string; color: string }> = {
  asset: { label: "Asset", plural: "Accounts", color: "#3987e5" },
  liability: { label: "Liability", plural: "Credit & debt", color: "#d95926" },
  income: { label: "Income", plural: "Income", color: "#1baf7a" },
  expense: { label: "Expense", plural: "Spending", color: "#9085e9" },
  equity: { label: "Equity", plural: "Opening balances", color: "#898781" },
};

export const GROUP_LABELS: Record<string, string> = {
  housing: "Housing",
  transport: "Transport",
  food: "Food",
  subscriptions: "Subscriptions",
  savings: "Savings",
  personal: "Personal",
  misc: "Misc",
  "": "Other",
};

export const STATUS_COLORS = {
  good: "#0ca30c", // < 75% of budget
  warn: "#fab219", // 75–99%
  over: "#d03b3b", // >= 100%
};

export const CHART_COLORS = {
  income: "#1baf7a",
  expense: "#d95926",
  netWorth: "#3987e5",
};

export const budgetStatus = (spent: number, budget: number): keyof typeof STATUS_COLORS => {
  if (budget <= 0) return spent > 0 ? "over" : "good";
  const pct = (spent / budget) * 100;
  if (pct >= 100) return "over";
  if (pct >= 75) return "warn";
  return "good";
};

/**
 * Stored balances are signed by accounting convention; this flips the ones
 * users read as positive quantities. A liability balance of -50000 means
 * "you owe $500", and income of -287592 means "you earned $2,875.92".
 */
export const displayBalance = (type: AccountType, cents: number): number =>
  type === "liability" || type === "income" || type === "equity" ? -cents : cents;

/**
 * Simple entries (the overwhelming majority) have exactly two splits: one
 * negative side money left, one positive side it arrived. This reduces such
 * an entry to the from/to/amount shape the entry form speaks, and returns
 * null for genuine multi-split entries so callers can fall back to a detailed
 * view rather than silently misrepresenting them.
 */
export type SimpleShape = { fromId: number; toId: number; amountCents: number };

export const simpleShape = (entry: { splits: Split[] }): SimpleShape | null => {
  if (entry.splits.length !== 2) return null;
  const from = entry.splits.find((s) => s.amount_cents < 0);
  const to = entry.splits.find((s) => s.amount_cents > 0);
  if (!from || !to) return null;
  return { fromId: from.account_id, toId: to.account_id, amountCents: to.amount_cents };
};

/** Builds the two splits for a from → to movement of `amountCents`. */
export const splitsFor = (fromId: number, toId: number, amountCents: number): Split[] => [
  { account_id: fromId, amount_cents: -amountCents },
  { account_id: toId, amount_cents: amountCents },
];

// ── derived metrics ──────────────────────────────────────────────────────────

export type Projections = { none: number; realistic: number; optimistic: number };

/** Future value of a base amount plus monthly contributions at an annual rate. */
const futureValue = (
  baseCents: number,
  contribCents: number,
  months: number,
  annualRate: number
): number => {
  if (months <= 0) return baseCents;
  if (annualRate === 0) return baseCents + contribCents * months;
  const i = annualRate / 12;
  const growth = Math.pow(1 + i, months);
  return Math.round(baseCents * growth + contribCents * ((growth - 1) / i));
};

export const project = (
  netWorthCents: number,
  monthlyCents: number,
  months: number
): Projections => ({
  none: futureValue(netWorthCents, monthlyCents, months, 0),
  realistic: futureValue(netWorthCents, monthlyCents, months, 0.07),
  optimistic: futureValue(netWorthCents, monthlyCents, months, 0.1),
});

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

  /** A 401 kicks back to the password gate; anything else shows in the banner. */
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

  const [meta] = createResource<Meta | undefined, string>(
    () => token() || undefined,
    (t) => guard(() => api.meta(t))
  );

  const [state, { refetch: refetchState }] = createResource<
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

  /**
   * Every balance in the app is a server-side rollup over the account's whole
   * history, so any write can move numbers that aren't on screen. Rather than
   * hand-patching local state (which is what made the old store drift), each
   * mutation just refetches the month — one small request against a tiny DB.
   */
  const reload = async () => {
    setHistVersion((v) => v + 1);
    await Promise.resolve(refetchState()).catch(() => undefined);
  };

  // ── lookups ──
  const accounts = createMemo<AccountBalance[]>(() => state()?.accounts ?? []);
  const activeAccounts = createMemo(() => accounts().filter((a) => !a.archived));

  const accountsByType = (type: AccountType) => activeAccounts().filter((a) => a.type === type);

  const accountById = (id: number): AccountBalance | undefined =>
    accounts().find((a) => a.id === id);

  const accountName = (id: number): string => accountById(id)?.name ?? "—";

  /** Accounts you'd pick as a payment source, ordered the way you'd reach for them. */
  const sourceAccounts = createMemo(() => [
    ...accountsByType("asset"),
    ...accountsByType("liability"),
    ...accountsByType("income"),
    ...accountsByType("equity"),
  ]);

  /** Accounts money can land in. */
  const destinationAccounts = createMemo(() => [
    ...accountsByType("expense"),
    ...accountsByType("asset"),
    ...accountsByType("liability"),
  ]);

  const spentByAccount = createMemo<Record<number, number>>(() => {
    const out: Record<number, number> = {};
    for (const a of accounts()) {
      if (a.type === "expense") out[a.id] = a.change_cents;
    }
    return out;
  });

  const summary = () => state()?.summary;
  const goal = () => state()?.goal;

  const projections = createMemo<Projections>(() => {
    const s = summary();
    if (!s) return { none: 0, realistic: 0, optimistic: 0 };
    // Project the goal-eligible pool forward at this month's run rate.
    return project(s.goal_net_worth_cents, s.net_worth_change_cents, s.months_remaining);
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

  // ── entries ──
  const addEntry = async (input: {
    date: string;
    description: string;
    fromId: number;
    toId: number;
    amountCents: number;
  }) => {
    const created = await guard(() =>
      api.createEntry(token(), {
        date: input.date,
        month: input.date.slice(0, 7),
        description: input.description,
        splits: splitsFor(input.fromId, input.toId, input.amountCents),
      })
    );
    if (created.month !== month()) flash(`Added to ${created.month}`);
    await reload();
    return created;
  };

  const updateEntry = async (entry: Entry) => {
    const saved = await guard(() =>
      api.updateEntry(token(), { ...entry, month: entry.date.slice(0, 7) })
    );
    if (saved.month !== month()) flash(`Moved to ${saved.month}`);
    await reload();
  };

  const deleteEntry = async (id: number) => {
    await guard(() => api.deleteEntry(token(), id));
    await reload();
  };

  // ── accounts ──
  /** Net worth including everything, vs. only what counts toward the goal. */
  const netWorthTotal = () => summary()?.net_worth_cents ?? 0;
  const netWorthInGoal = () => summary()?.goal_net_worth_cents ?? 0;
  const hasExcludedAccounts = createMemo(() =>
    accounts().some(
      (a) => !a.archived && !a.in_goal && (a.type === "asset" || a.type === "liability")
    )
  );

  const createAccount = async (a: Omit<Account, "id">) => {
    await guard(() => api.createAccount(token(), a));
    await reload();
    flash("Account added");
  };

  const updateAccount = async (a: Account) => {
    await guard(() => api.updateAccount(token(), a));
    await reload();
    flash("Account saved");
  };

  /**
   * Books a starting balance as a real entry against the Opening Balances
   * equity account, so the ledger balances instead of a number appearing from
   * nowhere. Amount is what the user reads: cash held, or debt owed.
   */
  const setOpeningBalance = async (account: Account, displayCents: number, date: string) => {
    const equity = accounts().find((a) => a.type === "equity");
    if (!equity) {
      flash("No equity account to balance against");
      return;
    }
    const owed = account.type === "liability";
    await guard(() =>
      api.createEntry(token(), {
        date,
        month: date.slice(0, 7),
        description: "Opening balance",
        splits: owed
          ? splitsFor(account.id, equity.id, displayCents)
          : splitsFor(equity.id, account.id, displayCents),
      })
    );
    await reload();
    flash("Opening balance recorded");
  };

  // ── budgets & goal ──
  const saveBudget = async (accountId: number, cents: number) => {
    await guard(() => api.saveBudget(token(), month(), accountId, cents));
    await reload();
  };

  const saveGoal = async (g: Goal) => {
    await guard(() => api.saveGoal(token(), g));
    await reload();
    flash("Goal saved");
  };

  const suggest = (q: string) => guard(() => api.suggest(token(), q)).then((r) => r.suggestions);

  return {
    // state
    token,
    month,
    setMonth,
    state,
    meta,
    history,
    accounts,
    activeAccounts,
    accountsByType,
    accountById,
    accountName,
    sourceAccounts,
    destinationAccounts,
    spentByAccount,
    summary,
    goal,
    projections,
    netWorthTotal,
    netWorthInGoal,
    hasExcludedAccounts,
    toast,
    apiError,
    flash,
    // actions
    login,
    logout,
    goMonth,
    goToday,
    addEntry,
    updateEntry,
    deleteEntry,
    createAccount,
    updateAccount,
    setOpeningBalance,
    saveBudget,
    saveGoal,
    suggest,
    reload,
  };
}
