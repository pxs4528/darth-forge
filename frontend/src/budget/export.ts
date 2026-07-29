import type { MonthState } from "./api";
import { simpleShape } from "./store";

// CSV export of the month: summary, balance sheet, budget-vs-actual, then
// every entry in from → to form. Downloads via a Blob link — no server.

const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const usd = (cents: number): string => (cents / 100).toFixed(2);

export const buildCsv = (state: MonthState, accountName: (id: number) => string): string => {
  const lines: string[] = [];
  const s = state.summary;

  lines.push(`Budget export,${state.month}`);
  lines.push("");
  lines.push("Summary,USD");
  lines.push(`Income,${usd(s.income_cents)}`);
  lines.push(`Spending,${usd(s.expense_cents)}`);
  lines.push(`Surplus,${usd(s.surplus_cents)}`);
  lines.push(`Net worth,${usd(s.net_worth_cents)}`);
  lines.push(`Net worth change,${usd(s.net_worth_change_cents)}`);
  lines.push(`Goal,${usd(state.goal.goal_cents)}`);
  lines.push(`Target month,${state.goal.target_month}`);
  lines.push(`Needed per month,${usd(s.target_monthly_cents)}`);
  lines.push("");

  lines.push("Account,Type,Balance,Change this month");
  for (const a of state.accounts) {
    if (a.archived) continue;
    if (a.type !== "asset" && a.type !== "liability") continue;
    lines.push(`${esc(a.name)},${a.type},${usd(a.balance_cents)},${usd(a.change_cents)}`);
  }
  lines.push("");

  lines.push("Expense account,Budgeted,Spent,Remaining");
  for (const a of state.accounts) {
    if (a.archived || a.type !== "expense") continue;
    const budget = state.budgets[String(a.id)] ?? 0;
    lines.push(
      `${esc(a.name)},${usd(budget)},${usd(a.change_cents)},${usd(budget - a.change_cents)}`
    );
  }
  lines.push("");

  lines.push("Date,Description,Amount,From,To");
  // oldest first reads naturally in a spreadsheet
  for (const entry of [...state.entries].reverse()) {
    const shape = simpleShape(entry);
    if (shape) {
      lines.push(
        `${entry.date},${esc(entry.description)},${usd(shape.amountCents)},` +
          `${esc(accountName(shape.fromId))},${esc(accountName(shape.toId))}`
      );
    } else {
      // Multi-split entries can't collapse to from/to; emit one line per split.
      for (const split of entry.splits) {
        lines.push(
          `${entry.date},${esc(entry.description)},${usd(split.amount_cents)},` +
            `${esc(accountName(split.account_id))},`
        );
      }
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
