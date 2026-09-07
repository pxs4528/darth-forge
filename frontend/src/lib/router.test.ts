import { afterEach, describe, expect, it, vi } from "vitest";

// The two-hostname deployment rests on this: one bundle serves both the
// portfolio and the budget tool, and the budget hostname has to resolve "/" to
// the budget app. If this is wrong, budget.example.com quietly serves the
// portfolio and the split looks like it worked.

const realLocation = window.location;

/** Loads a fresh copy of the router as if served from the given URL. */
const routerAt = async (hostname: string, pathname: string) => {
  vi.resetModules();
  Object.defineProperty(window, "location", {
    value: { hostname, pathname, protocol: "https:" },
    writable: true,
    configurable: true,
  });
  return import("./router");
};

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: realLocation,
    writable: true,
    configurable: true,
  });
});

describe("router", () => {
  it("serves the budget app at the root of the budget hostname", async () => {
    const { path, isBudgetHost } = await routerAt("budget.example.com", "/");
    expect(isBudgetHost()).toBe(true);
    expect(path()).toBe("/budget");
  });

  it("leaves the portfolio root alone", async () => {
    const { path, isBudgetHost } = await routerAt("example.com", "/");
    expect(isBudgetHost()).toBe(false);
    expect(path()).toBe("/");
  });

  it("still serves /budget as a path on the portfolio host", async () => {
    // Useful in local dev, where everything is on localhost.
    const { path } = await routerAt("localhost", "/budget");
    expect(path()).toBe("/budget");
  });

  it("does not rewrite deeper paths on the budget hostname", async () => {
    const { path } = await routerAt("budget.example.com", "/some/page");
    expect(path()).toBe("/some/page");
  });

  it("only matches the budget hostname on its own label", async () => {
    // "budgetary.example.com" or "mybudget.example.com" are not the budget host;
    // a substring match here would hand the ledger to the wrong origin.
    for (const host of ["budgetary.example.com", "mybudget.example.com", "example.com"]) {
      const { isBudgetHost } = await routerAt(host, "/");
      expect(isBudgetHost(), host).toBe(false);
    }
  });
});
