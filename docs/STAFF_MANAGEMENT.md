# Staff Management setup

The Staff Management page works with existing Auth accounts and staff profiles. Priest transfers and activation/deactivation preserve all sacramental records, pending approvals and historical creator/approver IDs. Diocesan officials retain their read-only registry role and cannot use this page.

## Activation by the database owner

1. Confirm the exact email of the server administrator and resolve it to an existing Supabase Auth user. Create a separate personal administrator account if appropriate; never hand over someone else's account or password.
2. Run `supabase/migrations/20261002_staff_management.sql` once in the SQL Editor. New installations also need this migration after `schema.sql`. No user is promoted by the migration.
3. After explicit authorization for the selected account, the database owner assigns `role='admin'` and `parish_id=null` in `staff_profiles`, using the confirmed Auth UUID. The administrator must sign out and sign in again to load the new menu. Do not change an existing priest into an administrator unless removing that priest's parish role is intended.

Administrator promotion is deliberately absent from the staff app. Administrator accounts are controlled by the database owner. This role administers staff assignments; record corrections continue through the trusted database administration operation documented in `REGISTRY_OPERATIONS.md`.

## Using the page

Select an existing account, choose its role, parish and active status, and provide the posting effective date and reason. Check the before/after summary before confirming. Changes apply immediately; future posting dates are rejected rather than silently applying a future transfer now. An incoming priest gains access to the parish's pending entries. The transferred priest loses access to the former parish and gains access to the new one. Staff should sign out and sign in again to refresh the displayed parish. Database access rules use the latest assignment immediately.

The server rejects changes if another administrator has modified the assignment since the page was loaded. It records the acting administrator, previous/new role, parish and active status, reason and effective date in `staff_assignment_events`. Only active administrators may read these events. Existing administrator accounts and the acting administrator's own account cannot be changed through this operation.

New invitations still use Supabase Authentication administration. No service-role key is exposed to the web app. Add the new account's staff profile, then manage subsequent transfers here. Deactivation disables registry data access; it does not delete the Auth user, revoke access to unrelated services, or erase historical records.

The page code is published, but initial migration activation and administrator provisioning must be confirmed for the intended account. The ordinary priest/secretary/diocesan menus remain unchanged until then.
