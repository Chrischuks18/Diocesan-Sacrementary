import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,toCsv,importRecords,matchesDuplicate,filterRecords,validDate} from '../src/registry-tools.js';
test('quoted commas, embedded quotes and multiline notes survive CSV parsing',()=>{
  const rows=[['name','notes'],['Ada, John','He said "yes"\nSecond line']];assert.deepEqual(parseCsv(toCsv(rows)),rows);
});
test('exports neutralize spreadsheet formulas without losing phone numbers',()=>{assert.equal(toCsv([['=HYPERLINK("x")','+2348030000000']]),'"\'=HYPERLINK(""x"")","\'+2348030000000"');});
test('historical imports validate dates and normalize legacy marriage name',()=>{
  const rows=importRecords('kind,subject_name,event_date,spouse_1_name,spouse_2_name\nmarriage,Test Couple,2024-02-29,Ada,John','p');assert.equal(rows[0].kind,'matrimony');assert.equal(rows[0].details.spouse_2_name,'John');
  assert.throws(()=>importRecords('kind,subject_name,event_date\nbaptism,Test Name,2023-02-29','p'),/check sacrament/);
  assert.equal(validDate('2024-02-30'),false);
});
test('imports reject malformed columns and unfinished quoted rows',()=>{
  assert.throws(()=>parseCsv('name\n"unfinished'),/unfinished/);
  assert.throws(()=>importRecords('kind,subject_name,event_date,unknown\nbaptism,Test,2024-01-01,x','p'),/Unknown column/);
  assert.throws(()=>importRecords('kind,subject_name,event_date\nbaptism,Test','p'),/wrong number/);
});
test('duplicates match normalized name/date or register number within parish and volume',()=>{
  const r={parish_id:'p',kind:'baptism',subject_name:'Ada  TEST',event_date:'2024-01-01',register_number:'1',register_volume:'A'};
  assert.equal(matchesDuplicate(r,{...r,subject_name:' ada test ',register_number:'2'}),true);
  assert.equal(matchesDuplicate(r,{...r,subject_name:'Other',event_date:'2024-01-02'}),true);
  assert.equal(matchesDuplicate(r,{...r,parish_id:'other'}),false);
  assert.equal(matchesDuplicate(r,{...r,subject_name:'Other',register_volume:'B'}),false);
});
test('combined search includes sponsors and respects date, parish, status and kind',()=>{
  const records=[{parish_id:'p',kind:'baptism',subject_name:'Ada',event_date:'2024-01-01',status:'approved',details:{sponsors:'John'}},{parish_id:'q',kind:'confirmation',subject_name:'Ada',event_date:'2025-01-01',status:'pending',details:{sponsors:'John'}}];
  assert.equal(filterRecords(records,{search:'john',parish:'p',from:'2023-01-01',to:'2024-12-31',status:'approved',kind:'baptism'}).length,1);
});
