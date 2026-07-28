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

## Accounts & transfers

Accounts (checking, credit cards, HYSA, brokerage — manageable in the UI via
"manage accounts") attribute where each expense hit. Transfers move money
between accounts and **never count as spending**: log your Discover/Chase
payment as a transfer from checking, since the card's expenses were already
recorded individually. Keep HYSA / index-fund contributions as *categorized
transactions* — that's what drives budgets and the savings rate. Accounts are
archived rather than deleted so history keeps its references.

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

`?` help · `n` new transaction · `[`/`]` prev/next month · `j`/`k` select ·
`e` edit · `x x` delete · `t` tracker · `Esc` close/cancel

## Useful queries

```bash
turso db shell darth-budget
```

```sql
-- restaurant spend by month, all time
SELECT month, SUM(amount_cents)/100.0 AS dollars
FROM transactions WHERE category = 'restaurants'
GROUP BY month ORDER BY month;
```
