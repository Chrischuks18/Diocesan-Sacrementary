import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistryUI} from '../src/registry-ui.js';
import {fields} from '../src/registry-tools.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(role='priest',status='approved') {
  const nodes=new Map(),inputs=[],calls=[];let html='',printed='';
  const state={profile:{role,user_id:'u',parish_id:'p'},parishes:[{id:'p',name:'Test parish'}],records:[],parish:{name:'Test parish'},current:{id:'r',parish_id:'p',kind:'baptism',subject_name:'Test <Name>',event_date:'2024-01-01',status,approved_at:'2024-01-02',details:{}},view:'detail'};
  const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',disabled:false,addEventListener(type,fn){this['on'+type]=fn;},querySelector(){return node('submit-button');}});return nodes.get(key);};
  const entry=node('entry');entry.elements={kind:node('kind'),person_link:node('person_link')};entry.elements.kind.value='baptism';
  Object.defineProperty(node('specific'),'innerHTML',{set(value){inputs.length=0;for(const match of value.matchAll(/<input name="([^"]+)"[^>]*value="([^"]*)"/g)){const input=node(match[1]);input.name=match[1];input.value=match[2];entry.elements[match[1]]=input;inputs.push(input);}}});
  globalThis.document={querySelector(selector){return node(selector.slice(1));},getElementById:node,querySelectorAll(selector){return selector==='#specific input'?inputs:[];},createElement(tag){if(tag==='iframe')return {style:{},set srcdoc(value){printed=value;}};return {click(){}};},body:{append(){}}};
  node('print-frame').remove=()=>{};
  const originalFormData=globalThis.FormData;
  globalThis.FormData=class {constructor(){this.data={kind:entry.elements.kind.value,subject_name:'Test Name',event_date:'2024-01-01',register_number:'1',register_volume:'A',...Object.fromEntries([...nodes].filter(([,v])=>v.name).map(([k,v])=>[k,v.value]))};}get(key){return this.data[key]||'';}};
  const db={async rpc(name,args){calls.push({name,args});return {data:name==='find_record_duplicates'?[]:'r',error:null};},from(){return {select(){return this;},eq(){return this;},single(){return Promise.resolve({data:state.current,error:null});},order(){return Promise.resolve({data:[],error:null});}};}};
  const ui=createRegistryUI({db,state:()=>state,shell:body=>{html=body;},esc:escape,label:v=>String(v).replace(/^./,c=>c.toUpperCase()),date:v=>v,logo:'data:image/jpeg;base64,test',phoneFields:[['spouse_1_phone','Spouse 1 phone'],['spouse_2_phone','Spouse 2 phone'],['sponsor_1_phone','Sponsor 1 phone'],['sponsor_2_phone','Sponsor 2 phone']],canEnter:()=>['priest','secretary'].includes(state.profile.role),navigate(){},refresh:async()=>{},flash(){}});
  return {ui,state,entry,node,calls,get html(){return html;},get printed(){return printed;},cleanup(){globalThis.FormData=originalFormData;delete globalThis.document;}};
}
test('each sacrament form selects its own fields and sends them in saved details',async()=>{
  const h=harness();try{h.ui.form();for(const kind of Object.keys(fields)){h.entry.elements.kind.value=kind;h.entry.elements.kind.onchange();for(const [key] of fields[kind])assert.ok(h.entry.elements[key],key);}
    h.entry.elements.spouse_1_name.value='Ada';h.entry.elements.spouse_2_name.value='John';h.entry.elements.spouse_1_phone.value='+2348000000000';
    await h.entry.onsubmit({preventDefault(){}});assert.equal(h.calls[0].name,'find_record_duplicates');assert.equal(h.calls[1].args.p_details.spouse_1_phone,'+2348000000000');assert.equal(h.calls[1].args.p_details.spouse_2_name,'John');assert.equal(h.calls[1].args.p_id,null);
  }finally{h.cleanup();}
});
test('certificates exclude drafts and diocesan users; approved certificate escapes names',async()=>{
  for(const [role,status,allowed] of [['priest','draft',false],['diocese','approved',false],['secretary','approved',true]]){
    const h=harness(role,status);try{await h.ui.detail();assert.equal(h.html.includes('id="certificate"'),allowed);if(allowed){await h.node('certificate').onclick();assert.ok(h.printed.includes('Test &lt;Name&gt;'));assert.ok(h.printed.includes('Parish priest’s signature'));assert.ok(!h.printed.includes('spouse_1_phone'));}}finally{h.cleanup();}
  }
});
