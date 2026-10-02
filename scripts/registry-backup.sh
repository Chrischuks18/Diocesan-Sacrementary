#!/usr/bin/env bash
set -euo pipefail
umask 077
# Connection uses PGHOST/PGPORT/PGUSER/PGDATABASE and a private PGPASSFILE.
# Never place credentials, encryption keys or backups in this repository.
action=${1:-}
backup_path=${2:-}
for tool in openssl pg_dump pg_restore psql; do command -v "$tool" >/dev/null || { echo "Install PostgreSQL client tools and OpenSSL." >&2; exit 1; }; done
: "${PGHOST:?Set PGHOST}" "${PGUSER:?Set PGUSER}" "${PGDATABASE:?Set PGDATABASE}" "${REGISTRY_BACKUP_KEY_FILE:?Set a private backup encryption key file}"
export PGSSLMODE=${PGSSLMODE:-require}
[[ -r "$REGISTRY_BACKUP_KEY_FILE" ]] || { echo 'Encryption key file is missing.' >&2; exit 1; }
case "$action" in
  backup)
    [[ -n "$backup_path" && ! -e "$backup_path" && ! -e "$backup_path.partial" ]] || { echo 'Choose a new backup filename outside the repository.' >&2; exit 1; }
    trap 'rm -f -- "$backup_path.partial"' EXIT
    # Public registry plus Auth identities: enough for registry data recovery,
    # but not Storage objects, project secrets, roles, or provider settings.
    pg_dump --format=custom --no-owner --schema=public --schema=auth |
      openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass "file:$REGISTRY_BACKUP_KEY_FILE" -out "$backup_path.partial"
    mv -- "$backup_path.partial" "$backup_path"
    openssl dgst -sha256 "$backup_path" > "$backup_path.sha256"
    echo 'Encrypted registry and Auth backup created.'
    ;;
  check)
    [[ -s "$backup_path" ]] || { echo 'Backup not found.' >&2; exit 1; }
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$REGISTRY_BACKUP_KEY_FILE" -in "$backup_path" | pg_restore --list >/dev/null
    echo 'Backup decrypted and archive contents verified. A restore drill is still required.'
    ;;
  restore-test)
    [[ "${REGISTRY_RESTORE_TEST:-}" == YES ]] || { echo 'Set REGISTRY_RESTORE_TEST=YES only for a separate empty test database.' >&2; exit 1; }
    [[ -s "$backup_path" ]] || { echo 'Backup not found.' >&2; exit 1; }
    count=$(psql -Atqc "select count(*) from information_schema.tables where table_schema in ('public','auth') and table_type='BASE TABLE'")
    [[ "$count" == 0 ]] || { echo 'Refusing restore: target contains tables. Use a separate empty test database with Supabase-compatible roles.' >&2; exit 1; }
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$REGISTRY_BACKUP_KEY_FILE" -in "$backup_path" |
      pg_restore --exit-on-error --single-transaction --no-owner --dbname "$PGDATABASE"
    psql -v ON_ERROR_STOP=1 -c "select count(*) as restored_records from public.records; select count(*) as restored_events from public.record_events;"
    echo 'Test restore completed. Check RLS, role behavior and sign-in before planning production recovery.'
    ;;
  *) echo 'Usage: bash scripts/registry-backup.sh backup|check|restore-test /secure/path/registry.dump.enc' >&2; exit 1 ;;
esac
