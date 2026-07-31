import { createSignal, For, Show, type Component } from "solid-js";
import { amount, money, moneyShort } from "./format";
import { CLASS_COLORS, CLASS_LABELS, type BudgetStore } from "./store";

// Inputs to an allocation decision — where your money currently sits, how much
// of it is committed to a cash reserve, and what's left over. Deliberately
// descriptive: it reports your position and does not suggest what to buy.

type Props = { store: BudgetStore };

const GRID = "grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_5.5rem] gap-3";

const Investing: Component<Props> = (props) => {
  const { store } = props;
  const [editingReserve, setEditingReserve] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const liq = () => store.liquidity();
  const total = () => store.assetsTotal();

  const pctOf = (cents: number) => (total() > 0 ? (cents / total()) * 100 : 0);

  const unclassified = () =>
    store.accounts().filter((a) => !a.archived && a.type === "asset" && !a.subtype);

  const commitReserve = async () => {
    const g = store.goal();
    setEditingReserve(false);
    if (!g) return;
    const months = Number(draft().trim());
    if (!Number.isInteger(months) || months < 0 || months > 60) return;
    if (months === g.emergency_months) return;
    try {
      await store.saveGoal({ ...g, emergency_months: months });
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to save reserve");
    }
  };

  return (
    <section>
      {/* Where the money sits — one rule split by class, then the figures. */}
      <div class="flex h-[3px] bg-[color:var(--rule)]">
        <For each={store.allocation()}>
          {(row) => (
            <Show when={row.balanceCents > 0}>
              <div
                class="h-full"
                style={{
                  width: `${pctOf(row.balanceCents)}%`,
                  background: CLASS_COLORS[row.key],
                }}
                title={`${CLASS_LABELS[row.key]} ${money(row.balanceCents)}`}
              />
            </Show>
          )}
        </For>
      </div>

      <div class={GRID + " t-label ink-2 pt-3 pb-2 rule-b"}>
        <span>Asset class</span>
        <span class="text-right">Share</span>
        <span class="text-right">Balance</span>
        <span class="text-right">This month</span>
      </div>

      <div class="ruled-rows">
        <For each={store.allocation()}>
          {(row) => (
            <div class={GRID + " py-1.5 t-meta items-baseline"}>
              <span class="ink truncate">
                {/* The only decorative colour here, and it keys the rule above. */}
                <span
                  class="inline-block w-2 h-[3px] mr-2 align-middle"
                  style={{ background: CLASS_COLORS[row.key] }}
                  aria-hidden="true"
                />
                {CLASS_LABELS[row.key]}
              </span>
              <span class="text-right tabular-nums ink-2">
                {Math.round(pctOf(row.balanceCents))}%
              </span>
              <span class="text-right tabular-nums ink">{amount(row.balanceCents)}</span>
              <span
                class="text-right tabular-nums"
                classList={{
                  pos: row.changeCents > 0,
                  neg: row.changeCents < 0,
                  "ink-2 opacity-50": row.changeCents === 0,
                }}>
                {row.changeCents === 0
                  ? "—"
                  : (row.changeCents > 0 ? "+" : "") + moneyShort(row.changeCents)}
              </span>
            </div>
          )}
        </For>
      </div>

      <div class={GRID + " rule-strong-t pt-3 mt-1 items-baseline"}>
        <span class="t-label ink">Total assets</span>
        <span aria-hidden="true" />
        <span class="text-right t-figure ink">{amount(total())}</span>
        <span aria-hidden="true" />
      </div>

      <Show when={unclassified().length > 0}>
        <p class="mt-3 t-meta leading-relaxed" style={{ color: "#fab219" }}>
          {unclassified().length === 1
            ? "1 asset account has"
            : `${unclassified().length} asset accounts have`}{" "}
          no asset class set (
          {unclassified()
            .map((a) => a.name)
            .join(", ")}
          ) — set it under manage, or the split above and the reserve maths below will be wrong.
        </p>
      </Show>

      {/* Cash reserve */}
      <h3 class="t-label ink-2 pt-6 pb-2 rule-b">Cash reserve</h3>
      <div class="ruled-rows">
        <Row
          label="Spending per month"
          hint={
            store.trailingSpend().months > 0
              ? `Average of the last ${store.trailingSpend().months} months with activity`
              : undefined
          }
          value={money(liq().spendPerMonth)}
        />
        <Row
          label="Cash covers"
          value={liq().spendPerMonth > 0 ? `${liq().monthsCovered.toFixed(1)} months` : "—"}
        />
        <div class="flex items-baseline justify-between gap-3 py-1.5">
          <span class="t-meta ink-2">
            Reserve target ·{" "}
            <Show
              when={editingReserve()}
              fallback={
                <button
                  onClick={() => {
                    setDraft(String(liq().targetMonths));
                    setEditingReserve(true);
                  }}
                  class="hover:text-[color:var(--ink)] underline decoration-dotted underline-offset-2">
                  {liq().targetMonths} mo
                </button>
              }>
              <input
                type="text"
                inputmode="numeric"
                value={draft()}
                ref={(el) => setTimeout(() => el.focus())}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onBlur={commitReserve}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitReserve();
                  if (e.key === "Escape") setEditingReserve(false);
                }}
                class="w-12 bg-[#161b22] border border-[#3987e5] px-1 text-right tabular-nums ink outline-none"
                aria-label="Reserve months"
              />
            </Show>
          </span>
          <span class="t-meta tabular-nums ink">{money(liq().reserveCents)}</span>
        </div>
      </div>

      <div class="flex items-baseline justify-between gap-3 rule-strong-t pt-3 mt-1">
        <span class="t-label ink">
          {liq().deployableCents >= 0 ? "Cash above reserve" : "Short of reserve"}
        </span>
        <span
          class="t-figure tabular-nums"
          classList={{ ink: liq().deployableCents >= 0, neg: liq().deployableCents < 0 }}>
          {money(Math.abs(liq().deployableCents))}
        </span>
      </div>
      <p class="mt-2 t-meta ink-2 opacity-70 leading-relaxed">
        Cash beyond your reserve, i.e. money not earmarked for emergencies. What to do with it is
        your call — this only reports the position.
      </p>
    </section>
  );
};

const Row: Component<{ label: string; value: string; hint?: string }> = (p) => (
  <div class="flex items-baseline justify-between gap-3 py-1.5">
    <span class="t-meta ink-2" title={p.hint}>
      {p.label}
    </span>
    <span class="t-meta tabular-nums ink">{p.value}</span>
  </div>
);

export default Investing;
