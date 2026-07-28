import { createSignal, Show, type Component } from "solid-js";
import type { NetWorth } from "./api";
import { money, moneyShort, parseCents } from "./format";
import type { BudgetStore } from "./store";

// The $100k tracker. Four editable balances, months-remaining, auto-computed
// total, monthly target, on-track status and three age-25 projections.
// Fields save on blur/Enter.

type Props = { store: BudgetStore };

const Tracker: Component<Props> = (props) => {
  const { store } = props;
  const [error, setError] = createSignal("");

  const nw = () => store.state()?.net_worth;
  const m = store.metrics;

  const saveField = async (field: keyof NetWorth, raw: string, isMoney: boolean) => {
    const current = nw();
    if (!current) return;
    setError("");

    let value: number | null;
    if (isMoney) {
      value = parseCents(raw);
    } else {
      const n = Number(raw.trim());
      value = Number.isInteger(n) && n >= 1 ? n : null;
    }
    if (value === null || value < 0) {
      setError(isMoney ? "Enter a dollar amount" : "Months must be a whole number ≥ 1");
      return;
    }
    if (current[field] === value) return;

    try {
      await store.saveNetWorth({ ...current, [field]: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const Field: Component<{ label: string; field: keyof NetWorth; isMoney?: boolean }> = (p) => {
    const isMoney = p.isMoney !== false;
    const display = () => {
      const v = nw()?.[p.field];
      if (typeof v !== "number") return "";
      return isMoney ? (v / 100).toFixed(2) : String(v);
    };
    return (
      <label class="block">
        <span class="text-[11px] text-gray-500">{p.label}</span>
        <input
          type="text"
          inputmode={isMoney ? "decimal" : "numeric"}
          value={display()}
          onBlur={(e) => saveField(p.field, e.currentTarget.value, isMoney)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          class="mt-0.5 w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-sm text-white text-right tabular-nums outline-none focus:border-[#3987e5]"
        />
      </label>
    );
  };

  const onTrack = () => (m()?.onTrackDeltaCents ?? 0) >= 0;

  return (
    <section
      id="tracker"
      class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-4 lg:sticky lg:top-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-bold text-gray-200">$100K by 25</h2>
        <span class="text-[11px] text-gray-500 tabular-nums">
          {nw()?.months_remaining ?? "—"} mo left
        </span>
      </div>

      <Show when={nw()} fallback={<p class="text-sm text-gray-500">Loading…</p>}>
        {/* Headline: current net worth + progress to goal */}
        <div>
          <div class="text-2xl font-bold text-white tabular-nums">
            {money(m()?.netWorthTotalCents ?? 0)}
          </div>
          <div class="mt-1.5 h-2 rounded-full bg-[#21262d] overflow-hidden">
            <div
              class="h-full rounded-full bg-[#3987e5] transition-all"
              style={{
                width: `${Math.min(100, ((m()?.netWorthTotalCents ?? 0) / (nw()!.goal_cents || 1)) * 100)}%`,
              }}
            />
          </div>
          <div class="mt-1 flex justify-between text-[11px] text-gray-500 tabular-nums">
            <span>
              {Math.round(((m()?.netWorthTotalCents ?? 0) / (nw()!.goal_cents || 1)) * 100)}% of{" "}
              {moneyShort(nw()!.goal_cents)}
            </span>
            <span>
              {moneyShort(Math.max(0, nw()!.goal_cents - (m()?.netWorthTotalCents ?? 0)))} to go
            </span>
          </div>
        </div>

        {/* Editable balances */}
        <div class="grid grid-cols-2 gap-2">
          <Field label="HYSA" field="hysa_cents" />
          <Field label="Brokerage" field="brokerage_cents" />
          <Field label="401k vested" field="k401_vested_cents" />
          <Field label="401k unvested" field="k401_unvested_cents" />
          <Field label="Months remaining" field="months_remaining" isMoney={false} />
          <Field label="Goal" field="goal_cents" />
        </div>
        <Show when={error()}>
          <p class="text-xs text-[#f85149]">{error()}</p>
        </Show>

        {/* Target + on-track */}
        <div class="border-t border-[#21262d] pt-3 space-y-2">
          <div class="flex items-baseline justify-between">
            <span class="text-[11px] uppercase tracking-wider text-gray-500">Need per month</span>
            <span class="text-lg font-bold text-white tabular-nums">
              {money(m()?.targetMonthlyCents ?? 0)}
            </span>
          </div>
          <div class="flex items-baseline justify-between">
            <span class="text-[11px] uppercase tracking-wider text-gray-500">Saved this month</span>
            <span class="text-sm text-gray-200 tabular-nums">{money(m()?.investedCents ?? 0)}</span>
          </div>
          <div
            class="rounded px-2.5 py-1.5 text-sm font-bold flex items-center gap-2"
            style={{
              background: onTrack() ? "rgba(12,163,12,0.12)" : "rgba(208,59,59,0.12)",
              color: onTrack() ? "#3fb950" : "#f85149",
            }}>
            <span aria-hidden="true">{onTrack() ? "✓" : "✗"}</span>
            {onTrack()
              ? `On track (+${money(m()?.onTrackDeltaCents ?? 0)})`
              : `Behind by ${money(Math.abs(m()?.onTrackDeltaCents ?? 0))}`}
          </div>
        </div>

        {/* Projections */}
        <div class="border-t border-[#21262d] pt-3">
          <div class="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
            At 25 — planned {moneyShort(m()?.plannedContribCents ?? 0)}/mo
          </div>
          <div class="space-y-1 text-sm tabular-nums">
            <div class="flex justify-between">
              <span class="text-gray-400">No returns</span>
              <span class="text-white">{moneyShort(m()?.projections.none ?? 0)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Realistic · 7%</span>
              <span class="text-white">{moneyShort(m()?.projections.realistic ?? 0)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Optimistic · 10%</span>
              <span class="text-white">{moneyShort(m()?.projections.optimistic ?? 0)}</span>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
};

export default Tracker;
