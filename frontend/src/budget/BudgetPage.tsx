import { createSignal, onCleanup, onMount, Show, type Component } from "solid-js";
import { navigate } from "../lib/router";
import Charts from "./Charts";
import Dashboard from "./Dashboard";
import EntryForm from "./EntryForm";
import { buildCsv, downloadCsv } from "./export";
import { money, monthLabel, moneyShort, parseCents } from "./format";
import { createBudgetStore } from "./store";
import Tracker from "./Tracker";
import TxList from "./TxList";

// /budget — full-page personal budgeting tool, gated on the site's existing
// admin password. Keyboard-first: press ? for the shortcut list.

const BudgetPage: Component = () => {
  const store = createBudgetStore();
  const [showHelp, setShowHelp] = createSignal(false);

  let focusEntry: () => void = () => undefined;
  const registerFocus = (fn: () => void) => (focusEntry = fn);

  const exportMonth = () => {
    const s = store.state();
    const m = store.metrics();
    if (!s || !m) return;
    const labelOf = (key: string) =>
      store.catalog()?.categories.find((c) => c.key === key)?.label ?? key;
    downloadCsv(`budget-${s.month}.csv`, buildCsv(s, m, labelOf));
    store.flash(`Exported budget-${s.month}.csv`);
  };

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement;

    if (e.key === "Escape") {
      if (showHelp()) setShowHelp(false);
      else if (typing) target.blur();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "?":
        e.preventDefault();
        setShowHelp((v) => !v);
        break;
      case "n":
        e.preventDefault();
        focusEntry();
        break;
      case "[":
        e.preventDefault();
        store.goMonth(-1);
        break;
      case "]":
        e.preventDefault();
        store.goMonth(1);
        break;
      case "t":
        e.preventDefault();
        document.getElementById("tracker")?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
    }
  };

  onMount(() => {
    const prevTitle = document.title;
    document.title = "budget · parth";
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.title = prevTitle;
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="min-h-screen bg-black text-white" style={{ "color-scheme": "dark" }}>
      <Show when={store.token()} fallback={<AuthGate store={store} />}>
        <Header store={store} onExport={exportMonth} onHelp={() => setShowHelp(true)} />

        {/* Surface API failures (e.g. Turso not configured yet → 503) */}
        <Show when={store.apiError()}>
          <div class="max-w-6xl mx-auto px-3 sm:px-4 pt-3">
            <div class="border border-[#d03b3b] bg-[#d03b3b]/10 text-[#f85149] rounded px-3 py-2 text-sm">
              {store.apiError()}
            </div>
          </div>
        </Show>

        {/* Compact tracker strip — keeps the goal visible on small screens */}
        <Show when={store.metrics()}>
          <div class="lg:hidden max-w-6xl mx-auto px-3 pt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>
              NW{" "}
              <span class="text-white font-bold tabular-nums">
                {moneyShort(store.metrics()!.netWorthTotalCents)}
              </span>
            </span>
            <span>
              need{" "}
              <span class="text-white font-bold tabular-nums">
                {moneyShort(store.metrics()!.targetMonthlyCents)}/mo
              </span>
            </span>
            <span
              style={{ color: store.metrics()!.onTrackDeltaCents >= 0 ? "#3fb950" : "#f85149" }}>
              {store.metrics()!.onTrackDeltaCents >= 0 ? "✓ on track" : "✗ behind"}
            </span>
          </div>
        </Show>

        <main class="max-w-6xl mx-auto px-3 sm:px-4 py-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20.5rem] gap-4 items-start">
          <div class="space-y-4 min-w-0">
            <Dashboard store={store} />
            <EntryForm store={store} registerFocus={registerFocus} />
            <TxList store={store} />
            <Charts store={store} />
          </div>
          <Tracker store={store} />
        </main>
      </Show>

      {/* Toast */}
      <Show when={store.toast()}>
        <div class="fixed bottom-4 right-4 z-50 bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm text-gray-200 shadow-xl">
          {store.toast()}
        </div>
      </Show>

      {/* Shortcut help */}
      <Show when={showHelp()}>
        <div
          class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4"
          onClick={() => setShowHelp(false)}>
          <div
            class="bg-[#0d1117] border border-[#30363d] rounded-lg p-5 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}>
            <h2 class="text-sm font-bold text-white mb-3">Keyboard shortcuts</h2>
            <dl class="space-y-1.5 text-sm">
              {(
                [
                  ["n", "New transaction (focus entry)"],
                  ["[ / ]", "Previous / next month"],
                  ["j / k", "Select transaction below / above"],
                  ["e", "Edit selected transaction"],
                  ["x x", "Delete selected (press twice)"],
                  ["t", "Jump to $100k tracker"],
                  ["Enter", "Submit form / save edit"],
                  ["Esc", "Close / cancel / unfocus"],
                  ["?", "Toggle this help"],
                ] as const
              ).map(([key, desc]) => (
                <div class="flex justify-between gap-4">
                  <dt class="font-mono text-[#3987e5]">{key}</dt>
                  <dd class="text-gray-400 text-right">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Show>
    </div>
  );
};

// ── auth gate ────────────────────────────────────────────────────────────────

const AuthGate: Component<{ store: ReturnType<typeof createBudgetStore> }> = (props) => {
  const [password, setPassword] = createSignal("");
  const [remember, setRemember] = createSignal(false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async () => {
    if (!password()) return;
    setBusy(true);
    setError("");
    try {
      await props.store.login(password(), remember());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4">
      <div class="w-full max-w-xs bg-[#0d1117] border border-[#30363d] rounded-lg p-6">
        <h1 class="text-lg font-bold text-white">budget</h1>
        <p class="text-xs text-gray-500 mt-1 mb-4">Admin password required.</p>
        <input
          type="password"
          value={password()}
          ref={(el) => setTimeout(() => el.focus())}
          onInput={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          class="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm text-white outline-none focus:border-[#3987e5]"
        />
        <label class="flex items-center gap-2 mt-3 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={remember()}
            onChange={(e) => setRemember(e.currentTarget.checked)}
            class="accent-[#3987e5]"
          />
          Stay signed in on this device
        </label>
        <button
          onClick={submit}
          disabled={busy() || !password()}
          class="mt-4 w-full py-2 text-sm font-bold rounded bg-[#238636] text-white hover:bg-[#2ea043] disabled:opacity-50">
          {busy() ? "…" : "Unlock"}
        </button>
        <Show when={error()}>
          <p class="mt-3 text-xs text-[#f85149]">{error()}</p>
        </Show>
        <button
          onClick={() => navigate("/")}
          class="mt-4 text-xs text-gray-500 hover:text-gray-300">
          ← back to site
        </button>
      </div>
    </div>
  );
};

// ── header ───────────────────────────────────────────────────────────────────

const Header: Component<{
  store: ReturnType<typeof createBudgetStore>;
  onExport: () => void;
  onHelp: () => void;
}> = (props) => {
  const { store } = props;
  const [editingIncome, setEditingIncome] = createSignal(false);
  const [incomeDraft, setIncomeDraft] = createSignal("");

  const commitIncome = async () => {
    const s = store.state();
    setEditingIncome(false);
    if (!s) return;
    const cents = parseCents(incomeDraft());
    if (cents === null || cents < 0 || cents === s.income_cents) return;
    try {
      await store.saveMonthSettings(cents, s.three_paycheck, s.match_401k_cents);
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to save income");
    }
  };

  const btn =
    "px-2.5 py-1.5 text-xs rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]";

  return (
    <header class="border-b border-[#21262d] bg-[#0d1117]">
      <div class="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate("/")}
          class="text-gray-500 hover:text-white text-sm"
          aria-label="Back to portfolio">
          ‹ site
        </button>
        <h1 class="text-sm font-bold text-white mr-2">budget</h1>

        {/* month nav */}
        <div class="flex items-center gap-1">
          <button onClick={() => store.goMonth(-1)} class={btn} aria-label="Previous month">
            ‹
          </button>
          <span class="text-sm text-white font-bold w-32 text-center tabular-nums">
            {monthLabel(store.month())}
          </span>
          <button onClick={() => store.goMonth(1)} class={btn} aria-label="Next month">
            ›
          </button>
          <button onClick={store.goToday} class={btn}>
            today
          </button>
        </div>

        <div class="flex items-center gap-2 ml-auto">
          {/* income (editable) + 3-paycheck toggle */}
          <Show when={store.state()}>
            <Show
              when={editingIncome()}
              fallback={
                <button
                  onClick={() => {
                    setIncomeDraft(((store.state()!.income_cents ?? 0) / 100).toFixed(2));
                    setEditingIncome(true);
                  }}
                  class={btn + " tabular-nums"}
                  title="Click to edit this month's income">
                  income {money(store.state()!.income_cents)}
                </button>
              }>
              <input
                type="text"
                inputmode="decimal"
                value={incomeDraft()}
                ref={(el) => setTimeout(() => el.focus())}
                onInput={(e) => setIncomeDraft(e.currentTarget.value)}
                onBlur={commitIncome}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitIncome();
                  if (e.key === "Escape") setEditingIncome(false);
                }}
                class="w-28 bg-[#161b22] border border-[#3987e5] rounded px-2 py-1.5 text-xs text-right tabular-nums text-white outline-none"
              />
            </Show>
            <label
              class={btn + " flex items-center gap-1.5 cursor-pointer select-none"}
              title="Three-paycheck month">
              <input
                type="checkbox"
                checked={store.state()!.three_paycheck}
                onChange={(e) =>
                  store
                    .setThreePaycheck(e.currentTarget.checked)
                    .catch((err) =>
                      store.flash(err instanceof Error ? err.message : "Failed to save")
                    )
                }
                class="accent-[#3987e5]"
              />
              3-pay
            </label>
          </Show>

          <button onClick={props.onExport} class={btn}>
            export csv
          </button>
          <button onClick={props.onHelp} class={btn} aria-label="Keyboard shortcuts">
            ?
          </button>
          <button onClick={store.logout} class={btn}>
            lock
          </button>
        </div>
      </div>
    </header>
  );
};

export default BudgetPage;
