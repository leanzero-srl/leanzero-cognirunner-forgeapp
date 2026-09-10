/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {statusNames,buildGraphPayload,validateGraphResponse,compareWorkflow,executeProjectGraphs,graphHash} from '../lib/org-workflow-graphs.mjs';
import {graphClient} from './org-workflow-graphs.mjs';
const plan=JSON.parse(await readFile(new URL('../../docs/org-expanded-approval-plan.json',import.meta.url)));
const site=plan.sites[0],project=site.projects[0];
const metadata={id:'1000',key:project.key,createdByCampaign:true,issueTypes:Object.fromEntries([...new Set(project.workflows.flatMap(w=>w.issueTypes))].map((name,i)=>[name,{id:String(i+2000)}]))};
const names=statusNames(plan);assert.equal(names.evidence.Accepted,'Evidence Accepted');assert.equal(names.risk.Accepted,'Risk Accepted');assert.equal(names.migration.Assessed,'Migration Assessed');
const payload=buildGraphPayload(plan,site.site,project,metadata);
assert(payload.workflows.every(w=>w.transitions[0].type==='INITIAL'&&w.transitions[0].links.length===0));
assert.throws(()=>buildGraphPayload(plan,site.site,project,{...metadata,createdByCampaign:false}),/migration blocked/);
assert.throws(()=>buildGraphPayload(plan,site.site,project,metadata,[{id:'1',name:'Ready',statusCategory:'DONE'}]),/category mismatch/);
assert.throws(()=>validateGraphResponse({}),/Malformed/);assert.throws(()=>validateGraphResponse({errors:[{level:'ERROR'}]}),/errors/);assert.deepEqual(validateGraphResponse({errors:[]}),[]);
const statusRows=payload.statuses.map((s,i)=>({...s,id:String(i+3000)}));
const sample={...structuredClone(payload.workflows[0]),id:'wf1'};
assert(compareWorkflow(payload.workflows[0],payload.statuses,sample,statusRows));
const changed=structuredClone(sample);changed.transitions[1].toStatusReference=changed.transitions[0].toStatusReference;assert.throws(()=>compareWorkflow(payload.workflows[0],payload.statuses,changed,statusRows),/graph differs/);
const locked=structuredClone(sample);locked.statuses[0].properties={'jira.issue.editable':'false'};
assert.throws(()=>compareWorkflow(payload.workflows[0],payload.statuses,locked,statusRows),/graph differs/);
let fetchCalls=0;await assert.rejects(graphClient(site.site,'verify','test',async()=>{fetchCalls++;})('/rest/api/3/workflows/create','POST',{}),/Read-only/);assert.equal(fetchCalls,0);
assert.throws(()=>graphClient('leanzero.atlassian.net','apply','test'),/Unapproved/);
let writeCount=0;const uncertain=graphClient(site.site,'apply','test',async()=>{writeCount++;throw new Error('network');});await assert.rejects(uncertain('/rest/api/3/workflows/create','POST',{}),/uncertain/);assert.equal(writeCount,1);
let storedWorkflows=[],storedStatuses=[],scheme=null,association='old',writes=[],saved=[],uncertainCreate=false;
const state={site:site.site,manifestHash:graphHash(plan),projects:{},pending:{}};
const page=values=>({values,isLast:true});
const api=async(path,method='GET',body)=>{
  if(method!=='GET')writes.push({path,method,body});
  if(path===`/rest/api/3/project/${metadata.id}`)return {id:metadata.id,key:project.key,description:'lz-org-expanded-20260910: Platform engineering',simplified:false};
  if(path.startsWith('/rest/api/3/statuses/search'))return page(storedStatuses);
  if(path.startsWith('/rest/api/3/workflows/search'))return {...page(storedWorkflows),statuses:storedStatuses};
  if(path==='/rest/api/3/workflows/create/validation')return {errors:[]};
  if(path==='/rest/api/3/workflows/create'){
    assert(state.pending[project.key+'/graphs'],'Pending must precede graph create');storedWorkflows=body.workflows.map((w,i)=>({...structuredClone(w),id:'wf-'+i}));storedStatuses=body.statuses.map((s,i)=>({...s,id:String(i+3000)}));if(uncertainCreate){uncertainCreate=false;throw new Error('uncertain create response');}return {workflows:storedWorkflows,statuses:storedStatuses};
  }
  if(path.startsWith('/rest/api/3/workflowscheme?'))return page(scheme?[scheme]:[]);
  if(path==='/rest/api/3/workflowscheme'&&method==='POST'){assert(state.pending[project.key+'/scheme']);scheme={id:'4000',...body};return scheme;}
  if(path==='/rest/api/3/workflowscheme/4000')return scheme;
  if(path.startsWith('/rest/api/3/workflowscheme/project?'))return {values:[{workflowScheme:{id:association}}]};
  if(path.startsWith('/rest/api/3/mypermissions?'))return {permissions:{BROWSE_PROJECTS:{havePermission:true},ADMINISTER_PROJECTS:{havePermission:true}}};
  if(path.endsWith('/issuesecuritylevel'))return {issueSecurityLevels:[]};
  if(path==='/rest/api/3/search/jql')return {issues:[],isLast:true};
  if(path==='/rest/api/3/workflowscheme/project'&&method==='PUT'){association=body.workflowSchemeId;return null;}
  throw new Error('Unexpected API '+method+' '+path);
};
const execute=mode=>executeProjectGraphs({plan,site:site.site,project,metadata,state,api,save:async s=>saved.push(structuredClone(s)),mode});
assert.equal((await execute('inspect')).status,'NEEDS_GRAPH_CREATION');assert.equal(writes.length,0);
uncertainCreate=true;await assert.rejects(execute('apply'),/uncertain create/);assert(state.pending[project.key+'/graphs']);
assert.equal((await execute('apply')).status,'GRAPH_AND_SCHEME_READBACK_PASS');assert.equal(writes.filter(w=>w.path==='/rest/api/3/workflows/create').length,1,'Reconcile committed create without duplicate');
const before=writes.length;assert.equal((await execute('verify')).status,'GRAPH_AND_SCHEME_READBACK_PASS');assert.equal(writes.length,before,'Verify performs no tenant writes');
association='human-choice';await assert.rejects(execute('apply'),/preserve external reassociation/);assert.equal(writes.length,before);
delete state.projects[project.key].checkedAt;state.pending[project.key+'/association']={schemeId:'4000'};
await assert.rejects(execute('apply'),/Uncertain workflow association/);assert.equal(writes.length,before);
assert.equal((await executeProjectGraphs({plan,site:site.site,project,metadata:{...metadata,createdByCampaign:false},state,api:async()=>{throw new Error('Must not read or write');},save:async()=>{},mode:'apply'})).status,'BLOCKED_EXISTING_PROJECT_MIGRATION');
const pending={site:site.site,manifestHash:graphHash(plan),projects:{},pending:{[project.key+'/graphs']:{payload}}};
storedWorkflows=[];await assert.rejects(executeProjectGraphs({plan,site:site.site,project,metadata,state:pending,api,save:async()=>{},mode:'apply'}),/Pending workflow creation not visible/);
console.log(JSON.stringify({status:'PASS',workflows:payload.workflows.length,checks:'status collisions, graph drift, existing project block, read-only client, pending before create, ambiguous response reconciliation, verify no writes'}));
