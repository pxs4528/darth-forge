import { createSignal, For, Show, type Component } from "solid-js";
import { money, moneyShort, parseCents, percent } from "./format";
import { budgetStatus, GROUP_META, STATUS_COLORS, type BudgetStore } from "./store";

// Current-month dashboard: stat tiles, then per-category budget bars grouped
// by category group. Bar fill color = status (green/yellow/red); the group
// chip + label carry identity, so color never stands alone.

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
      class="text-xl font-bold tabular-nums mt-0.5"
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

  const [editingCat, setEditingCat] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal("");

  const groups = () => {
    const cats = store.catalog()?.categories ?? [];
    const seen: string[] = [];
    for (const c of cats) if (!seen.includes(c.group)) seen.push(c.group);
    return seen;
  };

  const startBudgetEdit = (key: string, cents: number) => {
    setEditingCat(key);
    setDraft((cents / 100).toFixed(2));
  };

  const commitBudgetEdit = async (key: string) => {
    const cents = parseCents(draft());
    setEditingCat(null);
    if (cents === null || cents < 0) return;
    if (cents === (store.state()?.budgets[key] ?? -1)) return;
    try {
      await store.saveBudget(key, cents);
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to save budget");
    }
  };

  const m = store.metrics;

  return (
    <div class="space-y-4">
      {/* Stat tiles */}
      <Show when={m() && store.state()}>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile
            label="Income"
            value={money(store.state()!.income_cents)}
            sub={store.state()!.three_paycheck ? "3-paycheck month" : "2 paychecks"}
          />
          <Tile
            label="Spent"
            value={money(m()!.spendCents)}
            sub={`${money(m()!.totalOutCents)} incl. savings`}
          />
          <Tile
            label="Surplus"
            value={money(m()!.surplusCents)}
            tone={m()!.surplusCents >= 0 ? "good" : "bad"}
            sub="income − all outflows"
          />
          <Tile
            label="Savings rate"
            value={`${Math.round(m()!.savingsRate * 100)}%`}
            tone={m()!.savingsRate >= 0.3 ? "good" : ""}
            sub={`${moneyShort(m()!.investedCents)} to savings + match`}
          />
        </div>

        {/* Where savings went */}
        <div class="bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span class="text-gray-500 text-[11px] uppercase tracking-wider self-center">
            To net worth
          </span>
          <span class="text-gray-300">
            HYSA{" "}
            <span class="text-white font-bold tabular-nums">
              {money(m()!.spentByCategory["hysa"] ?? 0)}
            </span>
          </span>
          <span class="text-gray-300">
            Index{" "}
            <span class="text-white font-bold tabular-nums">
              {money(m()!.spentByCategory["index_fund"] ?? 0)}
            </span>
          </span>
          <span class="text-gray-300">
            401k match{" "}
            <span class="text-white font-bold tabular-nums">
              {money(store.state()!.match_401k_cents)}
            </span>
          </span>
          <span class="text-gray-300 ml-auto">
            = <span class="text-[#3fb950] font-bold tabular-nums">{money(m()!.investedCents)}</span>
          </span>
        </div>
      </Show>

      {/* Category bars, grouped */}
      <section class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
        <div class="flex items-baseline justify-between mb-1">
          <h2 class="text-sm font-bold text-gray-200">Budgets</h2>
          <span class="text-[11px] text-gray-500">click a budget number to edit</span>
        </div>

        <For each={groups()}>
          {(group) => {
            const cats = () => (store.catalog()?.categories ?? []).filter((c) => c.group === group);
            const groupSpent = () =>
              cats().reduce((sum, c) => sum + (m()?.spentByCategory[c.key] ?? 0), 0);
            const groupBudget = () =>
              cats().reduce((sum, c) => sum + (store.state()?.budgets[c.key] ?? 0), 0);
            return (
              <div class="mt-3">
                <div class="flex items-center gap-2 mb-1.5">
                  <span
                    class="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: GROUP_META[group]?.color }}
                  />
                  <span class="text-xs font-bold text-gray-300 uppercase tracking-wider">
                    {GROUP_META[group]?.label ?? group}
                  </span>
                  <span class="text-[11px] text-gray-500 tabular-nums ml-auto">
                    {money(groupSpent())} / {money(groupBudget())}
                  </span>
                </div>
                <div class="space-y-1">
                  <For each={cats()}>
                    {(c) => {
                      const spent = () => m()?.spentByCategory[c.key] ?? 0;
                      const budget = () => store.state()?.budgets[c.key] ?? 0;
                      const pct = () => percent(spent(), budget());
                      const status = () => budgetStatus(spent(), budget());
                      return (
                        <div class="grid grid-cols-[10rem_1fr_auto] sm:grid-cols-[12rem_1fr_9rem] gap-2 items-center text-sm">
                          <span class="text-gray-300 truncate text-[13px]">{c.label}</span>
                          <div
                            class="h-2 rounded-full bg-[#21262d] overflow-hidden"
                            role="presentation">
                            <div
                              class="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, pct())}%`,
                                background: STATUS_COLORS[status()],
                              }}
                            />
                          </div>
                          <span class="text-right tabular-nums text-[13px]">
                            <span style={{ color: STATUS_COLORS[status()] }}>{money(spent())}</span>
                            <span class="text-gray-600"> / </span>
                            <Show
                              when={editingCat() === c.key}
                              fallback={
                                <button
                                  onClick={() => startBudgetEdit(c.key, budget())}
                                  class="text-gray-400 hover:text-white underline decoration-dotted underline-offset-2"
                                  aria-label={`Edit ${c.label} budget`}>
                                  {moneyShort(budget())}
                                </button>
                              }>
                              <input
                                type="text"
                                inputmode="decimal"
                                value={draft()}
                                ref={(el) => setTimeout(() => el.focus())}
                                onInput={(e) => setDraft(e.currentTarget.value)}
                                onBlur={() => commitBudgetEdit(c.key)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitBudgetEdit(c.key);
                                  if (e.key === "Escape") setEditingCat(null);
                                }}
                                class="w-20 bg-[#161b22] border border-[#3987e5] rounded px-1 py-0 text-right tabular-nums text-white outline-none"
                              />
                            </Show>
                            <Show when={status() === "over"}>
                              <span class="ml-1 text-[10px] font-bold text-[#f85149]">OVER</span>
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
