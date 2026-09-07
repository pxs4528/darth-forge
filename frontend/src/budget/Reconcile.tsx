import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import type { AccountBalance, RegisterRow } from "./api";
import { amount, money, parseCents, today } from "./format";
import { displayBalance, type BudgetStore } from "./store";

// Reconciling: proving your books against the bank's record for one account
// over one statement period.
//
// You type the closing balance from the statement, tick every entry you can
// see on it, and the difference has to reach zero. Then you lock the period,
// which freezes those entries against later edits — that lock is the whole
// point, because the mistakes that hurt are the ones that quietly change a
// month you already checked.
//
// Signs follow the statement, not the schema: a card statement shows what you
// owe as a positive number, so liabilities are flipped for display and the
// balance you type is read the same way.

type Props = { store: BudgetStore };

// The running balance is desktop-only: while reconciling, the number you're
// working against is the difference at the top, not the per-row balance.
const GRID =
  "grid grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_5.5rem] " +
  "sm:grid-cols-[2.5rem_5rem_minmax(0,1fr)_7rem_7rem] gap-2 sm:gap-3";

const Reconcile: Component<Props> = (props) => {
  const { store } = props;

  const [accountId, setAccountId] = createSignal(0);
  const [rows, setRows] = createSignal<RegisterRow[]>([]);
  const [clearedCents, setClearedCents] = createSignal(0);
  const [statement, setStatement] = createSignal("");
  const [statementDate, setStatementDate] = createSignal(today());
  const [busy, setBusy] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  /** Only real-world accounts get statements. */
  const reconcilable = createMemo(() =>
    store.accounts().filter((a) => !a.archived && (a.type === "asset" || a.type === "liability"))
  );

  const account = (): AccountBalance | undefined => store.accountById(accountId());

  /** Statement-facing sign: liabilities read as "amount owed". */
  const asStatement = (cents: number) => {
    const a = account();
    return a ? displayBalance(a.type, cents) : cents;
  };

  const load = async (id: number) => {
    setAccountId(id);
    setLoaded(false);
    if (!id) {
      setRows([]);
      return;
    }
    try {
      const res = await store.loadRegister(id);
      setRows(res.rows);
      setClearedCents(res.cleared_cents);
      setLoaded(true);
    } catch {
      /* the store's guard already surfaced it in the banner */
    }
  };

  const isTicked = (r: RegisterRow) => r.reconcile_state !== "n";
  const isLocked = (r: RegisterRow) => r.reconcile_state === "y";

  const toggle = async (row: RegisterRow) => {
    if (isLocked(row) || busy()) return;
    const next = isTicked(row) ? "n" : "c";
    // Optimistic: ticking is rapid-fire and a round trip per click would make
    // it unusable. The cleared total is adjusted in step and re-synced on any
    // failure by reloading from the server.
    setRows((all) =>
      all.map((r) => (r.split_id === row.split_id ? { ...r, reconcile_state: next } : r))
    );
    setClearedCents((c) => c + (next === "c" ? row.amount_cents : -row.amount_cents));
    try {
      await store.setReconcile([row.split_id], next);
    } catch {
      await load(accountId());
    }
  };

  const statementCents = () => parseCents(statement());

  /** What's left to explain. Zero means the books agree with the bank. */
  const difference = createMemo(() => {
    const target = statementCents();
    if (target === null) return null;
    return target - asStatement(clearedCents());
  });

  const balanced = () => difference() === 0;
  const lockedCount = () => rows().filter(isLocked).length;
  const untickedCount = () => rows().filter((r) => !isTicked(r)).length;

  const finish = async () => {
    if (!balanced() || busy()) return;
    setBusy(true);
    try {
      await store.lockAccount(accountId());
      await load(accountId());
      setStatement("");
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await store.unlockAccount(accountId());
      await load(accountId());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div class="flex flex-wrap items-end gap-x-6 gap-y-3 pb-4 rule-b">
        <label class="flex flex-col gap-1 w-full sm:w-auto">
          <span class="t-label ink-2">Account</span>
          <select
            value={String(accountId())}
            onChange={(e) => load(Number(e.currentTarget.value))}
            class="field w-full sm:w-52"
            aria-label="Account to reconcile">
            <option value="0">Pick an account…</option>
            <For each={reconcilable()}>{(a) => <option value={String(a.id)}>{a.name}</option>}</For>
          </select>
        </label>

        <Show when={accountId() > 0}>
          <label class="flex flex-col gap-1">
            <span class="t-label ink-2">Statement date</span>
            <input
              type="date"
              value={statementDate()}
              onInput={(e) => setStatementDate(e.currentTarget.value)}
              class="field w-40 tabular-nums"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="t-label ink-2">
              {account()?.type === "liability" ? "Closing balance owed" : "Closing balance"}
            </span>
            <input
              type="text"
              inputmode="decimal"
              value={statement()}
              onInput={(e) => setStatement(e.currentTarget.value)}
              placeholder="$0.00"
              class="field w-40 text-right tabular-nums"
            />
          </label>
        </Show>
      </div>

      <Show
        when={accountId() > 0}
        fallback={
          <p class="t-meta ink-2 py-4 leading-relaxed max-w-prose">
            Pick an account, type the closing balance from its statement, then tick every entry that
            appears on that statement. When the difference reaches zero your books agree with the
            bank, and you can lock the period.
          </p>
        }>
        {/* Scoreboard — the numbers you're trying to make agree. */}
        {/* Sticks to the top on a phone: the difference is the number you
            watch while thumbing down a long list of entries. */}
        <div class="grid grid-cols-2 sm:grid-cols-4 rule-strong-b sticky top-0 z-10 bg-black">
          <Figure
            label="Statement"
            value={statementCents() === null ? "—" : money(statementCents()!)}
          />
          <Figure label="Cleared" value={money(asStatement(clearedCents()))} />
          <Figure
            label="Difference"
            value={difference() === null ? "—" : money(difference()!)}
            tone={difference() === null ? undefined : balanced() ? "pos" : "neg"}
          />
          <Figure label="Left to tick" value={String(untickedCount())} />
        </div>

        <Show when={loaded() && rows().length === 0}>
          <p class="t-meta ink-2 py-4">Nothing posted to this account yet.</p>
        </Show>

        <Show when={rows().length > 0}>
          <div class={GRID + " t-label ink-2 pt-3 pb-2 rule-b"}>
            <span aria-hidden="true" />
            <span>Date</span>
            <span>Description</span>
            <span class="text-right">Amount</span>
            <span class="hidden sm:block text-right">Balance</span>
          </div>
          {/* The row list scrolls inside itself on desktop; on a phone that
              traps the scroll, so it grows and the page scrolls instead. */}

          <div class="ruled-rows sm:max-h-[32rem] sm:overflow-y-auto">
            <For each={rows()}>
              {(r) => (
                <label
                  class={GRID + " py-2 sm:py-1.5 t-meta items-baseline"}
                  classList={{
                    "cursor-pointer hover:bg-[#0d1117]": !isLocked(r),
                    "opacity-60": isLocked(r),
                  }}>
                  <span class="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={isTicked(r)}
                      disabled={isLocked(r)}
                      onChange={() => toggle(r)}
                      class="accent-[#3987e5]"
                      aria-label={`Cleared: ${r.description}`}
                    />
                    <Show when={isLocked(r)}>
                      <span class="t-label ink-2" title="Locked by a reconciled statement">
                        ×
                      </span>
                    </Show>
                  </span>
                  <span class="ink-2 tabular-nums">{r.date.slice(5).replace("-", "/")}</span>
                  <span class="ink truncate">{r.description}</span>
                  <span class="text-right tabular-nums ink">
                    {amount(asStatement(r.amount_cents))}
                  </span>
                  <span class="hidden sm:block text-right tabular-nums ink-2">
                    {amount(asStatement(r.balance_cents))}
                  </span>
                </label>
              )}
            </For>
          </div>

          <div class="flex flex-wrap items-center gap-3 rule-strong-t pt-3 mt-1">
            <button onClick={finish} disabled={!balanced() || busy()} class="btn">
              {busy() ? "…" : "lock this statement"}
            </button>
            <Show when={lockedCount() > 0}>
              <button onClick={reopen} disabled={busy()} class="btn">
                reopen {lockedCount()} locked
              </button>
            </Show>
            <p class="t-meta ink-2 opacity-70">
              <Show
                when={balanced()}
                fallback={
                  <Show
                    when={difference() !== null}
                    fallback="Type the statement's closing balance to see the difference.">
                    Off by {money(Math.abs(difference()!))} — keep ticking, or fix the entry that's
                    wrong.
                  </Show>
                }>
                Balanced. Locking freezes these entries against later edits.
              </Show>
            </p>
          </div>
        </Show>
      </Show>
    </section>
  );
};

const Figure: Component<{ label: string; value: string; tone?: "pos" | "neg" }> = (p) => (
  <div class="py-3 pr-4">
    <div class="t-label ink-2">{p.label}</div>
    <div class={"t-figure mt-1 tabular-nums " + (p.tone ?? "ink")}>{p.value}</div>
  </div>
);

export default Reconcile;
