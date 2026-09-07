# Migrating off the Pi to a rented VPS

The portfolio and the budget tool both run on one small server, on **two
hostnames**, so the ledger and the Plaid tokens aren't reachable from the
address that gets crawled and scanned.

**These two have different lifespans.** The portfolio lives on the VPS
permanently: it's public by nature, holds nothing sensitive, and keeping it off
the home LAN means a compromise costs a disposable box rather than a foothold
next to your laptop and NAS. The budget tool is here **temporarily** — roughly
a month, until the Pi rack is rebuilt — and then moves behind a Tailscale-only
Pi, because hardware you own and never expose is the right home for a ledger
and seven banks' worth of access tokens. See `budget-todo.md` → Architecture.

The two-hostname split is what makes that later move a DNS change rather than a
refactor. Keep it.

Nothing about the application changes. The database stays on Turso for now, so
the data moves with the credentials rather than with the machine — there is no
data migration step and no downtime window to schedule. (Moving off Turso to a
local SQLite file is the next planned change; after that, migrating to the Pi
is one `scp` of the database file.)

## Pick the region before the plan

**This is the decision that matters.** Turso is SQLite-over-HTTP, so every
query is a separate HTTP round trip, and the code is chatty: one
`/api/admin/budget/month` costs about **eleven** of them — `ensureBudgets` (3),
`AccountBalances` (3), `listEntries` (2), plus budgets, goal and
`netWorthEarned`. The store also refetches the month after every write, so each
entry added and each checkbox ticked in Reconcile pays that cost again.

Co-located with the database, those eleven trips are single-digit
milliseconds. Across the Atlantic they're 90–110ms each — **over a second of
network time per page load**, on every interaction.

So: find out where the database lives, then put the server in the same place.

```bash
turso db show darth-budget
```

Do not split the app and the database across regions to save a euro.

## What this costs

The whole stack idles well under 1 GB — Caddy, the Go backend and the infosec
container. 2 GB is ample.

| Provider | Plan | Regions | Approx |
|---|---|---|---|
| Hetzner | **CPX11** (2 vCPU AMD, 2 GB, 40 GB) | Ashburn VA, Hillsboro OR, EU | ~€4.99/mo |
| Hetzner | CX23 (2 vCPU, 4 GB, 40 GB) | **EU only** — Nuremberg, Helsinki | ~€5.99/mo |
| DigitalOcean | Basic 1 GB | US + EU | $6/mo |
| Vultr | Regular 1 GB | US + EU | $5/mo |

**CPX11 in Ashburn** is the pick for a US Turso primary: cheaper than CX23, US
East, and Ashburn tends to have the best stock. CX23 is the "Cost-Optimized"
line — explicitly limited-availability, frequently out of stock, and EU-only,
so it can't serve a US database well no matter how cheap it gets.

Two things the headline price hides: Hetzner bills IPv4 separately, and US
locations include less traffic than the EU's 20 TB. Both are academic for a
personal site, but check them at checkout.

Any provider is fine. All that matters is a public IPv4, Debian 12 or
Ubuntu 24.04, ports 80/443, and **the right region**.

## 1. DNS

Decide the two hostnames first, because Caddy needs them resolving before it
can get certificates.

```
example.com        A   <vps-ip>
budget.example.com A   <vps-ip>
```

If the domain is on Cloudflare, set both records to **DNS only** (grey cloud)
for now. The orange-cloud proxy can go back on after the first certificate is
issued — see step 6.

## 2. Provision and bootstrap

Create the server with your SSH key, then:

```bash
ssh root@<vps-ip>
```

```bash
curl -fsSL https://raw.githubusercontent.com/pxs4528/darth-forge/main/scripts/setup-vps.sh | bash -s -- deploy
```

That installs Docker, creates a `deploy` user, enables `ufw` (22/80/443 only),
turns on fail2ban and unattended security upgrades, disables root SSH and
password auth, and creates `~/darth-forge/`.

It refuses to disable password auth if your key didn't copy across — check the
output rather than assuming.

## 3. Set up Tailscale for Budget access

Budget must be accessible only from your Tailscale network:

```bash
ssh deploy@<vps-ip>
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up
```

Get your Tailscale IP after authenticating:

```bash
tailscale ip -4
```

Save this IP — you'll need it for `.env.vps`.

## 4. Copy the deploy files

From your laptop, in the repo:

```bash
scp compose.vps.yaml scripts/deploy-vps.sh scripts/webhook-vps.service deploy@<vps-ip>:~/darth-forge/
scp webhook-listener.py deploy@<vps-ip>:~/darth-forge/  # from .cicd/
```

Then build `.env.vps` from the example and copy it up. **Do not commit it.**

```bash
cp .env.vps.example .env.vps
```

Fill in:

- `SITE_DOMAIN`, `BUDGET_DOMAIN`, `ACME_EMAIL`
- `TAILSCALE_IP` — the IP from step 3
- `ADMIN_SECRET` — generate a new one, don't reuse the Pi's:
  `openssl rand -base64 32`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — the **same** values the Pi used
- `BACKUP_TOKEN` — `openssl rand -hex 24`
- USCIS and ntfy values if you still want the poller
- Leave the `PLAID_*` values empty for now

```bash
scp .env.vps deploy@<vps-ip>:~/darth-forge/.env.vps
```

## 5. First deploy

```bash
ssh deploy@<vps-ip>
cd ~/darth-forge && bash deploy-vps.sh
```

If the GHCR packages are private, log in once first:

```bash
echo <PAT-with-read:packages> | docker login ghcr.io -u pxs4528 --password-stdin
```

## 6. Set up webhook listener on VPS

On the VPS, install the webhook listener as root:

```bash
ssh deploy@<vps-ip>
sudo bash ~/darth-forge/scripts/setup-webhook-vps.sh
```

This will output a webhook secret. Use it to configure GitHub:

1. Go to **Settings → Secrets and variables → Actions → New repository secret**
2. Add `WEBHOOK_URL_VPS`: `https://<your-vps-ip>:9000/webhook` (or via a reverse proxy)
3. Add `WEBHOOK_SECRET_VPS`: the secret from the setup script output

**Important**: The webhook listener runs on HTTP internally (port 9000). You'll need to either:
- Use your VPS's public IP directly (less secure, exposes the webhook to the internet)
- Set up a reverse proxy / Nginx to terminate HTTPS
- Use UFW to restrict access to port 9000 to your CI/CD IP range

For maximum security, set up an Nginx reverse proxy on the VPS to handle HTTPS and proxy to the webhook listener on localhost:9000.

The script warns if either hostname doesn't resolve to this machine, because
Caddy's failure to get a certificate is otherwise buried in container logs.

Certificates take ~30s on first boot:

```bash
docker compose -f compose.vps.yaml logs -f frontend
```

## 11. Verify before cutting over

```bash
curl -sS https://example.com/api/health              # {"status":"healthy"}
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com/budget   # 404
curl -sS -o /dev/null -w '%{http_code}\n' \
     https://example.com/api/admin/budget/month      # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://budget.example.com/  # 200
```

The two 404s are the point of the split: the budget tool is not served from the
public hostname at all. Then open `https://budget.example.com` and confirm the
admin gate appears and your data loads.

## 12. Put Cloudflare back in front (recommended)

Once certificates exist, switch both DNS records back to **Proxied** and set
SSL/TLS mode to **Full (strict)**. Caddy's Let's Encrypt certificate satisfies
that, and you regain Cloudflare's DDoS filtering and hide the origin IP.

Then tighten the firewall so only Cloudflare can reach the origin:

```bash
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo ufw allow from "$ip" to any port 443 proto tcp
done
```

Leave port 80 closed after this — certificate renewal uses the existing TLS-ALPN
challenge on 443.

**Worth doing while you're here:** put Cloudflare Access in front of
`budget.example.com` with an email-OTP policy. Requests then fail at
Cloudflare's edge and never reach the origin, which means the admin password
stops being the only thing between the internet and your bank tokens. Free tier
covers it. This is the interim stand-in for the VPN you wanted, and it survives
the move back to the Pi.

## 9. Configure GitHub Secrets

The deployment script injects secrets from GitHub Actions, so the `.env.vps` file never needs to be stored on your laptop.

Go to **Settings → Secrets and variables → Actions** and add these repository secrets:

**VPS Configuration:**
- `VPS_HOST`: Your VPS IP or hostname
- `VPS_USER`: `deploy`
- `VPS_SSH_KEY`: Your SSH private key (the one you used for passwordless login)
- `WEBHOOK_URL_VPS`: `https://<vps-ip>:9000/webhook`
- `WEBHOOK_SECRET_VPS`: From the webhook setup script output

**Application Secrets:**
- `SITE_DOMAIN`: Your portfolio domain
- `BUDGET_DOMAIN`: Your budget domain
- `TAILSCALE_IP`: From `tailscale ip -4`
- `ACME_EMAIL`: Let's Encrypt contact email
- `ADMIN_SECRET`: Generate with `openssl rand -base64 32`
- `TURSO_DATABASE_URL`: From `turso db show darth-budget --url`
- `TURSO_AUTH_TOKEN`: From `turso db tokens create darth-budget`
- `BACKUP_TOKEN`: Generate with `openssl rand -hex 24`

**Optional (leave empty if not using):**
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- `USCIS_CASE_URL`, `USCIS_COOKIE`, `USCIS_BEARER`
- `NTFY_TOPIC`, `NTFY_TOKEN`

## 10. CI/CD is now automated

GitHub Actions automatically builds and deploys on every push to main:
1. Builds multi-arch images and pushes to GHCR
2. Generates `.env.vps` from GitHub secrets
3. Copies it to the VPS via SCP
4. Triggers the webhook to deploy

No manual action needed — just push and it's deployed within a few seconds.

To monitor deployments:

```bash
ssh deploy@<vps-ip>
tail -f ~/darth-forge/.webhook.log
```

## 13. Update the backup job

The pipeline already builds `linux/amd64`, so images need no change. Update the
repo secret `WEBHOOK_URL` to the new host, or drop the webhook and deploy by
hand — `bash deploy-vps.sh` is the whole deploy.

## 14. Decommission

`scripts/backup-budget.ps1` reads `%USERPROFILE%\.budget-backup.json`. Point it
at the new host and paste the new `BACKUP_TOKEN`:

```json
{
  "url": "https://budget.example.com/api/admin/budget/dump",
  "token": "<BACKUP_TOKEN from .env.vps>",
  "keepDays": 60
}
```

Run it once by hand to confirm, and check the file is over 100 bytes — the
script fails loudly on a short response, which is what a wrong token looks like.

If you enable Cloudflare Access in step 6, this needs an Access **service
token** (two extra headers) or the nightly pull will start returning the login
page. Easy to miss: backups go quiet rather than erroring.

## 15. Rolling back

Only after a few days of the VPS running cleanly:

- Stop the Pi's stack so two hosts aren't polling USCIS and hitting Turso.
- Keep the Cloudflare Tunnel config — you'll want it when the rack is back.
- Keep the Pi's last SQL dump.

## 16. Going back to the Pi later

Nothing is destroyed by this migration. To go back: start the Pi stack, flip
DNS. The database never moved.


Keep `compose.vps.yaml` and `Caddyfile.vps` — the two-hostname split is worth
keeping regardless of where it runs. On the Pi behind the tunnel, run two
tunnel routes (one per hostname) pointing at the same Caddy container, and
switch the command back to the default `Caddyfile`, or keep `Caddyfile.vps`
with the tunnel terminating TLS.
