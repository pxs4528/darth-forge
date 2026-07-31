import { Show, type Component } from "solid-js";
import { money, monthLabel, moneyShort } from "./format";
import type { BudgetStore } from "./store";

// Pace toward the goal, pinned in the sidebar. Where you *are* is the masthead's
// job — the hero figure and the progress rule — so this panel only answers
// "am I adding fast enough, and where does that land me".
//
// The goal amount and target month are edited in the masthead.

type Props = { store: BudgetStore };

const Tracker: Component<Props> = (props) => {
  const { store } = props;

  const s = () => store.summary();

  /** Are we adding at least the pace the goal needs? */
  const onTrack = () => {
    const sum = s();
    if (!sum) return false;
    return sum.net_worth_change_cents >= sum.target_monthly_cents;
  };

  const gap = () => {
    const sum = s();
    if (!sum) return 0;
    return sum.net_worth_change_cents - sum.target_monthly_cents;
  };

  return (
    <section id="tracker" class="lg:sticky lg:top-4">
      <Show when={s() && store.goal()} fallback={<p class="t-meta ink-2">Loading…</p>}>
        <h2 class="t-label ink-2 pb-2 rule-b">Pace</h2>

        <div class="ruled-rows">
          <Row label="Need per month" value={money(s()!.target_monthly_cents)} figure />
          <Row
            label="Added this month"
            hint="Excludes opening balances — those establish the books rather than adding to net worth"
            value={money(s()!.net_worth_change_cents)}
            tone={s()!.net_worth_change_cents < 0 ? "neg" : undefined}
          />
          <Row
            label={onTrack() ? "Ahead by" : "Behind by"}
            value={money(Math.abs(gap()))}
            tone={onTrack() ? "pos" : "neg"}
          />
        </div>

        {/* Projections — only meaningful while the pace is positive. */}
        <h2 class="t-label ink-2 pt-5 pb-2 rule-b">
          At this pace, by {monthLabel(store.goal()!.target_month)}
        </h2>
        <Show
          when={s()!.net_worth_change_cents > 0}
          fallback={
            <p class="t-meta ink-2 py-2 leading-relaxed">
              Net worth went{" "}
              <span class="neg">down {money(Math.abs(s()!.net_worth_change_cents))}</span> this
              month, so there's no pace to project from yet. Compounding numbers off a negative
              month would be noise.
            </p>
          }>
          <div class="ruled-rows">
            <Row label="No returns" value={moneyShort(store.projections().none)} />
            <Row label="Realistic · 7%" value={moneyShort(store.projections().realistic)} />
            <Row label="Optimistic · 10%" value={moneyShort(store.projections().optimistic)} />
          </div>
        </Show>

        <p class="mt-3 t-meta ink-2 leading-relaxed opacity-70">
          Based on this month's change, excluding opening balances — those set the starting position
          rather than adding to it.
        </p>
      </Show>
    </section>
  );
};

const Row: Component<{
  label: string;
  value: string;
  hint?: string;
  figure?: boolean;
  tone?: "pos" | "neg";
}> = (p) => (
  <div class="flex items-baseline justify-between gap-3 py-1.5">
    <span class="t-meta ink-2" title={p.hint}>
      {p.label}
    </span>
    <span class={(p.figure ? "t-figure " : "t-meta ") + "tabular-nums " + (p.tone ?? "ink")}>
      {p.value}
    </span>
  </div>
);

export default Tracker;
