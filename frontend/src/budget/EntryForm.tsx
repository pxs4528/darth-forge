import { createEffect, createSignal, For, onCleanup, Show, type Component } from "solid-js";
import type { AccountBalance, Suggestion } from "./api";
import { currentMonth, firstOfMonth, parseCents, today } from "./format";
import type { BudgetStore } from "./store";

// One form for every kind of money movement. A paycheck, a card purchase, a
// credit-card payment and a transfer to savings are all the same shape:
// an amount leaving one account and arriving in another. That's what makes
// this simpler than the old two-form setup, not just prettier.

type Props = {
  store: BudgetStore;
  /** Lets the page-level "n" shortcut focus the description input. */
  registerFocus: (fn: () => void) => void;
};

/** Groups accounts under <optgroup> headings so a long list stays scannable. */
const AccountOptions: Component<{ accounts: AccountBalance[] }> = (props) => {
  const groups = () => {
    const out: { label: string; items: AccountBalance[] }[] = [];
    for (const a of props.accounts) {
      const label =
        a.type === "asset"
          ? "Accounts"
          : a.type === "liability"
            ? "Credit & debt"
            : a.type === "income"
              ? "Income"
              : a.type === "expense"
                ? "Spending"
                : "Opening balances";
      const existing = out.find((g) => g.label === label);
      if (existing) existing.items.push(a);
      else out.push({ label, items: [a] });
    }
    return out;
  };

  return (
    <For each={groups()}>
      {(g) => (
        <optgroup label={g.label}>
          <For each={g.items}>{(a) => <option value={String(a.id)}>{a.name}</option>}</For>
        </optgroup>
      )}
    </For>
  );
};

const EntryForm: Component<Props> = (props) => {
  const { store } = props;

  const defaultDate = () =>
    store.month() === currentMonth() ? today() : firstOfMonth(store.month());

  const [date, setDate] = createSignal(defaultDate());
  const [desc, setDesc] = createSignal("");
  const [amount, setAmount] = createSignal("");
  const [fromId, setFromId] = createSignal(0);
  const [toId, setToId] = createSignal(0);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [suggestIndex, setSuggestIndex] = createSignal(-1);
  const [suggestOpen, setSuggestOpen] = createSignal(false);

  let descRef: HTMLInputElement | undefined;
  let debounce: number | undefined;

  props.registerFocus(() => descRef?.focus());
  onCleanup(() => window.clearTimeout(debounce));

  // Reset the sticky date when navigating to a different month.
  createEffect(() => {
    setDate(defaultDate());
  });

  const closeSuggest = () => {
    setSuggestOpen(false);
    setSuggestIndex(-1);
  };

  const applySuggestion = (s: Suggestion) => {
    setDesc(s.description);
    if (s.from_account_id) setFromId(s.from_account_id);
    if (s.to_account_id) setToId(s.to_account_id);
    if (!amount() && s.amount_cents) setAmount((s.amount_cents / 100).toFixed(2));
    closeSuggest();
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
      } catch {
        /* suggestions are best-effort */
      }
    }, 180);
  };

  const submit = async () => {
    setError("");
    const cents = parseCents(amount());
    if (!desc().trim()) return setError("Description required");
    if (cents === null || cents <= 0) return setError("Enter a positive amount");
    if (!fromId() || !toId()) return setError("Pick where the money came from and went to");
    if (fromId() === toId()) return setError("From and to must be different accounts");
    if (!date()) return setError("Pick a date");

    setBusy(true);
    try {
      await store.addEntry({
        date: date(),
        description: desc().trim(),
        fromId: fromId(),
        toId: toId(),
        amountCents: cents,
      });
      // Date and accounts stick for rapid statement entry; text clears.
      setDesc("");
      setAmount("");
      setSuggestions([]);
      closeSuggest();
      descRef?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
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
      if ((e.key === "Enter" || e.key === "Tab") && suggestIndex() >= 0) {
        if (e.key === "Enter") e.preventDefault();
        applySuggestion(suggestions()[suggestIndex()]);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section class="pb-5 mb-4 rule-b">
      <h2 class="t-label ink-2 mb-2">Record a transaction</h2>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 items-start">
        <input
          type="date"
          value={date()}
          onInput={(e) => setDate(e.currentTarget.value)}
          onKeyDown={onFieldKey}
          class="field tabular-nums"
          aria-label="Date"
        />

        <div class="relative col-span-1">
          <input
            ref={descRef}
            type="text"
            value={desc()}
            onInput={(e) => onDescInput(e.currentTarget.value)}
            onKeyDown={onDescKey}
            onBlur={() => window.setTimeout(closeSuggest, 150)}
            placeholder="Description"
            class="field"
            autocomplete="off"
            spellcheck={false}
            aria-label="Description"
          />
          <Show when={suggestOpen()}>
            <ul class="absolute z-20 w-full bg-[#161b22] border border-[color:var(--rule-strong)] shadow-xl overflow-hidden">
              <For each={suggestions()}>
                {(s, i) => (
                  <li>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(s);
                      }}
                      class={
                        "w-full text-left px-2 py-1.5 t-meta flex justify-between gap-2 " +
                        (i() === suggestIndex() ? "bg-[#21262d]" : "hover:bg-[#21262d]")
                      }>
                      <span class="ink truncate">{s.description}</span>
                      <span class="ink-2 shrink-0">{store.accountName(s.to_account_id)}</span>
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
          class="field text-right tabular-nums"
          aria-label="Amount"
        />

        <select
          value={String(fromId())}
          onChange={(e) => setFromId(Number(e.currentTarget.value))}
          onKeyDown={onFieldKey}
          class="field truncate"
          aria-label="From account">
          <option value="0" disabled>
            From…
          </option>
          <AccountOptions accounts={store.sourceAccounts()} />
        </select>

        <select
          value={String(toId())}
          onChange={(e) => setToId(Number(e.currentTarget.value))}
          onKeyDown={onFieldKey}
          class="field truncate"
          aria-label="To account">
          <option value="0" disabled>
            To…
          </option>
          <AccountOptions accounts={store.destinationAccounts()} />
        </select>

        <button
          type="button"
          onClick={submit}
          disabled={busy()}
          class="btn w-full sm:w-auto col-span-2 sm:col-span-1 py-2">
          {busy() ? "…" : "Add"}
        </button>
      </div>

      <Show when={error()}>
        <p class="mt-2 t-meta neg">{error()}</p>
      </Show>

      {/* Not a keyboard hint — this is how the double-entry shape maps to real
          transactions, which is the one thing the form can't show on its own. */}
      <p class="mt-2.5 t-meta ink-2 opacity-70 leading-relaxed">
        Paycheck → Checking · Discover → Groceries · Checking → Discover · Checking → HYSA
      </p>
    </section>
  );
};

export default EntryForm;
