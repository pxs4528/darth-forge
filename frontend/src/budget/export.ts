import type { MonthState } from "./api";
import type { Metrics } from "./store";

// CSV export of the current month: summary block, budget-vs-actual per
// category, then every transaction. Downloads via a Blob link — no server.

const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const usd = (cents: number): string => (cents / 100).toFixed(2);

export const buildCsv = (
  state: MonthState,
  metrics: Metrics,
  labelOf: (key: string) => string
): string => {
  const lines: string[] = [];

  lines.push(`Budget export,${state.month}`);
  lines.push("");
  lines.push("Summary,USD");
  lines.push(`Income,${usd(state.income_cents)}`);
  lines.push(`401k match,${usd(state.match_401k_cents)}`);
  lines.push(`Total outflows,${usd(metrics.totalOutCents)}`);
  lines.push(`Spending (excl. savings),${usd(metrics.spendCents)}`);
  lines.push(`To savings/investments,${usd(metrics.savedTxCents)}`);
  lines.push(`Surplus,${usd(metrics.surplusCents)}`);
  lines.push(`Savings rate,${(metrics.savingsRate * 100).toFixed(1)}%`);
  lines.push(`Net worth,${usd(metrics.netWorthTotalCents)}`);
  lines.push(`Monthly target,${usd(metrics.targetMonthlyCents)}`);
  lines.push("");

  lines.push("Category,Budgeted,Spent,Remaining");
  for (const [key, budget] of Object.entries(state.budgets)) {
    const spent = metrics.spentByCategory[key] ?? 0;
    lines.push(`${esc(labelOf(key))},${usd(budget)},${usd(spent)},${usd(budget - spent)}`);
  }
  lines.push("");

  lines.push("Date,Description,Amount,Category");
  // oldest first reads naturally in a spreadsheet
  for (const tx of [...state.transactions].reverse()) {
    lines.push(
      `${tx.date},${esc(tx.description)},${usd(tx.amount_cents)},${esc(labelOf(tx.category))}`
    );
  }

  return lines.join("\n") + "\n";
};

export const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
