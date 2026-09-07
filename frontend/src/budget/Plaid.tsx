import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js";
import type { PlaidAccount, PlaidItem, StagedTxn, SyncMode } from "./api";
import { amount, money } from "./format";
import { openPlaidLink } from "./plaidLink";
import { displayBalance, type BudgetStore } from "./store";

// Bank sync. Three stacked sections, in the order you use them:
//
//   1. Institutions — link a bank, repair an expired login, unlink.
//   2. Accounts     — map each bank account onto one of yours, and choose
//                     whether it imports transactions or just a balance.
//   3. Review       — what came in. Nothing posts to the ledger until you
//                     accept it here, because a bank feed only tells you one
//                     side of every transaction.

type Props = { store: BudgetStore };

const SYNC_MODES: { value: SyncMode; label: string; hint: string }[] = [
  { value: "transactions", label: "Transactions", hint: "Import the feed to review" },
  { value: "balance", label: "Balance only", hint: "Track the value, not each trade" },
  { value: "ignore", label: "Ignore", hint: "Skip this account" },
];

const Plaid: Component<Props> = (props) => {
  const { store } = props;

  const [configured, setConfigured] = createSignal(true);
  const [env, setEnv] = createSignal("");
  const [items, setItems] = createSignal<PlaidItem[]>([]);
  const [linked, setLinked] = createSignal<PlaidAccount[]>([]);
  const [queue, setQueue] = createSignal<StagedTxn[]>([]);
  const [busy, setBusy] = createSignal("");
  const [error, setError] = createSignal("");

  const refresh = async () => {
    try {
      const status = await store.plaidStatus();
      setConfigured(status.configured);
      setEnv(status.env ?? "");
      setItems(status.items);
      setLinked(status.accounts);
      if (status.configured) setQueue(await store.plaidStaged());
    } catch {
      /* the store's guard already surfaced it in the banner */
    }
  };

  onMount(refresh);

  /** Accounts you could map a bank account onto. */
  const mappable = createMemo(() =>
    store.accounts().filter((a) => !a.archived && (a.type === "asset" || a.type === "liability"))
  );

  /** Expense and income accounts — the other leg of an imported transaction. */
  const counterparties = createMemo(() =>
    store.accounts().filter((a) => !a.archived && (a.type === "expense" || a.type === "income"))
  );

  const ledgerName = (id: number) => (id ? store.accountName(id) : "—");

  /**
   * For a matched transfer, the ledger account on the far side. Both sides are
   * in the queue, so the partner row resolves to the account it feeds.
   */
  const partnerAccountId = (row: StagedTxn): number => {
    if (!row.transfer_pair) return 0;
    const partner = queue().find((q) => q.plaid_txn_id === row.transfer_pair);
    if (!partner) return 0;
    return linked().find((l) => l.plaid_account_id === partner.plaid_account_id)?.account_id ?? 0;
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const link = (itemId?: string) =>
    run(itemId ? "relink" : "link", async () => {
      const linkToken = await store.plaidLinkToken(itemId);
      const publicToken = await openPlaidLink(linkToken);
      // Closing Link without finishing is a normal outcome, not a failure.
      if (publicToken) await store.plaidExchange(publicToken);
    });

  return (
    <section>
      <Show
        when={configured()}
        fallback={
          <div class="py-4 max-w-prose">
            <h2 class="t-label ink pb-2">Bank sync is not configured</h2>
            <p class="t-meta ink-2 leading-relaxed">
              Set <code class="ink">PLAID_CLIENT_ID</code>, <code class="ink">PLAID_SECRET</code>{" "}
              and <code class="ink">PLAID_ENV</code> in your environment, then restart the backend.
              Keys come from <span class="ink">dashboard.plaid.com</span> → Team Settings → Keys.
              Start with the Sandbox secret and <code class="ink">PLAID_ENV=sandbox</code> — Link
              then accepts the test login <code class="ink">user_good</code> /{" "}
              <code class="ink">pass_good</code>, so you can walk the whole flow before pointing it
              at real accounts.
            </p>
            <p class="t-meta ink-2 leading-relaxed mt-2 opacity-70">
              See docs/budget.md for the Trial plan application, which is what grants real bank
              access.
            </p>
          </div>
        }>
        {/* ── institutions ── */}
        <div class="flex flex-wrap items-center gap-3 pb-2 rule-b">
          <h2 class="t-label ink-2 mr-auto">
            Institutions
            <Show when={env() && env() !== "production"}>
              <span class="ml-2 t-label" style={{ color: "#fab219" }}>
                {env()}
              </span>
            </Show>
          </h2>
          <button onClick={() => link()} disabled={busy() !== ""} class="btn">
            {busy() === "link" ? "…" : "link a bank"}
          </button>
          <button
            onClick={() => run("sync", () => store.plaidSync())}
            disabled={busy() !== "" || items().length === 0}
            class="btn">
            {busy() === "sync" ? "syncing…" : "sync now"}
          </button>
        </div>

        <Show
          when={items().length > 0}
          fallback={
            <p class="t-meta ink-2 py-3 max-w-prose leading-relaxed">
              Nothing linked yet. One "institution" is one bank login — Chase checking and Chase
              credit share a login and count once against your plan's limit.
            </p>
          }>
          <div class="ruled-rows">
            <For each={items()}>
              {(item) => (
                <div class="flex flex-wrap items-baseline gap-3 py-2">
                  <span class="t-body ink">{item.institution_name || item.item_id}</span>
                  <Show when={item.status !== "ok"}>
                    <span class="t-label neg">
                      {item.status === "login_required" ? "sign in again" : "error"}
                    </span>
                  </Show>
                  <span class="t-meta ink-2 opacity-70 ml-auto tabular-nums">
                    {item.last_sync ? `synced ${item.last_sync.slice(0, 10)}` : "never synced"}
                  </span>
                  <Show when={item.status !== "ok"}>
                    <button onClick={() => link(item.item_id)} disabled={busy() !== ""} class="btn">
                      repair
                    </button>
                  </Show>
                  <button
                    onClick={() => run("unlink", () => store.plaidUnlink(item.item_id))}
                    disabled={busy() !== ""}
                    class="btn">
                    unlink
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ── account mapping ── */}
        <Show when={linked().length > 0}>
          <h2 class="t-label ink-2 pt-6 pb-2 rule-b">Accounts</h2>
          <div class="ruled-rows">
            <For each={linked()}>
              {(a) => (
                <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem_10rem_7rem] gap-2 items-center py-2">
                  <div class="min-w-0">
                    <div class="t-meta ink truncate">{a.name}</div>
                    <div class="t-label ink-2 opacity-70">
                      {a.subtype || a.type}
                      <Show when={a.balance_at}>
                        {" · "}
                        {money(a.balance_cents)} at {a.balance_at}
                      </Show>
                    </div>
                  </div>

                  <select
                    value={String(a.account_id)}
                    onChange={(e) =>
                      run("map", () =>
                        store.plaidMapAccount(
                          a.plaid_account_id,
                          Number(e.currentTarget.value),
                          a.sync_mode
                        )
                      )
                    }
                    class="field"
                    aria-label={`Ledger account for ${a.name}`}>
                    <option value="0">not mapped</option>
                    <For each={mappable()}>
                      {(l) => <option value={String(l.id)}>{l.name}</option>}
                    </For>
                  </select>

                  <select
                    value={a.sync_mode}
                    onChange={(e) =>
                      run("map", () =>
                        store.plaidMapAccount(
                          a.plaid_account_id,
                          a.account_id,
                          e.currentTarget.value as SyncMode
                        )
                      )
                    }
                    class="field"
                    aria-label={`Sync mode for ${a.name}`}>
                    <For each={SYNC_MODES}>{(m) => <option value={m.value}>{m.label}</option>}</For>
                  </select>

                  <span class="t-label ink-2 opacity-70">
                    {SYNC_MODES.find((m) => m.value === a.sync_mode)?.hint}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ── review queue ── */}
        <h2 class="t-label ink-2 pt-6 pb-2 rule-b">
          Review
          <Show when={queue().length > 0}>
            <span class="ink"> · {queue().length}</span>
          </Show>
        </h2>

        <Show
          when={queue().length > 0}
          fallback={
            <p class="t-meta ink-2 py-3 max-w-prose leading-relaxed">
              Nothing waiting. Imported transactions land here first — a bank feed only tells you
              that money left an account, never what it was for, so nothing posts to the ledger
              until you say where the other side goes.
            </p>
          }>
          <div class="ruled-rows">
            <For each={queue()}>
              {(row) => (
                <StagedRow
                  row={row}
                  store={store}
                  counterparties={counterparties()}
                  accountName={ledgerName}
                  linked={linked()}
                  partnerAccountId={partnerAccountId(row)}
                  disabled={busy() !== ""}
                  onDone={refresh}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={error()}>
        <p class="mt-4 t-meta neg">{error()}</p>
      </Show>
    </section>
  );
};

/** One row of the review queue, with its own pending state. */
const StagedRow: Component<{
  row: StagedTxn;
  store: BudgetStore;
  counterparties: ReturnType<BudgetStore["accounts"]>;
  accountName: (id: number) => string;
  linked: PlaidAccount[];
  /** The far side of a matched transfer; 0 when this isn't one. */
  partnerAccountId: number;
  disabled: boolean;
  onDone: () => Promise<void>;
}> = (p) => {
  const [counter, setCounter] = createSignal(p.row.counter_account_id);
  const [description, setDescription] = createSignal(p.row.merchant || p.row.name);
  const [saving, setSaving] = createSignal(false);

  const isTransfer = () => p.row.transfer_pair !== "";

  /** The ledger account this row's bank account feeds. */
  const ourAccount = () =>
    p.linked.find((l) => l.plaid_account_id === p.row.plaid_account_id)?.account_id ?? 0;

  const accountType = () => p.store.accountById(ourAccount())?.type ?? "asset";

  /** Show the amount the way the statement does. */
  const shown = () => displayBalance(accountType(), p.row.amount_cents);

  const act = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await fn();
      await p.onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="py-2.5">
      <div class="grid grid-cols-[3.25rem_minmax(0,1fr)_5.5rem] sm:grid-cols-[4rem_minmax(0,1fr)_6.5rem] gap-2 sm:gap-3 items-baseline">
        <span class="t-meta ink-2 tabular-nums">{p.row.date.slice(5).replace("-", "/")}</span>
        <span class="t-meta ink truncate">
          {p.row.merchant || p.row.name}
          <Show when={p.row.pending}>
            <span class="ml-2 t-label ink-2 opacity-70">pending</span>
          </Show>
        </span>
        <span class="t-meta ink text-right tabular-nums">{amount(shown())}</span>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-2">
        <span class="t-label ink-2">{p.accountName(ourAccount())} →</span>

        <Show
          when={!isTransfer()}
          fallback={
            // Both sides are yours, so this posts as a single entry and there
            // is nothing to choose.
            <span class="t-meta ink">{p.accountName(p.partnerAccountId)}</span>
          }>
          <select
            value={String(counter())}
            onChange={(e) => setCounter(Number(e.currentTarget.value))}
            class="field w-full sm:w-48"
            aria-label={`Other side of ${p.row.merchant || p.row.name}`}>
            <option value="0">pick an account…</option>
            <For each={p.counterparties}>
              {(a) => <option value={String(a.id)}>{a.name}</option>}
            </For>
          </select>
        </Show>

        <input
          type="text"
          value={description()}
          onInput={(e) => setDescription(e.currentTarget.value)}
          class="field w-full sm:w-52"
          aria-label="Description"
        />

        <button
          onClick={() =>
            act(() => p.store.plaidAccept(p.row.plaid_txn_id, counter(), description()))
          }
          disabled={p.disabled || saving() || (!isTransfer() && counter() === 0)}
          class="btn">
          {saving() ? "…" : "accept"}
        </button>
        <button
          onClick={() => act(() => p.store.plaidIgnore([p.row.plaid_txn_id]))}
          disabled={p.disabled || saving()}
          class="btn">
          dismiss
        </button>

        <Show when={isTransfer()}>
          <span class="t-label ink-2 opacity-70">matched transfer — posts as one entry</span>
        </Show>
        <Show when={p.row.category && !isTransfer()}>
          <span class="t-label ink-2 opacity-70">{p.row.category.toLowerCase()}</span>
        </Show>
      </div>
    </div>
  );
};

export default Plaid;
