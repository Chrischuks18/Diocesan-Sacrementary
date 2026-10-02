export function createStaffManagement({db,shell,esc,label,state}) {
  let generation=0;
  return async function staffManagement() {
    if(state().profile?.role!=='admin')return;
    const request=++generation;
    shell('<header class="page-head"><div><p class="eyebrow">SERVER ADMINISTRATION</p><h1>Staff Management</h1><p>Transfer staff or activate and deactivate existing accounts. Sacramental records remain in their original parish.</p></div></header><section class="panel entry-form" id="staff-content">Loading staff…</section>');
    const {data:staff,error}=await db.rpc('list_managed_staff');
    if(request!==generation||state().view!=='staff'||state().profile?.role!=='admin')return;
    const content=document.querySelector('#staff-content');
    if(error){content.innerHTML=`<p class="error">${esc(error.message)}</p>`;return;}
    const parishes=state().parishes;
    const parishName=id=>parishes.find(p=>p.id===id)?.name||'Central office';
    content.innerHTML=`<label>Staff account<select id="staff-user"><option value="">Select an existing account</option>${staff.filter(s=>s.role!=='admin').map(s=>`<option value="${s.user_id}">${esc(s.full_name)} · ${esc(s.email)} · ${s.active?'Active':'Inactive'}</option>`).join('')}</select></label><div id="assignment"></div><p class="hint">New staff invitations and administrator accounts are provisioned by the database owner. Staff keep their own login when transferred.</p>`;
    document.querySelector('#staff-user').onchange=e=>{
      const user=staff.find(s=>s.user_id===e.target.value),target=document.querySelector('#assignment');
      if(!user){target.innerHTML='';return;}
      target.innerHTML=`<p><strong>${esc(user.full_name)}</strong><br>${esc(user.email)}<br>Current assignment: ${esc(label(user.role))} · ${esc(parishName(user.parish_id))} · ${user.active?'Active':'Inactive'}</p><form id="assignment-form"><div class="form-grid"><label>Role<select name="role">${['priest','secretary','diocese'].map(r=>`<option value="${r}" ${r===user.role?'selected':''}>${label(r)}</option>`).join('')}</select></label><label>Parish<select name="parish"><option value="">Select parish</option>${parishes.map(p=>`<option value="${p.id}" ${p.id===user.parish_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Account status<select name="active"><option value="true" ${user.active?'selected':''}>Active</option><option value="false" ${!user.active?'selected':''}>Inactive</option></select></label><label>Posting effective date<input name="effective" type="date" value="${new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'})}" required></label></div><label>Reason<textarea name="reason" minlength="4" maxlength="1000" required placeholder="Posting or account-change details"></textarea></label><p>Changes apply immediately. Use this page when the posting takes effect. Deactivation blocks registry access. The incoming priest gains access to pending entries when assigned to the parish.</p><div class="actions"><button class="primary" type="submit">Review assignment change</button><span class="error" role="alert" id="assignment-error"></span></div></form>`;
      const form=document.querySelector('#assignment-form');
      const update=()=>{const parish=form.elements.parish;parish.disabled=form.elements.role.value==='diocese';parish.required=!parish.disabled;};form.elements.role.onchange=update;update();
      form.onsubmit=async event=>{
        event.preventDefault();const fd=new FormData(form),role=fd.get('role'),parish=role==='diocese'?null:fd.get('parish'),active=fd.get('active')==='true';
        const summary=`${user.full_name} (${user.email})\nFrom: ${label(user.role)}, ${parishName(user.parish_id)}, ${user.active?'active':'inactive'}\nTo: ${label(role)}, ${parishName(parish)}, ${active?'active':'inactive'}\nApplies immediately. Confirm this authorized staff assignment?`;
        if(!confirm(summary))return;
        const button=form.querySelector('[type="submit"]');button.disabled=true;
        const {error}=await db.rpc('manage_staff_assignment',{p_user_id:user.user_id,p_role:role,p_parish_id:parish,p_active:active,p_reason:fd.get('reason').trim(),p_effective_date:fd.get('effective'),p_expected_role:user.role,p_expected_parish_id:user.parish_id,p_expected_active:user.active});
        if(error){document.querySelector('#assignment-error').textContent=error.message;button.disabled=false;return;}
        user.role=role;user.parish_id=parish;user.active=active;target.innerHTML='<div class="notice">Assignment updated. The staff member should sign out and sign in again to refresh the displayed parish. Records and approval history remain unchanged.</div>';
      };
    };
  };
}
