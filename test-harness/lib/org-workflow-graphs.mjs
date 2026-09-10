/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {durableMutation} from '../scripts/org-metadata-execute.mjs';
const MARK='lz-org-expanded-20260910';
const CATEGORIES={'To Do':'TODO','In Progress':'IN_PROGRESS',Done:'DONE'};
const demand=(ok,message)=>{if(!ok)throw new Error(message);};
export const graphHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=value=>{const h=graphHash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const category=value=>CATEGORIES[value]||value;
export function resolutionActions(workflowName,transitionId,fromDone,toDone,resolutionId){
  if(!resolutionId||(!fromDone&&!toDone))return [];
  demand(/^\d+$/.test(String(resolutionId)),'Invalid native resolution ID');
  return [{id:uuid([workflowName,transitionId,'native-resolution']),ruleKey:'system:update-field',parameters:{field:'resolution',value:toDone?String(resolutionId):'',mode:toDone?'replace':''}}];
}

/** Qualify only names whose category differs across approved families. Never
 * rename or recategorize an existing global Jira status. */
export function statusNames(plan){
  const categories=new Map();
  for(const family of Object.values(plan.workflowFamilies))for(const name of family.states){if(!categories.has(name))categories.set(name,new Set());categories.get(name).add(family.statusCategories[name]);}
  return Object.fromEntries(Object.entries(plan.workflowFamilies).map(([key,family])=>[key,Object.fromEntries(family.states.map(name=>[name,categories.get(name).size>1?`${key[0].toUpperCase()+key.slice(1)} ${name}`:name]))]));
}

export function buildGraphPayload(plan,site,project,metadata,existingStatuses=[]){
  demand(metadata?.createdByCampaign===true,'Existing project migration blocked: no new-project provenance');
  demand(metadata.key===project.key&&/^\d+$/.test(metadata.id),'Project receipt identity mismatch');
  const names=statusNames(plan),statuses=new Map(),workflows=[];
  for(const wf of project.workflows){
    const family=plan.workflowFamilies[wf.family];demand(family,'Unknown workflow family');
    const refs={};
    for(const name of family.states){
      const actual=names[wf.family][name],cat=CATEGORIES[family.statusCategories[name]];
      demand(cat,'Unknown status category');
      const matches=existingStatuses.filter(s=>s.name===actual&&(!s.scope||s.scope.type==='GLOBAL'));
      demand(matches.length<=1,`Ambiguous existing status: ${actual}`);
      if(matches.length)demand(category(matches[0].statusCategory)===cat,`Existing status category mismatch: ${actual}`);
      const reference=uuid([site,actual,cat]); refs[name]=reference;
      if(!statuses.has(actual))statuses.set(actual,{statusReference:reference,name:actual,statusCategory:cat,...(matches.length?{id:String(matches[0].id)}:{})});
    }
    const transitions=[{id:'1',name:'Create',type:'INITIAL',links:[],toStatusReference:refs[family.states[0]],actions:[],validators:[],triggers:[],properties:{}}];
    for(const [i,edge]of family.edges.entries())transitions.push({id:String(i+11),name:edge.name,type:'DIRECTED',toStatusReference:refs[edge.to],links:[{fromStatusReference:refs[edge.from],fromPort:0,toPort:1}],actions:resolutionActions(wf.name,String(i+11),family.statusCategories[edge.from]==='Done',family.statusCategories[edge.to]==='Done',metadata.resolutionId),validators:[],triggers:[],properties:{}});
    workflows.push({name:wf.name,description:`${MARK}: ${project.key} / ${wf.id}`,statuses:family.states.map((name,i)=>({statusReference:refs[name],layout:{x:i*200,y:0},properties:{}})),transitions});
  }
  demand(workflows.length<=20,'Workflow create request exceeds 20 workflows');
  return {scope:{type:'GLOBAL'},statuses:[...statuses.values()],workflows};
}

export function validateGraphResponse(response){
  demand(response&&Array.isArray(response.errors),'Malformed workflow validation response');
  demand(response.errors.every(e=>['ERROR','WARNING'].includes(e.level)),'Unknown validation severity');
  demand(!response.errors.some(e=>e.level==='ERROR'),'Workflow payload validation returned errors');
  return response.errors;
}

/** Compare names/categories/edges, not transient status references. Refuse extra
 * transitions, unexpected executable rules, changed state categories or graph drift. */
export function compareWorkflow(expected,payloadStatuses,actual,actualStatuses){
  demand(actual?.id&&actual.name===expected.name&&actual.description===expected.description,'Workflow identity or ownership differs');
  const lookup=(statuses,ref)=>{const found=statuses.filter(s=>String(s.statusReference)===String(ref));demand(found.length===1,'Missing or ambiguous status reference');return {name:found[0].name,category:category(found[0].statusCategory)};};
  const canonical=(wf,statuses)=>({
    statuses:wf.statuses.map(s=>({...lookup(statuses,s.statusReference),properties:s.properties||{}})).sort((a,b)=>a.name.localeCompare(b.name)),
    transitions:wf.transitions.map(t=>({name:t.name,type:t.type,to:lookup(statuses,t.toStatusReference),from:(t.links||[]).map(l=>lookup(statuses,l.fromStatusReference)).sort((a,b)=>a.name.localeCompare(b.name)),actions:(t.actions||[]).map(a=>a.ruleKey?.startsWith('system:')?{ruleKey:a.ruleKey,parameters:a.parameters}:a),validators:t.validators||[],triggers:t.triggers||[],conditions:t.conditions||null,properties:t.properties||{}})).sort((a,b)=>a.name.localeCompare(b.name)),
  });
  demand(isDeepStrictEqual(canonical(expected,payloadStatuses),canonical(actual,actualStatuses)),`Workflow graph differs: ${expected.name}`);
  return true;
}

async function paged(api,path){
  const values=[],statuses=[];let start=0;
  for(;;){const data=await api(`${path}${path.includes('?')?'&':'?'}startAt=${start}&maxResults=100`);
    demand(Array.isArray(data.values),'Malformed paged response');values.push(...data.values);statuses.push(...(data.statuses||[]));
    if(data.isLast===true||(Number.isFinite(data.total)&&values.length>=data.total))return {values,statuses};
    demand(data.values.length>0,'Incomplete pagination');start+=data.values.length;
  }
}
async function readWorkflow(api,name){const data=await paged(api,`/rest/api/3/workflows/search?scope=GLOBAL&queryString=${encodeURIComponent(name)}&expand=values.transitions`);const matches=data.values.filter(w=>w.name===name);demand(matches.length<=1,'Ambiguous workflow name');return {workflow:matches[0],statuses:data.statuses};}

/** API injection contract: api(path,method='GET',body). Caller serializes this
 * writer and fsyncs save(state). A POST is attempted once; pending survives all
 * transport ambiguity. Existing projects are never assigned or migrated. */
export async function executeProjectGraphs({plan,site,project,metadata,state,api,save,mode='inspect'}){
  demand(['inspect','apply','verify'].includes(mode),'Unknown workflow mode');
  demand(plan.sites.some(s=>s.site===site&&s.projects.some(p=>p.key===project.key))&&site!=='leanzero.atlassian.net','Unapproved target');
  if(metadata?.createdByCampaign!==true)return {project:project.key,status:'BLOCKED_EXISTING_PROJECT_MIGRATION'};
  demand(state.site===site&&state.manifestHash===graphHash(plan),'Graph receipt scope mismatch');
  const live=await api(`/rest/api/3/project/${metadata.id}`);
  demand(live.key===project.key&&String(live.id)===metadata.id&&live.description?.startsWith(MARK+':')&&live.simplified===false,'Live project ownership differs');
  state.projects ||= {};state.pending ||= {};
  const prior=state.projects[project.key];
  const existingStatuses=(await paged(api,'/rest/api/3/statuses/search?scope=GLOBAL')).values;
  const payload=buildGraphPayload(plan,site,project,{...metadata,resolutionId:prior?.nativeResolutionId},existingStatuses);
  const requestId=`${project.key}/graphs`,expectedHash=graphHash(payload);
  // Ref IDs and reused status IDs legitimately differ after creation: retain
  // the exact original submitted payload for deterministic reconciliation.
  const submitted=prior?.payload||state.pending[requestId]?.payload||payload;
  demand(isDeepStrictEqual(submitted.workflows,payload.workflows),'Approved graph changed since pending receipt');
  const reads=[];for(const wf of submitted.workflows)reads.push(await readWorkflow(api,wf.name));
  const found=reads.filter(r=>r.workflow).length;
  if(found!==submitted.workflows.length){
    demand(found===0,'Partial workflow creation requires manual receipt reconciliation');
    demand(!state.pending[requestId],'Pending workflow creation not visible; refuse duplicate POST');
    if(mode!=='apply')return {project:project.key,status:'NEEDS_GRAPH_CREATION',payload:submitted};
    const validation=await api('/rest/api/3/workflows/create/validation','POST',{payload:submitted,validationOptions:{levels:['ERROR','WARNING']}});
    const warnings=validateGraphResponse(validation);
    demand(warnings.length===0,'Workflow validation warnings require explicit review before creation');
    state.pending[requestId]={payload:submitted,bodyHash:expectedHash,startedAt:new Date().toISOString()};await save(state);
    await api('/rest/api/3/workflows/create','POST',submitted);
    reads.length=0;for(const wf of submitted.workflows)reads.push(await readWorkflow(api,wf.name));
  }
  const bindings={};
  for(const [i,wf]of submitted.workflows.entries()){
    const read=reads[i];compareWorkflow(wf,submitted.statuses,read.workflow,read.statuses);
    const approved=project.workflows[i],family=plan.workflowFamilies[approved.family],names=statusNames(plan)[approved.family];
    const stateBindings={};
    for(const name of family.states){const matches=read.statuses.filter(s=>s.name===names[name]&&read.workflow.statuses.some(ws=>String(ws.statusReference)===String(s.statusReference)));demand(matches.length===1,'Actual status identity ambiguous');stateBindings[name]={id:String(matches[0].id),name:matches[0].name,statusReference:String(matches[0].statusReference),statusCategory:matches[0].statusCategory};}
    bindings[approved.id]={id:read.workflow.id,name:wf.name,stateBindings,transitions:Object.fromEntries(read.workflow.transitions.map(t=>[t.name,{id:String(t.id)}]))};
  }
  state.projects[project.key]={...prior,payload:submitted,workflows:bindings,projectId:metadata.id,graphsCheckedAt:new Date().toISOString()};delete state.pending[requestId];await save(state);
  const schemeName=`${project.key} Showcase Workflows`,description=`${MARK}: ${project.key}`;
  const mappings={};for(const wf of project.workflows)for(const name of wf.issueTypes){const id=metadata.issueTypes?.[name]?.id;demand(id,'Missing issue type binding');demand(!mappings[id],'Issue type mapped more than once');mappings[id]=wf.name;}
  const defaultWorkflow=project.workflows.find(w=>w.issueTypes.includes('Task'))?.name;demand(defaultWorkflow,'No Task default workflow');
  const schemeBody={name:schemeName,description,defaultWorkflow,issueTypeMappings:mappings};
  const schemeId=`${project.key}/scheme`;let schemes=(await paged(api,'/rest/api/3/workflowscheme')).values.filter(s=>s.name===schemeName);
  demand(schemes.length<=1,'Ambiguous workflow scheme');
  if(!schemes.length){
    demand(!state.pending[schemeId],'Pending workflow scheme not visible; refuse duplicate POST');
    if(mode!=='apply')return {project:project.key,status:'NEEDS_SCHEME_CREATION',schemeBody};
    state.pending[schemeId]={bodyHash:graphHash(schemeBody),startedAt:new Date().toISOString()};await save(state);
    await api('/rest/api/3/workflowscheme','POST',schemeBody);
    schemes=(await paged(api,'/rest/api/3/workflowscheme')).values.filter(s=>s.name===schemeName);demand(schemes.length===1,'Created scheme missing or ambiguous');
  }
  const scheme=await api(`/rest/api/3/workflowscheme/${schemes[0].id}`);
  demand(scheme.name===schemeName&&scheme.description===description&&scheme.defaultWorkflow===defaultWorkflow&&isDeepStrictEqual(scheme.issueTypeMappings,mappings),'Workflow scheme content mismatch');
  delete state.pending[schemeId];state.projects[project.key].schemeId=String(scheme.id);await save(state);
  const association=async()=>{const a=await api(`/rest/api/3/workflowscheme/project?projectId=${metadata.id}`);demand(Array.isArray(a.values)&&a.values.length===1,'Invalid scheme association');return String(a.values[0].workflowScheme.id);};
  if(await association()!==String(scheme.id)){
    demand(!prior?.checkedAt,'Completed workflow association drift; preserve external reassociation');
    demand(!state.pending[`${project.key}/association`],'Uncertain workflow association; reconcile before retry');
    if(mode!=='apply')return {project:project.key,status:'NEEDS_EMPTY_PROJECT_ASSOCIATION',schemeId:scheme.id};
    const permissions=await api(`/rest/api/3/mypermissions?projectId=${metadata.id}&permissions=BROWSE_PROJECTS,ADMINISTER`);
    demand(permissions.permissions?.BROWSE_PROJECTS?.havePermission&&permissions.permissions?.ADMINISTER?.havePermission,'Same-project visibility/global workflow administrator proof missing');
    const security=await paged(api,`/rest/api/3/issuesecurityschemes/project?projectId=${metadata.id}`);
    // Require the positive project-association row with no security scheme, not a
    // user-filtered list of visible levels or an ambiguous 404.
    demand(security.values.length===1&&String(security.values[0].projectId)===metadata.id&&Object.keys(security.values[0]).every(k=>k==='projectId'),'Cannot prove absence of project issue-security scheme');
    const issues=await api('/rest/api/3/search/jql','POST',{jql:`project = ${project.key}`,maxResults:1,fields:['id']});
    demand(Array.isArray(issues.issues)&&issues.issues.length===0&&issues.isLast===true,'New project is not demonstrably empty; migration blocked');
    // Jira itself rejects assignment if issues appeared since the read.
    await durableMutation(state,()=>save(state),api,mode,`${project.key}/association`,'PUT','/rest/api/3/workflowscheme/project',{projectId:metadata.id,workflowSchemeId:String(scheme.id)},async()=>await association()===String(scheme.id));
  }
  state.projects[project.key].checkedAt=new Date().toISOString();await save(state);
  return {project:project.key,status:'GRAPH_AND_SCHEME_READBACK_PASS',workflowCount:project.workflows.length,schemeId:String(scheme.id)};
}
