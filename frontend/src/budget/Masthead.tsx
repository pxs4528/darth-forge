import { createSignal, For, Show, type Component } from "solid-js";
import { amount, money, moneyShort, monthLabel, parseCents } from "./format";
import type { BudgetStore } from "./store";

// The top of the ledger page: one hero figure, the goal as a single thin rule,
// and the month's four numbers as ruled columns. No boxes — the rules and the
// column alignment do all the organising.

type Props = { store: BudgetStore };

// ── masthead ─────────────────────────────────────────────────────────────────

export const Masthead: Component<Props> = (props) => {
  const { store } = props;
  const [editing, setEditing] = createSignal<"amount" | "date" | null>(null);
  const [draft, setDraft] = createSignal("");

  const s = () => store.summary();
  const goal = () => store.goal();

  const pct = () => {
    const sum = s();
    const g = goal();
    if (!sum || !g || g.goal_cents <= 0) return 0;
    return Math.max(0, Math.min(100, (sum.goal_net_worth_cents / g.goal_cents) * 100));
  };

  const commit = async () => {
    const g = goal();
    const mode = editing();
    setEditing(null);
    if (!g || !mode) return;

    if (mode === "amount") {
      const cents = parseCents(draft());
      if (cents === null || cents <= 0 || cents === g.goal_cents) return;
      await store
        .saveGoal({ ...g, goal_cents: cents })
        .catch((e) => store.flash(e instanceof Error ? e.message : "Failed to save goal"));
    } else {
      const month = draft().trim();
      if (!/^\d{4}-\d{2}$/.test(month) || month === g.target_month) return;
      await store
        .saveGoal({ ...g, target_month: month })
        .catch((e) => store.flash(e instanceof Error ? e.message : "Failed to save goal"));
    }
  };

  const editCls = "bg-[#161b22] border border-[#3987e5] px-1 tabular-nums ink outline-none";
  const linkCls = "hover:text-[color:var(--ink)] underline decoration-dotted underline-offset-2";

  return (
    <Show when={s() && goal()}>
      <section class="pt-5 pb-4">
        <div class="flex items-baseline justify-between gap-4">
          <span class="t-label ink-2">Net worth</span>
          <span class="t-hero ink">{money(s()!.net_worth_cents)}</span>
        </div>

        {/* Goal progress: one rule, no box. */}
        <div class="mt-2.5 grid grid-cols-1 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2 items-center">
          <p class="t-meta ink-2 tabular-nums">
            {Math.round(pct())}% of{" "}
            <Show
              when={editing() === "amount"}
              fallback={
                <button
                  onClick={() => {
                    setDraft((goal()!.goal_cents / 100).toFixed(2));
                    setEditing("amount");
                  }}
                  class={linkCls}
                  aria-label="Edit goal amount">
                  {moneyShort(goal()!.goal_cents)}
                </button>
              }>
              <input
                type="text"
                inputmode="decimal"
                value={draft()}
                ref={(el) => setTimeout(() => el.focus())}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                }}
                class={editCls + " w-24 text-right"}
                aria-label="Goal amount"
              />
            </Show>{" "}
            · {s()!.months_remaining} months to{" "}
            <Show
              when={editing() === "date"}
              fallback={
                <button
                  onClick={() => {
                    setDraft(goal()!.target_month);
                    setEditing("date");
                  }}
                  class={linkCls}
                  aria-label="Edit target month">
                  {monthLabel(goal()!.target_month)}
                </button>
              }>
              <input
                type="month"
                value={draft()}
                ref={(el) => setTimeout(() => el.focus())}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                }}
                class={editCls}
                aria-label="Target month"
              />
            </Show>
            {/* The hero counts everything; the goal only counts what you ticked. */}
            <Show when={store.hasExcludedAccounts()}>
              <span class="block sm:inline"> · {money(s()!.goal_net_worth_cents)} counts</span>
            </Show>
          </p>

          <div
            class="h-[3px] bg-[color:var(--rule)] w-full"
            role="progressbar"
            aria-valuenow={Math.round(pct())}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress toward goal">
            <div class="h-full bg-[#3987e5] transition-all" style={{ width: `${pct()}%` }} />
          </div>
        </div>
      </section>
    </Show>
  );
};

// ── summary band ─────────────────────────────────────────────────────────────

const savingsRate = (store: BudgetStore) => {
  const sum = store.summary();
  if (!sum || sum.income_cents <= 0) return 0;
  return sum.surplus_cents / sum.income_cents;
};

export const SummaryBand: Component<Props> = (props) => {
  const { store } = props;
  const s = () => store.summary();

  const cells = (): { label: string; value: string; tone?: "pos" | "neg" }[] => {
    const sum = s()!;
    return [
      { label: "Income", value: amount(sum.income_cents) },
      { label: "Spending", value: amount(sum.expense_cents) },
      {
        label: "Surplus",
        value: amount(sum.surplus_cents),
        tone: sum.surplus_cents >= 0 ? "pos" : "neg",
      },
      { label: "Savings rate", value: `${Math.round(savingsRate(store) * 100)}%` },
    ];
  };

  return (
    <Show when={s()}>
      <section class="rule-strong-t rule-strong-b grid grid-cols-2 sm:grid-cols-4">
        <For each={cells()}>
          {(c, i) => {
            // Hairlines separate columns, so the first in each row carries none.
            // Rows wrap at two columns until sm, where all four sit side by side.
            const leading = () => i() === 0 || i() === 2;
            return (
              <div
                class="py-3 px-4 border-[color:var(--rule)]"
                classList={{
                  "border-l": !leading(),
                  "pl-0": leading(),
                  "sm:border-l sm:pl-4": i() === 2,
                }}>
                <div class="t-label ink-2">{c.label}</div>
                <div class={"t-figure mt-1 " + (c.tone ?? "ink")}>{c.value}</div>
              </div>
            );
          }}
        </For>
      </section>
    </Show>
  );
};
