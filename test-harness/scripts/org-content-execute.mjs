/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {readFileSync,existsSync,mkdirSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {buildPopulation,renderCase} from '../lib/org-content-model.mjs';
import {makeClient,atomicSave} from './org-metadata-execute.mjs';
import {executeProjectGraphs} from '../lib/org-workflow-graphs.mjs';
import {requireEnv} from '../lib/env.mjs';
import {verifyFieldAvailability} from './org-field-availability.mjs';
const demand=(x,m)=>{if(!x)throw Error(m);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

export function verifyFields(actual,expected){
  for(const [key,value] of Object.entries(expected)){
    let observed=actual[key],wanted=value;
    if(['project','issuetype'].includes(key)){observed=String(observed?.id);wanted=String(value.id);}
    else if(key==='parent'){observed=observed?.key;wanted=value.key;}
    else if(key==='labels'){observed=[...(observed||[])].sort();wanted=[...value].sort();}
    else if(value&&typeof value==='object'&&value.accountId){observed=observed?.accountId;wanted=value.accountId;}
    else if(value&&typeof value==='object'&&value.id&&!value.type){observed=String(observed?.id);wanted=String(value.id);}
    demand(isDeepStrictEqual(observed,wanted),`Issue field drift: ${key}`);
  }
}
export function transitionPath(family,from,to){
  const queue=[{state:from,path:[]}],seen=new Set([from]);
  while(queue.length){const row=queue.shift();if(row.state===to)return row.path;for(const edge of family.edges)if(edge.from===row.state&&!seen.has(edge.to)){seen.add(edge.to);queue.push({state:edge.to,path:[...row.path,edge]});}}
  throw Error(`No approved state path ${from} → ${to}`);
}
// Parent layers are barriers: a child can only use a fully verified parent receipt.
export async function runPopulationRows(rows,visit,concurrency=4){
  demand(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4,'Invalid content concurrency');
  const layer=row=>row.subtask?2:row.type==='Epic'?0:1;
  for(let i=1;i<rows.length;i++)demand(layer(rows[i])>=layer(rows[i-1]),'Population parent ordering changed');
  for(const kind of [0,1,2]){
    const group=rows.filter(row=>layer(row)===kind);let cursor=0,error,stopped=false;
    await Promise.all(Array.from({length:Math.min(concurrency,group.length)},async()=>{
      while(!error&&!stopped&&cursor<group.length){
        const row=group[cursor++];
        try{if(await visit(row)===false)stopped=true;}catch(e){error ||= e;}
      }
    }));
    if(error)throw error;
    if(stopped)return false;
  }
  return true;
}
async function execute(mode,site,key,limit){
  const plan=JSON.parse(readFileSync(resolve(root,'docs/org-expanded-approval-plan.json')));
  const population=buildPopulation(plan,site,key),project=plan.sites.find(s=>s.site===site).projects.find(p=>p.key===key);
  const metaFile=resolve(root,'test-harness/results/org-metadata-v1',site+'.json');
  const metadata=JSON.parse(readFileSync(metaFile));const binding=metadata.projects[key];
  demand(metadata.site===site&&metadata.manifestHash===hash(plan)&&binding?.checkedAt&&binding.createdByCampaign,'Verified campaign project metadata missing');
  const graphFile=resolve(root,'test-harness/results/org-expanded-execution',site==='leanzero-apps-demo.atlassian.net'?'demo-graphs.json':site+'-graphs.json');
  const graphs=JSON.parse(readFileSync(graphFile));demand(graphs.projects?.[key]?.checkedAt,'Assigned graph verification missing');
  demand(graphs.projects[key].nativeResolutionId&&graphs.projects[key].resolutionCheckedAt,'Native resolution lifecycle has not been verified');
  const folder=resolve(root,'test-harness/results/org-content-v1',site,key);mkdirSync(folder,{recursive:true});
  const lock=resolve(folder,'writer.lock'),fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,mode}));closeSync(fd);
  try{
    const auth=Buffer.from(requireEnv('JIRA_ADMIN_EMAIL')+':'+requireEnv('JIRA_API_TOKEN')).toString('base64');
    const api=makeClient(site,mode==='apply'?'apply':'verify',auth);
    const graphResult=await executeProjectGraphs({plan,site,project,metadata:binding,state:structuredClone(graphs),api:makeClient(site,'verify',auth),save:()=>{},mode:'verify'});
    demand(graphResult.status==='GRAPH_AND_SCHEME_READBACK_PASS','Bare graph verification failed');
    const permissions=await api(`/rest/api/3/mypermissions?projectKey=${key}&permissions=BROWSE_PROJECTS,CREATE_ISSUES,ASSIGN_ISSUES,TRANSITION_ISSUES,ADMINISTER`);
    for(const permission of ['BROWSE_PROJECTS','CREATE_ISSUES','ASSIGN_ISSUES','TRANSITION_ISSUES','ADMINISTER'])demand(permissions.permissions?.[permission]?.havePermission,`Missing ${permission}`);
    const security=await api(`/rest/api/3/issuesecurityschemes/project?projectId=${binding.id}`);
    demand(security.isLast&&security.values?.length===1&&String(security.values[0].projectId)===binding.id&&Object.keys(security.values[0]).every(k=>k==='projectId'),'Issue-security visibility is not established');
    const users=(await api(`/rest/api/3/user/assignable/search?project=${key}&maxResults=100`)).filter(u=>u.active&&u.accountType!=='app').sort((a,b)=>a.accountId.localeCompare(b.accountId));
    await verifyFieldAvailability(api,key,binding);
    const manifestFile=resolve(folder,'population.json');
    const existing=existsSync(manifestFile)?JSON.parse(readFileSync(manifestFile)):null;
    const fingerprint={site,key,planHash:hash(plan),modelHash:createHash('sha256').update(readFileSync(resolve(root,'test-harness/lib/org-content-model.mjs'))).digest('hex')};
    if(existing)demand(isDeepStrictEqual(existing.fingerprint,fingerprint),'Population instrument changed; explicit reconciliation required');
    const roster=existing?.users||users;demand(roster.length&&roster.every(u=>users.some(v=>v.accountId===u.accountId)),'Saved assignee roster is no longer assignable');
    if(!existing){demand(mode==='apply'||mode==='plan','Population receipt missing');atomicSave(manifestFile,{fingerprint,users:roster,rows:population.rows,createdAt:new Date().toISOString()});}
    const issued=new Map();let verified=0;let created=0;let transitioned=0;
    const walked=await runPopulationRows(limit?population.rows.slice(0,limit):population.rows,async row=>{
      const file=resolve(folder,hash(row.identity)+'.json');let receipt=existsSync(file)?JSON.parse(readFileSync(file)):null;
      const rendered=renderCase(plan,population,row,binding,roster);
      if(rendered.parentIdentity){const parent=issued.get(rendered.parentIdentity);demand(parent,'Parent has not passed independent verification');rendered.fields.parent={key:parent.key};}
      if(receipt)demand(receipt.identity===row.identity&&receipt.bodyHash===hash(rendered.fields),'Issue receipt or intended payload changed');
      const label=rendered.fields.labels.find(l=>l.startsWith('lz-case-'));
      const find=async()=>{const result=await api(`/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${key} AND labels = "${label}"`)}&maxResults=2&fields=key`);demand(result.isLast===true&&result.issues?.length<=1,'Ambiguous campaign issue identity');return result.issues[0];};
      let match=receipt?.key?{key:receipt.key}:await find();
      if(!match){
        demand(!receipt||receipt.stage==='rejected-create','Pending issue creation is not visible; never repeat an ambiguous POST');
        if(mode==='plan'){console.log(JSON.stringify({identity:row.identity,fields:rendered.fields,desiredState:row.state}));return false;}
        demand(mode==='apply','Missing planned issue');
        receipt={identity:row.identity,bodyHash:hash(rendered.fields),stage:'pending-create',at:new Date().toISOString(),...(receipt?{previousRejection:receipt}:{})};atomicSave(file,receipt);
        try{match=await api('/rest/api/3/issue','POST',{fields:rendered.fields});}
        catch(e){if([400,403,404,422].includes(e.status)){receipt.stage='rejected-create';receipt.rejection={status:e.status,at:new Date().toISOString()};atomicSave(file,receipt);}throw e;}
        demand(match?.id&&match?.key,'Create response missing identity');created++;
      }else demand(receipt,'Matching issue lacks campaign creation receipt; preserve it');
      let issue=await api(`/rest/api/3/issue/${match.key}?fields=*all`);verifyFields(issue.fields,rendered.fields);
      demand(issue.key.startsWith(key+'-')&&(!receipt.id||String(issue.id)===receipt.id),'Issue identity mismatch');
      receipt={...receipt,id:String(issue.id),key:issue.key,stage:receipt.stage==='complete'?'complete':'created'};atomicSave(file,receipt);
      const graph=graphs.projects[key].workflows[row.workflowId],family=plan.workflowFamilies[row.family];
      const actualState=()=>{const matches=Object.entries(graph.stateBindings).filter(([,v])=>String(v.id)===String(issue.fields.status.id));demand(matches.length===1,'Issue status outside approved graph');return matches[0][0];};
      let current=actualState();
      const verifyResolution=()=>demand(plan.workflowFamilies[row.family].statusCategories[current]==='Done'?String(issue.fields.resolution?.id)===graphs.projects[key].nativeResolutionId:issue.fields.resolution==null,'Resolution does not match the workflow state');
      verifyResolution();
      if(!receipt.lastState&&!receipt.pendingTransition)demand(current===family.states[0],'New issue left its initial state outside the campaign');
      if(receipt.pendingTransition){demand(current===receipt.pendingTransition.to,'Uncertain transition did not reach its expected state; no retry');receipt.lastState=current;delete receipt.pendingTransition;atomicSave(file,receipt);}
      if(receipt.lastState)demand(current===receipt.lastState,'Status changed outside campaign; preserve human transition');
      if(receipt.stage==='complete')demand(current===row.state,'Completed issue status drift');
      for(const edge of transitionPath(family,current,row.state)){
        demand(mode==='apply','Issue has not reached its planned state');
        const id=graph.transitions[edge.name]?.id;demand(id,'Missing exact transition binding');
        const allowed=await api(`/rest/api/3/issue/${issue.key}/transitions`);demand(allowed.transitions.some(t=>String(t.id)===String(id)),'Expected transition is not available');
        receipt.pendingTransition={from:edge.from,to:edge.to,id};atomicSave(file,receipt);
        await api(`/rest/api/3/issue/${issue.key}/transitions`,'POST',{transition:{id}});
        issue=await api(`/rest/api/3/issue/${issue.key}?fields=*all`);verifyFields(issue.fields,rendered.fields);current=actualState();demand(current===edge.to,'Transition readback failed');verifyResolution();
        receipt.lastState=current;delete receipt.pendingTransition;atomicSave(file,receipt);transitioned++;
      }
      receipt.stage='complete';receipt.lastState=current;receipt.verifiedAt=new Date().toISOString();atomicSave(file,receipt);issued.set(row.identity,receipt);verified++;
      if(verified%10===0||verified===population.rows.length)console.log(JSON.stringify({at:new Date().toISOString(),site,project:key,verified,total:population.rows.length,created,transitioned,mode}));
    },mode==='plan'?1:4);
    if(!walked)return;
    if(verified===population.rows.length){
      const keys=[];let nextPageToken;
      do{
        const query=new URLSearchParams({jql:`project = ${key} AND labels = "lz-org-expanded-20260910"`,maxResults:'100',fields:'key',...(nextPageToken?{nextPageToken}:{})});
        const page=await api('/rest/api/3/search/jql?'+query);demand(Array.isArray(page.issues),'Malformed campaign inventory');
        keys.push(...page.issues.map(i=>i.key));nextPageToken=page.nextPageToken;
        demand(page.isLast===true||nextPageToken,'Incomplete campaign inventory');
      }while(nextPageToken);
      demand(isDeepStrictEqual(keys.sort(),[...issued.values()].map(i=>i.key).sort()),'Campaign membership differs from verified population');
    }
    atomicSave(resolve(folder,'result.json'),{at:new Date().toISOString(),fingerprint,mode,verified,total:population.rows.length,reservedGenerated:population.reservedGeneratedIssues,complete:verified===population.rows.length,created,transitioned});
    console.log(JSON.stringify({project:key,verified,total:population.rows.length,complete:verified===population.rows.length,mode}));
  }finally{unlinkSync(lock);}
}
const [mode,site,key,limit]=process.argv.slice(2);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  demand(['plan','apply','verify'].includes(mode)&&site&&key,'Use plan|apply|verify exact-site KEY [canary-limit]');
  demand(!limit||(/^[1-9][0-9]*$/.test(limit)&&Number(limit)<=1000),'Invalid canary limit');
  execute(mode,site,key,Number(limit)||null).catch(e=>{console.error(e.message);process.exitCode=1;});
}
