export const fields = {
  baptism: [['birth_date','Date of birth','date'],['birth_place','Place of birth'],['baptism_place','Place of baptism']],
  communion: [['birth_date','Date of birth','date'],['baptism_date','Date of baptism','date'],['baptism_parish','Parish of baptism'],['communion_place','Place of First Communion']],
  confirmation: [['birth_date','Date of birth','date'],['baptism_date','Date of baptism','date'],['baptism_parish','Parish of baptism'],['confirmation_name','Confirmation name'],['confirmation_place','Place of confirmation']],
  matrimony: [['spouse_1_name','Spouse 1 full name'],['spouse_2_name','Spouse 2 full name'],['spouse_1_birth_date','Spouse 1 date of birth','date'],['spouse_2_birth_date','Spouse 2 date of birth','date'],['spouse_1_baptism_parish','Spouse 1 baptism parish'],['spouse_2_baptism_parish','Spouse 2 baptism parish'],['spouse_1_parents','Spouse 1 parents'],['spouse_2_parents','Spouse 2 parents'],['sponsor_1_name','Sponsor 1 full name'],['sponsor_2_name','Sponsor 2 full name'],['marriage_place','Place of marriage']]
};
export const kindOf = kind => kind === 'marriage' ? 'matrimony' : kind;
export const normalize = value => String(value || '').trim().replace(/\s+/g,' ').toLowerCase();
export function matchesDuplicate(a,b) {
  return a.parish_id === b.parish_id && kindOf(a.kind) === kindOf(b.kind) &&
    ((normalize(a.subject_name) === normalize(b.subject_name) && a.event_date === b.event_date) ||
    (normalize(a.register_number) && normalize(a.register_number) === normalize(b.register_number) && normalize(a.register_volume) === normalize(b.register_volume)));
}
export function filterRecords(records, filters, parishes = []) {
  const names = new Map(parishes.map(p=>[p.id,p.name]));
  const q = normalize(filters.search);
  return records.filter(r => (!filters.kind || kindOf(r.kind) === filters.kind) && (!filters.status || r.status === filters.status) &&
    (!filters.parish || r.parish_id === filters.parish) && (!filters.from || r.event_date >= filters.from) && (!filters.to || r.event_date <= filters.to) &&
    (!q || normalize([r.subject_name,r.register_number,names.get(r.parish_id),...Object.values(r.details || {}).filter(v=>typeof v==='string')].join(' ')).includes(q)));
}
export function csvCell(value) { const text=String(value ?? ''); return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"'; }
export const toCsv = rows => rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
export function parseCsv(text) {
  text=text.replace(/^\uFEFF/,''); const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) { const ch=text[i];
    if(ch==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;} else if(quoted){quoted=false;} else if(cell===''){quoted=true;} else throw Error('Unexpected quote in CSV.'); }
    else if(ch===',' && !quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r') && !quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(quoted)throw Error('CSV has an unfinished quoted field.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export const importHeaders = ['kind','subject_name','event_date','register_number','register_volume','parents','sponsors','officiating_clergy','notes','person_id',...new Set(Object.values(fields).flat().map(f=>f[0])),'spouse_1_phone','spouse_2_phone','sponsor_1_phone','sponsor_2_phone'];
export function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
export function importRecords(text, parishId) {
  const [header,...rows]=parseCsv(text);if(!header || !rows.length)throw Error('The CSV has no records.');
  const keys=header.map(normalize);if(new Set(keys).size!==keys.length)throw Error('Duplicate column names.');
  for(const key of ['kind','subject_name','event_date'])if(!keys.includes(key))throw Error('Missing column: '+key);
  for(const key of keys)if(!importHeaders.includes(key))throw Error('Unknown column: '+key);
  if(rows.length>200)throw Error('Import up to 200 records at a time.');
  return rows.map((row,index)=>{if(row.length!==keys.length)throw Error(`Row ${index+2}: wrong number of columns.`);
    const data=Object.fromEntries(keys.map((key,i)=>[key,row[i].trim()]));data.kind=kindOf(data.kind.toLowerCase());
    if(!fields[data.kind]||data.subject_name.length<2||!validDate(data.event_date))throw Error(`Row ${index+2}: check sacrament, name, and date (YYYY-MM-DD).`);
    const details=Object.fromEntries(Object.entries(data).filter(([key,value])=>!['kind','subject_name','event_date','register_number','register_volume'].includes(key)&&value));
    for(const [key,,type] of fields[data.kind])if(type==='date'&&details[key]&&!validDate(details[key]))throw Error(`Row ${index+2}: invalid ${key}.`);
    if(data.kind==='matrimony'&&(!details.spouse_1_name||!details.spouse_2_name))throw Error(`Row ${index+2}: enter both spouse names.`);
    if(details.person_id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.person_id))throw Error(`Row ${index+2}: invalid person_id.`);
    return {kind:data.kind,subject_name:data.subject_name,event_date:data.event_date,register_number:data.register_number||'',register_volume:data.register_volume||'',parish_id:parishId,details};
  });
}
