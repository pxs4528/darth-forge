import type { MonthState } from "./api";
import type { Metrics } from "./store";

// CSV export of the current month: summary block, budget-vs-actual per
// category, then every transaction. Downloads via a Blob link — no server.

const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const usd = (cents: number): string => (cents / 100).toFixed(2);

export const buildCsv = (
  state: MonthState,
  metrics: Metrics,
  labelOf: (key: string) => string,
  accountName: (id: number) => string
): string => {
  const lines: string[] = [];

  lines.push(`Budget export,${state.month}`);
  lines.push("");
  lines.push("Summary,USD");
  lines.push(`Income,${usd(metrics.incomeCents)}`);
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

  lines.push("Date,Description,Amount,Category,Account");
  // oldest first reads naturally in a spreadsheet
  for (const tx of [...state.transactions].reverse()) {
    lines.push(
      `${tx.date},${esc(tx.description)},${usd(tx.amount_cents)},${esc(labelOf(tx.category))},${esc(
        tx.account_id ? accountName(tx.account_id) : ""
      )}`
    );
  }

  if (state.transfers.length > 0) {
    lines.push("");
    lines.push("Transfers");
    lines.push("Date,From,To,Amount,Note");
    for (const t of [...state.transfers].reverse()) {
      lines.push(
        `${t.date},${esc(accountName(t.from_account))},${esc(accountName(t.to_account))},${usd(
          t.amount_cents
        )},${esc(t.note)}`
      );
    }
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
