create or replace function public.save_record(
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

