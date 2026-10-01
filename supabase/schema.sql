-- Pilot schema. Run in a NEW Supabase project. Create staff in Authentication first,
-- then assign roles in public.staff_profiles using the SQL editor.
create extension if not exists pgcrypto;

create type public.staff_role as enum ('secretary','priest','diocese');
create type public.record_status as enum ('draft','pending','returned','approved');
create type public.sacrament_kind as enum ('baptism','communion','confirmation','matrimony');

create table public.parishes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.staff_role not null,
  parish_id uuid references public.parishes(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint parish_assignment check ((role = 'diocese' and parish_id is null) or (role <> 'diocese' and parish_id is not null))
);

create table public.records (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id),
  kind public.sacrament_kind not null,
  subject_name text not null,
  event_date date not null,
  register_volume text,
  register_page text,
  register_number text,
  details jsonb not null default '{}'::jsonb,
  status public.record_status not null default 'draft',
  created_by uuid not null references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  return_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint details_object check (jsonb_typeof(details) = 'object')
);

create table public.record_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.records(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  note text,
  snapshot jsonb not null,
  happened_at timestamptz not null default now()
);

create index records_parish_status_idx on public.records(parish_id,status,created_at desc);
create index records_subject_idx on public.records(lower(subject_name));
create index record_events_record_idx on public.record_events(record_id,happened_at desc);

create function public.my_staff_role() returns public.staff_role language sql stable security definer set search_path = '' as $$
  select role from public.staff_profiles where user_id = (select auth.uid()) and active = true
$$;
create function public.my_parish_id() returns uuid language sql stable security definer set search_path = '' as $$
  select parish_id from public.staff_profiles where user_id = (select auth.uid()) and active = true
$$;

alter table public.parishes enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.records enable row level security;
alter table public.record_events enable row level security;

create policy parishes_read on public.parishes for select to authenticated using (public.my_staff_role() is not null);
create policy profile_self on public.staff_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy records_read on public.records for select to authenticated using (
  (public.my_staff_role() = 'diocese' and status = 'approved')
  or (parish_id = public.my_parish_id() and public.my_staff_role() in ('secretary','priest'))
);
create policy events_read on public.record_events for select to authenticated using (
  exists (select 1 from public.records r where r.id = record_id)
);

-- All writes go through these controlled operations. No direct client INSERT/UPDATE/DELETE grants.
revoke all on public.records, public.record_events, public.staff_profiles from anon, authenticated;
grant select on public.records, public.record_events, public.staff_profiles to authenticated;
grant select on public.parishes to authenticated;

create function public.save_record(
  p_id uuid, p_parish_id uuid, p_kind public.sacrament_kind,
  p_subject_name text, p_event_date date, p_register_volume text,
  p_register_page text, p_register_number text, p_details jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_record public.records; v_id uuid;
begin
  if coalesce(public.my_staff_role()::text, '') not in ('secretary','priest') or public.my_parish_id() is distinct from p_parish_id then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_subject_name,''))) < 2 or p_event_date is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Name, date and valid details are required';
  end if;
  if p_id is not null then raise exception 'Only the server administrator can edit saved records'; end if;
  insert into public.records(parish_id,kind,subject_name,event_date,register_volume,register_page,register_number,details,created_by)
  values(p_parish_id,p_kind,trim(p_subject_name),p_event_date,p_register_volume,p_register_page,p_register_number,p_details,auth.uid()) returning id into v_id;
  select * into v_record from public.records where id = v_id;
  insert into public.record_events(record_id,actor_id,action,snapshot) values(v_id,auth.uid(),'created',to_jsonb(v_record));
  return v_id;
end $$;

create function public.submit_record(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_record public.records;
begin
  select * into v_record from public.records where id=p_id for update;
  if not found or public.my_staff_role() not in ('secretary','priest') or v_record.parish_id is distinct from public.my_parish_id() or v_record.status not in ('draft','returned') then raise exception 'Not authorized to submit'; end if;
  update public.records set status='pending',submitted_at=now(),updated_at=now(),return_reason=null where id=p_id returning * into v_record;
  insert into public.record_events(record_id,actor_id,action,snapshot) values(p_id,auth.uid(),'submitted',to_jsonb(v_record));
end $$;

create function public.review_record(p_id uuid,p_approve boolean,p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare v_record public.records;
begin
  select * into v_record from public.records where id=p_id for update;
  if not found or public.my_staff_role() <> 'priest' or v_record.parish_id is distinct from public.my_parish_id() or v_record.status <> 'pending' then raise exception 'Not authorized to review'; end if;
  if not p_approve and length(trim(coalesce(p_reason,''))) < 4 then raise exception 'A reason is required'; end if;
  update public.records set status=case when p_approve then 'approved'::public.record_status else 'returned'::public.record_status end,
    approved_by=case when p_approve then auth.uid() else null end,
    approved_at=case when p_approve then now() else null end,
    return_reason=case when p_approve then null else trim(p_reason) end,updated_at=now()
    where id=p_id returning * into v_record;
  insert into public.record_events(record_id,actor_id,action,note,snapshot)
    values(p_id,auth.uid(),case when p_approve then 'approved' else 'returned' end,p_reason,to_jsonb(v_record));
end $$;

revoke all on function public.my_staff_role(),public.my_parish_id(),public.save_record(uuid,uuid,public.sacrament_kind,text,date,text,text,text,jsonb),public.submit_record(uuid),public.review_record(uuid,boolean,text) from public;
grant execute on function public.my_staff_role(),public.my_parish_id(),public.save_record(uuid,uuid,public.sacrament_kind,text,date,text,text,text,jsonb),public.submit_record(uuid),public.review_record(uuid,boolean,text) to authenticated;
