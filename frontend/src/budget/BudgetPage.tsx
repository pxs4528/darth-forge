import { createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
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
import { Masthead, SummaryBand } from "./Masthead";
import { createBudgetStore } from "./store";
import Tracker from "./Tracker";

// /budget — double-entry bookkeeping, gated on the site's admin password.
// Keyboard-first: press ? for the shortcut list.
//
// Layout is a ledger page, not a dashboard: masthead, summary band, then one
// section at a time behind a tab strip. The goal tracker is the exception —
// it stays pinned in the sidebar, because pace is context for everything else.

const TABS = [
  { key: "register", label: "Register" },
  { key: "accounts", label: "Accounts" },
  { key: "allocation", label: "Allocation" },
  { key: "budgets", label: "Budgets" },
  { key: "trends", label: "Trends" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const SHORTCUTS: [string, string][] = [
  ["1 – 5", "Switch tab"],
  ["n", "New entry (focus description)"],
  ["[ / ]", "Previous / next month"],
  ["j / k", "Select entry below / above"],
  ["e", "Edit selected entry"],
  ["x x", "Delete selected (press twice)"],
  ["t", "Jump to goal tracker"],
  ["Enter", "Submit form / save edit"],
  ["Esc", "Close / cancel / unfocus"],
  ["?", "Toggle this help"],
];

const BudgetPage: Component = () => {
  const store = createBudgetStore();
  const [showHelp, setShowHelp] = createSignal(false);
  const [tab, setTab] = createSignal<TabKey>("register");

  let focusEntry: () => void = () => undefined;
  const registerFocus = (fn: () => void) => (focusEntry = fn);

  /** The entry form lives on the register, so `n` brings you there first. */
  const newEntry = () => {
    setTab("register");
    setTimeout(focusEntry);
  };

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

    if (e.key >= "1" && e.key <= String(TABS.length)) {
      e.preventDefault();
      setTab(TABS[Number(e.key) - 1].key);
      return;
    }

    switch (e.key) {
      case "?":
        e.preventDefault();
        setShowHelp((v) => !v);
        break;
      case "n":
        e.preventDefault();
        newEntry();
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
    <div class="budget-app min-h-screen bg-black text-white" style={{ "color-scheme": "dark" }}>
      <Show when={store.token()} fallback={<AuthGate store={store} />}>
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          {/* Running head: month on the left, controls on the right. */}
          <header class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 rule-b">
            <button
              onClick={() => navigate("/")}
              class="t-label ink-2 hover:text-[color:var(--ink)]"
              aria-label="Back to portfolio">
              ‹ site
            </button>

            <span class="t-label ink tabular-nums">{monthLabel(store.month())}</span>

            <div class="flex items-center gap-1">
              <button onClick={() => store.goMonth(-1)} class="btn" aria-label="Previous month">
                ‹
              </button>
              <button onClick={() => store.goMonth(1)} class="btn" aria-label="Next month">
                ›
              </button>
              <button onClick={store.goToday} class="btn">
                today
              </button>
            </div>

            <div class="flex items-center gap-1.5 ml-auto">
              <button onClick={exportMonth} class="btn">
                export
              </button>
              <button onClick={backupDb} class="btn" title="Download full SQL backup">
                backup
              </button>
              <button onClick={() => setShowHelp(true)} class="btn" aria-label="Keyboard shortcuts">
                ?
              </button>
              <button onClick={store.logout} class="btn">
                lock
              </button>
            </div>
          </header>

          {/* Surface API failures (e.g. Turso not configured yet → 503) */}
          <Show when={store.apiError()}>
            <p class="mt-3 border border-[#d03b3b] bg-[#d03b3b]/10 neg px-3 py-2 t-meta">
              {store.apiError()}
            </p>
          </Show>

          <Masthead store={store} />
          <SummaryBand store={store} />

          <main class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_19rem] gap-x-8 gap-y-6 items-start">
            <div class="min-w-0">
              {/* Tab strip */}
              <div class="flex flex-wrap gap-x-5 gap-y-1 rule-b" role="tablist">
                <For each={TABS}>
                  {(t) => (
                    <button
                      role="tab"
                      aria-selected={tab() === t.key}
                      onClick={() => setTab(t.key)}
                      class="t-label py-2.5 -mb-px border-b transition-colors"
                      classList={{
                        "ink border-[color:var(--ink)]": tab() === t.key,
                        "ink-2 border-transparent hover:text-[color:var(--ink)]": tab() !== t.key,
                      }}>
                      {t.label}
                    </button>
                  )}
                </For>
              </div>

              <div class="pt-4" role="tabpanel">
                <Show when={tab() === "register"}>
                  <EntryForm store={store} registerFocus={registerFocus} />
                  <Ledger store={store} />
                </Show>
                <Show when={tab() === "accounts"}>
                  <Accounts store={store} />
                </Show>
                <Show when={tab() === "allocation"}>
                  <Investing store={store} />
                </Show>
                <Show when={tab() === "budgets"}>
                  <Dashboard store={store} />
                </Show>
                <Show when={tab() === "trends"}>
                  <Charts store={store} />
                </Show>
              </div>
            </div>

            <Tracker store={store} />
          </main>
        </div>
      </Show>

      {/* Toast */}
      <Show when={store.toast()}>
        <div class="fixed bottom-4 right-4 z-50 bg-[#161b22] border border-[color:var(--rule-strong)] px-3 py-2 t-meta ink shadow-xl">
          {store.toast()}
        </div>
      </Show>

      {/* Shortcut help — the only place keyboard reference lives. */}
      <Show when={showHelp()}>
        <div
          class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4"
          onClick={() => setShowHelp(false)}>
          <div
            class="bg-[#0d1117] border border-[color:var(--rule-strong)] rounded-lg p-5 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}>
            <h2 class="t-label ink mb-3">Keyboard shortcuts</h2>
            <dl class="t-meta ruled-rows">
              <For each={SHORTCUTS}>
                {([key, desc]) => (
                  <div class="flex justify-between gap-4 py-1">
                    <dt class="ink tabular-nums">{key}</dt>
                    <dd class="ink-2 text-right">{desc}</dd>
                  </div>
                )}
              </For>
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
      <div class="w-full max-w-xs">
        <h1 class="t-label ink">Budget</h1>
        <p class="t-meta ink-2 mt-1 mb-4">Admin password required.</p>
        <input
          type="password"
          value={password()}
          ref={(el) => setTimeout(() => el.focus())}
          onInput={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          class="field"
        />
        <label class="flex items-center gap-2 mt-3 t-meta ink-2 cursor-pointer">
          <input
            type="checkbox"
            checked={remember()}
            onChange={(e) => setRemember(e.currentTarget.checked)}
            class="accent-[#3987e5]"
          />
          Stay signed in on this device
        </label>
        <button onClick={submit} disabled={busy() || !password()} class="btn mt-4 w-full py-2">
          {busy() ? "…" : "Unlock"}
        </button>
        <Show when={error()}>
          <p class="mt-3 t-meta neg">{error()}</p>
        </Show>
        <button
          onClick={() => navigate("/")}
          class="mt-6 t-label ink-2 hover:text-[color:var(--ink)]">
          ← back to site
        </button>
      </div>
    </div>
  );
};

export default BudgetPage;
