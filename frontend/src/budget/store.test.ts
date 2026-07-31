import { describe, expect, it } from "vitest";
import type { Account, AccountType } from "./api";
import { displayBalance, signedAmount, simpleShape, splitsFor } from "./store";

describe("splitsFor", () => {
  it("always produces a balanced pair", () => {
    const splits = splitsFor(1, 2, 5000);
    expect(splits.reduce((sum, s) => sum + s.amount_cents, 0)).toBe(0);
  });

  it("credits the source and debits the destination", () => {
    const [from, to] = splitsFor(7, 9, 12345);
    expect(from).toEqual({ account_id: 7, amount_cents: -12345 });
    expect(to).toEqual({ account_id: 9, amount_cents: 12345 });
  });
});

describe("simpleShape", () => {
  it("reduces a two-split entry back to from/to/amount", () => {
    const shape = simpleShape({ splits: splitsFor(3, 4, 2500) });
    expect(shape).toEqual({ fromId: 3, toId: 4, amountCents: 2500 });
  });

  it("round-trips through splitsFor unchanged", () => {
    const original = { fromId: 11, toId: 22, amountCents: 98765 };
    const shape = simpleShape({
      splits: splitsFor(original.fromId, original.toId, original.amountCents),
    });
    expect(shape).toEqual(original);
  });

  it("returns null for multi-split entries rather than guessing", () => {
    const splits = [
      { account_id: 1, amount_cents: -10000 },
      { account_id: 2, amount_cents: 6000 },
      { account_id: 3, amount_cents: 4000 },
    ];
    expect(simpleShape({ splits })).toBeNull();
  });

  it("returns null when both splits sit on the same side", () => {
    const splits = [
      { account_id: 1, amount_cents: 5000 },
      { account_id: 2, amount_cents: 5000 },
    ];
    expect(simpleShape({ splits })).toBeNull();
  });
});

describe("signedAmount", () => {
  // 1 checking, 2 paycheck, 3 groceries, 4 savings.
  const types: Record<number, AccountType> = {
    1: "asset",
    2: "income",
    3: "expense",
    4: "asset",
  };
  const lookup = (id: number): Account | undefined =>
    types[id] ? ({ id, name: `acct-${id}`, type: types[id] } as Account) : undefined;

  it("reads a paycheck as money in", () => {
    expect(signedAmount({ splits: splitsFor(2, 1, 287592) }, lookup)).toBe(287592);
  });

  it("reads a card purchase as money out", () => {
    expect(signedAmount({ splits: splitsFor(1, 3, 4210) }, lookup)).toBe(-4210);
  });

  it("keeps a transfer positive — you still have the money", () => {
    expect(signedAmount({ splits: splitsFor(1, 4, 100000) }, lookup)).toBe(100000);
  });

  it("sums the destination sides of a multi-split entry", () => {
    const splits = [
      { account_id: 1, amount_cents: -10000 },
      { account_id: 3, amount_cents: 6000 }, // groceries
      { account_id: 4, amount_cents: 4000 }, // savings
    ];
    expect(signedAmount({ splits }, lookup)).toBe(-6000 + 4000);
  });

  it("does not flip the sign when the account is unknown", () => {
    expect(signedAmount({ splits: splitsFor(1, 99, 5000) }, lookup)).toBe(5000);
  });
});

describe("displayBalance", () => {
  it("shows assets and expenses as stored", () => {
    expect(displayBalance("asset", 200000)).toBe(200000);
    expect(displayBalance("expense", 5000)).toBe(5000);
  });

  it("flips liabilities so debt reads as a positive amount owed", () => {
    // A credit card carrying $500 of debt is stored as -50000.
    expect(displayBalance("liability", -50000)).toBe(50000);
  });

  it("flips income so earnings read as positive", () => {
    expect(displayBalance("income", -287592)).toBe(287592);
  });

  it("flips equity, which carries opening balances as credits", () => {
    expect(displayBalance("equity", -200000)).toBe(200000);
  });

  it("shows an overpaid card as a negative amount owed", () => {
    // Paying more than you owe leaves a positive stored balance.
    expect(displayBalance("liability", 2500)).toBe(-2500);
  });
});
