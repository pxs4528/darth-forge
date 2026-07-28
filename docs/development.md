# Local development

The Pi only hosts; all development and CI happens off it.

## One-time setup (any Windows machine)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
```

Installs Go + Node LTS via winget if missing, pulls dependencies, and runs the
full check suite (build, vet, tsc, eslint, tests). Idempotent — re-run any time.

## Daily use

```powershell
npm run dev
```

Frontend on `http://localhost:3000` (vite proxies `/api` to the Go backend on
`:8080`). The budget tool is at `http://localhost:3000/budget`.

Backend env vars for the current shell (optional — without Turso the site runs
and budget routes return 503):

```powershell
$env:ADMIN_SECRET       = 'pick-something'
$env:TURSO_DATABASE_URL = 'libsql://darth-budget-dev-....turso.io'  # a -dev DB, not prod
$env:TURSO_AUTH_TOKEN   = '...'
```

## Checks (same gates CI runs)

```powershell
npm test               # backend go test + frontend vitest
npm run lint           # eslint
npx tsc --noEmit -p frontend
```

## How deployment works

Push to `main` → GitHub Actions tests, builds multi-arch images, pushes to
GHCR, then pings the Pi's webhook. The Pi runs `.cicd/deploy.sh`, which only
pulls images and restarts containers. Details: `.cicd/README.md`.
