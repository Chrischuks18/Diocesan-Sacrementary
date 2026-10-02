# Registry operations

Apply `supabase/migrations/20261002_registry_features.sql` once in the Supabase SQL Editor before publishing the updated application. It preserves parish access boundaries and the diocesan read-only role.

## Corrections and verified links

The trusted database administrator uses the SQL Editor, not a parish or diocesan account. Corrections must carry a name and reason:

```sql
select public.admin_correct_record(
  'RECORD-UUID',
  '{"subject_name":"Corrected name","details":{"parents":"Corrected parent names"}}'::jsonb,
  'Corrected against the original paper register',
  'Administrator full name'
);
```

Details are merged with existing details. Record events preserve before/after snapshots and the stated administrator identity. Correcting an approved or pending record sends it back to pending and clears its approval, so the parish priest gives final approval again. Returned records remain returned until staff submit them. Direct edits to saved details without an administrator name and reason are rejected by the audit trigger. Database owners remain trusted and can technically change database objects; their external access controls and audit logs still matter.

To link old entries, assign the same verified UUID to `details.person_id` using this operation. Do not join people just because their names match. Cross-parish linking is an administrator operation. A matrimony entry represents the couple and has its own history identity; it is not automatically merged into either spouse’s individual history.

## Notifications, certificates and imports

Approval updates appear in the app, refreshed every 45 seconds while the Registers or Approval updates page is visible. These are in-app status updates, not email or phone push notifications. Certificates are printable from approved records by parish staff. The browser print dialogue supports printing or saving as PDF. Signing and stamping remain parish actions; the template does not replace the original register or any required annotations.

The import screen offers a CSV template and preview. Imports contain at most 200 rows, enter the user's own parish as drafts, skip duplicates and show row failures. Dates use YYYY-MM-DD. Blank `person_id` creates a new history identity; a supplied ID must be verified. Partial successes remain saved if a later row fails. Re-importing skips existing duplicates; do not create altered copies to evade the check. Spouse names and phone numbers have separate fields.

## Backup and recovery

`scripts/registry-backup.sh` supplies encrypted manual backup, archive verification and an empty-test-database restore command. It is not yet connected to an administrator machine or scheduled service. PostgreSQL client tools matching the server version and OpenSSL must be installed on the trusted administrator computer. Configure `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and a private `PGPASSFILE` using the project's database connection settings. Configure TLS trust according to that connection. Never send the database password in chat or commit it to GitHub.

Create a random encryption secret outside the repository (for example `openssl rand -base64 48 > /secure/path/registry-backup.key`, protect it with owner-only permissions). Set `REGISTRY_BACKUP_KEY_FILE` to its path. Keep a separate secure copy of the key, or encrypted backups cannot be recovered. Run:

```bash
bash scripts/registry-backup.sh backup /secure/backups/registry-YYYYMMDD.dump.enc
bash scripts/registry-backup.sh check /secure/backups/registry-YYYYMMDD.dump.enc
```

Keep encrypted backups and SHA-256 files off the application server and outside GitHub. The archive includes public registry and Auth database schemas. It does not include Storage file contents, SMTP credentials, project configuration, database roles, or provider settings. Preserve those separately using trusted administration procedures. A printed register or CSV export is not a database backup.

For a restore drill, point the PG connection environment to a separate empty PostgreSQL test database prepared with Supabase-compatible roles and dependencies, set `REGISTRY_RESTORE_TEST=YES`, then run `restore-test`. The script rejects targets containing public/Auth tables and never uses `--clean`. Verify restored record/event counts, RLS and the application against the test target. Production recovery requires a separately reviewed Supabase migration plan; do not run a test restore against the live project.

After a successful drill, schedule the backup command on an always-on administrator machine using Task Scheduler or cron, with protected credentials, encrypted output, monitoring and retention. No live backup, restore drill, or schedule has been completed merely by adding this script.
