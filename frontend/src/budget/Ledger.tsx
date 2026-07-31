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
import { amount, parseCents } from "./format";
import { signedAmount, simpleShape, splitsFor, type BudgetStore } from "./store";

// The register — the centrepiece. A ledger page: date, description, the two
// accounts money moved between, and the amount, aligned in the same columns on
// every row. Keyboard: j/k select, e edit, x-x delete (documented in ?).
//
// Amounts are rendered in plain ink and let the minus carry direction. Green
// and red are reserved for figures whose sign is the point — surplus, balance
// changes — and a register that is mostly spending would be mostly red.

type Props = { store: BudgetStore };

/** Same column tracks on the header, the rows and the empty state. */
const GRID =
  "grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem_3.5rem] " +
  "sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,15rem)_7rem_4.5rem] gap-3";

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
    <section>
      {/* Column headers */}
      <div class={GRID + " t-label ink-2 pb-2 rule-b"}>
        <span>Date</span>
        <span>Description</span>
        <span class="hidden sm:block">From → to</span>
        <span class="text-right">Amount</span>
        <span aria-hidden="true" />
      </div>

      <Show
        when={entries().length > 0}
        fallback={
          <p class="t-meta ink-2 py-4">Nothing this month — record your first transaction above.</p>
        }>
        <div ref={listRef} class="ruled-rows max-h-[32rem] overflow-y-auto">
          <For each={entries()}>
            {(entry, i) => (
              <Show
                when={editingId() !== entry.id}
                fallback={
                  <div class="py-2 bg-[#0d1117]">
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 items-center">
                      <input
                        type="date"
                        value={eDate()}
                        onInput={(e) => setEDate(e.currentTarget.value)}
                        class="field tabular-nums"
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
                        class="field"
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
                        class="field text-right tabular-nums"
                        aria-label="Amount"
                      />
                      <select
                        value={String(eFrom())}
                        onChange={(e) => setEFrom(Number(e.currentTarget.value))}
                        class="field truncate"
                        aria-label="From account">
                        <For each={store.activeAccounts()}>
                          {(a) => <option value={String(a.id)}>{a.name}</option>}
                        </For>
                      </select>
                      <select
                        value={String(eTo())}
                        onChange={(e) => setETo(Number(e.currentTarget.value))}
                        class="field truncate"
                        aria-label="To account">
                        <For each={store.activeAccounts()}>
                          {(a) => <option value={String(a.id)}>{a.name}</option>}
                        </For>
                      </select>
                      <div class="flex gap-1.5 col-span-2 sm:col-span-1">
                        <button onClick={() => saveEdit(entry)} class="btn">
                          save
                        </button>
                        <button onClick={cancelEdit} class="btn">
                          esc
                        </button>
                      </div>
                    </div>
                    <Show when={eError()}>
                      <p class="mt-1.5 t-meta neg">{eError()}</p>
                    </Show>
                  </div>
                }>
                <div
                  data-row={i()}
                  onClick={() => setSelected(i())}
                  onDblClick={() => startEdit(entry)}
                  class={
                    GRID +
                    " group items-baseline py-1.5 t-meta cursor-default " +
                    (selected() === i() ? "bg-[#161b22]" : "hover:bg-[#0d1117]")
                  }>
                  <span class="ink-2 tabular-nums">{entry.date.slice(5).replace("-", "/")}</span>
                  <span class="ink truncate">{entry.description}</span>

                  <span class="hidden sm:block ink-2 truncate">
                    <Show when={simpleShape(entry)} fallback={<span>split entry</span>}>
                      {(s) => (
                        <>
                          {store.accountName(s().fromId)}
                          <span class="px-1 text-[#484f58]">→</span>
                          {store.accountName(s().toId)}
                        </>
                      )}
                    </Show>
                  </span>

                  <span class="text-right tabular-nums ink">
                    {amount(signedAmount(entry, store.accountById))}
                  </span>

                  <span class="flex gap-1 justify-end sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(entry)}
                      class="btn px-1.5 py-0.5"
                      aria-label={`Edit ${entry.description}`}>
                      ed
                    </button>
                    <button
                      onClick={() => requestDelete(entry.id)}
                      class="btn px-1.5 py-0.5"
                      classList={{ "btn-armed": confirmId() === entry.id }}
                      aria-label={`Delete ${entry.description}`}>
                      {confirmId() === entry.id ? "sure?" : "del"}
                    </button>
                  </span>
                </div>
              </Show>
            )}
          </For>
        </div>

        {/*
         * Closes the page. Deliberately no money total: summing the register
         * would count a Checking → HYSA transfer as income, and the figures
         * that do mean something (income, spending, surplus) are in the band.
         */}
        <div class={GRID + " rule-strong-t pt-3 mt-1 t-label ink-2"}>
          <span class="col-span-2">
            {entries().length} {entries().length === 1 ? "entry" : "entries"}
          </span>
          <span class="hidden sm:block" aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </div>
      </Show>
    </section>
  );
};

export default Ledger;
