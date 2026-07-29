import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
} from "solid-js";
import type { Entry } from "./api";
import { money, parseCents } from "./format";
import { simpleShape, splitsFor, TYPE_META, type BudgetStore } from "./store";

// The month's entries, newest first, each shown as "from → to". Keyboard:
// j/k select, e edit, x-x delete. Inline edit saves with Enter, cancels with Esc.

type Props = { store: BudgetStore };

const inputCls =
  "bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm text-white " +
  "outline-none focus:border-[#3987e5] w-full min-w-0";

const Ledger: Component<Props> = (props) => {
  const { store } = props;

  const [selected, setSelected] = createSignal(-1);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [confirmId, setConfirmId] = createSignal<number | null>(null);

  // edit buffer
  const [eDate, setEDate] = createSignal("");
  const [eDesc, setEDesc] = createSignal("");
  const [eAmount, setEAmount] = createSignal("");
  const [eFrom, setEFrom] = createSignal(0);
  const [eTo, setETo] = createSignal(0);
  const [eError, setEError] = createSignal("");

  let listRef: HTMLDivElement | undefined;
  let confirmTimer: number | undefined;

  const entries = () => store.state()?.entries ?? [];

  createEffect(() => {
    if (selected() >= entries().length) setSelected(entries().length - 1);
  });

  const accountColor = (id: number) => {
    const a = store.accountById(id);
    return a ? TYPE_META[a.type].color : "#5f5d58";
  };

  const startEdit = (entry: Entry) => {
    const shape = simpleShape(entry);
    if (!shape) {
      store.flash("This entry has multiple splits — edit it in the register");
      return;
    }
    setEditingId(entry.id);
    setEDate(entry.date);
    setEDesc(entry.description);
    setEAmount((shape.amountCents / 100).toFixed(2));
    setEFrom(shape.fromId);
    setETo(shape.toId);
    setEError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEError("");
  };

  const saveEdit = async (entry: Entry) => {
    const cents = parseCents(eAmount());
    if (!eDesc().trim() || cents === null || cents <= 0 || !eDate()) {
      setEError("Fill date, description and a positive amount");
      return;
    }
    if (eFrom() === eTo()) {
      setEError("From and to must differ");
      return;
    }
    try {
      await store.updateEntry({
        ...entry,
        date: eDate(),
        description: eDesc().trim(),
        splits: splitsFor(eFrom(), eTo(), cents),
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
        await store.deleteEntry(id);
      } catch (e) {
        store.flash(e instanceof Error ? e.message : "Delete failed");
      }
    } else {
      setConfirmId(id);
      window.clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => setConfirmId(null), 1600);
    }
  };

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
      const next = Math.min(Math.max(selected() + delta, 0), entries().length - 1);
      setSelected(next);
      listRef?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "e" && selected() >= 0) {
      e.preventDefault();
      const entry = entries()[selected()];
      if (entry) startEdit(entry);
    } else if ((e.key === "x" || e.key === "Delete") && selected() >= 0) {
      e.preventDefault();
      const entry = entries()[selected()];
      if (entry) requestDelete(entry.id);
    }
  };

  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => {
    document.removeEventListener("keydown", onKey);
    window.clearTimeout(confirmTimer);
  });

  return (
    <section class="bg-[#0d1117] border border-[#30363d] rounded-lg">
      <div class="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 class="text-sm font-semibold text-gray-200">
          Entries <span class="text-gray-500 font-normal">({entries().length})</span>
        </h2>
        <span class="text-[11px] text-gray-500 hidden sm:inline">
          j/k select · e edit · x-x delete
        </span>
      </div>

      <div ref={listRef} class="max-h-[28rem] overflow-y-auto">
        <Show
          when={entries().length > 0}
          fallback={
            <p class="px-4 pb-4 text-sm text-gray-500">
              Nothing this month — record your first transaction above.
            </p>
          }>
          <For each={entries()}>
            {(entry, i) => {
              const shape = () => simpleShape(entry);
              return (
                <Show
                  when={editingId() !== entry.id}
                  fallback={
                    <div class="px-4 py-2 border-t border-[#21262d] bg-[#161b22]">
                      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 items-center">
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
                            if (e.key === "Enter") saveEdit(entry);
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
                            if (e.key === "Enter") saveEdit(entry);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          class={inputCls + " text-right tabular-nums"}
                          aria-label="Amount"
                        />
                        <select
                          value={String(eFrom())}
                          onChange={(e) => setEFrom(Number(e.currentTarget.value))}
                          class={inputCls + " truncate"}
                          aria-label="From account">
                          <For each={store.activeAccounts()}>
                            {(a) => <option value={String(a.id)}>{a.name}</option>}
                          </For>
                        </select>
                        <select
                          value={String(eTo())}
                          onChange={(e) => setETo(Number(e.currentTarget.value))}
                          class={inputCls + " truncate"}
                          aria-label="To account">
                          <For each={store.activeAccounts()}>
                            {(a) => <option value={String(a.id)}>{a.name}</option>}
                          </For>
                        </select>
                        <div class="flex gap-1.5 col-span-2 sm:col-span-1">
                          <button
                            onClick={() => saveEdit(entry)}
                            class="px-2.5 py-1 text-xs font-semibold rounded bg-[#238636] text-white hover:bg-[#2ea043]">
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
                    onDblClick={() => startEdit(entry)}
                    class={
                      "group px-4 py-1.5 border-t border-[#21262d] grid grid-cols-[3.5rem_1fr_auto] sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,14rem)_6.5rem_auto] gap-2 items-center text-sm cursor-default " +
                      (selected() === i() ? "bg-[#1c2430]" : "hover:bg-[#161b22]")
                    }>
                    <span class="text-gray-400 tabular-nums text-xs">{entry.date.slice(5)}</span>
                    <span class="text-white truncate">{entry.description}</span>

                    <span class="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 truncate">
                      <Show
                        when={shape()}
                        fallback={<span class="text-gray-500">split entry</span>}>
                        {(s) => (
                          <>
                            <span
                              class="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: accountColor(s().fromId) }}
                            />
                            <span class="truncate">{store.accountName(s().fromId)}</span>
                            <span class="text-gray-600 shrink-0">→</span>
                            <span
                              class="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: accountColor(s().toId) }}
                            />
                            <span class="truncate">{store.accountName(s().toId)}</span>
                          </>
                        )}
                      </Show>
                    </span>

                    <span class="text-right tabular-nums text-white">
                      {money(shape()?.amountCents ?? 0)}
                    </span>

                    <span class="flex gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={() => startEdit(entry)}
                        class="px-1.5 py-0.5 text-[11px] rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]"
                        aria-label={`Edit ${entry.description}`}>
                        edit
                      </button>
                      <button
                        onClick={() => requestDelete(entry.id)}
                        class={
                          "px-1.5 py-0.5 text-[11px] rounded border " +
                          (confirmId() === entry.id
                            ? "border-[#d03b3b] bg-[#d03b3b] text-white"
                            : "border-[#30363d] text-gray-300 hover:border-[#d03b3b] hover:text-[#f85149]")
                        }
                        aria-label={`Delete ${entry.description}`}>
                        {confirmId() === entry.id ? "sure?" : "del"}
                      </button>
                    </span>
                  </div>
                </Show>
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
};

export default Ledger;
