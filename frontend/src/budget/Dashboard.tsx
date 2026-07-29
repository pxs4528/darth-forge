import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { money, moneyShort, parseCents, percent } from "./format";
import { budgetStatus, GROUP_LABELS, STATUS_COLORS, type BudgetStore } from "./store";

// Headline numbers and budget-vs-actual. Everything here is derived from the
// ledger — income is the sum of what landed in income accounts, spending the
// sum that landed in expense accounts, surplus the difference.

type Props = { store: BudgetStore };

const Tile: Component<{
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "";
}> = (p) => (
  <div class="bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-3">
    <div class="text-[11px] uppercase tracking-wider text-gray-500">{p.label}</div>
    <div
      class="text-xl font-semibold tabular-nums mt-0.5"
      style={{ color: p.tone === "good" ? "#3fb950" : p.tone === "bad" ? "#f85149" : "#ffffff" }}>
      {p.value}
    </div>
    <Show when={p.sub}>
      <div class="text-[11px] text-gray-500 mt-0.5">{p.sub}</div>
    </Show>
  </div>
);

const Dashboard: Component<Props> = (props) => {
  const { store } = props;

  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [draft, setDraft] = createSignal("");

  const s = () => store.summary();

  const savingsRate = () => {
    const sum = s();
    if (!sum || sum.income_cents <= 0) return 0;
    return sum.surplus_cents / sum.income_cents;
  };

  /** Expense accounts grouped by budget_group, in catalog order. */
  const groups = createMemo(() => {
    const out: { key: string; accounts: ReturnType<BudgetStore["accounts"]> }[] = [];
    for (const a of store.accounts()) {
      if (a.archived || a.type !== "expense") continue;
      const key = a.budget_group || "";
      const existing = out.find((g) => g.key === key);
      if (existing) existing.accounts.push(a);
      else out.push({ key, accounts: [a] });
    }
    return out;
  });

  const budgetFor = (id: number) => store.state()?.budgets[String(id)] ?? 0;
  const spentFor = (id: number) => store.spentByAccount()[id] ?? 0;

  const startEdit = (id: number, cents: number) => {
    setEditingId(id);
    setDraft((cents / 100).toFixed(2));
  };

  const commitEdit = async (id: number) => {
    const cents = parseCents(draft());
    setEditingId(null);
    if (cents === null || cents < 0 || cents === budgetFor(id)) return;
    try {
      await store.saveBudget(id, cents);
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to save budget");
    }
  };

  return (
    <div class="space-y-4">
      <Show when={s()}>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Income" value={money(s()!.income_cents)} sub="money in this month" />
          <Tile label="Spent" value={money(s()!.expense_cents)} sub="expenses this month" />
          <Tile
            label="Surplus"
            value={money(s()!.surplus_cents)}
            tone={s()!.surplus_cents >= 0 ? "good" : "bad"}
            sub="income − spending"
          />
          <Tile
            label="Savings rate"
            value={`${Math.round(savingsRate() * 100)}%`}
            tone={savingsRate() >= 0.3 ? "good" : ""}
            sub={`net worth ${s()!.net_worth_change_cents >= 0 ? "+" : ""}${moneyShort(
              s()!.net_worth_change_cents
            )} this month`}
          />
        </div>
      </Show>

      {/* Budgets */}
      <section class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
        <div class="flex items-baseline justify-between mb-1">
          <h2 class="text-sm font-semibold text-gray-200">Budgets</h2>
          <span class="text-[11px] text-gray-500">click a target to edit</span>
        </div>

        <For each={groups()}>
          {(group) => {
            const groupSpent = () => group.accounts.reduce((sum, a) => sum + spentFor(a.id), 0);
            const groupBudget = () => group.accounts.reduce((sum, a) => sum + budgetFor(a.id), 0);
            return (
              <div class="mt-3">
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    {GROUP_LABELS[group.key] ?? group.key}
                  </span>
                  <span class="text-[11px] text-gray-500 tabular-nums ml-auto">
                    {money(groupSpent())} / {money(groupBudget())}
                  </span>
                </div>
                <div class="space-y-1">
                  <For each={group.accounts}>
                    {(a) => {
                      const spent = () => spentFor(a.id);
                      const budget = () => budgetFor(a.id);
                      const status = () => budgetStatus(spent(), budget());
                      return (
                        <div class="grid grid-cols-[9rem_minmax(0,1fr)_auto] sm:grid-cols-[12rem_minmax(0,1fr)_9rem] gap-2 items-center text-sm">
                          <span class="text-gray-300 truncate text-[13px]">{a.name}</span>
                          <div
                            class="h-2 rounded-full bg-[#21262d] overflow-hidden"
                            role="presentation">
                            <div
                              class="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, percent(spent(), budget()))}%`,
                                background: STATUS_COLORS[status()],
                              }}
                            />
                          </div>
                          <span class="text-right tabular-nums text-[13px]">
                            <span style={{ color: STATUS_COLORS[status()] }}>{money(spent())}</span>
                            <span class="text-gray-600"> / </span>
                            <Show
                              when={editingId() === a.id}
                              fallback={
                                <button
                                  onClick={() => startEdit(a.id, budget())}
                                  class="text-gray-400 hover:text-white underline decoration-dotted underline-offset-2"
                                  aria-label={`Edit ${a.name} budget`}>
                                  {moneyShort(budget())}
                                </button>
                              }>
                              <input
                                type="text"
                                inputmode="decimal"
                                value={draft()}
                                ref={(el) => setTimeout(() => el.focus())}
                                onInput={(e) => setDraft(e.currentTarget.value)}
                                onBlur={() => commitEdit(a.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitEdit(a.id);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                class="w-20 bg-[#161b22] border border-[#3987e5] rounded px-1 py-0 text-right tabular-nums text-white outline-none"
                              />
                            </Show>
                            <Show when={status() === "over"}>
                              <span class="ml-1 text-[10px] font-semibold text-[#f85149]">
                                OVER
                              </span>
                            </Show>
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </section>
    </div>
  );
};

export default Dashboard;
