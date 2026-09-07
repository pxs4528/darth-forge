import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountBalance,
  Entry,
  Meta,
  MonthState,
  PlaidStatus,
  RegisterRow,
  StagedTxn,
} from "./api";

// Renders the whole page against a stubbed API. The point is the ledger layout:
// one hero figure, the summary band, and a tab strip that swaps the section
// under it. It also catches runtime errors in components that are otherwise
// only reachable behind the admin password.

const account = (
  id: number,
  name: string,
  type: AccountBalance["type"],
  extra: Partial<AccountBalance> = {}
): AccountBalance => ({
  id,
  name,
  type,
  subtype: "",
  budget_group: "",
  sort: id,
  archived: false,
  in_goal: true,
  balance_cents: 0,
  change_cents: 0,
  ...extra,
});

const ACCOUNTS: AccountBalance[] = [
  account(1, "Chase Checking", "asset", {
    subtype: "cash",
    balance_cents: 1_200_000,
    change_cents: 341_063,
  }),
  account(2, "Brokerage", "asset", { subtype: "invested", balance_cents: 3_598_328 }),
  account(3, "Discover", "liability", { balance_cents: -50_000, change_cents: -50_000 }),
  account(4, "Paycheck", "income", { balance_cents: -575_184, change_cents: -575_184 }),
  account(5, "Groceries", "expense", {
    budget_group: "food",
    balance_cents: 234_121,
    change_cents: 234_121,
  }),
  account(6, "Opening Balances", "equity"),
];

const ENTRIES: Entry[] = [
  {
    id: 11,
    date: "2026-07-24",
    month: "2026-07",
    description: "Paycheck",
    splits: [
      { account_id: 4, amount_cents: -287_592 },
      { account_id: 1, amount_cents: 287_592 },
    ],
  },
  {
    id: 12,
    date: "2026-07-24",
    month: "2026-07",
    description: "Trader Joe's",
    splits: [
      { account_id: 1, amount_cents: -20_000 },
      { account_id: 5, amount_cents: 20_000 },
    ],
  },
];

const MONTH: MonthState = {
  month: "2026-07",
  accounts: ACCOUNTS,
  entries: ENTRIES,
  budgets: { "5": 300_000 },
  goal: { goal_cents: 10_000_000, target_month: "2028-10", emergency_months: 6 },
  summary: {
    income_cents: 575_184,
    expense_cents: 234_121,
    surplus_cents: 341_063,
    net_worth_cents: 4_798_328,
    goal_net_worth_cents: 4_798_328,
    net_worth_change_cents: 341_063,
    months_remaining: 27,
    target_monthly_cents: 192_654,
  },
};

// Chase Checking's own side of each entry, newest first, as /register returns it.
const REGISTER_ROWS: RegisterRow[] = [
  {
    ...ENTRIES[1],
    split_id: 102,
    amount_cents: -20_000,
    balance_cents: 267_592,
    reconcile_state: "n",
  },
  {
    ...ENTRIES[0],
    split_id: 101,
    amount_cents: 287_592,
    balance_cents: 287_592,
    reconcile_state: "n",
  },
];

const PLAID_STATUS: PlaidStatus = {
  configured: true,
  env: "sandbox",
  items: [
    {
      item_id: "item-1",
      institution_id: "ins_1",
      institution_name: "Chase",
      status: "ok",
      last_sync: "2026-08-30T10:00:00Z",
      created_at: "2026-08-01",
    },
  ],
  accounts: [
    {
      plaid_account_id: "pa-checking",
      item_id: "item-1",
      account_id: 1, // Chase Checking
      name: "Chase Checking ••1234",
      mask: "1234",
      type: "depository",
      subtype: "checking",
      sync_mode: "transactions",
      balance_cents: 1_200_000,
      balance_at: "2026-08-30",
    },
    {
      plaid_account_id: "pa-brokerage",
      item_id: "item-1",
      account_id: 2, // Brokerage
      name: "Fidelity",
      mask: "",
      type: "investment",
      subtype: "brokerage",
      sync_mode: "balance",
      balance_cents: 3_598_328,
      balance_at: "2026-08-30",
    },
  ],
};

const STAGED: StagedTxn[] = [
  {
    plaid_txn_id: "s1",
    plaid_account_id: "pa-checking",
    date: "2026-08-04",
    name: "TRADER JOE'S #998",
    merchant: "Trader Joe's",
    category: "FOOD_AND_DRINK",
    amount_cents: -4_200,
    pending: false,
    status: "new",
    txn_id: 0,
    counter_account_id: 5, // Groceries — proposed from history
    transfer_pair: "",
  },
];

const META: Meta = {
  account_types: ["asset", "liability", "income", "expense", "equity"],
  budget_groups: ["housing", "food", "misc"],
  asset_classes: ["cash", "invested", "retirement", "other"],
  defaults: { goal_cents: 10_000_000, target_month: "2028-10" },
};

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    loadToken: () => "test-token",
    saveToken: vi.fn(),
    clearToken: vi.fn(),
    api: {
      meta: vi.fn(async () => META),
      month: vi.fn(async () => MONTH),
      history: vi.fn(async () => ({
        history: [
          {
            month: "2026-06",
            income_cents: 550_000,
            expense_cents: 210_000,
            net_worth_cents: 4_400_000,
          },
          {
            month: "2026-07",
            income_cents: 575_184,
            expense_cents: 234_121,
            net_worth_cents: 4_798_328,
          },
        ],
      })),
      suggest: vi.fn(async () => ({ suggestions: [] })),
      register: vi.fn(async () => ({ rows: REGISTER_ROWS, cleared_cents: 0 })),
      setReconcile: vi.fn(async () => ({ changed: 1 })),
      reconcileAccount: vi.fn(async () => ({ changed: 2 })),
      reset: vi.fn(async () => ({ entries_deleted: 2 })),
      plaidStatus: vi.fn(async () => PLAID_STATUS),
      plaidStaged: vi.fn(async () => ({ staged: STAGED })),
      plaidAccept: vi.fn(async () => ENTRIES[0]),
      plaidIgnore: vi.fn(async () => ({ ignored: 1 })),
      plaidSync: vi.fn(async () => ({
        imported: 3,
        queued: 1,
        transfers: 1,
        balances: 2,
        problems: [],
      })),
      plaidLinkToken: vi.fn(async () => ({ link_token: "link-sandbox-1" })),
      plaidMapAccount: vi.fn(async () => ({ message: "mapped" })),
      plaidUnlink: vi.fn(async () => ({ message: "unlinked" })),
    },
  };
});

const { default: BudgetPage } = await import("./BudgetPage");

describe("BudgetPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leads with the net worth figure and the goal progress line", async () => {
    render(() => <BudgetPage />);

    expect(await screen.findByText("$47,983.28")).toBeInTheDocument();
    // 4,798,328 / 10,000,000 → 48%, and the target is 27 months out.
    expect(await screen.findByText(/48% of/)).toBeInTheDocument();
    expect(await screen.findByText(/27 months to/)).toBeInTheDocument();
  });

  it("shows the month's four figures as a summary band", async () => {
    render(() => <BudgetPage />);

    for (const label of ["Income", "Spending", "Surplus", "Savings rate"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(await screen.findByText("5,751.84")).toBeInTheDocument();
    expect(await screen.findByText("2,341.21")).toBeInTheDocument();
    expect(await screen.findByText("3,410.63")).toBeInTheDocument();
    expect(await screen.findByText("59%")).toBeInTheDocument();
  });

  it("signs register amounts by whether the money left for good", async () => {
    render(() => <BudgetPage />);

    // A paycheck arriving is positive; groceries take a true minus (U+2212).
    expect(await screen.findByText("2,875.92")).toBeInTheDocument();
    expect(await screen.findByText("−200.00")).toBeInTheDocument();
  });

  it("opens on the register and swaps sections when a tab is clicked", async () => {
    render(() => <BudgetPage />);

    expect(await screen.findByText("Trader Joe's")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    // "Net worth" also labels the masthead, so assert on the balance sheet itself.
    expect(await screen.findByText("Assets")).toBeInTheDocument();
    expect(screen.getByText("Chase Checking")).toBeInTheDocument();
    expect(screen.queryByText("Trader Joe's")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Allocation" }));
    expect(await screen.findByText("Cash reserve")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Budgets" }));
    expect(await screen.findByText("All spending")).toBeInTheDocument();
  });

  it("drives the difference to zero as entries are ticked off", async () => {
    render(() => <BudgetPage />);
    await screen.findByText("Trader Joe's");

    fireEvent.click(screen.getByRole("tab", { name: "Reconcile" }));
    fireEvent.change(await screen.findByLabelText("Account to reconcile"), {
      target: { value: "1" },
    });

    const rows = await screen.findAllByRole("checkbox");
    fireEvent.input(screen.getByLabelText("Closing balance"), {
      target: { value: "2675.92" },
    });
    // Nothing ticked yet, so the whole statement is still unexplained: it shows
    // as both the Statement and the Difference figure.
    expect(await screen.findAllByText("$2,675.92")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "lock this statement" })).toBeDisabled();

    fireEvent.click(rows[0]); // −200.00 groceries
    fireEvent.click(rows[1]); // +2,875.92 paycheck

    // 2,875.92 − 200.00 = 2,675.92, so the books now agree with the bank.
    expect(await screen.findByText("$0.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lock this statement" })).not.toBeDisabled();
  });

  it("will not let you lock a statement that does not balance", async () => {
    render(() => <BudgetPage />);
    await screen.findByText("Trader Joe's");

    fireEvent.click(screen.getByRole("tab", { name: "Reconcile" }));
    fireEvent.change(await screen.findByLabelText("Account to reconcile"), {
      target: { value: "1" },
    });
    const rows = await screen.findAllByRole("checkbox");
    fireEvent.input(screen.getByLabelText("Closing balance"), {
      target: { value: "9999.00" },
    });
    fireEvent.click(rows[1]);

    expect(await screen.findByText(/Off by/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lock this statement" })).toBeDisabled();
  });

  it("queues imported transactions for review with a proposed account", async () => {
    const { api } = await import("./api");
    render(() => <BudgetPage />);
    await screen.findByText("Trader Joe's");

    fireEvent.click(screen.getByRole("tab", { name: "Banks" }));

    // The linked institution and both accounts are listed.
    expect(await screen.findByText("Chase")).toBeInTheDocument();
    expect(screen.getByText("Chase Checking ••1234")).toBeInTheDocument();

    // The imported row shows with the account proposed from history already
    // selected, so accepting is one click.
    const picker = (await screen.findByLabelText(
      "Other side of Trader Joe's"
    )) as HTMLSelectElement;
    expect(picker.value).toBe("5");

    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await vi.waitFor(() => expect(api.plaidAccept).toHaveBeenCalled());

    expect(api.plaidAccept).toHaveBeenCalledWith("test-token", "s1", 5, "Trader Joe's");
  });

  it("defaults an investment account to balance-only sync", async () => {
    render(() => <BudgetPage />);
    await screen.findByText("Trader Joe's");

    fireEvent.click(screen.getByRole("tab", { name: "Banks" }));

    // A brokerage feed is dividends and rebalances that mean nothing without
    // cost-basis tracking, so it tracks value instead.
    const mode = (await screen.findByLabelText("Sync mode for Fidelity")) as HTMLSelectElement;
    expect(mode.value).toBe("balance");

    const checking = screen.getByLabelText(
      "Sync mode for Chase Checking ••1234"
    ) as HTMLSelectElement;
    expect(checking.value).toBe("transactions");
  });

  it("collapses the entry form on a phone so the register is reachable", async () => {
    const wide = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    try {
      render(() => <BudgetPage />);
      await screen.findByText("Trader Joe's");

      // Six stacked controls would push the register a screen and a half down.
      expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "add" }));
      expect(await screen.findByLabelText("Description")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { value: wide, configurable: true });
    }
  });

  it("leaves the entry form open on a wide screen", async () => {
    render(() => <BudgetPage />);
    await screen.findByText("Trader Joe's");

    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    // The toggle stays in the DOM and is hidden by `sm:hidden`, which jsdom
    // can't evaluate — so assert the state it reports rather than its display.
    expect(screen.getByRole("button", { name: "add" })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the goal tracker visible regardless of tab", async () => {
    render(() => <BudgetPage />);

    expect(await screen.findByText("Need per month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Trends" }));
    expect(screen.getByText("Need per month")).toBeInTheDocument();
  });
});
