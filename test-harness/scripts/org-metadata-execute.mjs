/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Org metadata only. No issues, workflows, rules, provider settings or deletes.
// API reference: developer.atlassian.com/cloud/jira/platform/rest/v3/
import { readFileSync, existsSync, mkdirSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync, fsyncSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const HOSTS = ['apex-coresystems','beacon-logistics','factory-liberation','krypton-cybersec','solace-ai-labs','strata-datalabs','wolfaenpak','leanzero-apps-demo'].map(x => `${x}.atlassian.net`);
const MARK = 'lz-org-expanded-20260910';
const NS = 'com.atlassian.jira.plugin.system.customfieldtypes';
const TYPES = { paragraph:['textarea','textsearcher'], 'short-text':['textfield','textsearcher'], number:['float','exactnumber'], date:['datepicker','daterange'], 'single-select':['select','multiselectsearcher'], 'single-user':['userpicker','userpickergroupsearcher'] };
const fail = message => { throw new Error(message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function selection(plan, site, project) {
  if (plan.schemaVersion !== 3 || plan.sites.length !== 8 || new Set(plan.sites.map(s=>s.site)).size !== 8 || plan.sites.some(s=>!HOSTS.includes(s.site))) fail('Manifest host/schema boundary mismatch');
  if (site && !HOSTS.includes(site)) fail('Site is outside approved allowlist');
  const rows = plan.sites.filter(s=>!site || s.site===site).map(s=>({...s, projects:s.projects.filter(p=>!project || p.key===project)})).filter(s=>s.projects.length);
  if (!rows.length) fail('No matching approved projects');
  for (const s of rows) for (const p of s.projects) {
    if (!/^[A-Z][A-Z0-9]{1,19}$/.test(p.key) || !p.name || !p.workflows.length) fail('Invalid project');
    if (new Set(p.customFields.map(f=>f.name)).size !== p.customFields.length) fail('Duplicate field');
    for (const f of p.customFields) if (!TYPES[f.type] || !f.name.startsWith(p.key+' ') || (f.type==='single-select' && (!f.options?.length || new Set(f.options).size!==f.options.length))) fail('Invalid scoped field specification');
    for (const n of new Set(p.workflows.flatMap(w=>w.issueTypes))) if (!s.issueTypeCatalogue.some(t=>t.name===n)) fail(`Unknown type ${n}`);
  }
  return rows;
}
export function fieldPayload(f) { const [type,searcher]=TYPES[f.type]; return {name:f.name,description:`${MARK}: ${f.name}`,type:`${NS}:${type}`,searcherKey:`${NS}:${searcher}`}; }
export function atomicSave(path, value) {
  mkdirSync(dirname(path),{recursive:true}); const temp=path+'.tmp'; const fd=openSync(temp,'w',0o600);
  try { writeFileSync(fd,JSON.stringify(value,null,2)+'\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp,path); const dir=openSync(dirname(path),'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function makeClient(site, mode, auth, fetcher=fetch) {
  if (!HOSTS.includes(site)) fail('Forbidden host');
  return async (path, method='GET', body) => {
    if (!path.startsWith('/rest/api/3/') || path.includes('..') || path.includes('://') || path.includes('#')) fail('Forbidden API path');
    if (method!=='GET' && mode!=='apply') fail('Read-only mode prohibits mutation');
    if (!['GET','POST','PUT'].includes(method)) fail('Unsupported method');
    for(let attempt=0;attempt<5;attempt++) {
      let r;
      try { r=await fetcher(`https://${site}${path}`,{method,redirect:'error',headers:{Authorization:`Basic ${auth}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)}); }
      catch { if(method==='GET' && attempt<4){await new Promise(r=>setTimeout(r,1000*2**attempt));continue;} fail(`${method} ${path}: transport uncertain; reconcile receipt before retry`); }
      if (method==='GET' && (r.status===429 || r.status>=500) && attempt<4) { await new Promise(done=>setTimeout(done,Math.min(30000,Math.max(1000*2**attempt,Number(r.headers.get('retry-after')||0)*1000)))); continue; }
      if(!r.ok) { const e=new Error(`${method} ${path}: HTTP ${r.status}; no mutation replay`);e.status=r.status;throw e; }
      const text=await r.text();return text?JSON.parse(text):null;
    }
  };
}
async function pages(api,path) {
  const rows=[];for(let startAt=0;;){const p=await api(`${path}${path.includes('?')?'&':'?'}startAt=${startAt}&maxResults=100`); if(Array.isArray(p)) return p;
    if(!Array.isArray(p.values)) fail(`Unexpected pagination at ${path}`);rows.push(...p.values);
    if(p.isLast===true || (Number.isFinite(p.total)&&rows.length>=p.total)) return rows;
    if(!p.values.length) fail(`Incomplete pagination at ${path}`);startAt+=p.values.length;
  }
}
function one(rows,name) { const a=rows.filter(r=>r.name===name);if(a.length>1)fail(`Ambiguous duplicate: ${name}`);return a[0]; }
function legacyProject(root,site,key) {
  const p=resolve(root,'org-showcase-20260910',site.replace('.atlassian.net','')+'.json');
  if(existsSync(p)){const x=JSON.parse(readFileSync(p));if(x.site===site.replace('.atlassian.net','')&&x.key===key&&x.marker==='leanzero-org-showcase-20260910'&&x.issues?.length===12&&x.issues.every(i=>i.id&&i.key)) return {...x.project,marker:x.marker};}
  const q=resolve(root,'demo-portfolio-v1/receipt.json');
  if(site==='leanzero-apps-demo.atlassian.net'&&existsSync(q)){const x=JSON.parse(readFileSync(q));const y=x.projects?.[key];if(x.base===`https://${site}`&&x.marker==='lz-demo-portfolio-v1'&&y?.checkedAt)return {...y.project,marker:x.marker};}
  return null;
}
async function executeSite(s,opts) {
  const path=resolve(opts.output,s.site+'.json');const state=existsSync(path)?JSON.parse(readFileSync(path)): {site:s.site,marker:MARK,manifestHash:opts.manifestHash,objects:{},pending:{},projects:{}};
  if(state.site!==s.site||state.marker!==MARK||state.manifestHash!==opts.manifestHash)fail('Receipt identity/manifest mismatch');
  const save=()=>atomicSave(path,state);const api=makeClient(s.site,opts.mode,opts.auth);
  const me=await api('/rest/api/3/myself');const perms=await api('/rest/api/3/mypermissions?permissions=ADMINISTER,CREATE_PROJECT');
  if(!me.active||!perms.permissions?.ADMINISTER?.havePermission||!perms.permissions?.CREATE_PROJECT?.havePermission)fail('Positive admin preflight failed');
  // Every create is durably pending before POST; unknown outcome can only be reconciled by a matching owned object.
  async function ensure(id,body,list,endpoint,check=(x)=>x.description===body.description) {
    const candidates=await list();let found=one(candidates,body.name);const remembered=state.objects[id];
    if(found){if(!check(found)||(remembered&&String(remembered.id)!==String(found.id)))fail(`Ownership/shape mismatch ${id}`);}
    else {
      if(remembered||state.pending[id])fail(`Missing or uncertain ${id}; manual reconciliation required, no POST retry`);
      if(opts.mode!=='apply')fail(`Missing ${id}`);
      state.pending[id]={bodyHash:hash(body),at:new Date().toISOString()};save();
      const created=await api(endpoint,'POST',body);
      if(!created?.id)fail(`No identity returned ${id}`);
      state.objects[id]={id:String(created.id),bodyHash:hash(body)};save();
      found=one(await list(),body.name);if(!found||String(found.id)!==String(created.id)||!check(found))fail(`Create readback failed ${id}`);
    }
    if(state.pending[id] && state.pending[id].bodyHash!==hash(body))fail(`Pending payload changed ${id}`);
    state.objects[id]={id:String(found.id),bodyHash:hash(body)};delete state.pending[id];save();return found;
  }
  async function mutation(id,method,path,body,ready) {
    if(await ready()){delete state.pending[id];save();return;}
    if(state.pending[id])fail(`Uncertain ${id}; inspect before retry`);
    if(opts.mode!=='apply')fail(`Unfulfilled ${id}`);
    state.pending[id]={bodyHash:hash(body),at:new Date().toISOString()};save();await api(path,method,body);
    if(!await ready())fail(`Readback failed ${id}`);delete state.pending[id];save();
  }
  const allTypes=()=>api('/rest/api/3/issuetype');
  for(const p of s.projects){
    const old=legacyProject(opts.receiptsRoot,s.site,p.key);let project;
    if(old){project=await api(`/rest/api/3/project/${old.id}`);if(project.key!==p.key||!project.description?.includes(old.marker)||project.simplified)fail(`Legacy project identity mismatch ${p.key}`);}
    else {
      const body={key:p.key,name:p.name,description:`${MARK}: ${s.theme}. Synthetic showcase.`,projectTypeKey:'software',projectTemplateKey:'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',leadAccountId:me.accountId,assigneeType:'UNASSIGNED'};
      // A global admin plus key-validator positive control is mandatory before a create.
      const list=async()=>{try{return [await api(`/rest/api/3/project/${p.key}`)];}catch(e){if(e.status!==404)throw e;const v=await api(`/rest/api/3/projectvalidate/key?key=${p.key}`);if(v.errorMessages?.length||Object.keys(v.errors||{}).length)fail('Key validation failed');return [];}};
      project=await ensure(`${p.key}/project`,body,list,'/rest/api/3/project',x=>x.key===p.key&&x.name===p.name&&x.description===body.description&&!x.simplified);
    }
    const pid=String(project.id);
    state.baselines ||= {};
    if(!state.baselines[p.key]){
      const typeAssociations=await pages(api,`/rest/api/3/issuetypescheme/project?projectId=${pid}`);
      const screenAssociations=await pages(api,`/rest/api/3/issuetypescreenscheme/project?projectId=${pid}`);
      if(typeAssociations.length!==1||screenAssociations.length!==1)fail('Cannot establish original scheme baseline');
      const originalFields=new Set();
      const mappings=await pages(api,`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${screenAssociations[0].issueTypeScreenScheme.id}`);
      for(const schemeId of new Set(mappings.map(m=>m.screenSchemeId))){
        const schemes=await pages(api,`/rest/api/3/screenscheme?id=${schemeId}`);
        if(schemes.length!==1)fail('Cannot read original screen scheme');
        for(const screenId of new Set(Object.values(schemes[0].screens))){
          for(const tab of await api(`/rest/api/3/screens/${screenId}/tabs`))for(const f of await api(`/rest/api/3/screens/${screenId}/tabs/${tab.id}/fields`))originalFields.add(f.id);
        }
      }
      state.baselines[p.key]={typeAssociations,screenAssociations,screenFields:[...originalFields],capturedAt:new Date().toISOString()};save();
    }
    const ids={};const wanted=[...new Set(p.workflows.flatMap(w=>w.issueTypes))];
    for(const name of wanted){const spec=s.issueTypeCatalogue.find(t=>t.name===name);let type;
      if(spec.hierarchy==='existing-standard'){type=one((await allTypes()).filter(t=>!t.scope),name);if(!type||Boolean(type.subtask)!==(name==='Sub-task'))fail(`Missing global standard type ${name}`);}
      else {const body={name,description:`${MARK}: ${s.theme} / ${name}`,type:spec.hierarchyLevel===-1?'subtask':'standard'};type=await ensure(`type/${name}`,body,allTypes,'/rest/api/3/issuetype',x=>x.description===body.description&&!x.scope&&Boolean(x.subtask)===(body.type==='subtask'));}
      ids[name]=String(type.id);
    }
    const schemeBody={name:`${p.key} Showcase Issue Types`,description:`${MARK}: ${p.key}`,defaultIssueTypeId:ids.Task,issueTypeIds:Object.values(ids)};
    if(!schemeBody.defaultIssueTypeId)fail('Task default missing');
    const scheme=await ensure(`${p.key}/typescheme`,schemeBody,()=>pages(api,'/rest/api/3/issuetypescheme'),'/rest/api/3/issuetypescheme');
    const mappings=await pages(api,`/rest/api/3/issuetypescheme/mapping?issueTypeSchemeId=${scheme.id}`);
    if(!isDeepStrictEqual(mappings.map(x=>String(x.issueTypeId)).sort(),Object.values(ids).sort()))fail('Issue type scheme content differs');
    await mutation(`${p.key}/typeassociation`,'PUT','/rest/api/3/issuetypescheme/project',{issueTypeSchemeId:String(scheme.id),projectId:pid},async()=>{const rows=await pages(api,`/rest/api/3/issuetypescheme/project?projectId=${pid}`);return rows.length===1&&String(rows[0].issueTypeScheme.id)===String(scheme.id);});
    const fields={};
    for(const f of p.customFields){
      const body=fieldPayload(f);const field=await ensure(`${p.key}/field/${f.name}`,body,()=>pages(api,'/rest/api/3/field/search?type=custom'),'/rest/api/3/field',x=>x.description===body.description&&x.schema?.custom===body.type);
      const prefix=`/rest/api/3/field/${field.id}`;let contexts=await pages(api,prefix+'/context');
      if(contexts.length!==1)fail(`Expected exactly one owned field context ${f.name}`);const ctx=contexts[0];
      // Newly-created Jira fields start with one global context; narrow only this owned field.
      const scoped=async()=>{const cs=await pages(api,prefix+'/context');const map=await pages(api,prefix+'/context/projectmapping');return cs.length===1&&!cs[0].isGlobalContext&&map.length===1&&String(map[0].contextId)===String(ctx.id)&&String(map[0].projectId)===pid;};
      if(ctx.isGlobalContext)await mutation(`${field.id}/scope`,'PUT',`${prefix}/context/${ctx.id}/project`,{projectIds:[pid]},scoped);
      if(!await scoped())fail(`Field project context mismatch ${f.name}`);
      let options=[];
      if(f.options){const op=`${prefix}/context/${ctx.id}/option`;options=await pages(api,op);
        if(options.some(o=>!f.options.includes(o.value)||o.disabled||o.optionId)||new Set(options.map(o=>o.value)).size!==options.length)fail(`Unexpected options ${f.name}`);
        const missing=f.options.filter(v=>!options.some(o=>o.value===v));
        if(missing.length)await mutation(`${field.id}/options`,'POST',op,{options:missing.map(value=>({value,disabled:false}))},async()=>{const xs=await pages(api,op);return isDeepStrictEqual(xs.map(x=>[x.value,!!x.disabled]).sort(),f.options.map(v=>[v,false]).sort());});
        options=await pages(api,op);
      }
      fields[f.name]={id:field.id,name:f.name,schema:field.schema,projectKeys:[p.key],contextId:String(ctx.id),type:f.type,options:Object.fromEntries(options.map(o=>[o.value,String(o.id)]))};
    }
    const screen=await ensure(`${p.key}/screen`,{name:`${p.key} Showcase Screen`,description:`${MARK}: ${p.key}`},()=>pages(api,'/rest/api/3/screens'),'/rest/api/3/screens');
    const tab=await ensure(`${p.key}/tab`,{name:'Showcase'},()=>api(`/rest/api/3/screens/${screen.id}/tabs`),`/rest/api/3/screens/${screen.id}/tabs`,()=>true);
    const screenFields=[...new Set([...state.baselines[p.key].screenFields,'summary','description','issuetype','priority','assignee','reporter','labels','duedate','components','fixVersions','timetracking','parent',...Object.values(fields).map(f=>f.id)])];
    for(const fieldId of screenFields)await mutation(`${screen.id}/field/${fieldId}`,'POST',`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`,{fieldId},async()=> (await api(`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`)).some(f=>f.id===fieldId));
    const ss=await ensure(`${p.key}/screenscheme`,{name:`${p.key} Showcase Screen Scheme`,description:`${MARK}: ${p.key}`,screens:{default:String(screen.id)}},()=>pages(api,'/rest/api/3/screenscheme'),'/rest/api/3/screenscheme',x=>x.description===`${MARK}: ${p.key}`&&String(x.screens?.default)===String(screen.id));
    const itss=await ensure(`${p.key}/typescreenscheme`,{name:`${p.key} Showcase Type Screen Scheme`,description:`${MARK}: ${p.key}`,issueTypeMappings:[{issueTypeId:'default',screenSchemeId:String(ss.id)}]},()=>pages(api,'/rest/api/3/issuetypescreenscheme'),'/rest/api/3/issuetypescreenscheme');
    const sm=await pages(api,`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${itss.id}`);
    if(sm.length!==1||sm[0].issueTypeId!=='default'||String(sm[0].screenSchemeId)!==String(ss.id))fail('Type screen mapping differs');
    await mutation(`${p.key}/screenassociation`,'PUT','/rest/api/3/issuetypescreenscheme/project',{issueTypeScreenSchemeId:String(itss.id),projectId:pid},async()=>{const rows=await pages(api,`/rest/api/3/issuetypescreenscheme/project?projectId=${pid}`);return rows.length===1&&String(rows[0].issueTypeScreenScheme.id)===String(itss.id);});
    state.projects[p.key]={id:pid,key:p.key,issueTypes:Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,{id,subtask:name==='Sub-task'||s.issueTypeCatalogue.find(t=>t.name===name)?.hierarchyLevel===-1}])),fields,issueTypeSchemeId:String(scheme.id),screenId:String(screen.id),screenSchemeId:String(ss.id),issueTypeScreenSchemeId:String(itss.id),checkedAt:new Date().toISOString()};save();
    console.log(JSON.stringify({site:s.site,project:p.key,fields:Object.keys(fields).length,issueTypes:wanted.length,mode:opts.mode}));
  }
}
export async function main(args=process.argv.slice(2)) {
  const mode=args.shift();if(!['plan','inspect','apply','verify'].includes(mode))fail('Use plan|inspect|apply|verify [--site exacthost] [--project KEY] --receipts-root PATH --env-module PATH --output PATH');
  const flags={};while(args.length){const k=args.shift();if(!['--site','--project','--receipts-root','--env-module','--output','--manifest'].includes(k)||!args.length||Object.hasOwn(flags,k))fail('Unknown or repeated argument');flags[k]=args.shift();}
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');const manifest=resolve(flags['--manifest']||resolve(root,'docs/org-expanded-approval-plan.json'));const plan=JSON.parse(readFileSync(manifest));const selected=selection(plan,flags['--site'],flags['--project']);
  if(mode==='plan'){console.log(JSON.stringify({mode,manifestHash:hash(plan),sites:selected.map(s=>({site:s.site,projects:s.projects.map(p=>({key:p.key,name:p.name,issueTypes:[...new Set(p.workflows.flatMap(w=>w.issueTypes))],fields:p.customFields.map(fieldPayload)}))}))},null,2));return;}
  const receiptsRoot=resolve(flags['--receipts-root']||resolve(root,'test-harness/results'));const output=resolve(flags['--output']||resolve(receiptsRoot,'org-metadata-v1'));mkdirSync(output,{recursive:true});
  const lock=resolve(output,'writer.lock');const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,JSON.stringify({pid:process.pid,mode,at:new Date().toISOString()}));closeSync(fd);
    const env=await import(pathToFileURL(resolve(flags['--env-module']||resolve(root,'test-harness/lib/env.mjs'))));const auth=Buffer.from(`${env.requireEnv('JIRA_ADMIN_EMAIL')}:${env.requireEnv('JIRA_API_TOKEN')}`).toString('base64');
    if(mode==='inspect'){for(const s of selected){const api=makeClient(s.site,mode,auth);const permission=await api('/rest/api/3/mypermissions?permissions=ADMINISTER,CREATE_PROJECT');const projects=await pages(api,'/rest/api/3/project/search');const fields=await pages(api,'/rest/api/3/field/search?type=custom');console.log(JSON.stringify({site:s.site,admin:!!permission.permissions?.ADMINISTER?.havePermission,projects:selected.find(x=>x.site===s.site).projects.map(p=>({key:p.key,exists:projects.some(x=>x.key===p.key),ownedReceipt:!!legacyProject(receiptsRoot,s.site,p.key)})),existingCustomFields:fields.length}));}return;}
    for(const s of selected)await executeSite(s,{mode,auth,output,receiptsRoot,manifestHash:hash(plan)});
  }finally{unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
