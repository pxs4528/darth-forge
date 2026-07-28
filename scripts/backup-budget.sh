#!/bin/bash
set -euo pipefail

# Nightly budget-database backup (runs on the Pi via cron).
#
# Dumps the full Turso database as SQL, gzips it with the date in the name,
# and prunes anything older than KEEP_DAYS. A dump restores with:
#   gunzip -c budget-YYYY-MM-DD.sql.gz | turso db shell <db-name>
#
# Install (once):
#   crontab -e
#   0 3 * * * /home/darth/darth-forge/scripts/backup-budget.sh >> /home/darth/backups/budget/backup.log 2>&1

DB_NAME="${BUDGET_DB:-darth-budget}"
BACKUP_DIR="${BACKUP_DIR:-/home/darth/backups/budget}"
KEEP_DAYS="${KEEP_DAYS:-60}"

# turso installs to ~/.turso by default; cron's PATH won't have it
export PATH="$HOME/.turso:$PATH"

mkdir -p "$BACKUP_DIR"

out="$BACKUP_DIR/budget-$(date +%F).sql.gz"
turso db shell "$DB_NAME" .dump | gzip > "$out.tmp"

# a dump under 100 bytes means something went wrong — keep yesterday's file
if [ ! -s "$out.tmp" ] || [ "$(stat -c%s "$out.tmp")" -lt 100 ]; then
    echo "[$(date)] backup FAILED — dump too small, keeping previous backups" >&2
    rm -f "$out.tmp"
    exit 1
fi
mv "$out.tmp" "$out"

find "$BACKUP_DIR" -name 'budget-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date)] backup ok: $out ($(stat -c%s "$out") bytes)"
