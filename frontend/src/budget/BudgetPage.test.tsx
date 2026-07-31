import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountBalance, Entry, Meta, MonthState } from "./api";

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

  it("keeps the goal tracker visible regardless of tab", async () => {
    render(() => <BudgetPage />);

    expect(await screen.findByText("Need per month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Trends" }));
    expect(screen.getByText("Need per month")).toBeInTheDocument();
  });
});
