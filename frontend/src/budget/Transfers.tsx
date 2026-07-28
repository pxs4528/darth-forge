import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import type { Account, AccountKind } from "./api";
import { currentMonth, firstOfMonth, money, parseCents, today } from "./format";
import type { BudgetStore } from "./store";

// Accounts & transfers. A transfer moves money between accounts (paying the
// Discover bill from checking) and deliberately never counts as spending —
// the expenses were already logged individually against the card. Keep HYSA /
// index contributions as categorized transactions so budgets and the savings
// rate stay accurate.

type Props = { store: BudgetStore };

const KINDS: AccountKind[] = ["checking", "savings", "credit", "investment", "other"];

const inputCls =
  "bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm text-white " +
  "outline-none focus:border-[#3987e5] placeholder-gray-600";

const Transfers: Component<Props> = (props) => {
  const { store } = props;

  const defaultDate = () =>
    store.month() === currentMonth() ? today() : firstOfMonth(store.month());

  // ── entry ──
  const [date, setDate] = createSignal(defaultDate());
  const [from, setFrom] = createSignal(0);
  const [to, setTo] = createSignal(0);
  const [amount, setAmount] = createSignal("");
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    setDate(defaultDate());
  });

  const submit = async () => {
    setError("");
    const cents = parseCents(amount());
    if (!from() || !to()) return setError("Pick both accounts");
    if (from() === to()) return setError("From and to must differ");
    if (cents === null || cents <= 0) return setError("Enter a positive amount");

    setBusy(true);
    try {
      await store.addTransfer({
        date: date(),
        from_account: from(),
        to_account: to(),
        amount_cents: cents,
        note: note().trim(),
      });
      setAmount("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  // ── list ──
  const transfers = () => store.state()?.transfers ?? [];
  const [confirmId, setConfirmId] = createSignal<number | null>(null);
  let confirmTimer: number | undefined;

  const requestDelete = async (id: number) => {
    if (confirmId() === id) {
      window.clearTimeout(confirmTimer);
      setConfirmId(null);
      try {
        await store.deleteTransfer(id);
      } catch (e) {
        store.flash(e instanceof Error ? e.message : "Delete failed");
      }
    } else {
      setConfirmId(id);
      window.clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => setConfirmId(null), 1600);
    }
  };

  // ── per-account month summary ──
  type Row = { account: Account; chargedCents: number; inCents: number; outCents: number };
  const summary = createMemo<Row[]>(() => {
    const s = store.state();
    if (!s) return [];
    const rows = new Map<number, Row>();
    for (const a of s.accounts) {
      if (!a.archived) rows.set(a.id, { account: a, chargedCents: 0, inCents: 0, outCents: 0 });
    }
    for (const tx of s.transactions) {
      const row = rows.get(tx.account_id);
      if (row) row.chargedCents += tx.amount_cents;
    }
    for (const t of s.transfers) {
      const fromRow = rows.get(t.from_account);
      if (fromRow) fromRow.outCents += t.amount_cents;
      const toRow = rows.get(t.to_account);
      if (toRow) toRow.inCents += t.amount_cents;
    }
    return [...rows.values()];
  });

  // ── account manager ──
  const [managing, setManaging] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newKind, setNewKind] = createSignal<AccountKind>("checking");

  const addAccount = async () => {
    if (!newName().trim()) return;
    try {
      await store.createAccount(newName().trim(), newKind());
      setNewName("");
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to add account");
    }
  };

  const saveAccount = async (account: Account, patch: Partial<Account>) => {
    try {
      await store.updateAccount({ ...account, ...patch });
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to save account");
    }
  };

  return (
    <section class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-bold text-gray-200">Accounts &amp; transfers</h2>
        <button
          onClick={() => setManaging((v) => !v)}
          class="text-[11px] text-gray-500 hover:text-gray-300 underline decoration-dotted underline-offset-2">
          {managing() ? "done" : "manage accounts"}
        </button>
      </div>

      {/* Account manager */}
      <Show when={managing()}>
        <div class="border border-[#21262d] rounded p-3 space-y-2">
          <For each={store.accounts()}>
            {(a) => (
              <div
                class="grid grid-cols-[1fr_7rem_5rem] gap-2 items-center"
                classList={{ "opacity-50": a.archived }}>
                <input
                  type="text"
                  value={a.name}
                  onBlur={(e) => {
                    const name = e.currentTarget.value.trim();
                    if (name && name !== a.name) saveAccount(a, { name });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  class={inputCls}
                  aria-label="Account name"
                />
                <select
                  value={a.kind}
                  onChange={(e) => saveAccount(a, { kind: e.currentTarget.value as AccountKind })}
                  class={inputCls}
                  aria-label="Account kind">
                  <For each={KINDS}>{(k) => <option value={k}>{k}</option>}</For>
                </select>
                <button
                  onClick={() => saveAccount(a, { archived: !a.archived })}
                  class="px-2 py-1 text-[11px] rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]">
                  {a.archived ? "restore" : "archive"}
                </button>
              </div>
            )}
          </For>
          <div class="grid grid-cols-[1fr_7rem_5rem] gap-2 items-center pt-1 border-t border-[#21262d]">
            <input
              type="text"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addAccount()}
              placeholder="New account name"
              class={inputCls}
              aria-label="New account name"
            />
            <select
              value={newKind()}
              onChange={(e) => setNewKind(e.currentTarget.value as AccountKind)}
              class={inputCls}
              aria-label="New account kind">
              <For each={KINDS}>{(k) => <option value={k}>{k}</option>}</For>
            </select>
            <button
              onClick={addAccount}
              class="px-2 py-1 text-[11px] font-bold rounded bg-[#238636] text-white hover:bg-[#2ea043]">
              add
            </button>
          </div>
        </div>
      </Show>

      {/* Per-account summary for the month */}
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] tabular-nums">
          <thead>
            <tr class="text-[11px] uppercase tracking-wider text-gray-500 text-right">
              <th class="text-left font-normal pb-1">Account</th>
              <th class="font-normal pb-1">Charged</th>
              <th class="font-normal pb-1">In</th>
              <th class="font-normal pb-1">Out</th>
            </tr>
          </thead>
          <tbody>
            <For each={summary()}>
              {(row) => (
                <tr class="border-t border-[#21262d] text-right">
                  <td class="text-left py-1 text-gray-300">
                    {row.account.name}
                    <span class="text-gray-600 text-[11px]"> · {row.account.kind}</span>
                  </td>
                  <td class="text-white">{row.chargedCents ? money(row.chargedCents) : "—"}</td>
                  <td class="text-[#3fb950]">{row.inCents ? money(row.inCents) : "—"}</td>
                  <td class="text-[#f85149]">{row.outCents ? money(row.outCents) : "—"}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      {/* Transfer entry */}
      <div class="border-t border-[#21262d] pt-3">
        <div class="flex items-baseline justify-between mb-2">
          <h3 class="text-xs font-bold text-gray-300">Log a transfer</h3>
          <span class="text-[11px] text-gray-500">
            never counts as spending — use for CC payments &amp; moving money
          </span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-[8.5rem_1fr_1fr_6.5rem_1fr_auto] gap-2 items-start">
          <input
            type="date"
            value={date()}
            onInput={(e) => setDate(e.currentTarget.value)}
            onKeyDown={onKey}
            class={inputCls + " tabular-nums"}
            aria-label="Date"
          />
          <select
            value={String(from())}
            onChange={(e) => setFrom(Number(e.currentTarget.value))}
            onKeyDown={onKey}
            class={inputCls}
            aria-label="From account">
            <option value="0" disabled>
              From…
            </option>
            <For each={store.activeAccounts()}>
              {(a) => <option value={String(a.id)}>{a.name}</option>}
            </For>
          </select>
          <select
            value={String(to())}
            onChange={(e) => setTo(Number(e.currentTarget.value))}
            onKeyDown={onKey}
            class={inputCls}
            aria-label="To account">
            <option value="0" disabled>
              To…
            </option>
            <For each={store.activeAccounts()}>
              {(a) => <option value={String(a.id)}>{a.name}</option>}
            </For>
          </select>
          <input
            type="text"
            inputmode="decimal"
            value={amount()}
            onInput={(e) => setAmount(e.currentTarget.value)}
            onKeyDown={onKey}
            placeholder="$0.00"
            class={inputCls + " text-right tabular-nums"}
            aria-label="Amount"
          />
          <input
            type="text"
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            onKeyDown={onKey}
            placeholder="Note (optional)"
            class={inputCls}
            aria-label="Note"
          />
          <button
            onClick={submit}
            disabled={busy()}
            class="px-4 py-1.5 text-sm font-bold rounded bg-[#238636] text-white hover:bg-[#2ea043] disabled:opacity-50 col-span-2 sm:col-span-1">
            {busy() ? "…" : "Move"}
          </button>
        </div>
        <Show when={error()}>
          <p class="mt-2 text-xs text-[#f85149]">{error()}</p>
        </Show>
      </div>

      {/* Transfer list */}
      <Show when={transfers().length > 0}>
        <div class="border-t border-[#21262d] pt-2">
          <For each={transfers()}>
            {(t) => (
              <div class="group grid grid-cols-[5rem_1fr_6rem_auto] gap-2 items-center py-1 text-sm border-t border-[#21262d] first:border-t-0">
                <span class="text-gray-400 tabular-nums text-xs">{t.date.slice(5)}</span>
                <span class="text-gray-300 truncate">
                  {store.accountName(t.from_account)} <span class="text-gray-600">→</span>{" "}
                  {store.accountName(t.to_account)}
                  <Show when={t.note}>
                    <span class="text-gray-600 text-xs"> · {t.note}</span>
                  </Show>
                </span>
                <span class="text-right tabular-nums text-white">{money(t.amount_cents)}</span>
                <button
                  onClick={() => requestDelete(t.id)}
                  class={
                    "px-1.5 py-0.5 text-[11px] rounded border opacity-0 group-hover:opacity-100 focus:opacity-100 " +
                    (confirmId() === t.id
                      ? "border-[#d03b3b] bg-[#d03b3b] text-white opacity-100"
                      : "border-[#30363d] text-gray-300 hover:border-[#d03b3b] hover:text-[#f85149]")
                  }
                  aria-label="Delete transfer">
                  {confirmId() === t.id ? "sure?" : "del"}
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

export default Transfers;
