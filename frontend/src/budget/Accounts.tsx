import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import type { AccountBalance, AccountType } from "./api";
import { amount, firstOfMonth, money, parseCents } from "./format";
import { CLASS_LABELS, displayBalance, GROUP_LABELS, TYPE_META, type BudgetStore } from "./store";

/** Must be typed exactly to wipe the ledger. Matches the server-side check. */
const RESET_PHRASE = "DELETE ALL ENTRIES";

// What you own and owe, with balances computed from the ledger rather than
// typed in. Assets and liabilities are grouped under their own headings — the
// grouping carries the account type, so the rows need no colour coding.
//
// Also where accounts are created, renamed, classified and archived.

type Props = { store: BudgetStore };

const TYPES: AccountType[] = ["asset", "liability", "income", "expense", "equity"];
const NEW_TYPES: AccountType[] = ["asset", "liability", "income", "expense"];

const GRID =
  "grid grid-cols-[minmax(0,1fr)_4.75rem_5.75rem] sm:grid-cols-[minmax(0,1fr)_6rem_7rem] gap-2 sm:gap-3";

const Accounts: Component<Props> = (props) => {
  const { store } = props;

  const [managing, setManaging] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newType, setNewType] = createSignal<AccountType>("asset");
  const [newGroup, setNewGroup] = createSignal("misc");
  const [openingFor, setOpeningFor] = createSignal<number | null>(null);
  const [openingAmount, setOpeningAmount] = createSignal("");
  // Opening balances are dated: starting a book on 1 August means dating them
  // 2026-08-01, not today. Sticky across accounts so you set it once.
  const [openingDate, setOpeningDate] = createSignal(firstOfMonth(store.month()));
  const [resetConfirm, setResetConfirm] = createSignal("");
  const [resetting, setResetting] = createSignal(false);

  // Balance sheet: only assets and liabilities are "what you have".
  const sheet = (type: AccountType) =>
    createMemo(() => store.accounts().filter((a) => !a.archived && a.type === type));

  const assets = sheet("asset");
  const liabilities = sheet("liability");

  const addAccount = async () => {
    const name = newName().trim();
    if (!name) return;
    try {
      await store.createAccount({
        name,
        type: newType(),
        subtype: "",
        budget_group: newType() === "expense" ? newGroup() : "",
        sort: store.accounts().length,
        archived: false,
        in_goal: true,
      });
      setNewName("");
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to add account");
    }
  };

  const patch = async (a: AccountBalance, changes: Partial<AccountBalance>) => {
    try {
      // Balances are server-derived, so only the account's own fields go back.
      const merged = { ...a, ...changes };
      await store.updateAccount({
        id: merged.id,
        name: merged.name,
        type: merged.type,
        subtype: merged.subtype,
        budget_group: merged.budget_group,
        sort: merged.sort,
        archived: merged.archived,
        in_goal: merged.in_goal,
      });
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to save account");
    }
  };

  const submitOpening = async (a: AccountBalance) => {
    const cents = parseCents(openingAmount());
    const date = openingDate();
    setOpeningFor(null);
    setOpeningAmount("");
    if (cents === null || cents <= 0 || !date) return;
    try {
      await store.setOpeningBalance(a, cents, date);
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to record opening balance");
    }
  };

  const doReset = async () => {
    if (resetConfirm() !== RESET_PHRASE || resetting()) return;
    setResetting(true);
    try {
      await store.resetLedger(RESET_PHRASE);
      setResetConfirm("");
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <section>
      <div class={GRID + " t-label ink-2 pb-2 rule-b"}>
        <span>Account</span>
        <span class="text-right">This month</span>
        <span class="text-right">Balance</span>
      </div>

      <Group label="Assets" rows={assets()} store={store} />
      <Group label="Owed" rows={liabilities()} store={store} />

      {/* Totals sit under a strong rule with extra top padding. */}
      <div class={GRID + " rule-strong-t pt-3 mt-2 items-baseline"}>
        <span class="t-label ink">Net worth</span>
        <span aria-hidden="true" />
        <span class="text-right t-figure ink">{money(store.netWorthTotal())}</span>
      </div>
      {/* Only worth showing the split once something is actually excluded. */}
      <Show when={store.hasExcludedAccounts()}>
        <div class={GRID + " pt-1.5 items-baseline"}>
          <span class="t-label ink-2">Counts toward goal</span>
          <span aria-hidden="true" />
          <span class="text-right t-meta tabular-nums ink-2">{money(store.netWorthInGoal())}</span>
        </div>
      </Show>

      <div class="flex items-baseline gap-3 mt-4">
        <button onClick={() => setManaging((v) => !v)} class="btn">
          {managing() ? "done" : "manage"}
        </button>
        <p class="t-meta ink-2 opacity-70">
          Balances come from your entries — record an opening balance to start an account off.
        </p>
      </div>

      {/* Manager */}
      <Show when={managing()}>
        <div class="mt-4 pt-4 rule-strong-t">
          <h3 class="t-label ink-2 pb-2">Manage accounts</h3>
          <div class="ruled-rows">
            <For each={store.accounts()}>
              {(a) => (
                <div class="py-2" classList={{ "opacity-50": a.archived }}>
                  {/* Stacks on a phone: the class/opening/goal cluster is far
                      wider than half a 375px screen. */}
                  <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem_auto_auto] gap-2 items-center">
                    <input
                      type="text"
                      value={a.name}
                      onBlur={(e) => {
                        const name = e.currentTarget.value.trim();
                        if (name && name !== a.name) patch(a, { name });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      class="field"
                      aria-label="Account name"
                    />
                    <select
                      value={a.type}
                      onChange={(e) => patch(a, { type: e.currentTarget.value as AccountType })}
                      class="field"
                      aria-label="Account type">
                      <For each={TYPES}>
                        {(t) => <option value={t}>{TYPE_META[t].label}</option>}
                      </For>
                    </select>
                    <Show
                      when={a.type === "asset" || a.type === "liability"}
                      fallback={
                        <span class="t-meta ink-2 px-1">
                          {GROUP_LABELS[a.budget_group] ?? a.budget_group}
                        </span>
                      }>
                      <div class="flex flex-wrap gap-1.5 items-center">
                        {/* Asset class drives the allocation and reserve figures. */}
                        <Show when={a.type === "asset"}>
                          <select
                            value={a.subtype}
                            onChange={(e) => patch(a, { subtype: e.currentTarget.value })}
                            class="field w-28"
                            aria-label="Asset class">
                            <option value="">set class…</option>
                            <For each={store.meta()?.asset_classes ?? []}>
                              {(c) => <option value={c}>{CLASS_LABELS[c] ?? c}</option>}
                            </For>
                          </select>
                        </Show>
                        <button
                          onClick={() => {
                            setOpeningFor(openingFor() === a.id ? null : a.id);
                            setOpeningAmount("");
                          }}
                          class="btn">
                          opening $
                        </button>
                        <label
                          class="flex items-center gap-1 t-meta ink-2 cursor-pointer whitespace-nowrap"
                          title="Count this account toward the goal. Turn off for depreciating assets like a car, its loan, or unvested balances.">
                          <input
                            type="checkbox"
                            checked={a.in_goal}
                            onChange={(e) => patch(a, { in_goal: e.currentTarget.checked })}
                            class="accent-[#3987e5]"
                          />
                          goal
                        </label>
                      </div>
                    </Show>
                    <button onClick={() => patch(a, { archived: !a.archived })} class="btn">
                      {a.archived ? "restore" : "archive"}
                    </button>
                  </div>

                  <Show when={openingFor() === a.id}>
                    <div class="flex flex-wrap gap-2 items-center pt-2">
                      <span class="t-meta ink-2 whitespace-nowrap">
                        {a.type === "liability" ? "Owed as of" : "Balance as of"}
                      </span>
                      {/* Dating this is the whole trick to opening a book on a
                          given day — an opening balance dated today would land
                          in the wrong month. */}
                      <input
                        type="date"
                        value={openingDate()}
                        onInput={(e) => setOpeningDate(e.currentTarget.value)}
                        class="field w-36 tabular-nums"
                        aria-label="Opening balance date"
                      />
                      <input
                        type="text"
                        inputmode="decimal"
                        value={openingAmount()}
                        ref={(el) => setTimeout(() => el.focus())}
                        onInput={(e) => setOpeningAmount(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitOpening(a);
                          if (e.key === "Escape") setOpeningFor(null);
                        }}
                        placeholder="$0.00"
                        class="field w-28 text-right tabular-nums"
                        aria-label="Opening balance"
                      />
                      <button onClick={() => submitOpening(a)} class="btn">
                        record
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_4rem] gap-2 items-center pt-3 mt-1 rule-strong-t">
            <input
              type="text"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addAccount()}
              placeholder="New account name"
              class="field"
              aria-label="New account name"
            />
            <select
              value={newType()}
              onChange={(e) => setNewType(e.currentTarget.value as AccountType)}
              class="field"
              aria-label="New account type">
              <For each={NEW_TYPES}>{(t) => <option value={t}>{TYPE_META[t].label}</option>}</For>
            </select>
            <select
              value={newGroup()}
              onChange={(e) => setNewGroup(e.currentTarget.value)}
              disabled={newType() !== "expense"}
              class="field disabled:opacity-40"
              aria-label="Budget group">
              <For each={store.meta()?.budget_groups ?? []}>
                {(g) => <option value={g}>{GROUP_LABELS[g] ?? g}</option>}
              </For>
            </select>
            <button onClick={addAccount} class="btn">
              add
            </button>
          </div>

          {/*
            Opening a fresh book. Deliberately plain and unstyled-as-a-button:
            this deletes every transaction you have ever recorded, and the only
            way back is the nightly SQL dump.
          */}
          <div class="mt-8 pt-4 rule-strong-t">
            <h3 class="t-label neg pb-2">Start a new book</h3>
            <p class="t-meta ink-2 leading-relaxed max-w-prose">
              Deletes every transaction, keeping your accounts, asset classes, targets and goal. You
              then record an opening balance dated to your start date for each account, and enter
              that period's transactions from your statements.
            </p>
            <p class="t-meta ink-2 leading-relaxed max-w-prose mt-2 opacity-70">
              There is no undo. Take a backup first — the <em>backup</em> button in the header
              downloads a full SQL dump you can restore from.
            </p>
            <div class="flex flex-wrap gap-2 items-center mt-3">
              <input
                type="text"
                value={resetConfirm()}
                onInput={(e) => setResetConfirm(e.currentTarget.value)}
                placeholder={RESET_PHRASE}
                class="field w-56"
                aria-label={`Type ${RESET_PHRASE} to confirm`}
                autocomplete="off"
                spellcheck={false}
              />
              <button
                onClick={doReset}
                disabled={resetConfirm() !== RESET_PHRASE || resetting()}
                class="btn"
                classList={{ "btn-armed": resetConfirm() === RESET_PHRASE && !resetting() }}>
                {resetting() ? "…" : "delete all entries"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
};

/** One side of the balance sheet. Omitted entirely when it has no accounts. */
const Group: Component<{ label: string; rows: AccountBalance[]; store: BudgetStore }> = (props) => (
  <Show when={props.rows.length > 0}>
    <div class={GRID + " pt-4 pb-1.5 t-label ink"}>
      <span>{props.label}</span>
      <span aria-hidden="true" />
      <span class="text-right tabular-nums ink-2">
        {amount(props.rows.reduce((sum, a) => sum + displayBalance(a.type, a.balance_cents), 0))}
      </span>
    </div>
    <div class="ruled-rows rule-t">
      <For each={props.rows}>
        {(a) => {
          const shown = () => displayBalance(a.type, a.balance_cents);
          const change = () => displayBalance(a.type, a.change_cents);
          return (
            <div class={GRID + " py-1.5 t-meta items-baseline"}>
              <span class="ink truncate">
                {a.name}
                <Show when={!a.in_goal}>
                  <span
                    class="ml-1.5 t-label ink-2"
                    title="Counted in net worth, excluded from the goal">
                    off-goal
                  </span>
                </Show>
              </span>
              <span
                class="text-right tabular-nums"
                classList={{
                  pos: change() > 0,
                  neg: change() < 0,
                  "ink-2 opacity-50": change() === 0,
                }}>
                {change() === 0 ? "—" : (change() > 0 ? "+" : "") + amount(change())}
              </span>
              <span class="text-right tabular-nums ink">{amount(shown())}</span>
            </div>
          );
        }}
      </For>
    </div>
  </Show>
);

export default Accounts;
