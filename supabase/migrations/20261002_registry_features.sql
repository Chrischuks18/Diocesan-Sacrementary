begin;

-- Duplicate checks reveal only records of the caller's own parish.
create or replace function public.find_record_duplicates(p_kind public.sacrament_kind,p_subject_name text,p_event_date date,p_register_number text default null,p_register_volume text default null)
returns table(id uuid,subject_name text,event_date date,status public.record_status)
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(public.my_staff_role()::text,'') not in ('secretary','priest') then raise exception 'Not authorized'; end if;
  return query select r.id,r.subject_name,r.event_date,r.status from public.records r
  where r.parish_id=public.my_parish_id() and (case when r.kind::text='marriage' then 'matrimony' else r.kind::text end)=(case when p_kind::text='marriage' then 'matrimony' else p_kind::text end) and (
    (lower(regexp_replace(trim(r.subject_name),'\s+',' ','g'))=lower(regexp_replace(trim(p_subject_name),'\s+',' ','g')) and r.event_date=p_event_date)
    or (nullif(trim(p_register_number),'') is not null and lower(trim(r.register_number))=lower(trim(p_register_number)) and lower(trim(coalesce(r.register_volume,'')))=lower(trim(coalesce(p_register_volume,''))))
  ) limit 20;
end $$;

create or replace function public.save_record(p_id uuid,p_parish_id uuid,p_kind public.sacrament_kind,p_subject_name text,p_event_date date,p_register_volume text,p_register_page text,p_register_number text,p_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_record public.records;v_id uuid;
begin
  if coalesce(public.my_staff_role()::text,'') not in ('secretary','priest') or public.my_parish_id() is distinct from p_parish_id then raise exception 'Not authorized'; end if;
  if p_id is not null then raise exception 'Only the server administrator can edit saved records'; end if;
  if length(trim(coalesce(p_subject_name,'')))<2 or p_event_date is null or jsonb_typeof(p_details) is distinct from 'object' then raise exception 'Name, date and valid details are required'; end if;
  -- Serialize creations in a parish so concurrent requests cannot evade the check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_parish_id::text,0));
  if exists(select 1 from public.find_record_duplicates(p_kind,p_subject_name,p_event_date,p_register_number,p_register_volume)) then raise exception 'Duplicate entry detected. Ask the administrator to check it.'; end if;
  if nullif(p_details->>'person_id','') is not null then
    if (p_details->>'person_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid person history ID'; end if;
    if exists(select 1 from public.records r where r.details->>'person_id'=p_details->>'person_id' and r.parish_id<>p_parish_id) then raise exception 'Person history must be linked by an administrator across parishes'; end if;
  end if;
  insert into public.records(parish_id,kind,subject_name,event_date,register_volume,register_page,register_number,details,created_by)
    values(p_parish_id,p_kind,trim(p_subject_name),p_event_date,nullif(trim(p_register_volume),''),null,nullif(trim(p_register_number),''),p_details,auth.uid()) returning * into v_record;
  v_id=v_record.id;
  insert into public.record_events(record_id,actor_id,action,snapshot) values(v_id,auth.uid(),'created',to_jsonb(v_record));
  return v_id;
end $$;

-- Harden approval operations against missing/inactive profiles and null decisions.
create or replace function public.submit_record(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_record public.records;
begin
  select * into v_record from public.records where id=p_id for update;
  if not found or coalesce(public.my_staff_role()::text,'') not in ('secretary','priest') or v_record.parish_id is distinct from public.my_parish_id() or v_record.status not in ('draft','returned') then raise exception 'Not authorized to submit'; end if;
  update public.records set status='pending',submitted_at=now(),updated_at=now(),return_reason=null where id=p_id returning * into v_record;
  insert into public.record_events(record_id,actor_id,action,snapshot) values(p_id,auth.uid(),'submitted',to_jsonb(v_record));
end $$;
create or replace function public.review_record(p_id uuid,p_approve boolean,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_record public.records;
begin
  select * into v_record from public.records where id=p_id for update;
  if not found or public.my_staff_role() is distinct from 'priest'::public.staff_role or v_record.parish_id is distinct from public.my_parish_id() or v_record.status<>'pending' or p_approve is null then raise exception 'Not authorized to review'; end if;
  if not p_approve and length(trim(coalesce(p_reason,'')))<4 then raise exception 'A reason is required'; end if;
  update public.records set status=case when p_approve then 'approved'::public.record_status else 'returned'::public.record_status end,approved_by=case when p_approve then auth.uid() else null end,approved_at=case when p_approve then now() else null end,return_reason=case when p_approve then null else trim(p_reason) end,updated_at=now() where id=p_id returning * into v_record;
  insert into public.record_events(record_id,actor_id,action,note,snapshot) values(p_id,auth.uid(),case when p_approve then 'approved' else 'returned' end,p_reason,to_jsonb(v_record));
end $$;

alter table public.record_events alter column actor_id drop not null;
alter table public.record_events add column if not exists admin_actor text;
alter table public.record_events add column if not exists previous_snapshot jsonb;
create or replace function public.audit_record_correction() returns trigger language plpgsql security definer set search_path='' as $$
declare v_reason text;v_actor text;
begin
  if row(new.parish_id,new.kind,new.subject_name,new.event_date,new.register_volume,new.register_page,new.register_number,new.details)
    is distinct from row(old.parish_id,old.kind,old.subject_name,old.event_date,old.register_volume,old.register_page,old.register_number,old.details) then
    v_reason=nullif(trim(current_setting('registry.correction_reason',true)),'');
    v_actor=nullif(trim(current_setting('registry.admin_actor',true)),'');
    if coalesce(length(v_reason),0)<4 or v_actor is null then raise exception 'Use admin_correct_record with an administrator name and correction reason'; end if;
    if old.status in ('approved','pending') then new.status='pending';new.approved_by=null;new.approved_at=null;new.submitted_at=now(); end if;
    new.updated_at=now();
    insert into public.record_events(record_id,actor_id,admin_actor,action,note,previous_snapshot,snapshot)
      values(old.id,null,v_actor,'corrected',v_reason,to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists records_correction_audit on public.records;
create trigger records_correction_audit before update on public.records for each row execute function public.audit_record_correction();

-- Execute only through the trusted database administrator, never staff app accounts.
create or replace function public.admin_correct_record(p_id uuid,p_changes jsonb,p_reason text,p_admin_name text)
returns void language plpgsql security invoker set search_path='' as $$
declare v_key text;
begin
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'Changes must be an object'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('subject_name','event_date','kind','register_volume','register_number','details') then raise exception 'Unsupported correction field: %',v_key; end if;
  end loop;
  if length(trim(coalesce(p_reason,'')))<4 or length(trim(coalesce(p_admin_name,'')))<2 then raise exception 'Administrator name and reason required'; end if;
  if p_changes ? 'subject_name' and length(trim(coalesce(p_changes->>'subject_name','')))<2 then raise exception 'Name required'; end if;
  if p_changes ? 'event_date' and nullif(p_changes->>'event_date','') is null then raise exception 'Date required'; end if;
  if p_changes ? 'kind' and nullif(p_changes->>'kind','') is null then raise exception 'Sacrament required'; end if;
  if p_changes ? 'details' and jsonb_typeof(p_changes->'details') is distinct from 'object' then raise exception 'Details must be an object'; end if;
  perform set_config('registry.correction_reason',p_reason,true);perform set_config('registry.admin_actor',p_admin_name,true);
  update public.records set subject_name=case when p_changes?'subject_name' then trim(p_changes->>'subject_name') else subject_name end,
    event_date=case when p_changes?'event_date' then (p_changes->>'event_date')::date else event_date end,
    kind=case when p_changes?'kind' then (p_changes->>'kind')::public.sacrament_kind else kind end,
    register_volume=case when p_changes?'register_volume' then p_changes->>'register_volume' else register_volume end,
    register_number=case when p_changes?'register_number' then p_changes->>'register_number' else register_number end,
    details=case when p_changes?'details' then details||(p_changes->'details') else details end where id=p_id;
  if not found then raise exception 'Record not found'; end if;
  perform set_config('registry.correction_reason','',true);perform set_config('registry.admin_actor','',true);
end $$;
revoke all on function public.admin_correct_record(uuid,jsonb,text,text),public.audit_record_correction() from public,anon,authenticated;
revoke all on function public.find_record_duplicates(public.sacrament_kind,text,date,text,text) from public,anon;
grant execute on function public.find_record_duplicates(public.sacrament_kind,text,date,text,text) to authenticated;
grant execute on function public.admin_correct_record(uuid,jsonb,text,text) to postgres;
create index if not exists records_person_history_idx on public.records((details->>'person_id'));
commit;
