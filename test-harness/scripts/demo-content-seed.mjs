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
// Persistent content only. No workflow activation, app settings or other-site access.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';
import { requireEnv } from '../lib/env.mjs';
const catalog=JSON.parse(readFileSync(new URL('./demo-content-catalog.json',import.meta.url),'utf8'));
const base='https://leanzero-apps-demo.atlassian.net';
assert.equal(catalog.site,new URL(base).host);
const mode=process.argv[2]??'plan';
assert(['plan','apply','verify'].includes(mode));
const hash=s=>createHash('sha256').update(s).digest('hex');
const adf=lines=>({type:'doc',version:1,content:lines.map(text=>({type:'paragraph',content:[{type:'text',text}]}))});
const texts=n=>[...(n.type==='text'?[n.text]:[]),...(n.content??[]).flatMap(texts)];
// Confluence may attach node-local IDs; retain all other structure, formatting and links.
function canonical(node){
  if(Array.isArray(node))return node.map(canonical);
  if(!node||typeof node!=='object')return node;
  const out=Object.fromEntries(Object.entries(node).map(([k,v])=>[k,canonical(v)]));
  if(out.attrs){delete out.attrs.localId;if(!Object.keys(out.attrs).length)delete out.attrs;}
  return out;
}
function attachmentSpecs(doc,index){
  const first={name:`${doc.id}-review-notes.txt`,content:[doc.title,'','Synthetic demonstration evidence. This is prepared content, not a claim of an executed app test.','',...doc.paragraphs.map((p,i)=>`${i+1}. ${p}`),'','Review checks: confirm the exact target, inspect the saved content and record the actual app outcome.'].join('\n')+'\n'};
  const second={name:`${doc.id}-acceptance-procedure.txt`,content:[doc.title+' — acceptance procedure','','1. Open the campaign-owned record and record its current content.','2. Complete the intended action in the relevant LeanZero app.','3. Read the same record again and compare every expected field or attachment byte.','4. Record a failure or pending step explicitly; a configuration save is not end-to-end proof.','','Expected app context: '+doc.app,'Execution status: not executed by this document upload.'].join('\n')+'\n'};
  return index%3===0?[first,second]:[first];
}
assert.equal(catalog.documents.length,18);assert.equal(catalog.cogniScenarios.length,24);
assert.equal(new Set(catalog.documents.map(d=>d.id)).size,18);
assert.equal(catalog.documents.flatMap(attachmentSpecs).length,24);
console.log(JSON.stringify({mode,site:catalog.site,pages:18,attachments:24,newCogniIssues:24,apps:['LeanZero Management','Sentinel Vault','CogniRunner']}));
if(mode==='plan')process.exit(0);
const root=fileURLToPath(new URL('../results/demo-three-apps-content/',import.meta.url));mkdirSync(root,{recursive:true});
const receipt=root+'receipt.json',lock=root+'writer.lock';
const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));
const state=existsSync(receipt)?JSON.parse(readFileSync(receipt,'utf8')):{site:catalog.site,marker:catalog.marker,pages:{},issues:[]};
assert.equal(state.site,catalog.site);assert.equal(state.marker,catalog.marker);
const save=()=>{writeFileSync(receipt+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(receipt+'.tmp',receipt);};
const auth='Basic '+Buffer.from(`${requireEnv('JIRA_ADMIN_EMAIL')}:${requireEnv('JIRA_API_TOKEN')}`).toString('base64');
async function api(path,method='GET',body){
  assert(path.startsWith('/wiki/api/v2/')||path.startsWith('/wiki/rest/api/')||path.startsWith('/rest/api/3/'));
  for(let i=0;i<5;i++){
    const r=await fetch(base+path,{method,redirect:'error',headers:{Authorization:auth,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const text=await r.text();
    if(method==='GET'&&r.status===429&&i<4){await new Promise(r=>setTimeout(r,Math.min(30000,Number(r.headers.get('Retry-After')??3)*1000)));continue;}
    if(!r.ok)throw Error(`${method} ${path} HTTP ${r.status}: ${text.slice(0,400)}`);
    return text?JSON.parse(text):null;
  }
}
async function all(path){const rows=[];const visited=new Set();while(path){assert(!visited.has(path));visited.add(path);const d=await api(path);rows.push(...(d.results??[]));path=d._links?.next??null;if(path){const u=new URL(path,base);assert.equal(u.origin,base);path=u.pathname+u.search;}}return rows;}
async function fields(project,type){const rows=[];for(let start=0;;){const d=await api(`/rest/api/3/issue/createmeta/${project}/issuetypes/${type}?startAt=${start}&maxResults=100`);const batch=d.fields??d.values??[];rows.push(...batch);if(d.isLast||!batch.length||(d.total!==undefined&&rows.length>=d.total))return rows;start+=batch.length;}}
try{
  const me=await api('/rest/api/3/myself');assert(me.active);
  const spaces=await all(`/wiki/api/v2/spaces?keys=${catalog.spaceKey}&limit=100`);
  if(!state.space){
    if(spaces.length){
      assert(state.pendingSpace,'Refuse to adopt an existing unowned space');assert.equal(spaces.length,1);assert.equal(spaces[0].name,catalog.spaceName);
      const detail=await api(`/wiki/api/v2/spaces/${spaces[0].id}?description-format=plain`);
      assert(JSON.stringify(detail.description??{}).includes(catalog.marker),'Pending space requires ownership reconciliation');state.space={id:String(spaces[0].id),key:catalog.spaceKey};
    }else{
      assert.equal(mode,'apply');assert(!state.pendingSpace,'Uncertain space create; reconcile before retry');state.pendingSpace=true;save();
      const created=await api('/wiki/api/v2/spaces','POST',{key:catalog.spaceKey,name:catalog.spaceName,description:{value:`${catalog.marker}. Synthetic product demonstration library for LeanZero Management, Sentinel Vault and CogniRunner.`,representation:'plain'}});
      assert(created.id,'Space creation did not return an ID');state.space={id:String(created.id),key:catalog.spaceKey};
    }
    delete state.pendingSpace;save();
  }
  const space=await api(`/wiki/api/v2/spaces/${state.space.id}`);assert.equal(space.key,catalog.spaceKey);assert.equal(space.name,catalog.spaceName);
  for(let i=0;i<catalog.documents.length;i++){
    const doc=catalog.documents[i],expected=adf(doc.paragraphs),parent=doc.parent?state.pages[doc.parent].id:null;
    let row=state.pages[doc.id];
    if(!row){
      assert.equal(mode,'apply');let created;
      const existing=(await all(`/wiki/api/v2/spaces/${space.id}/pages?limit=100`)).filter(p=>p.title===doc.title);
      if(state.pendingPage){
        assert.equal(state.pendingPage,doc.id);assert.equal(existing.length,1,'Uncertain page create; reconcile before retry');
        created=await api(`/wiki/api/v2/pages/${existing[0].id}?body-format=atlas_doc_format`);
        assert.deepEqual(canonical(JSON.parse(created.body.atlas_doc_format.value)),canonical(expected));
      }else{
        assert.equal(existing.length,0,'Refuse duplicate page title');state.pendingPage=doc.id;save();
        created=await api('/wiki/api/v2/pages','POST',{spaceId:String(space.id),status:'current',title:doc.title,...(parent?{parentId:parent}:{}),body:{representation:'atlas_doc_format',value:JSON.stringify(expected)}});
      }
      row=state.pages[doc.id]={id:String(created.id),title:doc.title,parentId:parent,attachments:[]};delete state.pendingPage;save();
    }
    let page=await api(`/wiki/api/v2/pages/${row.id}?body-format=atlas_doc_format`);
    assert.equal(page.title,doc.title);assert.equal(String(page.spaceId),String(space.id));if(parent)assert.equal(String(page.parentId),parent);
    assert.deepEqual(texts(JSON.parse(page.body.atlas_doc_format.value)).slice(0,doc.paragraphs.length),doc.paragraphs);
    for(const spec of attachmentSpecs(doc,i)){
      let saved=row.attachments.find(a=>a.name===spec.name);
      if(!saved){
        assert.equal(mode,'apply');const existing=(await all(`/wiki/api/v2/pages/${row.id}/attachments?limit=100`)).filter(a=>a.title===spec.name);let a;
        if(row.pendingAttachment){assert.equal(row.pendingAttachment,spec.name);assert.equal(existing.length,1,'Uncertain attachment upload; reconcile before retry');a=existing[0];}
        else{
          assert.equal(existing.length,0,'Refuse unowned duplicate attachment');row.pendingAttachment=spec.name;save();
          const form=new FormData();form.append('file',new Blob([spec.content],{type:'text/plain'}),spec.name);form.append('minorEdit','true');
          const r=await fetch(`${base}/wiki/rest/api/content/${row.id}/child/attachment`,{method:'POST',redirect:'error',headers:{Authorization:auth,'X-Atlassian-Token':'no-check'},body:form,signal:AbortSignal.timeout(30000)});
          if(!r.ok)throw Error(`Attachment upload HTTP ${r.status}`);const d=await r.json();a=d.results?.[0];assert(a?.id);
        }
        saved={id:String(a.id),name:spec.name,sha256:hash(spec.content)};row.attachments.push(saved);delete row.pendingAttachment;save();
      }
      const a=await api(`/wiki/api/v2/attachments/${saved.id}`);assert.equal(a.title,spec.name);assert.equal(String(a.pageId),row.id);assert.equal(a.status,'current');assert.equal(a.fileSize,Buffer.byteLength(spec.content));
      const link=new URL(a.downloadLink,base+'/wiki');assert.equal(link.origin,base,'Do not send product credentials to another host');
      const download=await fetch(link,{headers:{Authorization:auth},signal:AbortSignal.timeout(30000)});assert(download.ok,'Attachment download failed');assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(spec.content),'Attachment byte mismatch');
      saved.sha256=hash(spec.content);saved.downloadPath=link.pathname+link.search;saved.verifiedAt=new Date().toISOString();save();
    }
    const final=adf(doc.paragraphs);
    for(const a of row.attachments)final.content.push({type:'paragraph',content:[{type:'text',text:`Evidence file: ${a.name}`,marks:[{type:'link',attrs:{href:base+a.downloadPath}}]}]});
    if(!isDeepStrictEqual(canonical(JSON.parse(page.body.atlas_doc_format.value)),canonical(final))){
      assert.equal(mode,'apply','Page links not prepared');
      // Only append links to our original exact body, never overwrite an edited document.
      assert.deepEqual(canonical(JSON.parse(page.body.atlas_doc_format.value)),canonical(expected),'Page changed since creation; preserve manual edits');
      await api(`/wiki/api/v2/pages/${row.id}`,'PUT',{id:row.id,spaceId:String(space.id),status:'current',title:doc.title,body:{representation:'atlas_doc_format',value:JSON.stringify(final)},version:{number:page.version.number+1,message:'Link prepared demonstration evidence'}});
    }
    page=await api(`/wiki/api/v2/pages/${row.id}?body-format=atlas_doc_format`);assert.deepEqual(canonical(JSON.parse(page.body.atlas_doc_format.value)),canonical(final));
    row.verifiedAt=new Date().toISOString();save();console.log(JSON.stringify({page:doc.title,attachments:row.attachments.length,verified:true}));
  }
  // Extend the original owned CogniRunner project without renaming it in this content pass.
  const project=await api('/rest/api/3/project/COGDEMO');assert.equal(project.name,'CogniRunner Workflow Showcase');assert(project.description?.includes('leanzero-org-showcase-20260910'));
  const task=project.issueTypes.find(t=>t.name==='Task');assert(task);const meta=await fields('COGDEMO',task.id);
  const supported=new Set(meta.map(f=>f.fieldId??f.key));
  const assignable=await api(`/rest/api/3/user/assignable/search?project=COGDEMO&accountId=${encodeURIComponent(me.accountId)}&maxResults=10`);assert(assignable.some(u=>u.accountId===me.accountId&&u.active));
  const initial=await api('/rest/api/3/issue/COGDEMO-1?fields=project');assert.equal(initial.fields.project.key,'COGDEMO');
  for(let i=0;i<catalog.cogniScenarios.length;i++){
    const [summary,detail]=catalog.cogniScenarios[i],label=`three-apps-cogni-${i+1}`;
    const want={project:{key:'COGDEMO'},issuetype:{id:task.id},summary,description:adf(['Synthetic CogniRunner demonstration scenario.',detail,'This record supplies input and expected behaviour. The workflow effect is not claimed until a real transition and independent Jira readback have verified it.']),assignee:{accountId:me.accountId},labels:[catalog.marker,label,'cognirunner-scenario'],parent:{key:'COGDEMO-1'},...(supported.has('duedate')?{duedate:i===21?'2026-09-09':'2026-10-16'}:{})};
    if(i===17)want.labels.push('customer-facing','quarterly-review');
    for(const field of meta){const id=field.fieldId??field.key;if(field.required&&!field.hasDefaultValue&&!Object.hasOwn(want,id))throw Error(`Missing required ${field.name}`);}
    if(!state.issues[i]){
      assert.equal(mode,'apply');let created;
      if(state.pendingIssue){assert.equal(state.pendingIssue,i+1);const found=await api('/rest/api/3/search/jql','POST',{jql:`project = COGDEMO AND labels = "${catalog.marker}" AND labels = "${label}"`,fields:['summary'],maxResults:2});assert.equal(found.issues?.length,1,'Uncertain issue POST; reconcile before retry');created=found.issues[0];}
      else{state.pendingIssue=i+1;save();created=await api('/rest/api/3/issue','POST',{fields:want});}
      state.issues[i]={id:String(created.id),key:created.key,expected:want};delete state.pendingIssue;save();
    }
    const row=state.issues[i];assert.deepEqual(row.expected,want,'Scenario design changed');const issue=await api(`/rest/api/3/issue/${row.id}?fields=summary,description,project,issuetype,assignee,labels,parent,duedate`),f=issue.fields;
    assert.equal(f.summary,want.summary);assert.deepEqual(canonical(f.description),canonical(want.description));assert.equal(f.project.key,'COGDEMO');assert.equal(f.issuetype.id,task.id);assert.equal(f.assignee?.accountId,me.accountId);assert.equal(f.parent?.key,'COGDEMO-1');assert.deepEqual([...f.labels].sort(),[...want.labels].sort());if(want.duedate)assert.equal(f.duedate,want.duedate);
    row.verifiedAt=new Date().toISOString();save();console.log(JSON.stringify({issue:row.key,verified:true}));
  }
  assert.equal(Object.keys(state.pages).length,18);assert.equal(Object.values(state.pages).flatMap(p=>p.attachments).length,24);assert.equal(state.issues.length,24);
  state.verifiedAt=new Date().toISOString();save();console.log(JSON.stringify({site:catalog.site,pages:18,attachments:24,newCogniIssues:24,verified:true}));
}finally{closeSync(fd);unlinkSync(lock);}
