import {
  createEffect,
  createSignal,
  For,
  Show,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import type { Transaction } from "./api";
import { money, parseCents } from "./format";
import { GROUP_META, type BudgetStore } from "./store";

// Transaction list with vim-ish keys: j/k select, e edit, x-x (or Delete twice)
// deletes. Inline edit: Enter saves, Esc cancels.

type Props = { store: BudgetStore };

const TxList: Component<Props> = (props) => {
  const { store } = props;

  const [selected, setSelected] = createSignal(-1);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [confirmId, setConfirmId] = createSignal<number | null>(null);

  // edit buffer
  const [eDate, setEDate] = createSignal("");
  const [eDesc, setEDesc] = createSignal("");
  const [eAmount, setEAmount] = createSignal("");
  const [eCategory, setECategory] = createSignal("");
  const [eAccount, setEAccount] = createSignal(0);
  const [eError, setEError] = createSignal("");

  let listRef: HTMLDivElement | undefined;
  let confirmTimer: number | undefined;

  const txs = () => store.state()?.transactions ?? [];

  // Keep selection in range as the list changes.
  createEffect(() => {
    if (selected() >= txs().length) setSelected(txs().length - 1);
  });

  const catLabel = (key: string) =>
    store.catalog()?.categories.find((c) => c.key === key)?.label ?? key;
  const groupColor = (key: string) =>
    GROUP_META[store.groupOf()[key] ?? "misc"]?.color ?? "#5f5d58";

  const startEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setEDate(tx.date);
    setEDesc(tx.description);
    setEAmount((tx.amount_cents / 100).toFixed(2));
    setECategory(tx.category);
    setEAccount(tx.account_id);
    setEError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEError("");
  };

  const saveEdit = async (tx: Transaction) => {
    const cents = parseCents(eAmount());
    if (!eDesc().trim() || cents === null || cents === 0 || !eDate()) {
      setEError("Fill date, description and a non-zero amount");
      return;
    }
    try {
      await store.updateTransaction({
        ...tx,
        date: eDate(),
        month: eDate().slice(0, 7),
        description: eDesc().trim(),
        amount_cents: cents,
        category: eCategory(),
        account_id: eAccount(),
      });
      cancelEdit();
    } catch (e) {
      setEError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const requestDelete = async (id: number) => {
    if (confirmId() === id) {
      window.clearTimeout(confirmTimer);
      setConfirmId(null);
      try {
        await store.deleteTransaction(id);
      } catch (e) {
        store.flash(e instanceof Error ? e.message : "Delete failed");
      }
    } else {
      setConfirmId(id);
      window.clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => setConfirmId(null), 1600);
    }
  };

  // vim-ish list navigation, page-wide but inert while typing in a field
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement;
    if (typing || editingId() !== null) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "j" || e.key === "k") {
      e.preventDefault();
      const delta = e.key === "j" ? 1 : -1;
      const next = Math.min(Math.max(selected() + delta, 0), txs().length - 1);
      setSelected(next);
      listRef?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "e" && selected() >= 0) {
      e.preventDefault();
      const tx = txs()[selected()];
      if (tx) startEdit(tx);
    } else if ((e.key === "x" || e.key === "Delete") && selected() >= 0) {
      e.preventDefault();
      const tx = txs()[selected()];
      if (tx) requestDelete(tx.id);
    }
  };

  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => {
    document.removeEventListener("keydown", onKey);
    window.clearTimeout(confirmTimer);
  });

  const inputCls =
    "bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm text-white outline-none focus:border-[#3987e5]";

  return (
    <section class="bg-[#0d1117] border border-[#30363d] rounded-lg">
      <div class="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 class="text-sm font-bold text-gray-200">
          Transactions <span class="text-gray-500 font-normal">({txs().length})</span>
        </h2>
        <span class="text-[11px] text-gray-500 hidden sm:inline">
          j/k select · e edit · x-x delete
        </span>
      </div>

      <div ref={listRef} class="max-h-[26rem] overflow-y-auto">
        <Show
          when={txs().length > 0}
          fallback={
            <p class="px-4 pb-4 text-sm text-gray-500">
              Nothing yet — add your first expense above.
            </p>
          }>
          <For each={txs()}>
            {(tx, i) => (
              <Show
                when={editingId() !== tx.id}
                fallback={
                  <div class="px-4 py-2 border-t border-[#21262d] bg-[#161b22]">
                    <div class="grid grid-cols-2 sm:grid-cols-[8.5rem_1fr_6rem_8rem_10rem_auto] gap-2 items-center">
                      <input
                        type="date"
                        value={eDate()}
                        onInput={(e) => setEDate(e.currentTarget.value)}
                        class={inputCls + " tabular-nums"}
                        aria-label="Date"
                      />
                      <input
                        type="text"
                        value={eDesc()}
                        ref={(el) => setTimeout(() => el.focus())}
                        onInput={(e) => setEDesc(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(tx);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        class={inputCls}
                        aria-label="Description"
                      />
                      <input
                        type="text"
                        inputmode="decimal"
                        value={eAmount()}
                        onInput={(e) => setEAmount(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(tx);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        class={inputCls + " text-right tabular-nums"}
                        aria-label="Amount"
                      />
                      <select
                        value={String(eAccount())}
                        onChange={(e) => setEAccount(Number(e.currentTarget.value))}
                        class={inputCls}
                        aria-label="Account">
                        <option value="0">No account</option>
                        <For each={store.activeAccounts()}>
                          {(a) => <option value={String(a.id)}>{a.name}</option>}
                        </For>
                      </select>
                      <select
                        value={eCategory()}
                        onChange={(e) => setECategory(e.currentTarget.value)}
                        class={inputCls}
                        aria-label="Category">
                        <For each={store.catalog()?.categories ?? []}>
                          {(c) => <option value={c.key}>{c.label}</option>}
                        </For>
                      </select>
                      <div class="flex gap-1.5 col-span-2 sm:col-span-1">
                        <button
                          onClick={() => saveEdit(tx)}
                          class="px-2.5 py-1 text-xs font-bold rounded bg-[#238636] text-white hover:bg-[#2ea043]">
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          class="px-2.5 py-1 text-xs rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]">
                          Esc
                        </button>
                      </div>
                    </div>
                    <Show when={eError()}>
                      <p class="mt-1 text-xs text-[#f85149]">{eError()}</p>
                    </Show>
                  </div>
                }>
                <div
                  data-row={i()}
                  onClick={() => setSelected(i())}
                  onDblClick={() => startEdit(tx)}
                  class={
                    "group px-4 py-1.5 border-t border-[#21262d] grid grid-cols-[5rem_1fr_auto] sm:grid-cols-[5.5rem_1fr_10rem_6rem_auto] gap-2 items-center text-sm cursor-default " +
                    (selected() === i() ? "bg-[#1c2430]" : "hover:bg-[#161b22]")
                  }>
                  <span class="text-gray-400 tabular-nums text-xs">{tx.date.slice(5)}</span>
                  <span class="text-white truncate">{tx.description}</span>
                  <span class="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 truncate">
                    <span
                      class="w-2 h-2 rounded-full shrink-0"
                      style={{ background: groupColor(tx.category) }}
                    />
                    {catLabel(tx.category)}
                    <Show when={tx.account_id > 0}>
                      <span class="text-gray-600 truncate">
                        · {store.accountName(tx.account_id)}
                      </span>
                    </Show>
                  </span>
                  <span
                    class={
                      "text-right tabular-nums " +
                      (tx.amount_cents < 0 ? "text-[#3fb950]" : "text-white")
                    }>
                    {money(tx.amount_cents)}
                  </span>
                  <span class="flex gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={() => startEdit(tx)}
                      class="px-1.5 py-0.5 text-[11px] rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]"
                      aria-label={`Edit ${tx.description}`}>
                      edit
                    </button>
                    <button
                      onClick={() => requestDelete(tx.id)}
                      class={
                        "px-1.5 py-0.5 text-[11px] rounded border " +
                        (confirmId() === tx.id
                          ? "border-[#d03b3b] bg-[#d03b3b] text-white"
                          : "border-[#30363d] text-gray-300 hover:border-[#d03b3b] hover:text-[#f85149]")
                      }
                      aria-label={`Delete ${tx.description}`}>
                      {confirmId() === tx.id ? "sure?" : "del"}
                    </button>
                  </span>
                </div>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
};

export default TxList;
