/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Org metadata only. The only DELETE removes campaign-new field associations.
// Global contexts are immutable since April 2026; scope uses isolated field schemes.
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
export function isolationRemovals(record, currentIds, targetId) {
  const current=[...currentIds].map(String).sort();const target=String(targetId);
  if(!record||!Array.isArray(record.initialSchemeIds))fail('No initial association provenance; manual reconciliation required');
  if(record.complete){if(!isDeepStrictEqual(current,[target]))fail('Association drift after completed isolation; preserve external changes');return [];}
  if(current.some(id=>id!==target&&!record.initialSchemeIds.includes(id)))fail('Unexpected association during initialization; preserve external changes');
  return current.filter(id=>id!==target);
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
    if (!['GET','POST','PUT'].includes(method) && !(method==='DELETE'&&path==='/rest/api/3/config/fieldschemes/fields')) fail('Unsupported method');
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
  const createdThisRun=new Set();
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
      state.creationProof ||= {};state.creationProof[id]={absentBeforeCreate:true,bodyHash:hash(body),at:new Date().toISOString()};
      state.pending[id]={bodyHash:hash(body),at:new Date().toISOString()};save();
      const response=await api(endpoint,'POST',body);
      const created={...response,id:response?.id ?? (endpoint==='/rest/api/3/issuetypescheme'?response?.issueTypeSchemeId:undefined) ?? (endpoint==='/rest/api/3/issuetypescreenscheme'?response?.issueTypeScreenSchemeId:undefined)};
      if(!created?.id)fail(`No identity returned ${id}`);createdThisRun.add(id);
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
  // Global types necessarily enter the immutable default scheme. No project may use it.
  const schemes=await pages(api,'/rest/api/3/issuetypescheme?expand=projects');
  const defaultScheme=schemes.filter(x=>x.isDefault);
  if(defaultScheme.length!==1)fail('Cannot identify default issue type scheme');
  const dp=defaultScheme[0].projects;
  if(!dp||dp.isLast!==true||dp.total!==0||dp.values.length!==0)fail('Default issue type scheme has projects or incomplete exposure proof; stop before writes');
  state.defaultTypeSchemeBaseline={id:String(defaultScheme[0].id),projectCount:0,checkedAt:new Date().toISOString()};save();
  // Capability probe before project creation, so unsupported modern field APIs cannot strand setup.
  await pages(api,'/rest/api/3/config/fieldschemes');
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
      const screenMappings=await pages(api,`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${screenAssociations[0].issueTypeScreenScheme.id}`);
      const screenSchemes={},screens={};
      for(const schemeId of new Set(screenMappings.map(m=>m.screenSchemeId))){
        const xs=await pages(api,`/rest/api/3/screenscheme?id=${schemeId}`);
        if(xs.length!==1)fail('Cannot read original screen scheme');screenSchemes[schemeId]=xs[0].screens;
        for(const screenId of new Set(Object.values(xs[0].screens))){
          const tabs=[];for(const tab of await api(`/rest/api/3/screens/${screenId}/tabs`))tabs.push({name:tab.name,fields:(await api(`/rest/api/3/screens/${screenId}/tabs/${tab.id}/fields`)).map(f=>f.id)});
          screens[screenId]={tabs};
        }
      }
      const fa=await pages(api,`/rest/api/3/config/fieldschemes/projects?projectId=${pid}`);
      if(fa.length!==1||String(fa[0].projectId)!==pid)fail('Cannot read original field scheme');
      state.baselines[p.key]={typeAssociations,screenAssociations,screenMappings,screenSchemes,screens,fieldSchemeId:fa[0].schemeId,capturedAt:new Date().toISOString()};save();
    }
    const baseline=state.baselines[p.key];
    const fs=await ensure(`${p.key}/fieldscheme`,{name:`${p.key} Showcase Field Scheme`,description:`${MARK}: ${p.key}`},()=>pages(api,'/rest/api/3/config/fieldschemes'),`/rest/api/3/config/fieldschemes/${baseline.fieldSchemeId}/clone`);
    const fsProjects=()=>pages(api,`/rest/api/3/config/fieldschemes/${fs.id}/projects`);
    if((await fsProjects()).some(x=>String(x.id)!==pid))fail('Owned field scheme is shared outside project');
    await mutation(`${p.key}/fieldschemeassociation`,'PUT','/rest/api/3/config/fieldschemes/projects',{[fs.id]:{projectIds:[Number(pid)]}},async()=>{const x=await pages(api,`/rest/api/3/config/fieldschemes/projects?projectId=${pid}`);return x.length===1&&String(x[0].schemeId)===String(fs.id);});
    const ids={};const wanted=[...new Set(p.workflows.flatMap(w=>w.issueTypes))];
    for(const name of wanted){const spec=s.issueTypeCatalogue.find(t=>t.name===name);let type;
      if(spec.hierarchy==='existing-standard'){type=one((await allTypes()).filter(t=>!t.scope),name);if(!type||Boolean(type.subtask)!==(name==='Sub-task'))fail(`Missing global standard type ${name}`);}
      else {const body={name,description:`${MARK}: ${s.theme} / ${name}`,type:spec.hierarchyLevel===-1?'subtask':'standard'};type=await ensure(`type/${name}`,body,allTypes,'/rest/api/3/issuetype',x=>x.description===body.description&&!x.scope&&Boolean(x.subtask)===(body.type==='subtask'));}
      ids[name]=String(type.id);
    }
    const schemeBody={name:`${p.key} Showcase Issue Types`,description:`${MARK}: ${p.key}`,defaultIssueTypeId:ids.Task,issueTypeIds:Object.values(ids)};
    if(!schemeBody.defaultIssueTypeId)fail('Task default missing');
    const scheme=await ensure(`${p.key}/typescheme`,schemeBody,()=>pages(api,'/rest/api/3/issuetypescheme'),'/rest/api/3/issuetypescheme',x=>x.description===schemeBody.description&&String(x.defaultIssueTypeId)===ids.Task);
    const mappings=await pages(api,`/rest/api/3/issuetypescheme/mapping?issueTypeSchemeId=${scheme.id}`);
    if(!isDeepStrictEqual(mappings.map(x=>String(x.issueTypeId)).sort(),Object.values(ids).sort()))fail('Issue type scheme content differs');
    await mutation(`${p.key}/typeassociation`,'PUT','/rest/api/3/issuetypescheme/project',{issueTypeSchemeId:String(scheme.id),projectId:pid},async()=>{const rows=await pages(api,`/rest/api/3/issuetypescheme/project?projectId=${pid}`);return rows.length===1&&String(rows[0].issueTypeScheme.id)===String(scheme.id);});
    const fields={};
    for(const f of p.customFields){
      const body=fieldPayload(f);const field=await ensure(`${p.key}/field/${f.name}`,body,()=>pages(api,'/rest/api/3/field/search?type=custom'),'/rest/api/3/field',x=>x.description===body.description&&x.schema?.custom===body.type);
      const prefix=`/rest/api/3/field/${field.id}`;const contexts=await pages(api,prefix+'/context');
      if(contexts.length!==1||!contexts[0].isGlobalContext||!contexts[0].isAnyIssueType)fail(`Unexpected owned context layout ${f.name}`);const ctx=contexts[0];
      const hasField=async schemeId=>{
        const rows=await pages(api,`/rest/api/3/config/fieldschemes/${schemeId}/fields?fieldId=${field.id}`);const row=rows.find(x=>x.fieldId===field.id);
        if(row?.restrictedToWorkTypes?.length)fail(`Unexpected work-type restrictions ${field.id} / ${schemeId}`);return !!row;
      };
      const currentOwners=async()=>{const owners=[];for(const other of await pages(api,'/rest/api/3/config/fieldschemes'))if(await hasField(other.id))owners.push(String(other.id));return owners;};
      // Durable initial association snapshot is captured only in the process that created the field.
      // An interrupted POST without this snapshot needs explicit reconciliation, never inferred ownership.
      state.fieldIsolation ||= {};
      if(!state.fieldIsolation[field.id]){
        if(!createdThisRun.has(`${p.key}/field/${f.name}`))fail('Missing initial association snapshot; manual reconciliation required');
        state.fieldIsolation[field.id]={initialSchemeIds:await currentOwners(),targetSchemeId:String(fs.id),complete:false,at:new Date().toISOString()};save();
      }
      const isolation=state.fieldIsolation[field.id];
      if(isolation.targetSchemeId!==String(fs.id))fail('Isolation target changed');
      const removals=isolationRemovals(isolation,await currentOwners(),fs.id);
      if(!isolation.complete){
        if(!state.creationProof?.[`${p.key}/field/${f.name}`]?.absentBeforeCreate||state.creationProof[`${p.key}/field/${f.name}`].bodyHash!==hash(body)||String(state.objects[`${p.key}/field/${f.name}`]?.id)!==String(field.id)||field.description!==body.description)fail('Field ownership guard failed');
        await mutation(`${field.id}/fieldscheme`,'PUT','/rest/api/3/config/fieldschemes/fields',{[field.id]:[{schemeIds:[Number(fs.id)]}]},()=>hasField(fs.id));
        for(const otherId of removals){
          await mutation(`${field.id}/detach/${otherId}`,'DELETE','/rest/api/3/config/fieldschemes/fields',{[field.id]:{schemeIds:[Number(otherId)]}},async()=>!await hasField(otherId));
        }
        if(!isDeepStrictEqual(await currentOwners(),[String(fs.id)]))fail('Field scheme isolation failed');
        isolation.complete=true;isolation.completedAt=new Date().toISOString();save();
      }
      let options=[];
      if(f.options){const op=`${prefix}/context/${ctx.id}/option`;options=await pages(api,op);
        if(options.some(o=>!f.options.includes(o.value)||o.disabled||o.optionId)||new Set(options.map(o=>o.value)).size!==options.length)fail(`Unexpected options ${f.name}`);
        const missing=f.options.filter(v=>!options.some(o=>o.value===v));
        if(missing.length)await mutation(`${field.id}/options`,'POST',op,{options:missing.map(value=>({value,disabled:false}))},async()=>{const xs=await pages(api,op);return isDeepStrictEqual(xs.map(x=>[x.value,!!x.disabled]).sort(),f.options.map(v=>[v,false]).sort());});
        options=await pages(api,op);
      }
      fields[f.name]={id:field.id,name:f.name,schema:field.schema,projectKeys:[p.key],contextId:String(ctx.id),contextIsGlobal:true,scopeMechanism:'field-scheme',fieldSchemeId:String(fs.id),type:f.type,options:options.map(o=>({id:String(o.id),value:o.value,disabled:!!o.disabled}))};
    }
    const screenIds={},screenSchemeIds={};
    for(const [oldId,oldScreen] of Object.entries(baseline.screens)){
      const screen=await ensure(`${p.key}/screen/${oldId}`,{name:`${p.key} Showcase Screen ${oldId}`,description:`${MARK}: ${p.key} / original ${oldId}`},()=>pages(api,'/rest/api/3/screens'),'/rest/api/3/screens');screenIds[oldId]=String(screen.id);
      // Copy each original tab separately. New fields get a dedicated tab; no operation/type flattening.
      const originalIds=new Set(oldScreen.tabs.flatMap(t=>t.fields));
      const tabs=[...oldScreen.tabs,{name:'Showcase Fields',fields:[...['duedate','fixVersions'].filter(id=>!originalIds.has(id)),...Object.values(fields).map(f=>f.id)]}];
      if(new Set(tabs.map(t=>t.name)).size!==tabs.length)fail('Conflicting tab name');
      for(const source of tabs){
        const tab=await ensure(`${p.key}/tab/${oldId}/${source.name}`,{name:source.name},()=>api(`/rest/api/3/screens/${screen.id}/tabs`),`/rest/api/3/screens/${screen.id}/tabs`,()=>true);
        for(const fieldId of source.fields){
          const exists=async()=>(await api(`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`)).some(f=>f.id===fieldId);
          if(!await exists()&&!(await api(`/rest/api/3/screens/${screen.id}/availableFields`)).some(f=>f.id===fieldId))fail(`Required original/custom field unavailable ${fieldId}`);
          await mutation(`${screen.id}/field/${fieldId}`,'POST',`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`,{fieldId},exists);
        }
      }
    }
    for(const [oldId,operations] of Object.entries(baseline.screenSchemes)){
      const screens=Object.fromEntries(Object.entries(operations).map(([op,id])=>[op,screenIds[id]]));
      const ss=await ensure(`${p.key}/screenscheme/${oldId}`,{name:`${p.key} Showcase Screen Scheme ${oldId}`,description:`${MARK}: ${p.key} / original ${oldId}`,screens},()=>pages(api,'/rest/api/3/screenscheme'),'/rest/api/3/screenscheme',x=>x.description===`${MARK}: ${p.key} / original ${oldId}`&&isDeepStrictEqual(Object.fromEntries(Object.entries(x.screens||{}).map(([k,v])=>[k,String(v)])),screens));screenSchemeIds[oldId]=String(ss.id);
    }
    const issueTypeMappings=baseline.screenMappings.map(m=>({issueTypeId:String(m.issueTypeId),screenSchemeId:screenSchemeIds[m.screenSchemeId]}));
    const itss=await ensure(`${p.key}/typescreenscheme`,{name:`${p.key} Showcase Type Screen Scheme`,description:`${MARK}: ${p.key}`,issueTypeMappings},()=>pages(api,'/rest/api/3/issuetypescreenscheme'),'/rest/api/3/issuetypescreenscheme');
    const sm=await pages(api,`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${itss.id}`);
    const normalize=rows=>rows.map(m=>`${m.issueTypeId}:${m.screenSchemeId}`).sort();
    if(!isDeepStrictEqual(normalize(sm),normalize(issueTypeMappings)))fail('Type screen mapping differs');
    await mutation(`${p.key}/screenassociation`,'PUT','/rest/api/3/issuetypescreenscheme/project',{issueTypeScreenSchemeId:String(itss.id),projectId:pid},async()=>{const rows=await pages(api,`/rest/api/3/issuetypescreenscheme/project?projectId=${pid}`);return rows.length===1&&String(rows[0].issueTypeScreenScheme.id)===String(itss.id);});
    for(const id of ['duedate','fixVersions'])fields[id]={id,name:id,projectKeys:[p.key],system:true,screenIds:Object.values(screenIds)};
    state.projects[p.key]={id:pid,key:p.key,createdByCampaign:!old,issueTypes:Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,{id,subtask:name==='Sub-task'||s.issueTypeCatalogue.find(t=>t.name===name)?.hierarchyLevel===-1}])),fields,issueTypeSchemeId:String(scheme.id),fieldSchemeId:String(fs.id),screenIds,screenSchemeIds,issueTypeScreenSchemeId:String(itss.id),checkedAt:new Date().toISOString()};save();
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
