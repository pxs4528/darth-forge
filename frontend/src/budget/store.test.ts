import { describe, expect, it } from "vitest";
import type { MonthState, Transaction } from "./api";
import { computeMetrics } from "./store";

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 1,
  month: "2026-07",
  date: "2026-07-15",
  description: "test",
  amount_cents: 0,
  category: "misc",
  account_id: 0,
  ...overrides,
});

const baseState = (transactions: Transaction[]): MonthState => ({
  month: "2026-07",
  income_cents: 999999, // legacy field — must be ignored entirely
  three_paycheck: false,
  match_401k_cents: 24500,
  budgets: {},
  transactions,
  net_worth: {
    month: "2026-07",
    hysa_cents: 0,
    brokerage_cents: 0,
    k401_vested_cents: 0,
    k401_unvested_cents: 0,
    months_remaining: 12,
    goal_cents: 10000000,
  },
  accounts: [],
  transfers: [],
});

const savingsKeys = new Set(["hysa", "index_fund"]);
const incomeKeys = new Set(["paycheck", "other_income"]);

describe("computeMetrics — income as transactions", () => {
  it("derives incomeCents from income-category transactions, not the legacy field", () => {
    const state = baseState([
      tx({ id: 1, category: "paycheck", amount_cents: -287592, date: "2026-07-15" }),
      tx({ id: 2, category: "paycheck", amount_cents: -287592, date: "2026-07-31" }),
    ]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.incomeCents).toBe(575184); // two paychecks, ignores income_cents: 999999
  });

  it("excludes income transactions from totalOutCents — a paycheck must not offset spending", () => {
    const state = baseState([
      tx({ id: 1, category: "paycheck", amount_cents: -287592 }),
      tx({ id: 2, category: "groceries", amount_cents: 5000 }),
    ]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.totalOutCents).toBe(5000); // not 5000 - 287592
    expect(m.incomeCents).toBe(287592);
  });

  it("computes surplus as income minus outflows, using the derived income", () => {
    const state = baseState([
      tx({ id: 1, category: "paycheck", amount_cents: -575184 }),
      tx({ id: 2, category: "rent", amount_cents: 112000 }),
      tx({ id: 3, category: "groceries", amount_cents: 30000 }),
    ]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.surplusCents).toBe(575184 - 112000 - 30000);
  });

  it("still tracks savings-category spend and 401k match for savings rate", () => {
    const state = baseState([
      tx({ id: 1, category: "paycheck", amount_cents: -575184 }),
      tx({ id: 2, category: "hysa", amount_cents: 80000 }),
    ]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.savedTxCents).toBe(80000);
    expect(m.investedCents).toBe(80000 + 24500);
    expect(m.savingsRate).toBeCloseTo((80000 + 24500) / (575184 + 24500));
  });

  it("a refund entered as a negative expense is unaffected by the income convention", () => {
    const state = baseState([
      tx({ id: 1, category: "clothing", amount_cents: 5000 }),
      tx({ id: 2, category: "clothing", amount_cents: -2000 }), // store return
    ]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.totalOutCents).toBe(3000); // net of the refund, as before this feature
    expect(m.incomeCents).toBe(0);
    expect(m.spentByCategory["clothing"]).toBe(3000);
  });

  it("handles a paycheck correction (positive amount under an income category)", () => {
    // signForCategory flips whatever sign the user's edit carries — an
    // explicit negative entry under "Paycheck" becomes a positive stored
    // amount, meaning money leaving via that category (a clawback).
    const state = baseState([tx({ id: 1, category: "paycheck", amount_cents: 5000 })]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.incomeCents).toBe(-5000);
  });

  it("zero income transactions yields zero income and a savings rate of 0", () => {
    const state = baseState([tx({ id: 1, category: "groceries", amount_cents: 5000 })]);
    const m = computeMetrics(state, savingsKeys, incomeKeys);
    expect(m.incomeCents).toBe(0);
    // denom = incomeCents + match; match is nonzero here so this isn't the
    // 0/0 guard, just confirms income contributes nothing.
    expect(m.savingsRate).toBeCloseTo(24500 / (0 + 24500));
  });
});
