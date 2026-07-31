import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { amount, moneyShort, parseCents, percent } from "./format";
import { budgetStatus, GROUP_LABELS, STATUS_COLORS, type BudgetStore } from "./store";

// Budget vs. actual, grouped the way the expense catalog is grouped. The
// headline numbers that used to live here moved to the summary band; this is
// now purely the "am I within my targets" view.
//
// Targets are edited in place — click the figure in the TARGET column.

type Props = { store: BudgetStore };

const Dashboard: Component<Props> = (props) => {
  const { store } = props;

  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [draft, setDraft] = createSignal("");

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

  const totalSpent = () => groups().reduce((sum, g) => sum + rowsTotal(g.accounts, spentFor), 0);
  const totalBudget = () => groups().reduce((sum, g) => sum + rowsTotal(g.accounts, budgetFor), 0);

  return (
    <section>
      {/* Column headers, same grid as the rows below. */}
      <div class="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem] gap-3 t-label ink-2 pb-2 rule-b">
        <span>Account</span>
        <span class="hidden sm:block" aria-hidden="true" />
        <span class="text-right">Spent</span>
        <span class="text-right">Target</span>
      </div>

      <For each={groups()}>
        {(group) => {
          const groupSpent = () => rowsTotal(group.accounts, spentFor);
          const groupBudget = () => rowsTotal(group.accounts, budgetFor);
          return (
            <div>
              <div class="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem] gap-3 pt-4 pb-1.5 t-label ink">
                <span>{GROUP_LABELS[group.key] ?? group.key}</span>
                <span class="hidden sm:block" aria-hidden="true" />
                <span class="text-right tabular-nums ink-2">{amount(groupSpent())}</span>
                <span class="text-right tabular-nums ink-2">{amount(groupBudget())}</span>
              </div>

              <div class="ruled-rows rule-t">
                <For each={group.accounts}>
                  {(a) => {
                    const spent = () => spentFor(a.id);
                    const budget = () => budgetFor(a.id);
                    const status = () => budgetStatus(spent(), budget());
                    return (
                      <div class="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem] gap-3 items-center py-1.5 t-meta">
                        <span class="ink truncate">
                          {a.name}
                          <Show when={status() === "over"}>
                            <span class="ml-1.5 t-label neg">over</span>
                          </Show>
                        </span>

                        {/* The bar is a rule, not a pill — same weight as the goal rule. */}
                        <span class="hidden sm:block h-[3px] bg-[color:var(--rule)]">
                          <span
                            class="block h-full transition-all"
                            style={{
                              width: `${Math.min(100, percent(spent(), budget()))}%`,
                              background: STATUS_COLORS[status()],
                            }}
                          />
                        </span>

                        <span
                          class="text-right tabular-nums"
                          style={{ color: STATUS_COLORS[status()] }}>
                          {amount(spent())}
                        </span>

                        <span class="text-right tabular-nums">
                          <Show
                            when={editingId() === a.id}
                            fallback={
                              <button
                                onClick={() => startEdit(a.id, budget())}
                                class="ink-2 hover:text-[color:var(--ink)] underline decoration-dotted underline-offset-2"
                                aria-label={`Edit ${a.name} target`}>
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
                              class="w-20 bg-[#161b22] border border-[#3987e5] px-1 text-right tabular-nums ink outline-none"
                              aria-label={`${a.name} target`}
                            />
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

      {/* Total sits under a strong rule with extra top padding. */}
      <Show when={groups().length > 0}>
        <div class="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem] gap-3 rule-strong-t pt-3 mt-1 t-label">
          <span class="ink">All spending</span>
          <span class="hidden sm:block" aria-hidden="true" />
          <span class="text-right t-meta tabular-nums ink">{amount(totalSpent())}</span>
          <span class="text-right t-meta tabular-nums ink-2">{amount(totalBudget())}</span>
        </div>
      </Show>

      <Show when={groups().length === 0}>
        <p class="t-meta ink-2 py-4">No expense accounts yet.</p>
      </Show>
    </section>
  );
};

const rowsTotal = (
  accounts: ReturnType<BudgetStore["accounts"]>,
  value: (id: number) => number
): number => accounts.reduce((sum, a) => sum + value(a.id), 0);

export default Dashboard;
