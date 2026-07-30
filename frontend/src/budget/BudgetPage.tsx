import { createSignal, onCleanup, onMount, Show, type Component } from "solid-js";
import { navigate } from "../lib/router";
import Accounts from "./Accounts";
import { api } from "./api";
import Charts from "./Charts";
import Dashboard from "./Dashboard";
import EntryForm from "./EntryForm";
import Investing from "./Investing";
import { buildCsv, downloadCsv } from "./export";
import { monthLabel } from "./format";
import Ledger from "./Ledger";
import { createBudgetStore } from "./store";
import Tracker from "./Tracker";

// /budget — double-entry bookkeeping, gated on the site's admin password.
// Keyboard-first: press ? for the shortcut list.

const BudgetPage: Component = () => {
  const store = createBudgetStore();
  const [showHelp, setShowHelp] = createSignal(false);

  let focusEntry: () => void = () => undefined;
  const registerFocus = (fn: () => void) => (focusEntry = fn);

  const exportMonth = () => {
    const s = store.state();
    if (!s) return;
    downloadCsv(`budget-${s.month}.csv`, buildCsv(s, store.accountName));
    store.flash(`Exported budget-${s.month}.csv`);
  };

  const backupDb = async () => {
    try {
      const sql = await api.dump(store.token());
      const day = new Date().toISOString().slice(0, 10);
      downloadCsv(`budget-${day}.sql`, sql);
      store.flash("Backup downloaded");
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Backup failed");
    }
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

  const btn =
    "px-2.5 py-1.5 text-xs rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]";

  return (
    <div class="budget-app min-h-screen bg-black text-white" style={{ "color-scheme": "dark" }}>
      <Show when={store.token()} fallback={<AuthGate store={store} />}>
        <header class="border-b border-[#21262d] bg-[#0d1117]">
          <div class="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate("/")}
              class="text-gray-500 hover:text-white text-sm"
              aria-label="Back to portfolio">
              ‹ site
            </button>
            <h1 class="text-sm font-semibold text-white mr-2">budget</h1>

            <div class="flex items-center gap-1">
              <button onClick={() => store.goMonth(-1)} class={btn} aria-label="Previous month">
                ‹
              </button>
              <span class="text-sm text-white font-semibold w-32 text-center tabular-nums">
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
              <button onClick={exportMonth} class={btn}>
                export csv
              </button>
              <button onClick={backupDb} class={btn} title="Download full SQL backup">
                backup
              </button>
              <button onClick={() => setShowHelp(true)} class={btn} aria-label="Keyboard shortcuts">
                ?
              </button>
              <button onClick={store.logout} class={btn}>
                lock
              </button>
            </div>
          </div>
        </header>

        {/* Surface API failures (e.g. Turso not configured yet → 503) */}
        <Show when={store.apiError()}>
          <div class="max-w-6xl mx-auto px-3 sm:px-4 pt-3">
            <div class="border border-[#d03b3b] bg-[#d03b3b]/10 text-[#f85149] rounded px-3 py-2 text-sm">
              {store.apiError()}
            </div>
          </div>
        </Show>

        {/* Compact goal strip on small screens, where the sidebar wraps below */}
        <Show when={store.summary()}>
          <div class="lg:hidden max-w-6xl mx-auto px-3 pt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>
              net worth{" "}
              <span class="text-white font-semibold tabular-nums">
                ${Math.round(store.summary()!.goal_net_worth_cents / 100).toLocaleString("en-US")}
              </span>
            </span>
            <span>
              need{" "}
              <span class="text-white font-semibold tabular-nums">
                ${Math.round(store.summary()!.target_monthly_cents / 100).toLocaleString("en-US")}
                /mo
              </span>
            </span>
          </div>
        </Show>

        <main class="max-w-6xl mx-auto px-3 sm:px-4 py-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20.5rem] gap-4 items-start">
          <div class="space-y-4 min-w-0">
            <EntryForm store={store} registerFocus={registerFocus} />
            <Ledger store={store} />
            <Accounts store={store} />
            <Investing store={store} />
            <Dashboard store={store} />
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
            <h2 class="text-sm font-semibold text-white mb-3">Keyboard shortcuts</h2>
            <dl class="space-y-1.5 text-sm">
              {(
                [
                  ["n", "New entry (focus description)"],
                  ["[ / ]", "Previous / next month"],
                  ["j / k", "Select entry below / above"],
                  ["e", "Edit selected entry"],
                  ["x x", "Delete selected (press twice)"],
                  ["t", "Jump to goal tracker"],
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
        <h1 class="text-lg font-semibold text-white">budget</h1>
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
          class="mt-4 w-full py-2 text-sm font-semibold rounded bg-[#238636] text-white hover:bg-[#2ea043] disabled:opacity-50">
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

export default BudgetPage;
