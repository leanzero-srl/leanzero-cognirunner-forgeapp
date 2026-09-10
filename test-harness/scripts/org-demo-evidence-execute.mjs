/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Exact demo-only scope; no app configuration or workflow state is claimed by content creation.
import {readFileSync,existsSync,mkdirSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {evidenceCatalog,evidenceHash} from '../lib/org-demo-evidence.mjs';
import {atomicSave} from './org-metadata-execute.mjs';
import {requireEnv} from '../lib/env.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),folder=resolve(root,'test-harness/results/org-demo-evidence-v1');
const base='https://leanzero-apps-demo.atlassian.net';
export function canonicalEvidence(node){
  if(Array.isArray(node))return node.map(canonicalEvidence);
  if(!node||typeof node!=='object')return node;
  const out=Object.fromEntries(Object.entries(node).map(([k,v])=>[k,canonicalEvidence(v)]));
  if(out.type==='doc'&&out.version===undefined)out.version=1;
  if(out.attrs){
    delete out.attrs.localId;
    if(out.type==='table'&&out.attrs.isNumberColumnEnabled===false)delete out.attrs.isNumberColumnEnabled;
    if(out.type==='tableCell'||out.type==='tableHeader'){if(out.attrs.colspan===1)delete out.attrs.colspan;if(out.attrs.rowspan===1)delete out.attrs.rowspan;}
    if(!Object.keys(out.attrs).length)delete out.attrs;
  }
  return out;
}
async function main(mode,limit){
  assert(['apply','verify','plan'].includes(mode));
  const catalog=evidenceCatalog();assert.equal(catalog.site,new URL(base).host);
  assert.deepEqual(JSON.parse(readFileSync(resolve(folder,'catalog.json'))),catalog,'Prepared catalog changed; rebuild artifacts before any upload');
  if(mode==='plan'){console.log(JSON.stringify({site:catalog.site,pages:102,attachments:156,spaces:catalog.spaces.map(s=>s.key)}));return;}
  const expectedHash=evidenceHash(JSON.stringify(catalog));
  const attachmentHashes=Object.fromEntries(catalog.spaces.flatMap(s=>s.pages.flatMap(p=>p.attachments.map(a=>[a.name,evidenceHash(readFileSync(resolve(folder,'files',a.name)))]))));
  mkdirSync(folder,{recursive:true});const lock=resolve(folder,'writer.lock'),fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,mode}));closeSync(fd);
  const receipt=resolve(folder,'receipt.json');
  try{
    const state=existsSync(receipt)?JSON.parse(readFileSync(receipt)):{site:catalog.site,catalogHash:expectedHash,attachmentHashes,spaces:{},pages:{}};
    assert.equal(state.site,catalog.site);assert.equal(state.catalogHash,expectedHash);assert.deepEqual(state.attachmentHashes,attachmentHashes);
    const save=()=>atomicSave(receipt,state);save();
    const auth='Basic '+Buffer.from(requireEnv('JIRA_ADMIN_EMAIL')+':'+requireEnv('JIRA_API_TOKEN')).toString('base64');
    async function api(path,method='GET',body){
      assert(path.startsWith('/wiki/api/v2/')||path.startsWith('/wiki/rest/api/'));assert(!path.includes('..')&&!path.includes('://'));
      assert(method==='GET'||mode==='apply','Read-only mode refuses mutation');
      for(let i=0;i<5;i++){
        const response=await fetch(base+path,{method,redirect:'error',headers:{Authorization:auth,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
        if(method==='GET'&&(response.status===429||response.status>=500)&&i<4){await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(1000*2**i,Number(response.headers.get('Retry-After')||0)*1000))));continue;}
        assert(response.ok,`${method} ${path}: HTTP ${response.status}; reconcile uncertain writes before retry`);const text=await response.text();return text?JSON.parse(text):null;
      }
    }
    async function all(path){const items=[],seen=new Set();while(path){assert(!seen.has(path));seen.add(path);const result=await api(path);assert(Array.isArray(result.results));items.push(...result.results);path=result._links?.next||null;if(path){const u=new URL(path,base);assert.equal(u.origin,base);path=u.pathname+u.search;}}return items;}
    let pagesVerified=0,attachmentsVerified=0;
    for(const space of catalog.spaces){
      let owned=state.spaces[space.key];
      if(!owned?.id){
        const matches=await all('/wiki/api/v2/spaces?keys='+space.key+'&limit=100');assert(matches.length<=1,'Ambiguous space');
        if(matches.length){assert(owned?.pending,'Refuse existing unowned space');const live=await api('/wiki/api/v2/spaces/'+matches[0].id+'?description-format=plain');assert.equal(live.name,space.name);assert(JSON.stringify(live.description).includes(space.description));owned.id=String(live.id);}
        else{assert.equal(mode,'apply');assert(!owned?.pending,'Uncertain space creation; never duplicate');owned=state.spaces[space.key]={pending:true};save();const created=await api('/wiki/api/v2/spaces','POST',{key:space.key,name:space.name,description:{value:space.description,representation:'plain'}});assert(created.id);owned.id=String(created.id);}
        delete owned.pending;save();
      }
      const liveSpace=await api('/wiki/api/v2/spaces/'+owned.id+'?description-format=plain');assert.equal(liveSpace.key,space.key);assert.equal(liveSpace.name,space.name);assert(JSON.stringify(liveSpace.description).includes(space.description));
      for(const page of space.pages){
        if(limit&&pagesVerified>=limit)break;
        let row=state.pages[page.identity];
        if(!row?.id){
          const matches=(await all('/wiki/api/v2/spaces/'+owned.id+'/pages?limit=100')).filter(p=>p.title===page.title);assert(matches.length<=1,'Ambiguous page title');
          if(matches.length){assert(row?.pendingCreate,'Refuse unowned matching page');const live=await api('/wiki/api/v2/pages/'+matches[0].id+'?body-format=atlas_doc_format');assert.deepEqual(canonicalEvidence(JSON.parse(live.body.atlas_doc_format.value)),canonicalEvidence(page.body));row.id=String(live.id);}
          else{assert.equal(mode,'apply');assert(!row?.pendingCreate,'Uncertain page creation; never duplicate');row=state.pages[page.identity]={pendingCreate:true,spaceId:owned.id,attachments:{}};save();const created=await api('/wiki/api/v2/pages','POST',{spaceId:owned.id,status:'current',title:page.title,body:{representation:'atlas_doc_format',value:JSON.stringify(page.body)}});assert(created.id);row.id=String(created.id);}
          delete row.pendingCreate;save();
        }
        let livePage=await api('/wiki/api/v2/pages/'+row.id+'?body-format=atlas_doc_format');assert.equal(livePage.title,page.title);assert.equal(String(livePage.spaceId),owned.id);assert.equal(livePage.status,'current');
        const original=canonicalEvidence(page.body),final=structuredClone(page.body);
        const savedFinal=structuredClone(page.body);
        for(const attachment of page.attachments){const href=row.attachments[attachment.name]?.href;if(href)savedFinal.content.push({type:'paragraph',content:[{type:'text',text:'Evidence: '+attachment.name,marks:[{type:'link',attrs:{href}}]}]});}
        const before=canonicalEvidence(JSON.parse(livePage.body.atlas_doc_format.value));
        if(row.verifiedAt)assert.deepEqual(before,canonicalEvidence(savedFinal),'Preserve changes to completed pages');
        else assert(isDeepStrictEqual(before,original)||isDeepStrictEqual(before,canonicalEvidence(savedFinal)),'Preserve page edits before any attachment write');
        for(const attachment of page.attachments){
          const bytes=readFileSync(resolve(folder,'files',attachment.name));assert.equal(evidenceHash(bytes),attachmentHashes[attachment.name]);
          let saved=row.attachments[attachment.name];
          if(!saved?.id){
            const matches=(await all('/wiki/api/v2/pages/'+row.id+'/attachments?limit=100')).filter(a=>a.title===attachment.name);assert(matches.length<=1,'Ambiguous attachment');
            if(matches.length){assert(saved?.pending,'Refuse unowned matching attachment');saved.id=String(matches[0].id);}
            else{assert.equal(mode,'apply');assert(!saved?.pending,'Uncertain upload; never repeat');saved=row.attachments[attachment.name]={pending:true};save();
              const mime={pdf:'application/pdf',csv:'text/csv',json:'application/json',txt:'text/plain',svg:'image/svg+xml'}[attachment.format];
              const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),attachment.name);form.append('minorEdit','true');
              const response=await fetch(base+'/wiki/rest/api/content/'+row.id+'/child/attachment',{method:'POST',redirect:'error',headers:{Authorization:auth,'X-Atlassian-Token':'no-check'},body:form,signal:AbortSignal.timeout(30000)});assert(response.ok,'Upload HTTP '+response.status);const result=await response.json();assert(result.results?.[0]?.id);saved.id=String(result.results[0].id);
            }
            delete saved.pending;save();
          }
          const live=await api('/wiki/api/v2/attachments/'+saved.id);assert.equal(live.title,attachment.name);assert.equal(String(live.pageId),row.id);assert.equal(live.status,'current');assert.equal(live.fileSize,bytes.length);
          const path=/^\/(?:rest|download)\//.test(live.downloadLink)?'/wiki'+live.downloadLink:live.downloadLink;const url=new URL(path,base+'/wiki/');assert.equal(url.origin,base);assert(url.pathname.startsWith('/wiki/'));
          const response=await fetch(url,{headers:{Authorization:auth},signal:AbortSignal.timeout(30000)});assert(response.ok,'Download HTTP '+response.status);assert.equal(evidenceHash(Buffer.from(await response.arrayBuffer())),attachmentHashes[attachment.name],'Attachment bytes differ');
          saved.sha256=attachmentHashes[attachment.name];saved.href ||= url.href;saved.verifiedAt=new Date().toISOString();save();attachmentsVerified++;
          final.content.push({type:'paragraph',content:[{type:'text',text:'Evidence: '+attachment.name,marks:[{type:'link',attrs:{href:saved.href}}]}]});
        }
        const canonicalFinal=canonicalEvidence(final),observed=canonicalEvidence(JSON.parse(livePage.body.atlas_doc_format.value));
        if(!isDeepStrictEqual(observed,canonicalFinal)){
          assert.equal(mode,'apply','Prepared evidence links missing');assert.deepEqual(observed,original,'Preserve human page edits');assert(!row.pendingLinks,'Uncertain page link update; reconcile before retry');row.pendingLinks=true;save();
          await api('/wiki/api/v2/pages/'+row.id,'PUT',{id:row.id,spaceId:owned.id,status:'current',title:page.title,body:{representation:'atlas_doc_format',value:JSON.stringify(final)},version:{number:livePage.version.number+1,message:'Link the prepared evidence package'}});
        }
        livePage=await api('/wiki/api/v2/pages/'+row.id+'?body-format=atlas_doc_format');assert.deepEqual(canonicalEvidence(JSON.parse(livePage.body.atlas_doc_format.value)),canonicalFinal);delete row.pendingLinks;
        const labels=[catalog.marker,space.key.toLowerCase(),'prepared-evidence'];let current=await all('/wiki/api/v2/pages/'+row.id+'/labels?limit=100');const missing=labels.filter(x=>!current.some(l=>l.name===x));
        if(missing.length){assert(!row.verifiedAt,'Preserve removed labels on a completed page');assert.equal(mode,'apply');assert(!row.pendingLabels,'Uncertain labels write');row.pendingLabels=missing;save();await api('/wiki/rest/api/content/'+row.id+'/label','POST',missing.map(name=>({prefix:'global',name})));current=await all('/wiki/api/v2/pages/'+row.id+'/labels?limit=100');}
        assert(labels.every(name=>current.some(l=>l.name===name)));delete row.pendingLabels;row.verifiedAt=new Date().toISOString();save();pagesVerified++;
        console.log(JSON.stringify({at:row.verifiedAt,page:page.title,id:row.id,pagesVerified,attachmentsVerified,mode}));
      }
      if(limit&&pagesVerified>=limit)break;
    }
    const complete=pagesVerified===102&&attachmentsVerified===156;state.lastRun={at:new Date().toISOString(),mode,pagesVerified,attachmentsVerified,complete};save();console.log(JSON.stringify(state.lastRun));
  }finally{unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,limit]=process.argv.slice(2);assert(!limit||/^[1-9][0-9]*$/.test(limit));main(mode||'plan',Number(limit)||null).catch(e=>{console.error(e.message);process.exitCode=1;});
}
