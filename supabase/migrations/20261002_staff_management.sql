-- Run as database owner. This adds the admin capability but assigns nobody to it.
alter type public.staff_role add value if not exists 'admin';

begin;
alter table public.staff_profiles drop constraint if exists parish_assignment;
alter table public.staff_profiles add constraint parish_assignment check (
  (role::text in ('diocese','admin') and parish_id is null) or
  (role::text in ('priest','secretary') and parish_id is not null)
);

create table if not exists public.staff_assignment_events (
  id bigint generated always as identity primary key,
  staff_user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  previous_role text not null,
  new_role text not null,
  previous_parish_id uuid references public.parishes(id),
  new_parish_id uuid references public.parishes(id),
  previous_active boolean not null,
  new_active boolean not null,
  effective_date date not null,
  reason text not null,
  happened_at timestamptz not null default now()
);
alter table public.staff_assignment_events enable row level security;
revoke all on public.staff_assignment_events from public,anon,authenticated;
grant select on public.staff_assignment_events to authenticated;
create policy staff_events_admin_read on public.staff_assignment_events for select to authenticated
  using (public.my_staff_role()::text='admin');

create or replace function public.list_managed_staff()
returns table(user_id uuid,full_name text,email text,role text,parish_id uuid,active boolean)
language plpgsql security definer set search_path='' as $$
begin
  if public.my_staff_role()::text is distinct from 'admin' then raise exception 'Administrator access required';end if;
  return query select s.user_id,s.full_name,u.email::text,s.role::text,s.parish_id,s.active
    from public.staff_profiles s join auth.users u on u.id=s.user_id order by s.full_name;
end $$;

create or replace function public.manage_staff_assignment(
  p_user_id uuid,p_role text,p_parish_id uuid,p_active boolean,
  p_reason text,p_effective_date date,p_expected_role text,p_expected_parish_id uuid,p_expected_active boolean
) returns void language plpgsql security definer set search_path='' as $$
declare v_old public.staff_profiles;
begin
  if public.my_staff_role()::text is distinct from 'admin' then raise exception 'Administrator access required';end if;
  select * into v_old from public.staff_profiles where user_id=p_user_id for update;
  if not found then raise exception 'Staff profile not found';end if;
  if v_old.role::text='admin' or p_user_id=auth.uid() then raise exception 'Administrator accounts are managed by the database owner';end if;
  if v_old.role::text is distinct from p_expected_role or v_old.parish_id is distinct from p_expected_parish_id or v_old.active is distinct from p_expected_active then raise exception 'Assignment changed since this page was opened. Reload and check it.';end if;
  if p_role is null or p_role not in ('priest','secretary','diocese') or p_active is null then raise exception 'Choose a valid staff role and account status';end if;
  if p_role in ('priest','secretary') and (p_parish_id is null or not exists(select 1 from public.parishes where id=p_parish_id)) then raise exception 'Choose an existing parish';end if;
  if p_role='diocese' and p_parish_id is not null then raise exception 'Diocesan officials have no parish assignment';end if;
  if p_effective_date is null or p_effective_date>current_date then raise exception 'Future transfers cannot be scheduled here. Apply the change when the posting takes effect.';end if;
  if length(trim(coalesce(p_reason,'')))<4 then raise exception 'A transfer or account-change reason is required';end if;
  if v_old.role::text=p_role and v_old.parish_id is not distinct from p_parish_id and v_old.active=p_active then raise exception 'No assignment changes were selected';end if;
  update public.staff_profiles set role=p_role::public.staff_role,parish_id=p_parish_id,active=p_active where user_id=p_user_id;
  insert into public.staff_assignment_events(staff_user_id,actor_id,previous_role,new_role,previous_parish_id,new_parish_id,previous_active,new_active,effective_date,reason)
    values(p_user_id,auth.uid(),v_old.role::text,p_role,v_old.parish_id,p_parish_id,v_old.active,p_active,p_effective_date,trim(p_reason));
end $$;
revoke all on function public.list_managed_staff(),public.manage_staff_assignment(uuid,text,uuid,boolean,text,date,text,uuid,boolean) from public,anon;
grant execute on function public.list_managed_staff(),public.manage_staff_assignment(uuid,text,uuid,boolean,text,date,text,uuid,boolean) to authenticated;
commit;

-- Administrator provisioning is a separate database-owner action after confirming
-- the exact existing Auth user. Never automatically promote a priest or diocesan official.
