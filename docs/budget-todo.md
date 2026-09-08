# Budget & Plaid — outstanding work

Running list. Newest decisions at the top of each section; tick things off in
place rather than deleting them, so the reasoning survives.

Status as of 2026-09-08.

---

## Where this stands

The infrastructure work is done. Both hostnames are live on the VPS with real
certificates, the budget tool is reachable only over the tailnet, and CI builds
and ships images on every push. Plaid has credentials but **has still never
talked to Plaid** — everything below is about closing that last gap safely.

### Do these next, in this order

1. **Set `PLAID_IMPORT_START`** to the date you open the book (`2026-08-01`).
   Repo secret, same as the others. Without it the first sync backfills up to
   24 months into the review queue. See "Import start-date filter" below.
2. **Walk the sandbox flow end to end** with `PLAID_ENV=sandbox` and the
   sandbox secret, using `user_good` / `pass_good`. Do this *before* opening the
   book — it costs nothing to get wrong.
3. **Open the book at 1 August** (see below). Backup first.
4. **Apply for the Trial plan**, swap in the production secret, set
   `PLAID_ENV=production`, and link the first real institution.
5. **Fix the deploy webhook** (see "Deployment" below) — until then every
   deploy needs a manual `docker compose up -d` on the box.

---

## Deployment — state and known problems

- [x] **VPS is live.** Portfolio on the apex, budget on `budget.`, both with
      Let's Encrypt certificates. Caddy terminates TLS directly.
- [x] **Tailscale on the VPS.** The budget hostname resolves to the tailnet
      address, so it isn't reachable from the public internet at all.
- [x] **CI/CD.** Push to `main` → test → multi-arch images to GHCR → `.env.vps`
      generated from repo secrets and `scp`'d up → webhook fires.
- [x] **`pull_policy: always`** on both services. Without it `docker compose up`
      reuses the cached image, which is how a stale `ADMIN_SECRET` survived
      three restarts and a redeploy before anyone worked out why the password
      was being rejected. Worth remembering: if a config change appears to have
      no effect, check the image is actually new before debugging the config.

- [ ] **The webhook listener doesn't deploy.** It's running and listening on
      9000, and GitHub reports the request as delivered, but the listener logs
      only `ConnectionResetError: [Errno 104] Connection reset by peer` and the
      deploy script never runs. So images build and `.env.vps` lands correctly,
      and then nothing restarts. **Consequence: every deploy currently needs
      `docker compose -f compose.vps.yaml up -d` by hand.** Worth checking
      whether the listener reads the request body before responding — resetting
      the connection without draining the body produces exactly this on the
      sending side. Replacing the webhook with an `ssh` step in the deploy job
      would remove the moving part entirely, and is probably the better fix.
- [ ] **`.env.vps` is generated with an unquoted heredoc** in `deploy.yml`.
      Values are substituted by Actions before the shell sees them, so a secret
      containing a newline, backtick or `$(` would corrupt the file rather than
      failing loudly. Fine today; a trap when a Plaid production secret gets
      pasted in with a stray character.

---

## Architecture — decided

Split by **what the data is worth**, not by what's convenient to host.

| Where | What | Exposure |
|---|---|---|
| **VPS** (Hetzner or equivalent) | Portfolio — *permanent* | Public |
| **VPS** (same box) | Budget tool — *temporary, ~1 month* | `budget.` hostname, Cloudflare Access |
| **Pi cluster** (rack rebuild, ~Oct 2026) | Plex, ad-block DNS, **and the budget tool** | LAN-only + Tailscale, never public |

**Why the budget tool ends up on the Pi.** It holds the full ledger and tokens
that read seven bank accounts. The best home for that is hardware you own,
reachable only over a VPN. Better than rented hardware, much better than Turso.

**Why the portfolio stays on the VPS.** It's public by nature and contains
nothing sensitive, so it wants uptime and a real IP — and keeping it off the
home LAN means a compromise costs a disposable VPS rather than a foothold on
the same network as your laptop, phone and NAS. That asymmetry is the whole
argument for the split.

**Why the pi cluster is not exposed at all.** Plex and Pi-hole assume a trusted
network and have the CVE history to match. Residential upload is asymmetric,
the IP is dynamic, and most ISP terms prohibit hosting anyway.

- [x] **Tailscale**, not NordVPN. Nord's main product is an outbound privacy
      proxy — wrong direction, gives no inbound access. Its Meshnet feature
      technically would work, but NordVPN announced Meshnet's shutdown in Aug
      2025 and only reversed it after backlash; that's a poor foundation for
      the only route to your finances. Tailscale is free for personal use and
      adds **subnet routing** (one Pi advertises the whole LAN, nothing to
      install on the Plex box) and **DNS push** (Pi-hole works on mobile data).

### Migration back to the Pi (~1 month)

Cheap by design, because of choices already made:

1. `scp` the SQLite file. That's the data migration, in full.
2. Repoint `budget.example.com` at the Pi over the tailnet.
3. Portfolio never moves; nothing in the code changes.

The **two-hostname split** is what makes this a config change rather than a
refactor — it is the reason the budget tool can move without touching the
portfolio. Keep it even after the move.

---

## Blocked on me (not code)

- [x] **Get Plaid credentials.** Sign up at dashboard.plaid.com → Team Settings
      → Keys. Copy `client_id` and the **Sandbox** secret into `.env.vps`
      (or `.env.dev`) with `PLAID_ENV=sandbox`. Nothing in the Banks tab works
      until this exists. *Done — held as repo secrets and injected at deploy.*
- [ ] **Set `PLAID_IMPORT_START`** to the date the book opens, `2026-08-01`.
      Add it as a repo secret alongside the other three. Confirm it took effect
      in `GET /api/admin/budget/plaid/status`, which now echoes `import_start`;
      an empty value there means it's unset or was rejected as malformed.
- [ ] **Walk the sandbox flow end to end** before touching real accounts. Link
      accepts `user_good` / `pass_good`. This is the first time any of the
      Plaid code will have talked to Plaid — treat it as the real test.
- [ ] **Apply for the Trial plan** (free, 10 live Items, no time limit,
      includes Chase/Capital One OAuth). Swap in the Production secret and set
      `PLAID_ENV=production`.
- [ ] **Check institution coverage** in Plaid's coverage explorer for the three
      uncertain ones: **T. Rowe Price 401k** (employer plans usually sit on a
      separate recordkeeping login), **Forbright**, **HSA Bank**. Anything not
      covered can still be tracked by hand in balance mode — one number a month.

### The 7 Items

Chase checking and Chase credit share one login, so 8 accounts cost 7 Items:
Chase · Discover · Capital One · Forbright · Fidelity · T. Rowe Price · HSA Bank.
Three spare under the cap.

---

## Opening the book at 1 August

Decided: wipe and restart rather than correct. See `budget.md` → "Starting a
new book".

- [ ] **Take a backup first.** The `backup` button in the header. It is the
      only undo.
- [ ] Accounts → manage → **Start a new book**, type `DELETE ALL ENTRIES`.
- [ ] Record opening balances **dated 2026-08-01** for every account, from that
      day's statements. The date field is sticky, so it's set once.
- [ ] **Create the car accounts** while doing this: Mazda3 (asset) and Car Loan
      (liability), both with **goal unticked**, opening balances as of Aug 1.
      No correcting entries needed — the reset removes the old Car Downpayment
      expense along with everything else.
- [ ] Enter August from statements, or import once Plaid is live.
- [ ] **Reconcile each account** against its August statement and lock it.

### Superseded by the reset

- ~~Recategorise "Rent :(" out of Restaurants / Takeout~~ — those entries are
  deleted by the reset.
- ~~Rebook Jane's Zelle as Rent → Chase Checking~~ — same.

### Survives the reset — still needed

- [ ] **Set asset classes** on every asset account (Accounts → manage → set
      class). Accounts survive a reset, and both the allocation panel and
      Plaid's balance mode depend on this. It deliberately refuses to guess.

---

## Code — do before the first real sync

- [x] **Import start-date filter.** Plaid's first sync backfills up to 24
      months. Right after opening the book at Aug 1 that means several hundred
      pre-August rows in the review queue to dismiss by hand, which fights the
      whole point of the fresh start. Needs a "don't import before <date>"
      setting honoured in `syncItem`. *This is the one I'd do first.*

      Done as `PLAID_IMPORT_START=YYYY-MM-DD`. Dates are compared as strings —
      Plaid's `YYYY-MM-DD` sorts chronologically, so no parsing per row. Skipped
      rows still advance the cursor, so they're dropped once rather than
      re-offered on every sync, and the count comes back as `skipped` in the
      sync report.

      **A malformed value fails open** — it logs an error and imports
      everything, rather than silently importing nothing. Importing too much is
      a visible nuisance; importing nothing looks exactly like a broken sync and
      would be debugged for hours before anyone suspected the date. Chose an
      env var over a settings table because it's set once, the day the book
      opens, and never touched again; a table would have needed a migration, an
      endpoint and a UI to express one date.

## Code — worth doing

- [ ] **Tests for `handlers/plaid.go`.** The package sits at 8.6% coverage
      (only auth is tested; `budget.go` is untested too, and was before). The
      logic underneath is well covered — `internal/db` 66%, `internal/plaid`
      69% — but `syncItem`, which coordinates paging, staging, transfer
      matching and balance application, has none.
- [ ] **Scheduled sync.** Currently manual "sync now" only. The host already
      runs cron for backups; a nightly pull is small once the flow is proven.
- [ ] **Persisted statement history for reconciliation.** Deliberately deferred.
      Cleared/locked states work and the lock protects closed periods; what's
      missing is remembering that August closed at $X on the 30th.
- [ ] **`plaidLink.ts` is untested** — needs a real browser and Plaid's CDN
      script, so it won't be covered by the unit suite.

## Code — considered and deferred

- **Move off Turso to local SQLite.** Turso currently holds the complete
  financial history *and* the Plaid access tokens. Local SQLite on the host
  would make it the only place that data exists. Very doable —
  `modernc.org/sqlite` is already in `go.mod` (added for tests) and the code is
  plain `database/sql`. Deferred because it's a bigger change than the network
  hardening and the Pi rack is mid-rebuild. Revisit once hosting settles.
- **Splitting `/budget` into its own codebase.** Not needed. Separate hostnames
  plus path rules in `Caddyfile.vps` get the whole security benefit; a real
  split is a large refactor for very little more.
- **Encrypting Plaid tokens at rest.** A key sitting in the same `.env` on the
  same box would be theatre. `plaid_items` is excluded from `/dump`, which is
  the leak that actually mattered — the dump is pulled to a laptop nightly and
  kept 60 days.

---

## Security posture

Where this landed and why, so it isn't re-litigated:

- Portfolio and budget are **separate hostnames**. `/budget` and
  `/api/admin/*` return 404 on the public host.
- `plaid_items` (access tokens) is **excluded from `/dump`**. Restoring a
  backup leaves Plaid unlinked; re-linking takes two minutes.
- Plaid routes are `AdminOnly` — never reachable with the backup token.
- [x] **Tailscale on `budget.*`**, which arrived earlier than planned and does
      the job Cloudflare Access was going to do on the way to the Pi: the
      hostname resolves to a tailnet address, so an unauthenticated request
      doesn't reach the origin because it can't route to it at all. The admin
      password is now the second lock rather than the only one.
- [ ] ~~Cloudflare Access on `budget.*` with email OTP~~ — superseded by
      Tailscale above. Left here because the reasoning still applies if the
      tool ever needs to be reachable from a device that can't join the tailnet.
- [ ] **Move the tailnet route to the Pi** once the rack is rebuilt. Same
      Tailscale, different node; DNS change rather than a refactor.

- **Nothing sensitive goes in `frontend/public/`.** Vite copies that directory
  verbatim into the document root, and the catch-all `file_server` in
  `Caddyfile.vps` serves it from *both* hostnames — the 404 rules only cover
  `/budget*` and `/api/admin/*`. A file put there is public even if the route
  you meant to reach it through is gated. The learning dashboard was briefly
  written there before being moved into the Go binary with `go:embed`
  (`internal/handlers/learn.go`), which is the pattern to copy: if a static
  file needs the admin gate, embed it and serve it from a handler.

---

## Verification state

Be honest about what has and hasn't been exercised:

| Area | State |
|---|---|
| Reconciliation | Unit-tested (11 backend tests), never run against real data |
| Plaid client | Unit-tested against a fake server, **never talked to Plaid** |
| Import start filter | Env parsing unit-tested incl. malformed dates; the skip itself is only exercised by a real sync |
| Transfer matching | 8 tests incl. card payments, refunds, double-claim |
| Accept → ledger | Tested, incl. auto-clearing and pending handling |
| Mobile layout | Measured in-browser at 375px across all 7 tabs |
| Plaid UI | Renders against stubbed API; Link flow never opened |
