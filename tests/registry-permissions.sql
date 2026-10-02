-- Run in SQL Editor as postgres. All invented records and audit events roll back.
begin;
select set_config('registry.test_priest',(select user_id::text from public.staff_profiles where active and role='priest' limit 1),true);
select set_config('registry.test_diocese',(select user_id::text from public.staff_profiles where active and role='diocese' limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('registry.test_priest'),true);
set local role authenticated;
do $$
declare v_id uuid;v_parish uuid;v_name text:='Rollback validation '||gen_random_uuid()::text;
begin
  if public.my_staff_role() is distinct from 'priest'::public.staff_role then raise exception 'Test needs an active priest';end if;
  v_parish=public.my_parish_id();
  v_id=public.save_record(null,v_parish,'baptism',v_name,current_date,'TEST',null,v_name,'{}'::jsonb);
  perform set_config('registry.test_record',v_id::text,true);
  begin
    perform public.save_record(null,v_parish,'baptism',v_name,current_date,'TEST',null,v_name,'{}'::jsonb);
    raise exception 'TEST FAILED: duplicate accepted';
  exception when others then if sqlerrm not like 'Duplicate entry detected%' then raise; end if;end;
  begin
    perform public.save_record(v_id,v_parish,'baptism',v_name,current_date,'TEST',null,v_name,'{}'::jsonb);
    raise exception 'TEST FAILED: saved edit accepted';
  exception when others then if sqlerrm not like 'Only the server administrator%' then raise;end if;end;
  perform public.submit_record(v_id);
  perform public.review_record(v_id,true);
  if not exists(select 1 from public.records where id=v_id and status='approved') then raise exception 'TEST FAILED: priest approval';end if;
  begin perform public.admin_correct_record(v_id,'{}'::jsonb,'Test reason','Parish priest');raise exception 'TEST FAILED: staff correction permitted';exception when insufficient_privilege then null;end;
  begin update public.records set subject_name='Forbidden' where id=v_id;raise exception 'TEST FAILED: direct update permitted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',current_setting('registry.test_diocese'),true);
  if public.my_staff_role() is distinct from 'diocese'::public.staff_role then raise exception 'Test needs an active diocesan official';end if;
  if not exists(select 1 from public.records where id=v_id) then raise exception 'TEST FAILED: approved diocesan read';end if;
  begin perform public.review_record(v_id,true);raise exception 'TEST FAILED: diocesan approval permitted';exception when others then if sqlerrm not like 'Not authorized to review%' then raise;end if;end;
end $$;
reset role;
do $$
declare v_id uuid:=current_setting('registry.test_record')::uuid;
begin
  perform public.admin_correct_record(v_id,'{"details":{"parents":"Invented rollback parents"}}'::jsonb,'Validation against invented register','Rollback test administrator');
  if not exists(select 1 from public.records where id=v_id and status='pending' and approved_at is null) then raise exception 'TEST FAILED: corrected record not returned for priest approval';end if;
  if not exists(select 1 from public.record_events where record_id=v_id and action='corrected' and admin_actor='Rollback test administrator' and previous_snapshot->>'status'='approved' and snapshot->>'status'='pending') then raise exception 'TEST FAILED: correction audit';end if;
end $$;
set local role authenticated;
do $$
begin
  if exists(select 1 from public.records where id=current_setting('registry.test_record')::uuid) then raise exception 'TEST FAILED: diocesan access to pending correction';end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin perform public.review_record(current_setting('registry.test_record')::uuid,true);raise exception 'TEST FAILED: missing-profile approval';exception when others then if sqlerrm not like 'Not authorized to review%' then raise;end if;end;
end $$;
reset role;
rollback;
select 'PASS: duplicate guard, administrator-only edits, priest approval, diocesan read-only access, correction audit and reapproval; all test data rolled back' as verification;
