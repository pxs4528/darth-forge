import { createEffect, createSignal, For, Show, onCleanup, type Component } from "solid-js";
import type { Suggestion } from "./api";
import { firstOfMonth, parseCents, today, currentMonth } from "./format";
import { GROUP_META, type BudgetStore } from "./store";

// Fast, keyboard-first transaction entry:
//   Tab through date → description → amount → category; Enter anywhere submits.
//   Typing a known description auto-fills its usual category; after submit the
//   date and category stick, focus returns to description.

type Props = {
  store: BudgetStore;
  /** Lets the page-level "n" shortcut focus the description input. */
  registerFocus: (fn: () => void) => void;
};

const EntryForm: Component<Props> = (props) => {
  const { store } = props;

  const defaultDate = () =>
    store.month() === currentMonth() ? today() : firstOfMonth(store.month());

  const [date, setDate] = createSignal(defaultDate());
  const [desc, setDesc] = createSignal("");
  const [amount, setAmount] = createSignal("");
  const [category, setCategory] = createSignal("");
  const [account, setAccount] = createSignal(0);
  const [categoryTouched, setCategoryTouched] = createSignal(false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [suggestIndex, setSuggestIndex] = createSignal(-1);
  const [suggestOpen, setSuggestOpen] = createSignal(false);

  let descRef: HTMLInputElement | undefined;
  let debounce: number | undefined;

  props.registerFocus(() => descRef?.focus());

  onCleanup(() => window.clearTimeout(debounce));

  // Reset the sticky date when the user navigates to a different month.
  createEffect(() => {
    setDate(defaultDate());
  });

  const closeSuggest = () => {
    setSuggestOpen(false);
    setSuggestIndex(-1);
  };

  const onDescInput = (value: string) => {
    setDesc(value);
    window.clearTimeout(debounce);
    if (value.trim().length < 2) {
      closeSuggest();
      setSuggestions([]);
      return;
    }
    debounce = window.setTimeout(async () => {
      try {
        const got = await store.suggest(value);
        setSuggestions(got);
        setSuggestOpen(got.length > 0);
        setSuggestIndex(-1);
        // Exact match on a known description → auto-fill its usual category
        // (unless the user already picked one by hand this entry).
        const exact = got.find((s) => s.description.toLowerCase() === value.trim().toLowerCase());
        if (exact && !categoryTouched()) setCategory(exact.category);
      } catch {
        /* suggestions are best-effort */
      }
    }, 180);
  };

  const pickSuggestion = (s: Suggestion) => {
    setDesc(s.description);
    setCategory(s.category);
    closeSuggest();
  };

  const submit = async () => {
    setError("");
    const cents = parseCents(amount());
    if (!desc().trim()) return setError("Description required");
    if (cents === null || cents === 0) return setError("Enter a non-zero amount");
    if (!category()) return setError("Pick a category");
    if (!date()) return setError("Pick a date");

    setBusy(true);
    try {
      await store.addTransaction({
        date: date(),
        description: desc().trim(),
        amount_cents: cents,
        category: category(),
        account_id: account(),
      });
      // Date + category + account stick for rapid statement entry; text fields clear.
      setDesc("");
      setAmount("");
      setSuggestions([]);
      closeSuggest();
      setCategoryTouched(false);
      descRef?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const onDescKey = (e: KeyboardEvent) => {
    if (suggestOpen()) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestIndex((i) => Math.min(i + 1, suggestions().length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSuggest();
        return;
      }
      if (e.key === "Enter" && suggestIndex() >= 0) {
        e.preventDefault();
        pickSuggestion(suggestions()[suggestIndex()]);
        return;
      }
      if (e.key === "Tab" && suggestIndex() >= 0) {
        pickSuggestion(suggestions()[suggestIndex()]);
        return; // let Tab move focus onward
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const inputCls =
    "bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-2 text-sm text-white " +
    "outline-none focus:border-[#3987e5] placeholder-gray-600";

  return (
    <section class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-sm font-bold text-gray-200">Add transaction</h2>
        <span class="text-[11px] text-gray-500">Enter to add · date &amp; category stick</span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-[8.5rem_1fr_6.5rem_11rem_8rem_auto] gap-2 items-start">
        <input
          type="date"
          value={date()}
          onInput={(e) => setDate(e.currentTarget.value)}
          onKeyDown={onFieldKey}
          class={inputCls + " tabular-nums col-span-1"}
          aria-label="Date"
        />

        <div class="relative col-span-1 sm:col-span-1">
          <input
            ref={descRef}
            type="text"
            value={desc()}
            onInput={(e) => onDescInput(e.currentTarget.value)}
            onKeyDown={onDescKey}
            onBlur={() => window.setTimeout(closeSuggest, 150)}
            placeholder="Description (e.g. HEB, Shell, Rent)"
            class={inputCls + " w-full"}
            autocomplete="off"
            spellcheck={false}
            aria-label="Description"
          />
          <Show when={suggestOpen()}>
            <ul class="absolute z-20 mt-1 w-full bg-[#161b22] border border-[#30363d] rounded shadow-xl overflow-hidden">
              <For each={suggestions()}>
                {(s, i) => (
                  <li>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(s);
                      }}
                      class={
                        "w-full text-left px-2.5 py-1.5 text-sm flex justify-between gap-2 " +
                        (i() === suggestIndex() ? "bg-[#21262d]" : "hover:bg-[#21262d]")
                      }>
                      <span class="text-white truncate">{s.description}</span>
                      <span class="text-[11px] text-gray-400 shrink-0">
                        {store.catalog()?.categories.find((c) => c.key === s.category)?.label ??
                          s.category}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>

        <input
          type="text"
          inputmode="decimal"
          value={amount()}
          onInput={(e) => setAmount(e.currentTarget.value)}
          onKeyDown={onFieldKey}
          placeholder="$0.00"
          class={inputCls + " text-right tabular-nums"}
          aria-label="Amount"
        />

        <select
          value={category()}
          onChange={(e) => {
            setCategory(e.currentTarget.value);
            setCategoryTouched(true);
          }}
          onKeyDown={onFieldKey}
          class={inputCls + " w-full"}
          aria-label="Category">
          <option value="" disabled>
            Category…
          </option>
          <For each={store.catalog()?.categories ?? []}>
            {(c) => (
              <option value={c.key}>
                {GROUP_META[c.group]?.label ?? c.group} · {c.label}
              </option>
            )}
          </For>
        </select>

        <select
          value={String(account())}
          onChange={(e) => setAccount(Number(e.currentTarget.value))}
          onKeyDown={onFieldKey}
          class={inputCls + " w-full"}
          aria-label="Account">
          <option value="0">No account</option>
          <For each={store.activeAccounts()}>
            {(a) => <option value={String(a.id)}>{a.name}</option>}
          </For>
        </select>

        <button
          type="button"
          onClick={submit}
          disabled={busy()}
          class="px-4 py-2 text-sm font-bold rounded bg-[#238636] text-white hover:bg-[#2ea043] disabled:opacity-50 col-span-2 sm:col-span-1">
          {busy() ? "…" : "Add"}
        </button>
      </div>

      <Show when={error()}>
        <p class="mt-2 text-xs text-[#f85149]">{error()}</p>
      </Show>
    </section>
  );
};

export default EntryForm;
