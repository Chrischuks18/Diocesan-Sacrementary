# Diocesan Sacrament Registry — pilot

A web app for parish secretaries and priests to draft and submit entries, parish priests to approve or return them, and diocesan staff to see approved entries across parishes. The pilot registers Baptism, Communion, Confirmation, and Matrimony. It uses Vite, Supabase Auth, PostgreSQL and Row Level Security. This pilot uses sample records only.

## Run locally

1. Create a new Supabase project under an account controlled by the Diocese.
2. Open its SQL Editor and run `supabase/schema.sql` once, in full.
3. In **Authentication → Users**, manually create a secretary, a priest and a diocesan user. Disable open public sign-up in the Authentication settings. Enable MFA for accounts where supported. Configure custom SMTP before inviting staff outside the Supabase organization; the built-in mailer does not deliver to those addresses.
4. In the SQL Editor, create a pilot parish and assign each user's UUID from Authentication → Users. Replace the example UUIDs:

```sql
insert into public.parishes (name) values ('Pilot Parish') returning id;
insert into public.staff_profiles (user_id, full_name, role, parish_id) values
  ('SECRETARY-USER-UUID', 'Pilot Secretary', 'secretary', 'PARISH-UUID'),
  ('PRIEST-USER-UUID', 'Pilot Parish Priest', 'priest', 'PARISH-UUID'),
  ('DIOCESE-USER-UUID', 'Pilot Diocesan Officer', 'diocese', null);
```

5. Copy `.env.example` to `.env`. Get the project URL and **publishable/anon key** from Supabase project settings. Never place a service-role or secret key in this file.
6. Run `npm install`, then `npm run dev`. Open the printed local URL.

## Publish when ready

Push this folder to a private GitHub repository. Connect that repository to Cloudflare Pages, with build command `npm run build` and output directory `dist`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Pages environment variables. Set the Supabase Authentication Site URL to the Pages address. Run `npm run build` before publishing. GitHub holds the code; Cloudflare serves the app; Supabase stores the records and handles sign-in.

## Pilot boundaries

- The form's `details.notes` field is intentionally generic. Agree exact canonical fields for each sacrament with diocesan authorities before entering actual records.
- Diocesan staff see only approved entries; secretaries and priests see only their own parish. Saved entry details cannot be edited through the app by parish or diocesan staff; corrections are reserved for trusted server administrators through the database administration tools. The parish priest alone gives final approval. Formal amendment, transfer notification, certificate issue, attachment storage, and migration of historical registers require a separate reviewed workflow.
- Apply `supabase/migrations/20261001_admin_only_edits.sql` to an existing project to enforce administrator-only corrections to saved records. Creating and submitting entries remains available to parish secretaries and priests; diocesan users have read-only access to approved entries.
- For an existing project created with the earlier schema, run `supabase/migrations/20260929_priest_entries_sacraments.sql` in its SQL editor. Priests can save drafts, submit them, then approve after checking the register. The older enum values remain in the database for historical pilot rows but are no longer offered for new entries.
- There is no public registration or public search. Staff accounts are provisioned manually. Do not put credentials or real records in GitHub.
- Supabase Free may pause inactive projects and does not provide scheduled database backups. Use invented test data during this stage. Confirm data location, privacy obligations, operational support and tested backups before real use.
- Keep the Diocese as owner of the GitHub, Supabase and Cloudflare accounts. Remove staff access promptly when assignments change.
