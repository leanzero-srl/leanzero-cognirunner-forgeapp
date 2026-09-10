/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {readFileSync,openSync,closeSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareWorkflow,resolutionActions} from '../lib/org-workflow-graphs.mjs';
import {makeClient,atomicSave} from './org-metadata-execute.mjs';
import {requireEnv} from '../lib/env.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const demand=(v,m)=>{if(!v)throw Error(m);};
const [mode,site,key]=process.argv.slice(2);demand(['apply','verify'].includes(mode),'Use apply|verify exact-site KEY');
const path=resolve(root,'test-harness/results/org-expanded-execution',site==='leanzero-apps-demo.atlassian.net'?'demo-graphs.json':site+'-graphs.json');
const lock=path+'.lock',fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,mode}));closeSync(fd);
try{
  const plan=JSON.parse(readFileSync(resolve(root,'docs/org-expanded-approval-plan.json'))),state=JSON.parse(readFileSync(path));
  const project=plan.sites.find(s=>s.site===site)?.projects.find(p=>p.key===key),entry=state.projects?.[key];
  demand(state.site===site&&project&&entry?.checkedAt,'Verified campaign graph required');
  const auth=Buffer.from(requireEnv('JIRA_ADMIN_EMAIL')+':'+requireEnv('JIRA_API_TOKEN')).toString('base64');
  const api=makeClient(site,mode,auth);
  const resolutions=await api('/rest/api/3/resolution');
  const done=resolutions.filter(r=>r.name==='Done');demand(done.length===1,'Exact Done resolution unavailable or ambiguous');
  const resolutionId=String(done[0].id);demand(!entry.nativeResolutionId||entry.nativeResolutionId===resolutionId,'Resolution identity drift');
  entry.resolutionProgress ||= {};
  for(const [i,wf] of project.workflows.entries()){
    const original=entry.payload.workflows[i],family=plan.workflowFamilies[wf.family];
    const expected=structuredClone(original);
    for(const t of expected.transitions){const edge=family.edges.find(e=>e.name===t.name);t.actions=edge?resolutionActions(wf.name,t.id,family.statusCategories[edge.from]==='Done',family.statusCategories[edge.to]==='Done',resolutionId):[];}
    const read=async()=>{const result=await api(`/rest/api/3/workflows/search?queryString=${encodeURIComponent(wf.name)}&expand=values.transitions&maxResults=100`);demand(result.isLast===true,'Incomplete workflow search');const matches=result.values.filter(w=>w.name===wf.name);demand(matches.length===1,'Workflow identity ambiguous');return {workflow:matches[0],statuses:result.statuses};};
    let live=await read();let correct=false;
    try{compareWorkflow(expected,entry.payload.statuses,live.workflow,live.statuses);correct=true;}catch{}
    if(!correct){
      demand(!entry.resolutionProgress[wf.id],'Pending/completed native resolution update drift; no retry');
      compareWorkflow(original,entry.payload.statuses,live.workflow,live.statuses);
      demand(mode==='apply','Native resolution actions missing');
      entry.resolutionProgress[wf.id]={state:'pending',at:new Date().toISOString()};atomicSave(path,state);
      const transitions=live.workflow.transitions.map(t=>({...t,actions:expected.transitions.find(x=>x.name===t.name).actions}));
      const body={statuses:live.statuses.map(({id,name,statusReference,statusCategory})=>({id,name,statusReference,statusCategory})),workflows:[{id:live.workflow.id,name:live.workflow.name,description:live.workflow.description,version:live.workflow.version,statuses:live.workflow.statuses,transitions}]};
      await api('/rest/api/3/workflows/update','POST',body);live=await read();compareWorkflow(expected,entry.payload.statuses,live.workflow,live.statuses);
    }
    entry.resolutionProgress[wf.id]={state:'verified',at:new Date().toISOString()};entry.payload.workflows[i]=expected;atomicSave(path,state);
  }
  entry.nativeResolutionId=resolutionId;entry.resolutionCheckedAt=new Date().toISOString();atomicSave(path,state);
  console.log(JSON.stringify({project:key,workflows:project.workflows.length,nativeResolutionId:resolutionId,mode}));
}finally{unlinkSync(lock);}
