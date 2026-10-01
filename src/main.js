import { createClient } from '@supabase/supabase-js';
import './style.css';

const root = document.querySelector('#app');
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const arrivingFromInvite = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'invite';
const db = url && key ? createClient(url, key) : null;
const kinds = ['baptism','communion','confirmation','matrimony'];
const marriageKinds = ['matrimony', 'marriage'];
const marriagePhoneFields = [['spouse_1_phone', 'Spouse 1 phone number'], ['spouse_2_phone', 'Spouse 2 phone number'], ['sponsor_1_phone', 'Sponsor 1 phone number'], ['sponsor_2_phone', 'Sponsor 2 phone number']];
const canEnter = () => profile && ['secretary','priest'].includes(profile.role);
let profile = null, parish = null, records = [], current = null, view = arrivingFromInvite ? 'password' : 'list', message = '';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = v => String(v || '').replace(/^./, c => c.toUpperCase());
const date = v => v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}) : '—';
function flash(text) { message = text; render(); }
function shell(body) {
  root.innerHTML = `<div class="app"><aside class="rail"><div class="brand"><span class="mark">✝</span><div>Diocesan<br><strong>Sacrament Registry</strong></div></div><div class="rail-note">${esc(parish?.name || 'Central office')}</div><nav><button class="nav ${view==='list'?'active':''}" id="records">Registers</button>${canEnter()?'<button class="nav" id="new">New entry</button>':''}<button class="nav ${view==='password'?'active':''}" id="password-nav">Set password</button></nav><div class="rail-bottom"><span>${esc(profile?.full_name)}<small>${esc(label(profile?.role))}</small></span><button id="logout" class="text-button">Sign out</button></div></aside><main class="main">${message?`<div class="notice" role="status">${esc(message)}<button id="dismiss" aria-label="Dismiss">×</button></div>`:''}${body}</main></div>`;
  document.querySelector('#records').onclick = () => { current=null; view='list'; render(); };
  document.querySelector('#new')?.addEventListener('click',()=>{ current=null; view='form'; render(); });
  document.querySelector('#password-nav').onclick = () => { view='password'; render(); };
  document.querySelector('#logout').onclick = () => db.auth.signOut();
  document.querySelector('#dismiss')?.addEventListener('click',()=>{message='';render();});
}
function render() {
  if (!db) { root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><span class="mark">✝</span><h1>Diocesan Sacrament Registry</h1><p>Project setup is required. Add the Supabase URL and publishable key to your environment file, then restart the app.</p><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase</a></div></div>`; return; }
  if (!profile) return login();
  if (view==='password') return passwordForm();
  if (view==='form' && canEnter()) return form();
  if (view==='detail' && current) return detail();
  list();
}
function passwordForm() {
  shell(`<header class="page-head"><div><p class="eyebrow">STAFF ACCOUNT</p><h1>Set your password</h1><p>Choose a password to use when you sign in again.</p></div></header><form id="password-form" class="panel entry-form"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" minlength="12" required></label><div class="actions"><button class="primary" type="submit">Save password</button><span id="password-error" class="error" role="alert"></span></div></form>`);
  document.querySelector('#password-form').onsubmit = async e => {
    e.preventDefault(); const fd=new FormData(e.target), password=fd.get('password');
    if(password!==fd.get('confirm')) { document.querySelector('#password-error').textContent='Passwords do not match.'; return; }
    const btn=e.target.querySelector('button[type=submit]'); btn.disabled=true;
    const {error}=await db.auth.updateUser({password});
    if(error) { document.querySelector('#password-error').textContent=error.message; btn.disabled=false; return; }
    view='list'; message='Password saved. You can now sign in with your email and password.'; render();
  };
}
function login() {
  root.innerHTML = `<div class="auth-wrap"><form class="auth-card" id="login"><span class="mark">✝</span><p class="eyebrow">STAFF ACCESS</p><h1>Diocesan Sacrament Registry</h1><p>Sign in with the account assigned to you by the diocesan office.</p><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">Sign in</button><p class="error" id="error" role="alert"></p></form></div>`;
  document.querySelector('#login').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target); const button=e.target.querySelector('button'); button.disabled=true;
    const {error}=await db.auth.signInWithPassword({email:fd.get('email'),password:fd.get('password')});
    if(error){document.querySelector('#error').textContent=error.message;button.disabled=false;}
  };
}
async function load() {
  const {data:{user}}=await db.auth.getUser();
  if(!user){profile=null;render();return;}
  const {data:p,error}=await db.from('staff_profiles').select('*').eq('user_id',user.id).single();
  if(error||!p?.active){profile=null;root.innerHTML=`<div class="auth-wrap"><div class="auth-card"><h1>Access not assigned</h1><p>Ask the diocesan administrator to activate your staff profile.</p><button id="signout" class="primary">Sign out</button></div></div>`;document.querySelector('#signout').onclick=()=>db.auth.signOut();return;}
  profile=p;
  if(p.parish_id){const {data}=await db.from('parishes').select('name').eq('id',p.parish_id).single();parish=data;}else parish=null;
  await refresh();
}
async function refresh() {
  const {data,error}=await db.from('records').select('*').order('created_at',{ascending:false}).limit(500);
  records=data||[]; if(error) message=error.message; render();
}
function list() {
  const pending=records.filter(r=>r.status==='pending').length;
  shell(`<header class="page-head"><div><p class="eyebrow">${profile.role==='diocese'?'DIOCESAN VIEW':'PARISH REGISTER'}</p><h1>Sacramental records</h1><p>${profile.role==='diocese'?'Approved records from all participating parishes.':profile.role==='priest'?`${pending} entr${pending===1?'y':'ies'} awaiting your review. You can also register entries yourself.`:'Prepare entries for your parish priest to review.'}</p></div>${canEnter()?'<button id="add" class="primary">Add entry</button>':''}</header><section class="stats"><div><span>Total visible</span><strong>${records.length}</strong></div><div><span>Awaiting approval</span><strong>${pending}</strong></div><div><span>Approved</span><strong>${records.filter(r=>r.status==='approved').length}</strong></div></section><section class="panel"><div class="panel-head"><h2>Entries</h2><div class="filters"><input id="search" type="search" placeholder="Search name or register no." aria-label="Search entries"><select id="kind" aria-label="Filter sacrament"><option value="">All sacraments</option>${kinds.map(k=>`<option value="${k}">${label(k)}</option>`).join('')}</select></div></div><div id="rows"></div></section>`);
  document.querySelector('#add')?.addEventListener('click',()=>{current=null;view='form';render();});
  const paint=()=>{const q=document.querySelector('#search').value.trim().toLowerCase(), k=document.querySelector('#kind').value;const found=records.filter(r=>(!k||r.kind===k)&&(!q||`${r.subject_name} ${r.register_number||''}`.toLowerCase().includes(q)));document.querySelector('#rows').innerHTML=found.length?`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Sacrament</th><th>Date</th><th>Register no.</th><th>Sponsors</th><th>Parents</th><th>Officiating clergy</th>${marriagePhoneFields.map(([,name])=>`<th>${name}</th>`).join('')}<th>Status</th><th></th></tr></thead><tbody>${found.map(r=>`<tr><td><strong>${esc(r.subject_name)}</strong></td><td>${label(r.kind)}</td><td>${date(r.event_date)}</td><td>${esc(r.register_number||'—')}</td><td>${esc(r.details?.sponsors||'—')}</td><td>${esc(r.details?.parents||'—')}</td><td>${esc(r.details?.officiating_clergy||'—')}</td>${marriagePhoneFields.map(([key])=>`<td>${esc(marriageKinds.includes(r.kind)?r.details?.[key]||'—':'—')}</td>`).join('')}<td><span class="badge ${r.status}">${label(r.status)}</span></td><td><button class="row-link" data-id="${r.id}">View</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No matching entries yet.</div>';document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{current=records.find(r=>r.id===b.dataset.id);view='detail';render();});};
  document.querySelector('#search').oninput=paint;document.querySelector('#kind').onchange=paint;paint();
}
function form() {
  const r=current||{}, d=r.details||{};
  shell(`<button class="back" id="back">← Registers</button><div class="form-head"><p class="eyebrow">PARISH ENTRY</p><h1>${current?'Edit entry':'New sacramental entry'}</h1><p>${profile.role==='priest'?'Save a draft, then submit and approve it after checking the parish register.':'The parish priest will review this entry before it is approved.'}</p></div><form id="entry" class="panel entry-form"><div class="form-grid"><label>Sacrament<select name="kind" required>${kinds.map(k=>`<option value="${k}" ${r.kind===k?'selected':''}>${label(k)}</option>`).join('')}</select></label><label>Name of person / principal party<input name="subject_name" value="${esc(r.subject_name)}" required minlength="2"></label><label>Date of sacrament / event<input name="event_date" type="date" value="${esc(r.event_date)}" required></label><label>Register number<input name="register_number" value="${esc(r.register_number)}"></label><label>Register volume<input name="register_volume" value="${esc(r.register_volume)}"></label><label>Register page<input name="register_page" value="${esc(r.register_page)}"></label><label>Sponsors<input name="sponsors" value="${esc(d.sponsors)}" placeholder="Names of sponsors"></label><label>Parents<input name="parents" value="${esc(d.parents)}" placeholder="Names of parents"></label><label>Officiating clergy<input name="officiating_clergy" value="${esc(d.officiating_clergy)}" placeholder="Name of the officiating priest or clergy"></label></div><section id="marriage-phones" hidden><h2>Couple and sponsors’ phone numbers</h2><p>Enter spouses and sponsors in the same order as their names in the register.</p><div class="form-grid">${marriagePhoneFields.map(([key,name])=>`<label>${name}<input name="${key}" type="tel" maxlength="40" value="${esc(d[key])}" placeholder="e.g. +234 803 123 4567"></label>`).join('')}</div></section><label>Additional register details<textarea name="notes" rows="5" placeholder="For example: spouse, witnesses, place of celebration…">${esc(d.notes)}</textarea></label><p class="hint">Pilot form: the Diocese should approve the precise fields for each register before real records are entered.</p><div class="actions"><button class="primary" type="submit">Save draft</button><span id="form-error" class="error" role="alert"></span></div></form>`);
  document.querySelector('#back').onclick=()=>{view='list';current=null;render();};
  const toggleMarriagePhones=()=>{const show=marriageKinds.includes(document.querySelector('[name="kind"]').value);const section=document.querySelector('#marriage-phones');section.hidden=!show;section.querySelectorAll('input').forEach(input=>input.disabled=!show);};
  document.querySelector('[name="kind"]').onchange=toggleMarriagePhones;toggleMarriagePhones();
  document.querySelector('#entry').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.target);const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
    const {error}=await db.rpc('save_record',{p_id:current?.id||null,p_parish_id:profile.parish_id,p_kind:fd.get('kind'),p_subject_name:fd.get('subject_name'),p_event_date:fd.get('event_date'),p_register_number:fd.get('register_number'),p_register_page:fd.get('register_page'),p_register_volume:fd.get('register_volume'),p_details:{...d,notes:fd.get('notes'),sponsors:fd.get('sponsors').trim(),parents:fd.get('parents').trim(),officiating_clergy:fd.get('officiating_clergy').trim(),...(marriageKinds.includes(fd.get('kind'))?Object.fromEntries(marriagePhoneFields.map(([key])=>[key,String(fd.get(key)||'').trim()])):{})}});
    if(error){document.querySelector('#form-error').textContent=error.message;btn.disabled=false;return;} current=null;view='list';message='Draft saved.';await refresh();};
}
function detail() {
  const r=current,d=r.details||{};
  shell(`<button class="back" id="back">← Registers</button><header class="page-head detail-head"><div><p class="eyebrow">${label(r.kind)} · ${esc(parish?.name||'Diocesan record')}</p><h1>${esc(r.subject_name)}</h1><span class="badge ${r.status}">${label(r.status)}</span></div></header><section class="panel detail-grid"><div><small>Date</small><strong>${date(r.event_date)}</strong></div><div><small>Register number</small><strong>${esc(r.register_number||'—')}</strong></div><div><small>Volume</small><strong>${esc(r.register_volume||'—')}</strong></div><div><small>Page</small><strong>${esc(r.register_page||'—')}</strong></div><div><small>Sponsors</small><strong>${esc(d.sponsors||'—')}</strong></div><div><small>Parents</small><strong>${esc(d.parents||'—')}</strong></div><div><small>Officiating clergy</small><strong>${esc(d.officiating_clergy||'—')}</strong></div>${marriageKinds.includes(r.kind)?marriagePhoneFields.map(([key,name])=>`<div><small>${name}</small><strong>${esc(d[key]||'—')}</strong></div>`).join(''):''}</section><section class="panel notes"><h2>Register details</h2><p>${esc(d.notes||'No additional details supplied.')}</p></section>${r.return_reason?`<section class="notice">Awaiting administrator correction: ${esc(r.return_reason)}</section>`:''}<div class="actions" id="actions">${canEnter()&&['draft','returned'].includes(r.status)?'<button class="primary" id="submit">Submit for approval</button>':''}${profile.role==='priest'&&r.status==='pending'?'<button class="primary" id="approve">Approve entry</button><button class="secondary" id="return">Return for correction</button>':''}</div>`);
  document.querySelector('#back').onclick=()=>{current=null;view='list';render();};
  document.querySelector('#submit')?.addEventListener('click',async()=>{const {error}=await db.rpc('submit_record',{p_id:r.id});if(error)return flash(error.message);current=null;view='list';message='Sent to the parish priest for approval.';await refresh();});
  document.querySelector('#approve')?.addEventListener('click',async()=>{if(!confirm('Approve this entry after checking the parish register?'))return;const {error}=await db.rpc('review_record',{p_id:r.id,p_approve:true});if(error)return flash(error.message);current=null;view='list';message='Entry approved.';await refresh();});
  document.querySelector('#return')?.addEventListener('click',async()=>{const reason=prompt('What needs correction by the server administrator?');if(reason===null)return;if(reason.trim().length<4)return flash('Please provide a clear reason.');const {error}=await db.rpc('review_record',{p_id:r.id,p_approve:false,p_reason:reason.trim()});if(error)return flash(error.message);current=null;view='list';message='Entry returned for correction.';await refresh();});
}
if(db){db.auth.onAuthStateChange((_event,session)=>{if(session)load();else{profile=null;render();}});load();}else render();
