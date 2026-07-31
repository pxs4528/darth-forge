import { createMemo, createSignal, For, Index, Show, type Component } from "solid-js";
import type { HistoryPoint } from "./api";
import { money, moneyAxis, monthShort, shiftMonth } from "./format";
import { CHART_COLORS, type BudgetStore } from "./store";

// Hand-rolled SVG charts, no dependencies.
//   Cashflow  — grouped bars, income vs spent vs saved per month.
//   Net worth — line toward the $100k goal with a dashed projection.
// Palette: #3987e5/#d95926/#1baf7a — validated (CVD + contrast) on #0d1117.

const VIEW_W = 720;
const VIEW_H = 240;
const M = { l: 52, r: 12, t: 14, b: 26 };
const PLOT_W = VIEW_W - M.l - M.r;
const PLOT_H = VIEW_H - M.t - M.b;

// SVG can't read the CSS custom properties, so the ink tokens are mirrored here.
const INK_MUTED = "#8b949e"; // --ink-2
const GRID = "#21262d"; // --rule
const AXIS = "#30363d"; // --rule-strong
const PAGE = "#000000"; // knockout behind line markers

/** Rounds up to a pleasant axis maximum (1/2/2.5/5 × 10^k). */
const niceMax = (v: number): number => {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
};

type Tip = {
  xPct: number;
  yPct: number;
  lines: { color?: string; label: string; value: string }[];
  title: string;
};

const Tooltip: Component<{ tip: Tip | null }> = (p) => (
  <Show when={p.tip}>
    {(t) => (
      <div
        class="absolute z-10 pointer-events-none bg-[#161b22] border border-[color:var(--rule-strong)] px-2.5 py-1.5 t-meta shadow-xl"
        style={{
          left: `${Math.min(78, Math.max(2, t().xPct))}%`,
          top: `${Math.max(0, t().yPct)}%`,
        }}>
        <div class="ink-2 mb-0.5">{t().title}</div>
        <For each={t().lines}>
          {(line) => (
            <div class="flex items-center gap-1.5 tabular-nums">
              <Show when={line.color}>
                <span class="w-2 h-[3px] shrink-0" style={{ background: line.color }} />
              </Show>
              <span class="ink-2">{line.label}</span>
              <span class="ink ml-auto pl-2">{line.value}</span>
            </div>
          )}
        </For>
      </div>
    )}
  </Show>
);

const LegendDot: Component<{ color: string; label: string }> = (p) => (
  <span class="flex items-center gap-1.5 t-label ink-2">
    <span class="w-2 h-[3px]" style={{ background: p.color }} />
    {p.label}
  </span>
);

// ── Cashflow ─────────────────────────────────────────────────────────────────

const SERIES = [
  { key: "income_cents" as const, label: "Income", color: CHART_COLORS.income },
  { key: "expense_cents" as const, label: "Spent", color: CHART_COLORS.expense },
];

const CashflowChart: Component<{ points: HistoryPoint[] }> = (props) => {
  const [tip, setTip] = createSignal<Tip | null>(null);

  const pts = createMemo(() => props.points.slice(-12));
  const yMax = createMemo(() =>
    niceMax(Math.max(1, ...pts().flatMap((p) => [p.income_cents, p.expense_cents])))
  );
  const y = (v: number) => M.t + PLOT_H - (v / yMax()) * PLOT_H;
  const band = () => PLOT_W / Math.max(1, pts().length);
  const barW = () => Math.min(16, (band() - 8) / 3 - 2);

  const showTip = (p: HistoryPoint, i: number) => {
    const cx = M.l + band() * (i + 0.5);
    setTip({
      xPct: (cx / VIEW_W) * 100,
      yPct: 4,
      title: monthShort(p.month) + " " + p.month.slice(0, 4),
      lines: SERIES.map((s) => ({ color: s.color, label: s.label, value: money(p[s.key]) })),
    });
  };

  const ticks = () => [0.25, 0.5, 0.75, 1].map((f) => yMax() * f);

  return (
    <div class="relative">
      <div class="flex items-center gap-4 mb-2">
        <h3 class="t-label ink mr-auto">Cashflow by month</h3>
        <For each={SERIES}>{(s) => <LegendDot color={s.color} label={s.label} />}</For>
      </div>
      <Show when={pts().length > 0} fallback={<p class="t-meta ink-2">No history yet.</p>}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          class="w-full h-auto"
          role="img"
          aria-label="Grouped bar chart of income, spending and savings per month"
          onMouseLeave={() => setTip(null)}>
          {/* grid + y labels */}
          <For each={ticks()}>
            {(v) => (
              <>
                <line
                  x1={M.l}
                  x2={VIEW_W - M.r}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={GRID}
                  stroke-width="1"
                />
                <text x={M.l - 6} y={y(v) + 3} text-anchor="end" font-size="10" fill={INK_MUTED}>
                  {moneyAxis(v)}
                </text>
              </>
            )}
          </For>
          <line
            x1={M.l}
            x2={VIEW_W - M.r}
            y1={M.t + PLOT_H}
            y2={M.t + PLOT_H}
            stroke={AXIS}
            stroke-width="1"
          />

          <Index each={pts()}>
            {(p, i) => {
              const cx = () => M.l + band() * (i + 0.5);
              const groupW = () => barW() * 3 + 4; // 2px gaps between bars
              return (
                <>
                  {/* bars */}
                  <For each={SERIES}>
                    {(s, si) => {
                      const x0 = () => cx() - groupW() / 2 + si() * (barW() + 2);
                      const h = () => Math.max(0, M.t + PLOT_H - y(p()[s.key]));
                      return (
                        <rect
                          x={x0()}
                          y={y(p()[s.key])}
                          width={barW()}
                          height={h()}
                          rx="2"
                          fill={s.color}
                        />
                      );
                    }}
                  </For>
                  {/* x label */}
                  <text
                    x={cx()}
                    y={VIEW_H - 8}
                    text-anchor="middle"
                    font-size="10"
                    fill={INK_MUTED}>
                    {monthShort(p().month)}
                  </text>
                  {/* hover / focus hit area */}
                  <rect
                    x={M.l + band() * i}
                    y={M.t}
                    width={band()}
                    height={PLOT_H}
                    fill="transparent"
                    tabindex="0"
                    aria-label={`${p().month}: income ${money(p().income_cents)}, spent ${money(p().expense_cents)}`}
                    onMouseEnter={() => showTip(p(), i)}
                    onFocus={() => showTip(p(), i)}
                    onBlur={() => setTip(null)}
                  />
                </>
              );
            }}
          </Index>
        </svg>
      </Show>
      <Tooltip tip={tip()} />
    </div>
  );
};

// ── Net worth ────────────────────────────────────────────────────────────────

const NetWorthChart: Component<{
  points: HistoryPoint[];
  goalCents: number;
  monthsRemaining: number;
  projectedCents: number;
}> = (props) => {
  const [tip, setTip] = createSignal<Tip | null>(null);

  const pts = createMemo(() => props.points.filter((p) => p.net_worth_cents > 0));

  // X domain = history plus the remaining months to the deadline.
  const domain = createMemo(() => {
    const hist = pts();
    if (hist.length === 0) return [] as string[];
    const months = hist.map((p) => p.month);
    let cursor = months[months.length - 1];
    for (let k = 0; k < props.monthsRemaining; k++) {
      cursor = shiftMonth(cursor, 1);
      months.push(cursor);
    }
    return months;
  });

  const yMax = createMemo(() =>
    niceMax(
      Math.max(props.goalCents * 1.06, props.projectedCents, ...pts().map((p) => p.net_worth_cents))
    )
  );
  const x = (i: number) => M.l + (domain().length <= 1 ? 0 : (i / (domain().length - 1)) * PLOT_W);
  const y = (v: number) => M.t + PLOT_H - (v / yMax()) * PLOT_H;

  const linePath = createMemo(() =>
    pts()
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.net_worth_cents).toFixed(1)}`)
      .join(" ")
  );

  const areaPath = createMemo(() => {
    const h = pts();
    if (h.length === 0) return "";
    return (
      linePath() +
      ` L${x(h.length - 1).toFixed(1)},${(M.t + PLOT_H).toFixed(1)}` +
      ` L${x(0).toFixed(1)},${(M.t + PLOT_H).toFixed(1)} Z`
    );
  });

  const projPath = createMemo(() => {
    const h = pts();
    if (h.length === 0) return "";
    const lastI = h.length - 1;
    const endI = domain().length - 1;
    return `M${x(lastI).toFixed(1)},${y(h[lastI].net_worth_cents).toFixed(1)} L${x(endI).toFixed(1)},${y(props.projectedCents).toFixed(1)}`;
  });

  const xLabels = createMemo(() => {
    const d = domain();
    const step = Math.max(1, Math.ceil(d.length / 8));
    return d.map((mo, i) => ({ mo, i })).filter(({ i }) => i % step === 0);
  });

  return (
    <div class="relative">
      <div class="flex items-center gap-4 mb-2">
        <h3 class="t-label ink mr-auto">Net worth → goal</h3>
        <span class="flex items-center gap-1.5 t-label ink-2">
          <svg width="18" height="6" aria-hidden="true">
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke={CHART_COLORS.income}
              stroke-width="2"
              stroke-dasharray="4 3"
            />
          </svg>
          projection · 7%
        </span>
      </div>
      <Show when={pts().length > 0} fallback={<p class="t-meta ink-2">No snapshots yet.</p>}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          class="w-full h-auto"
          role="img"
          aria-label="Net worth over time with projection to goal"
          onMouseLeave={() => setTip(null)}>
          {/* goal line */}
          <line
            x1={M.l}
            x2={VIEW_W - M.r}
            y1={y(props.goalCents)}
            y2={y(props.goalCents)}
            stroke={INK_MUTED}
            stroke-width="1"
            stroke-dasharray="2 4"
          />
          <text
            x={VIEW_W - M.r}
            y={y(props.goalCents) - 5}
            text-anchor="end"
            font-size="10"
            fill={INK_MUTED}>
            goal {moneyAxis(props.goalCents)}
          </text>
          <line
            x1={M.l}
            x2={VIEW_W - M.r}
            y1={M.t + PLOT_H}
            y2={M.t + PLOT_H}
            stroke={AXIS}
            stroke-width="1"
          />

          {/* area + line + projection */}
          <path d={areaPath()} fill={CHART_COLORS.income} opacity="0.08" />
          <path
            d={linePath()}
            fill="none"
            stroke={CHART_COLORS.income}
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d={projPath()}
            fill="none"
            stroke={CHART_COLORS.income}
            stroke-width="2"
            stroke-dasharray="4 3"
            opacity="0.7"
          />

          {/* history markers + hit areas */}
          <Index each={pts()}>
            {(p, i) => (
              <>
                <circle
                  cx={x(i)}
                  cy={y(p().net_worth_cents)}
                  r="3.5"
                  fill={PAGE}
                  stroke={CHART_COLORS.income}
                  stroke-width="2"
                />
                <circle
                  cx={x(i)}
                  cy={y(p().net_worth_cents)}
                  r="12"
                  fill="transparent"
                  tabindex="0"
                  aria-label={`${p().month}: ${money(p().net_worth_cents)}`}
                  onMouseEnter={() =>
                    setTip({
                      xPct: (x(i) / VIEW_W) * 100,
                      yPct: (y(p().net_worth_cents) / VIEW_H) * 100 - 18,
                      title: monthShort(p().month) + " " + p().month.slice(0, 4),
                      lines: [{ label: "Net worth", value: money(p().net_worth_cents) }],
                    })
                  }
                  onFocus={() =>
                    setTip({
                      xPct: (x(i) / VIEW_W) * 100,
                      yPct: (y(p().net_worth_cents) / VIEW_H) * 100 - 18,
                      title: p().month,
                      lines: [{ label: "Net worth", value: money(p().net_worth_cents) }],
                    })
                  }
                  onBlur={() => setTip(null)}
                />
              </>
            )}
          </Index>

          {/* projection endpoint */}
          <circle
            cx={x(domain().length - 1)}
            cy={y(props.projectedCents)}
            r="3.5"
            fill={PAGE}
            stroke={CHART_COLORS.income}
            stroke-width="2"
            stroke-dasharray="2 2"
          />
          <text
            x={x(domain().length - 1) - 6}
            y={y(props.projectedCents) - 8}
            text-anchor="end"
            font-size="10"
            fill={INK_MUTED}>
            {moneyAxis(props.projectedCents)}
          </text>

          {/* x labels */}
          <For each={xLabels()}>
            {({ mo, i }) => (
              <text x={x(i)} y={VIEW_H - 8} text-anchor="middle" font-size="10" fill={INK_MUTED}>
                {mo.endsWith("-01") ? mo.slice(0, 4) : monthShort(mo)}
              </text>
            )}
          </For>
        </svg>
      </Show>
      <Tooltip tip={tip()} />
    </div>
  );
};

// ── wrapper ──────────────────────────────────────────────────────────────────

const Charts: Component<{ store: BudgetStore }> = (props) => {
  const { store } = props;
  const history = () => store.history()?.history ?? [];

  return (
    <section class="space-y-8">
      <CashflowChart points={history()} />
      <Show when={store.goal() && store.summary()}>
        <NetWorthChart
          points={history()}
          goalCents={store.goal()!.goal_cents}
          monthsRemaining={store.summary()!.months_remaining}
          projectedCents={store.projections().realistic}
        />
      </Show>
    </section>
  );
};

export default Charts;
