/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
// Additive, single-site portfolio fixtures. No app configuration or shared scheme writes.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { requireEnv } from '../lib/env.mjs';
const base = 'https://leanzero-apps-demo.atlassian.net';
const marker = 'lz-demo-portfolio-v1';
const mode = process.argv[2] ?? 'plan';
if (!['plan','apply','verify'].includes(mode)) throw Error('Use plan|apply|verify');
const packs = [
 {key:'LAUNCH',name:'Product Launch',label:'lz-showcase-launch',count:180,streams:['Customer discovery','Checkout experience','Partner onboarding','Launch communications','Service readiness','Release assurance'],objects:['buyer journey','payment confirmation','partner catalogue','launch campaign','support handover','release checklist']},
 {key:'UPGRADE',name:'Platform Upgrade',label:'lz-showcase-upgrade',count:150,streams:['Architecture baseline','Identity migration','Data migration','API compatibility','Performance assurance','Cutover readiness'],objects:['platform inventory','single sign-on','customer records','integration contract','load profile','cutover runbook']},
 {key:'ROLLOUT',name:'Operational Rollout',label:'lz-showcase-rollout',count:120,streams:['Pilot operations','Regional onboarding','Training delivery','Service desk readiness','Operational controls','Adoption measurement'],objects:['pilot location','regional process','operator training','support escalation','control evidence','adoption dashboard']},
];
const actions=['Define acceptance criteria for','Implement','Exercise recovery for','Review accessibility of','Validate performance of','Document ownership of','Test permissions for','Prepare release evidence for','Rehearse rollback of','Approve readiness of','Measure adoption of','Resolve integration gaps in','Confirm monitoring of','Review data quality for','Prepare handover for','Validate reconciliation of','Demonstrate end-to-end','Review operational risks for','Refine user guidance for'];
const date = n => { const d=new Date('2026-09-07T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); };
function design(p) {
 const out=[]; const per=p.count/6;
 for(let s=0;s<6;s++) {
  const epic=out.length;
  out.push({summary:p.streams[s],type:'Epic',stream:s,parent:null,start:date(s*7),due:date(s*7+45),status:'new'});
  for(let j=1;j<per;j++) {
   const sub=j>1 && j%4===0;
   out.push({summary:`${sub?'Record acceptance evidence for':actions[(j-1)%actions.length]} ${p.objects[s]}${j>19?' — regional wave 2':''}`,type:sub?'Sub-task':j%2?'Story':'Task',stream:s,parent:sub?out.length-1:epic,start:date(s*7+j),due:date(s*7+j+(sub?3:4)),status:j<=4?'done':j<=10?'indeterminate':'new'});
  }
 }
 if(out.length!==p.count)throw Error('Design count mismatch');return out;
}
console.log(JSON.stringify({base,mode,projects:packs.map(p=>({key:p.key,name:p.name,count:p.count,label:p.label,epics:6,subtasks:design(p).filter(x=>x.type==='Sub-task').length})),total:450}));
if(mode==='plan')process.exit(0);
const root=fileURLToPath(new URL('../results/demo-portfolio-v1/',import.meta.url));mkdirSync(root,{recursive:true});
const receipt=root+'receipt.json';
const state=existsSync(receipt)?JSON.parse(readFileSync(receipt,'utf8')):{base,marker,projects:{}};
if(state.base!==base||state.marker!==marker)throw Error('Receipt identity mismatch');
const receiptKeys=Object.values(state.projects).flatMap(p=>p.issues.map(i=>i.key));
if(new Set(receiptKeys).size!==receiptKeys.length)throw Error('Duplicate receipt issue key');
function save(){writeFileSync(receipt+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(receipt+'.tmp',receipt);}
const auth=Buffer.from(`${requireEnv('JIRA_ADMIN_EMAIL')}:${requireEnv('JIRA_API_TOKEN')}`).toString('base64');
const requestCounts={};
async function api(path,method='GET',body){
 if(mode==='verify'&&method!=='GET')throw Error('Verify mode forbids all HTTP mutations');
 requestCounts[method]=(requestCounts[method]??0)+1;
 if(!path.startsWith('/rest/api/3/'))throw Error('Only Jira relative API paths allowed');
 // No automatic retries for any mutation, including 429 or ambiguous transport failures.
 for(let n=0;n<5;n++){
  const r=await fetch(base+path,{method,redirect:'error',headers:{Authorization:`Basic ${auth}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const t=await r.text();
  if(method==='GET'&&r.status===429&&n<4){await new Promise(r=>setTimeout(r,2000*(n+1)));continue;}
  if(!r.ok)throw Error(`${method} ${path} HTTP ${r.status}: ${t.slice(0,500)}`);
  return t?JSON.parse(t):null;
 }
}
async function pages(path,field){const out=[];for(let startAt=0;;){const p=await api(`${path}?startAt=${startAt}&maxResults=100`);const a=p[field]??p.values??[];out.push(...a);if(p.isLast||!a.length||(p.total!==undefined&&out.length>=p.total))return out;startAt+=a.length;}}
const me=await api('/rest/api/3/myself');
const perms=await api('/rest/api/3/mypermissions?permissions=ADMINISTER,CREATE_PROJECT');
if(!me.active||!perms.permissions.ADMINISTER.havePermission||!perms.permissions.CREATE_PROJECT.havePermission)throw Error('Admin preflight failed');
const starts=(await api('/rest/api/3/field')).filter(f=>f.name==='Start date'&&f.schema?.type==='date');
if(starts.length!==1)throw Error('Ambiguous or missing Start date');const startField=starts[0].id;
const priorities=await api('/rest/api/3/priority');
const blocks=(await api('/rest/api/3/issueLinkType')).issueLinkTypes.find(t=>t.name==='Blocks');if(!blocks)throw Error('Blocks link unavailable');
const adf=lines=>({version:1,type:'doc',content:lines.map(text=>({type:'paragraph',content:[{type:'text',text}]}))});
function equal(a,b){return isDeepStrictEqual(a,b);}
async function checkIssue(key,want,category){
 const f=(await api(`/rest/api/3/issue/${key}?fields=*all`)).fields;
 for(const k of ['summary','description','duedate',startField])if(!equal(f[k],want[k]))throw Error(`${key}: ${k} mismatch`);
 if(f.assignee?.accountId!==want.assignee.accountId)throw Error(`${key}: assignee mismatch`);
 if(f.project.key!==want.project.key||f.issuetype.id!==want.issuetype.id||f.priority.id!==want.priority.id)throw Error(`${key}: identity/type/priority mismatch`);
 for(const k of ['components','fixVersions'])if(!equal(f[k].map(x=>x.id).sort(),want[k].map(x=>x.id).sort()))throw Error(`${key}: ${k} mismatch`);
 if(!equal([...f.labels].sort(),[...want.labels].sort())||f.parent?.key!==want.parent?.key)throw Error(`${key}: labels/parent mismatch`);
 if(category&&f.status.statusCategory.key!==category)throw Error(`${key}: status mismatch`);return f;
}
for(const p of packs){
 const rows=design(p);const st=state.projects[p.key]??={issues:[],links:[]};save();
 if(!st.project){
  if(st.pendingProject){const got=await api(`/rest/api/3/project/${p.key}`);if(got.name!==p.name||!got.description?.includes(marker))throw Error('Pending project identity mismatch');st.project={id:got.id,key:got.key};delete st.pendingProject;save();}
  else {
   const v=await api(`/rest/api/3/projectvalidate/key?key=${p.key}`);if(v.errorMessages?.length||Object.keys(v.errors??{}).length)throw Error(`${p.key} is unavailable; never adopt unrelated project`);
   if(mode!=='apply')throw Error('Missing project');st.pendingProject=true;save();
   const got=await api('/rest/api/3/project','POST',{key:p.key,name:p.name,projectTypeKey:'software',projectTemplateKey:'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',description:`${marker}. Persistent synthetic ${p.name.toLowerCase()} demonstration for LeanZero Management and CogniRunner.`,leadAccountId:me.accountId,assigneeType:'UNASSIGNED'});
   st.project={id:got.id,key:got.key};delete st.pendingProject;save();
  }
 }
 const project=await api(`/rest/api/3/project/${p.key}`);if(String(project.id)!==String(st.project.id)||project.name!==p.name||!project.description?.includes(marker))throw Error('Project identity mismatch');
 const assignable=(await api(`/rest/api/3/user/assignable/search?project=${p.key}&maxResults=50`)).filter(u=>u.active&&u.accountType==='atlassian');
 if(!assignable.length)throw Error('No active assignable users');
 if(!st.assignees){st.assignees=assignable.sort((a,b)=>a.accountId.localeCompare(b.accountId)).slice(0,3).map(u=>u.accountId);save();}
 if(st.assignees.some(id=>!assignable.some(u=>u.accountId===id)))throw Error('Assigned user no longer available');
 const components=await api(`/rest/api/3/project/${p.key}/components`);
 for(const name of p.streams)if(!components.some(c=>c.name===name)){
  if(mode!=='apply'||st.pendingComponent===name)throw Error('Missing/ambiguous component; reconcile before retry');st.pendingComponent=name;save();
  components.push(await api('/rest/api/3/component','POST',{name,project:p.key,description:`${marker}: ${name}`}));delete st.pendingComponent;save();
 }
 if(st.pendingComponent){if(!components.some(c=>c.name===st.pendingComponent))throw Error('Unresolved component');delete st.pendingComponent;save();}
 const versions=await api(`/rest/api/3/project/${p.key}/versions`);
 for(let v=0;v<3;v++){const name=['Pilot 2026.09','Launch 2026.10','Expansion 2026.11'][v];if(!versions.some(x=>x.name===name)){
  if(mode!=='apply'||st.pendingVersion===name)throw Error('Missing/ambiguous version; reconcile before retry');st.pendingVersion=name;save();
  versions.push(await api('/rest/api/3/version','POST',{name,projectId:Number(project.id),description:marker,startDate:date(v*21),releaseDate:date(v*21+28),released:false}));delete st.pendingVersion;save();
 }}
 if(st.pendingVersion){if(!versions.some(v=>v.name===st.pendingVersion))throw Error('Unresolved version');delete st.pendingVersion;save();}
 const types=await pages(`/rest/api/3/issue/createmeta/${p.key}/issuetypes`,'issueTypes');const meta={};
 for(const name of new Set(rows.map(x=>x.type))){const t=types.find(x=>x.name===name);if(!t)throw Error(`Missing ${name}`);meta[name]={type:t,fields:await pages(`/rest/api/3/issue/createmeta/${p.key}/issuetypes/${t.id}`,'fields')};}
 for(let i=0;i<rows.length;i++){
  const row=rows[i],m=meta[row.type],label=`${marker}-${p.key.toLowerCase()}-${i+1}`;
  const want={assignee:{accountId:st.assignees[i%st.assignees.length]},project:{key:p.key},issuetype:{id:m.type.id},summary:row.summary,description:adf([`${p.name} / ${p.streams[row.stream]}. Synthetic demonstration content; no customer records.`, `Outcome: ${row.summary}. Deliver a traceable result for ${p.objects[row.stream]} with a named operational handover and recorded recovery procedure.`, 'Acceptance criteria: exercise normal, missing-input and permission-denied paths; retain evidence of the result; confirm the saved state through an independent read. The release reviewer checks monitoring, rollback readiness and support guidance.', `Portfolio work package ${i+1}/${p.count}. Membership: ${p.label}. CogniRunner can use this ready-for-review description for quality checks, classification and follow-up effects.`]),labels:[marker,p.label,label,'quality-gate-ready'],components:[{id:components.find(c=>c.name===p.streams[row.stream]).id}],fixVersions:[{id:versions.find(v=>v.name===['Pilot 2026.09','Launch 2026.10','Expansion 2026.11'][row.stream%3]).id}],priority:{id:priorities[i%priorities.length].id},duedate:row.due,[startField]:row.start,...(row.parent!==null?{parent:{key:st.issues[row.parent].key}}:{})};
  for(const field of m.fields){const id=field.fieldId??field.key;if(field.name==='Epic Name'&&row.type==='Epic')want[id]=row.summary;if(field.required&&!field.hasDefaultValue&&!Object.hasOwn(want,id))throw Error(`Unmapped required field ${field.name}`);}
  if(!st.issues[i]){
   if(mode!=='apply')throw Error(`Missing issue ${i}`);let issue;
   if(st.pendingIssue){if(st.pendingIssue.index!==i)throw Error('Pending index mismatch');const found=await api('/rest/api/3/search/jql','POST',{jql:`project = ${p.key} AND labels = "${label}"`,fields:['summary'],maxResults:2});if(found.issues?.length!==1)throw Error('Ambiguous issue create: wait for indexing and reconcile; no duplicate POST');issue=found.issues[0];}
   else {st.pendingIssue={index:i,label};save();issue=await api('/rest/api/3/issue','POST',{fields:want});}
   st.issues[i]={key:issue.key,id:issue.id,expected:want,category:row.status};delete st.pendingIssue;save();
  }
  if(!equal(st.issues[i].expected,want))throw Error('Design drift; refuse mutation');
  let actual=await checkIssue(st.issues[i].key,want);
  if(actual.status.statusCategory.key!==row.status){
   if(mode!=='apply')throw Error('Unexpected status');
   const transitions=(await api(`/rest/api/3/issue/${st.issues[i].key}/transitions`)).transitions;
   const t=transitions.find(x=>x.to.statusCategory.key===row.status);if(!t)throw Error('No direct transition to planned category');
   await api(`/rest/api/3/issue/${st.issues[i].key}/transitions`,'POST',{transition:{id:t.id}});
  }
  await checkIssue(st.issues[i].key,want,row.status);st.issues[i].checkedAt=new Date().toISOString();save();
  if((i+1)%15===0)console.log(`${p.key}: ${i+1}/${rows.length} issues read back`);
 }
 // Four-edge, same-stream dependency chains between standard issues. No subtasks/epics linked.
 for(let s=0;s<6;s++){
  const indices=rows.map((r,i)=>({r,i})).filter(x=>x.r.stream===s&&['Story','Task'].includes(x.r.type)).slice(0,5).map(x=>x.i);
  for(let j=1;j<indices.length;j++){
   const from=st.issues[indices[j-1]].key,to=st.issues[indices[j]].key;
   const has=async()=>{const f=(await api(`/rest/api/3/issue/${from}?fields=issuelinks`)).fields;return f.issuelinks.some(l=>l.type.id===blocks.id&&l.outwardIssue?.key===to);};
   if(!await has()){if(mode!=='apply'||st.pendingLink)throw Error('Missing/ambiguous dependency; reconcile before retry');st.pendingLink={from,to};save();await api('/rest/api/3/issueLink','POST',{type:{id:blocks.id},inwardIssue:{key:from},outwardIssue:{key:to}});}
   if(!await has())throw Error('Dependency readback failed');if(!st.links.some(l=>l.from===from&&l.to===to))st.links.push({from,to});delete st.pendingLink;save();
  }
 }
 if(st.issues.length!==p.count||new Set(st.issues.map(x=>x.key)).size!==p.count||st.links.length!==24)throw Error('Final count mismatch');
 st.checkedAt=new Date().toISOString();save();console.log(`${p.key}: ${st.issues.length} issues / ${st.links.length} Blocks links complete`);
}
state.checkedAt=new Date().toISOString();save();
console.log(JSON.stringify({requestCounts}));
console.log('All 450 issues independently read back with hierarchy, dates, components, versions, priority, labels, descriptions and statuses.');
