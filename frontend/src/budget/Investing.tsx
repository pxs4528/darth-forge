import { createSignal, For, Show, type Component } from "solid-js";
import { money, moneyShort } from "./format";
import { CLASS_COLORS, CLASS_LABELS, type BudgetStore } from "./store";

// Inputs to an allocation decision — where your money currently sits, how much
// of it is committed to a cash reserve, and what's left over. Deliberately
// descriptive: it reports your position and does not suggest what to buy.

type Props = { store: BudgetStore };

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
    <section class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-4">
      <h2 class="text-sm font-semibold text-gray-200">Allocation &amp; liquidity</h2>

      {/* Where the money sits */}
      <div>
        <div class="flex h-2.5 rounded-full overflow-hidden bg-[#21262d]">
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

        <table class="w-full text-[13px] tabular-nums mt-2">
          <tbody>
            <For each={store.allocation()}>
              {(row) => (
                <tr class="border-t border-[#21262d] first:border-t-0">
                  <td class="text-left py-1 text-gray-300">
                    <span
                      class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                      style={{ background: CLASS_COLORS[row.key] }}
                    />
                    {CLASS_LABELS[row.key]}
                  </td>
                  <td class="text-right text-gray-500 w-14">
                    {Math.round(pctOf(row.balanceCents))}%
                  </td>
                  <td class="text-right text-white w-24">{money(row.balanceCents)}</td>
                  <td
                    class="text-right w-24"
                    classList={{
                      "text-[#3fb950]": row.changeCents > 0,
                      "text-[#f85149]": row.changeCents < 0,
                      "text-gray-600": row.changeCents === 0,
                    }}>
                    {row.changeCents === 0
                      ? "—"
                      : (row.changeCents > 0 ? "+" : "") + moneyShort(row.changeCents)}
                  </td>
                </tr>
              )}
            </For>
            <tr class="border-t-2 border-[#30363d]">
              <td class="text-left py-1 text-gray-400 text-[11px] uppercase tracking-wider">
                Total assets
              </td>
              <td />
              <td class="text-right font-semibold text-white">{money(total())}</td>
              <td class="text-right text-[10px] text-gray-600">this mo</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Show when={unclassified().length > 0}>
        <p class="text-[11px] text-[#fab219] leading-relaxed">
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
      <div class="border-t border-[#21262d] pt-3 space-y-1.5 text-[13px] tabular-nums">
        <div class="flex justify-between">
          <span class="text-gray-400">Spending per month</span>
          <span class="text-gray-200">
            {money(liq().spendPerMonth)}
            <Show when={store.trailingSpend().months > 0}>
              <span class="text-[10px] text-gray-600">
                {" "}
                avg of {store.trailingSpend().months} mo
              </span>
            </Show>
          </span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Cash covers</span>
          <span class="text-gray-200">
            {liq().spendPerMonth > 0 ? `${liq().monthsCovered.toFixed(1)} months` : "—"}
          </span>
        </div>
        <div class="flex justify-between items-baseline">
          <span class="text-gray-400">
            Reserve target ·{" "}
            <Show
              when={editingReserve()}
              fallback={
                <button
                  onClick={() => {
                    setDraft(String(liq().targetMonths));
                    setEditingReserve(true);
                  }}
                  class="text-gray-300 hover:text-white underline decoration-dotted underline-offset-2">
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
                class="w-12 bg-[#161b22] border border-[#3987e5] rounded px-1 text-right tabular-nums text-white outline-none"
                aria-label="Reserve months"
              />
            </Show>
          </span>
          <span class="text-gray-200">{money(liq().reserveCents)}</span>
        </div>

        <div
          class="rounded px-2.5 py-2 mt-1 flex items-baseline justify-between"
          style={{
            background:
              liq().deployableCents > 0 ? "rgba(57,135,229,0.12)" : "rgba(250,178,25,0.10)",
          }}>
          <span class="text-[11px] uppercase tracking-wider text-gray-400">
            {liq().deployableCents >= 0 ? "Cash above reserve" : "Short of reserve"}
          </span>
          <span
            class="text-lg font-semibold"
            style={{ color: liq().deployableCents >= 0 ? "#3987e5" : "#fab219" }}>
            {money(Math.abs(liq().deployableCents))}
          </span>
        </div>
        <p class="text-[10px] text-gray-600 leading-relaxed">
          Cash beyond your reserve, i.e. money not earmarked for emergencies. What to do with it is
          your call — this only reports the position.
        </p>
      </div>
    </section>
  );
};

export default Investing;
