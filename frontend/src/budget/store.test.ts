import { describe, expect, it } from "vitest";
import { displayBalance, simpleShape, splitsFor } from "./store";

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
