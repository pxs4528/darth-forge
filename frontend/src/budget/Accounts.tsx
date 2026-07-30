import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import type { AccountBalance, AccountType } from "./api";
import { money, parseCents, today } from "./format";
import { CLASS_LABELS, displayBalance, GROUP_LABELS, TYPE_META, type BudgetStore } from "./store";

// What you own and owe, with balances that are computed from the ledger rather
// than typed in. Also where accounts are created, renamed and archived.

type Props = { store: BudgetStore };

const TYPES: AccountType[] = ["asset", "liability", "income", "expense", "equity"];
const NEW_TYPES: AccountType[] = ["asset", "liability", "income", "expense"];

const inputCls =
  "bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm text-white " +
  "outline-none focus:border-[#3987e5] placeholder-gray-600 w-full min-w-0";

const Accounts: Component<Props> = (props) => {
  const { store } = props;

  const [managing, setManaging] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newType, setNewType] = createSignal<AccountType>("asset");
  const [newGroup, setNewGroup] = createSignal("misc");
  const [openingFor, setOpeningFor] = createSignal<number | null>(null);
  const [openingAmount, setOpeningAmount] = createSignal("");

  // Balance sheet: only assets and liabilities are "what you have".
  const balanceSheet = createMemo(() =>
    store.accounts().filter((a) => !a.archived && (a.type === "asset" || a.type === "liability"))
  );

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
    setOpeningFor(null);
    setOpeningAmount("");
    if (cents === null || cents <= 0) return;
    try {
      await store.setOpeningBalance(a, cents, today());
    } catch (e) {
      store.flash(e instanceof Error ? e.message : "Failed to record opening balance");
    }
  };

  return (
    <section class="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-3">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-semibold text-gray-200">Accounts</h2>
        <button
          onClick={() => setManaging((v) => !v)}
          class="text-[11px] text-gray-400 hover:text-gray-200 underline decoration-dotted underline-offset-2">
          {managing() ? "done" : "manage"}
        </button>
      </div>

      {/* Balance sheet */}
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] tabular-nums">
          <thead>
            <tr class="text-[11px] uppercase tracking-wider text-gray-500">
              <th class="text-left font-normal pb-1">Account</th>
              <th class="text-right font-normal pb-1">This month</th>
              <th class="text-right font-normal pb-1">Balance</th>
            </tr>
          </thead>
          <tbody>
            <For each={balanceSheet()}>
              {(a) => {
                const shown = () => displayBalance(a.type, a.balance_cents);
                const change = () => displayBalance(a.type, a.change_cents);
                return (
                  <tr class="border-t border-[#21262d]">
                    <td class="text-left py-1.5 text-gray-300">
                      <span
                        class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                        style={{ background: TYPE_META[a.type].color }}
                      />
                      {a.name}
                      <Show when={a.type === "liability"}>
                        <span class="text-gray-600 text-[11px]"> owed</span>
                      </Show>
                      <Show when={!a.in_goal}>
                        <span
                          class="ml-1.5 text-[10px] text-gray-500 border border-[#30363d] rounded px-1"
                          title="Counted in net worth, excluded from the goal">
                          off-goal
                        </span>
                      </Show>
                    </td>
                    <td
                      class="text-right"
                      classList={{
                        "text-[#3fb950]": change() > 0,
                        "text-[#f85149]": change() < 0,
                        "text-gray-600": change() === 0,
                      }}>
                      {change() === 0 ? "—" : (change() > 0 ? "+" : "") + money(change())}
                    </td>
                    <td
                      class="text-right font-semibold"
                      classList={{
                        "text-[#f85149]": a.type === "liability" && shown() > 0,
                        "text-white": !(a.type === "liability" && shown() > 0),
                      }}>
                      {money(shown())}
                    </td>
                  </tr>
                );
              }}
            </For>
            <tr class="border-t-2 border-[#30363d]">
              <td class="text-left py-1.5 text-gray-400 text-[11px] uppercase tracking-wider">
                Net worth
              </td>
              <td />
              <td class="text-right font-bold text-white">{money(store.netWorthTotal())}</td>
            </tr>
            {/* Only worth showing the split once something is actually excluded. */}
            <Show when={store.hasExcludedAccounts()}>
              <tr>
                <td class="text-left py-1 text-gray-500 text-[11px] uppercase tracking-wider">
                  Counts toward goal
                </td>
                <td />
                <td class="text-right font-semibold text-[#3987e5]">
                  {money(store.netWorthInGoal())}
                </td>
              </tr>
            </Show>
          </tbody>
        </table>
      </div>

      <p class="text-[11px] text-gray-600">
        Balances come from your entries — record an opening balance to start an account off.
      </p>

      {/* Manager */}
      <Show when={managing()}>
        <div class="border border-[#21262d] rounded p-3 space-y-2">
          <For each={store.accounts()}>
            {(a) => (
              <div
                class="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto_auto] gap-2 items-center"
                classList={{ "opacity-50": a.archived }}>
                <input
                  type="text"
                  value={a.name}
                  onBlur={(e) => {
                    const name = e.currentTarget.value.trim();
                    if (name && name !== a.name) patch(a, { name });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  class={inputCls}
                  aria-label="Account name"
                />
                <select
                  value={a.type}
                  onChange={(e) => patch(a, { type: e.currentTarget.value as AccountType })}
                  class={inputCls}
                  aria-label="Account type">
                  <For each={TYPES}>{(t) => <option value={t}>{TYPE_META[t].label}</option>}</For>
                </select>
                <Show
                  when={a.type === "asset" || a.type === "liability"}
                  fallback={<span class="text-[11px] text-gray-600 px-1">{a.budget_group}</span>}>
                  <div class="flex gap-1.5 items-center">
                    {/* Asset class drives the allocation and reserve figures. */}
                    <Show when={a.type === "asset"}>
                      <select
                        value={a.subtype}
                        onChange={(e) => patch(a, { subtype: e.currentTarget.value })}
                        class={inputCls + " w-24 text-[11px]"}
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
                      class="px-2 py-1 text-[11px] rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d] whitespace-nowrap">
                      opening $
                    </button>
                    <label
                      class="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer whitespace-nowrap"
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
                <button
                  onClick={() => patch(a, { archived: !a.archived })}
                  class="px-2 py-1 text-[11px] rounded border border-[#30363d] text-gray-300 hover:bg-[#21262d]">
                  {a.archived ? "restore" : "archive"}
                </button>

                <Show when={openingFor() === a.id}>
                  <div class="col-span-2 sm:col-span-4 flex gap-2 items-center pl-1 pb-1">
                    <span class="text-[11px] text-gray-500 whitespace-nowrap">
                      {a.type === "liability" ? "Currently owed" : "Current balance"}
                    </span>
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
                      class={inputCls + " w-28 text-right tabular-nums"}
                      aria-label="Opening balance"
                    />
                    <button
                      onClick={() => submitOpening(a)}
                      class="px-2 py-1 text-[11px] font-semibold rounded bg-[#238636] text-white hover:bg-[#2ea043]">
                      record
                    </button>
                  </div>
                </Show>
              </div>
            )}
          </For>

          <div class="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_4rem] gap-2 items-center pt-2 border-t border-[#21262d]">
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
              value={newType()}
              onChange={(e) => setNewType(e.currentTarget.value as AccountType)}
              class={inputCls}
              aria-label="New account type">
              <For each={NEW_TYPES}>{(t) => <option value={t}>{TYPE_META[t].label}</option>}</For>
            </select>
            <select
              value={newGroup()}
              onChange={(e) => setNewGroup(e.currentTarget.value)}
              disabled={newType() !== "expense"}
              class={inputCls + " disabled:opacity-40"}
              aria-label="Budget group">
              <For each={store.meta()?.budget_groups ?? []}>
                {(g) => <option value={g}>{GROUP_LABELS[g] ?? g}</option>}
              </For>
            </select>
            <button
              onClick={addAccount}
              class="px-2 py-1.5 text-[11px] font-semibold rounded bg-[#238636] text-white hover:bg-[#2ea043]">
              add
            </button>
          </div>
        </div>
      </Show>
    </section>
  );
};

export default Accounts;
