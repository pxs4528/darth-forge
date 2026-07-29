import { createSignal, Show, type Component } from "solid-js";
import { money, monthLabel, moneyShort, parseCents } from "./format";
import type { BudgetStore } from "./store";

// Progress toward the goal. Net worth is derived from the ledger, so the only
// editable things here are the target itself and the date you want to hit it.

type Props = { store: BudgetStore };

const Tracker: Component<Props> = (props) => {
  const { store } = props;
  const [editing, setEditing] = createSignal<"amount" | "date" | null>(null);
  const [draft, setDraft] = createSignal("");

  const s = () => store.summary();
  const goal = () => store.goal();

  const pct = () => {
    const sum = s();
    const g = goal();
    if (!sum || !g || g.goal_cents <= 0) return 0;
    return Math.max(0, Math.min(100, (sum.net_worth_cents / g.goal_cents) * 100));
  };

  /** Are we adding at least the pace the goal needs? */
  const onTrack = () => {
    const sum = s();
    if (!sum) return false;
    return sum.net_worth_change_cents >= sum.target_monthly_cents;
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

  const editCls =
    "bg-[#161b22] border border-[#3987e5] rounded px-1.5 py-0.5 text-right tabular-nums text-white outline-none";

  return (
    <section
      id="tracker"
      class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-4 lg:sticky lg:top-4">
      <Show when={s() && goal()} fallback={<p class="text-sm text-gray-500">Loading…</p>}>
        <div class="flex items-baseline justify-between">
          <h2 class="text-sm font-semibold text-gray-200">
            <Show
              when={editing() === "amount"}
              fallback={
                <button
                  onClick={() => {
                    setDraft((goal()!.goal_cents / 100).toFixed(2));
                    setEditing("amount");
                  }}
                  class="hover:text-white underline decoration-dotted underline-offset-2">
                  {moneyShort(goal()!.goal_cents)} goal
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
                class={editCls + " w-28 text-sm"}
                aria-label="Goal amount"
              />
            </Show>
          </h2>
          <span class="text-[11px] text-gray-500 tabular-nums">
            <Show
              when={editing() === "date"}
              fallback={
                <button
                  onClick={() => {
                    setDraft(goal()!.target_month);
                    setEditing("date");
                  }}
                  class="hover:text-gray-300 underline decoration-dotted underline-offset-2">
                  by {monthLabel(goal()!.target_month)}
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
                class={editCls + " text-xs"}
                aria-label="Target month"
              />
            </Show>
          </span>
        </div>

        {/* Headline */}
        <div>
          <div class="text-2xl font-semibold text-white tabular-nums">
            {money(s()!.net_worth_cents)}
          </div>
          <div class="mt-1.5 h-2 rounded-full bg-[#21262d] overflow-hidden">
            <div
              class="h-full rounded-full bg-[#3987e5] transition-all"
              style={{ width: `${pct()}%` }}
            />
          </div>
          <div class="mt-1 flex justify-between text-[11px] text-gray-500 tabular-nums">
            <span>{Math.round(pct())}% there</span>
            <span>
              {moneyShort(Math.max(0, goal()!.goal_cents - s()!.net_worth_cents))} to go ·{" "}
              {s()!.months_remaining} mo
            </span>
          </div>
        </div>

        {/* Pace */}
        <div class="border-t border-[#21262d] pt-3 space-y-2">
          <div class="flex items-baseline justify-between">
            <span class="text-[11px] uppercase tracking-wider text-gray-500">Need per month</span>
            <span class="text-lg font-semibold text-white tabular-nums">
              {money(s()!.target_monthly_cents)}
            </span>
          </div>
          <div class="flex items-baseline justify-between">
            <span class="text-[11px] uppercase tracking-wider text-gray-500">Added this month</span>
            <span class="text-sm text-gray-200 tabular-nums">
              {money(s()!.net_worth_change_cents)}
            </span>
          </div>
          <div
            class="rounded px-2.5 py-1.5 text-sm font-semibold flex items-center gap-2"
            style={{
              background: onTrack() ? "rgba(12,163,12,0.12)" : "rgba(208,59,59,0.12)",
              color: onTrack() ? "#3fb950" : "#f85149",
            }}>
            <span aria-hidden="true">{onTrack() ? "✓" : "✗"}</span>
            {onTrack()
              ? `On pace (+${money(s()!.net_worth_change_cents - s()!.target_monthly_cents)})`
              : `Behind by ${money(
                  Math.abs(s()!.net_worth_change_cents - s()!.target_monthly_cents)
                )}`}
          </div>
        </div>

        {/* Projections */}
        <div class="border-t border-[#21262d] pt-3">
          <div class="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
            At this pace, by {monthLabel(goal()!.target_month)}
          </div>
          <div class="space-y-1 text-sm tabular-nums">
            <div class="flex justify-between">
              <span class="text-gray-400">No returns</span>
              <span class="text-white">{moneyShort(store.projections().none)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Realistic · 7%</span>
              <span class="text-white">{moneyShort(store.projections().realistic)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Optimistic · 10%</span>
              <span class="text-white">{moneyShort(store.projections().optimistic)}</span>
            </div>
          </div>
          <p class="mt-2 text-[10px] text-gray-600 leading-relaxed">
            Projected from this month's net-worth change, so it moves as you record entries.
          </p>
        </div>
      </Show>
    </section>
  );
};

export default Tracker;
