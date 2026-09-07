# Budget tool (`/budget`)

Private budgeting app at `https://<domain>/budget`, gated behind the same
`ADMIN_SECRET` as the terminal's `sudo` command. Data lives in
[Turso](https://turso.tech) (SQLite-over-HTTP), so laptop and phone see the
same numbers and the Pi keeps no local state.

## First-time setup

```bash
# 1. Turso CLI + database (free tier: 5 GB, 500M row reads/mo)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup
turso db create darth-budget
turso db show darth-budget --url        # → TURSO_DATABASE_URL
turso db tokens create darth-budget     # → TURSO_AUTH_TOKEN

# 2. Add both values to .env.prod (and .env.dev for local dev)

# 3. Pull the Go driver (updates go.mod/go.sum)
cd backend && go get github.com/tursodatabase/libsql-client-go/libsql && go mod tidy
```

Schema migrates automatically on boot (`backend/internal/db/db.go`). Without
the env vars the site runs normally and budget routes return 503.

## Architecture

- `backend/internal/db/` — libSQL connection, schema, queries. Money is
  integer cents everywhere.
- `backend/internal/handlers/budget.go` — REST API under
  `/api/admin/budget/*`, all wrapped in the existing `AdminOnly` middleware.
- `frontend/src/budget/` — the SPA page. `store.ts` holds state/actions;
  `api.ts` is the typed client. Served at `/budget` by the tiny router in
  `frontend/src/lib/router.ts` (Caddy's SPA fallback covers deep links).

Monthly seeding: opening a new month copies the previous month's category
budgets and net-worth snapshot, and decrements `months_remaining`
automatically.

## Auth

Logging in exchanges the admin password for a **random session token**
(`backend/internal/handlers/auth.go`) — the browser stores only the token,
never the secret. Sessions live in backend memory with a 30-day sliding
expiry, so every deploy/restart signs you out. Failed logins are limited to
5/minute.

### Changing the admin password

The password is the `ADMIN_SECRET` env var:

```bash
# on the Pi
nano /home/darth/darth-forge/.env.prod        # change ADMIN_SECRET=...
docker compose -f compose.yaml -f compose.prod.yaml up -d backend
```

Recreating the backend picks up the new value and (because sessions are
in-memory) instantly signs out every device. Locally it's
`$env:ADMIN_SECRET = '...'` before `npm run dev`.

## How the books work (double-entry)

Every movement of money is one **entry** made of **splits** that sum to zero:
money leaves one account and arrives in another. There is no separate
"category" or "transfer" concept — a category *is* an account.

| Account type | Balance means | Examples |
|---|---|---|
| asset | cash you hold | Checking, HYSA, Brokerage, 401k |
| liability | debt you owe | Discover Credit, Chase Credit |
| income | money earned | Paycheck, 401k Match, Reimbursement |
| expense | money spent | Rent, Groceries, Gas |
| equity | opening balances | Opening Balances |

Everything is the same From → To shape:

| Situation | From | To |
|---|---|---|
| Paycheck lands | Paycheck | Checking |
| Buy groceries on a card | Discover Credit | Groceries |
| Pay the card off | Checking | Discover Credit |
| Move money to savings | Checking | HYSA |
| Friend repays you | Other Income | Checking |
| Lend a friend money | Checking | *(asset account "Owed by X")* |
| Starting balance | Opening Balances | Checking |

**Net worth is never typed in.** It is `SUM(balance)` over asset and liability
accounts; because debt is stored negative it subtracts itself. That's what
makes the goal tracker reconcile with reality: it's the same number the ledger
produces, not a figure kept in sync by hand.

Lending money is worth calling out: create an asset account for the
receivable, and moving cash into it leaves net worth unchanged (you swapped
cash for a claim) — which is correct, and something the old model couldn't
express.

## Managing accounts

"manage" on the Accounts panel adds, renames, retypes and archives accounts.
Accounts are archived rather than deleted so historical splits keep their
references.

Two things worth knowing:

- **Paying a credit card is not spending.** It's an entry from Checking to
  the card, which reduces the debt. The purchases were already recorded when
  you made them; counting the payment too would double them.
- **Contributions to savings or investments are not expenses either** — they
  move money between two accounts you own, so net worth is unchanged and the
  surplus already reflects them. Only expense accounts get budgets.

## Reconciling against a statement

Reconciling is how you prove the books match the bank. It runs one account
against one statement period, on the **Reconcile** tab.

1. Pick the account and type the statement's **closing balance**.
2. Tick every entry that appears on that statement.
3. The **Difference** figure has to reach zero. If it won't, either an entry
   is missing, one is duplicated, or an amount is wrong — fix it on the
   Register tab and come back.
4. **Lock this statement.** Everything ticked moves to locked and is frozen:
   editing or deleting a locked entry is refused with a 409 rather than
   silently changing a period you already proved.

Signs follow the statement, not the schema — a card statement shows what you
owe as a positive number, so liabilities are flipped for display and the
balance you type is read the same way.

Reconciliation lives on the split, not the transaction, exactly as in GnuCash:
a `Chase → Groceries` entry gets its Chase side reconciled against the Chase
statement while the Groceries side never is. States are `n` (not reconciled),
`c` (cleared) and `y` (locked).

Two consequences worth knowing:

- **Editing an unlocked entry drops its cleared marks.** The amount or
  accounts may have moved, so the earlier tick-off no longer means anything.
- **"reopen N locked" unlocks the whole account**, dropping everything back to
  cleared. Use it when a statement was proved against bad data.

## Bank sync (Plaid)

Optional. Unset, everything below is inert and manual entry is unchanged.

### Setup

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com/signup), then
   Team Settings → Keys for `client_id` and the **Sandbox** secret.
2. Put both in `.env.prod` (and `.env.dev`) with `PLAID_ENV=sandbox`.
3. Exercise the whole flow against Plaid's fake bank first — Link accepts
   `user_good` / `pass_good`.
4. For real accounts, apply for the free **Trial plan**: 10 live Items, no
   time limit, OAuth banks included. Swap in the Production secret and set
   `PLAID_ENV=production`.

An *Item* is one bank login, not one account — Chase checking and Chase credit
share a login and cost one Item.

### The two sync modes

Set per account under the Plaid tab:

| Mode | For | What happens |
|---|---|---|
| `transactions` | chequing, savings, cards | The feed is imported to a review queue |
| `balance` | investments, 401k, HSA | Only the value is tracked |
| `ignore` | anything else | Skipped |

Balance mode exists because a retirement account's feed is dividends,
reinvestments and rebalances that mean nothing without lot-level cost-basis
tracking. What you actually want is that it's worth $X now, so the difference
posts as a single entry against a **Market Movement** income account, created
automatically. Plaid's own account type picks a sensible default; you can
override it.

### The review queue

Nothing Plaid sends becomes an entry on its own. A bank feed only ever tells
you one side — that $52.10 left Chase, never whether it was groceries or a
transfer to savings — so a sync stages rows and proposes how each should post:

- **Transfers between your own accounts are matched into one entry.** Opposite
  signs, identical amount, within 4 days, both accounts mapped. Without this a
  Checking → HYSA move imports twice and reads as income.
- **Everything else is proposed from what you did last time** with the same
  merchant, matching on the stable part of the description so
  `TRADER JOE'S #412` and `TRADER JOE'S #998` count as the same place. With no
  precedent it proposes nothing rather than guessing.

Accepting a settled row marks the bank's side **cleared**, because it came
from the bank's own record — which is exactly what clearing asserts. So
reconciling an imported month is usually just checking the difference is zero
and locking. Pending rows stay unreconciled: they can still change or vanish.

### Security

`plaid_items` holds live access tokens and is **excluded from `/dump`** — that
dump is pulled to a laptop nightly over HTTP and kept for 60 days, which is no
place for bank credentials. Restoring a backup therefore leaves Plaid
unlinked; re-linking takes a couple of minutes.

Tokens are stored unencrypted in Turso. Encrypting them with a key sitting in
the same `.env` on the same Pi would be theatre — the trust boundary is the
same one that already protects `ADMIN_SECRET`. Worth knowing rather than
assuming otherwise.

Unlinking an institution deletes its items, account mappings and *unreviewed*
staged rows. Entries you already accepted stay: they're your bookkeeping now.

## Starting a new book

When manual entry has drifted far enough that correcting it costs more than
redoing it, open a fresh book at a chosen date. Under Accounts → manage →
**Start a new book**:

1. Hit **backup** in the header first. That is the only undo.
2. Type `DELETE ALL ENTRIES` and confirm. Every transaction and split is
   deleted; accounts, asset classes, budget targets and the goal survive.
3. For each account, use **opening $** and set the date to your start date
   (e.g. `2026-08-01`) with the balance from that day's statement. The date
   field is sticky, so you set it once.
4. Enter that period's transactions from your statements, then reconcile.

Opening balances are booked against the Opening Balances equity account, so
the ledger stays balanced, and they're excluded from "added this month" —
they establish the books rather than counting as growth.

Restoring instead, if the reset was a mistake:

```bash
gunzip -c ~/Backups/budget/budget-YYYY-MM-DD.sql.gz | turso db shell <db>
```

### Upgrading from the pre-double-entry schema

The first boot after this change renames the old tables to `transactions_v1`,
`transfers_v1`, `months_v1`, `net_worth_v1`, `accounts_v1` and `budgets_v1`
rather than dropping them, so nothing is destroyed. Old data is readable with
e.g. `SELECT * FROM transactions_v1;` and the tables can be dropped by hand
once you're happy.

## Backups

Nightly SQL dumps via cron on the Pi:

```bash
crontab -e
# add:
0 3 * * * /home/darth/darth-forge/scripts/backup-budget.sh >> /home/darth/backups/budget/backup.log 2>&1
```

Dumps land in `/home/darth/backups/budget/budget-YYYY-MM-DD.sql.gz`, pruned
after 60 days, with a size sanity-check so a failed dump never overwrites a
good one. Restore into a fresh or existing DB:

```bash
gunzip -c budget-2026-07-28.sql.gz | turso db shell darth-budget
```

The in-app "export csv" button is for human-readable monthly statements;
these dumps are the real disaster-recovery path (full schema + all months).

### Off-Pi copies (PC / laptop)

Three ways to get dumps off the Pi:

1. **UI**: the header's `backup` button downloads the full SQL dump from any
   logged-in device (uses your session — no extra setup).
2. **Automated pull** (`scripts/backup-budget.ps1` + a daily Scheduled Task):
   fetches `GET /api/admin/budget/dump` through the tunnel using the
   dedicated `BACKUP_TOKEN` env var — a read-only token, so the admin
   password never lives in a file. Setup:
   - on the Pi: add `BACKUP_TOKEN=$(openssl rand -hex 24)` to the env file,
     redeploy
   - on the PC: put the same token + your domain in
     `%USERPROFILE%\.budget-backup.json`
   - register the task:
     `Register-ScheduledTask` (already done on the desktop; see script header)
3. **Manual**: `curl -H "X-Backup-Token: <token>" https://<domain>/api/admin/budget/dump -o budget.sql`

## Keyboard shortcuts

`?` help · `1`–`7` switch tab · `n` new transaction · `[`/`]` prev/next month ·
`j`/`k` select · `e` edit · `x x` delete · `t` tracker · `Esc` close/cancel

## Useful queries

```bash
turso db shell darth-budget
```

```sql
-- restaurant spend by month, all time
SELECT t.month, SUM(s.amount_cents)/100.0 AS dollars
FROM splits s
JOIN txns t     ON t.id = s.txn_id
JOIN accounts a ON a.id = s.account_id
WHERE a.name = 'Restaurants / Takeout'
GROUP BY t.month ORDER BY t.month;

-- net worth right now (debt is stored negative, so it subtracts itself)
SELECT SUM(s.amount_cents)/100.0 AS net_worth
FROM splits s JOIN accounts a ON a.id = s.account_id
WHERE a.type IN ('asset','liability');

-- proof the books balance: every entry must sum to zero, so this returns nothing
SELECT txn_id, SUM(amount_cents) FROM splits
GROUP BY txn_id HAVING SUM(amount_cents) != 0;

-- what each account has reconciled: cleared/locked balance vs. the full one
SELECT a.name,
       SUM(CASE WHEN s.reconcile_state IN ('c','y') THEN s.amount_cents END)/100.0 AS cleared,
       SUM(s.amount_cents)/100.0 AS actual
FROM splits s JOIN accounts a ON a.id = s.account_id
WHERE a.type IN ('asset','liability')
GROUP BY a.name ORDER BY a.name;
```
