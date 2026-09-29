-- Apply to the existing project before publishing the corresponding UI.
-- Legacy marriage/death enum values remain for any existing pilot records, but the UI offers the four requested sacraments.
alter type public.sacrament_kind add value if not exists 'communion';
alter type public.sacrament_kind add value if not exists 'matrimony';

create or replace function public.save_record(
  p_id uuid, p_parish_id uuid, p_kind public.sacrament_kind,
  p_subject_name text, p_event_date date, p_register_volume text,
  p_register_page text, p_register_number text, p_details jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_record public.records; v_id uuid;
begin
  if public.my_staff_role() not in ('secretary','priest') or public.my_parish_id() is distinct from p_parish_id then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_subject_name,''))) < 2 or p_event_date is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Name, date and valid details are required';
  end if;
  if p_id is null then
    insert into public.records(parish_id,kind,subject_name,event_date,register_volume,register_page,register_number,details,created_by)
    values(p_parish_id,p_kind,trim(p_subject_name),p_event_date,p_register_volume,p_register_page,p_register_number,p_details,auth.uid()) returning id into v_id;
    select * into v_record from public.records where id = v_id;
    insert into public.record_events(record_id,actor_id,action,snapshot) values(v_id,auth.uid(),'created',to_jsonb(v_record));
  else
    select * into v_record from public.records where id = p_id for update;
    if not found or v_record.parish_id <> p_parish_id or v_record.status not in ('draft','returned') then raise exception 'Record cannot be edited'; end if;
    update public.records set kind=p_kind,subject_name=trim(p_subject_name),event_date=p_event_date,
      register_volume=p_register_volume,register_page=p_register_page,register_number=p_register_number,
      details=p_details,updated_at=now(),return_reason=null where id=p_id returning * into v_record;
    v_id := p_id;
    insert into public.record_events(record_id,actor_id,action,snapshot) values(v_id,auth.uid(),'edited',to_jsonb(v_record));
  end if;
  return v_id;
end $$;

create or replace function public.submit_record(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_record public.records;
begin
  select * into v_record from public.records where id=p_id for update;
  if not found or public.my_staff_role() not in ('secretary','priest') or v_record.parish_id is distinct from public.my_parish_id() or v_record.status not in ('draft','returned') then raise exception 'Not authorized to submit'; end if;
  update public.records set status='pending',submitted_at=now(),updated_at=now(),return_reason=null where id=p_id returning * into v_record;
  insert into public.record_events(record_id,actor_id,action,snapshot) values(p_id,auth.uid(),'submitted',to_jsonb(v_record));
end $$;
