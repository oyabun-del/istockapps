#!/usr/bin/env bash
# Dumps the production Postgres to backups/istock-<timestamp>.sql.gz and deletes dumps older
# than KEEP_DAYS. Run from cron on the host (docs/DEPLOY.md). Restore:
#   gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -v ON_ERROR_STOP=1 --single-transaction -U istock -d istock
set -euo pipefail
# Dumps hold customer and order data: readable by the owner only.
umask 077

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/istock-$(date +%Y%m%d-%H%M%S).sql.gz"

# Write to a temp file first so a failed dump never looks like a valid backup.
trap 'rm -f "$file.tmp"' EXIT
docker compose exec -T db pg_dump -U istock -d istock --clean --if-exists --no-owner | gzip > "$file.tmp"
mv "$file.tmp" "$file"

find "$BACKUP_DIR" -name 'istock-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $file"
