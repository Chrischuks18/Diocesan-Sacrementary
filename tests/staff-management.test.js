import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffManagement} from '../src/staff-management.js';
test('parish and diocesan accounts cannot load Staff Management',async()=>{
  for(const role of ['priest','secretary','diocese']){let called=false;const page=createStaffManagement({db:{rpc(){called=true;}},shell(){called=true;},state:()=>({profile:{role}})});await page();assert.equal(called,false);}
});
test('administrator permission errors appear without exposing stale staff data',async()=>{
  let body='';const node={innerHTML:''};globalThis.document={querySelector(){return node;}};
  try{const page=createStaffManagement({db:{rpc:async()=>({data:null,error:{message:'Administrator access required'}})},shell:text=>body=text,esc:v=>v,label:v=>v,state:()=>({profile:{role:'admin'},view:'staff',parishes:[]})});await page();assert.ok(body.includes('Staff Management'));assert.ok(node.innerHTML.includes('Administrator access required'));}finally{delete globalThis.document;}
});
