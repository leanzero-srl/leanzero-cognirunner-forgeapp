/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSite, projectRegistry } from '../lib/org-workflow-compiler.mjs';
const plan = JSON.parse(await readFile(new URL('../../docs/org-expanded-approval-plan.json',import.meta.url)));
const site = plan.sites[0];
const suffix = {paragraph:'textarea','short-text':'textfield',number:'float',date:'datepicker','single-select':'select','single-user':'userpicker'};
const metadata = {site:site.site,installation:{appId:'36415848-6868-4697-9554-3c3ad87b8da9',environmentId:'989ecaa0-261b-406e-b444-78c01c0d7772'},projects:{}};
let next = 10000;
for (const project of site.projects) {
  const m = metadata.projects[project.key] = {id:String(next++),fields:{},statuses:{},issueTypes:{},workflows:{},creationAdmissions:{}};
  for (const field of project.customFields) m.fields[field.name] = {id:'customfield_' + next++,name:field.name,schema:{custom:'com.atlassian.jira.plugin.system.customfieldtypes:' + suffix[field.type]},projectKeys:[project.key],options:field.options?.map(value=>({id:String(next++),value}))};
  for (const name of ['duedate','fixVersions']) m.fields[name] = {id:name,name,projectKeys:[project.key]};
  for (const wf of project.workflows) {
    for (const name of wf.issueTypes) m.issueTypes[name] = {id:String(next++),subtask:['Sub-task','Verification Step','Recovery Step'].includes(name)};
    const family = plan.workflowFamilies[wf.family];
    for (const name of family.states) m.statuses[name] ||= {id:String(next++)};
    m.workflows[wf.id] = {id:String(next++),transitions:Object.fromEntries(family.edges.map(edge=>[edge.name,{id:String(next++),screenFields:['comment',...Object.values(m.fields).map(f=>f.id)]}]))};
  }
  for (const spec of project.configurations.filter(c=>['S02','S05'].includes(c.archetype))) m.creationAdmissions[spec.id] = {serializedController:true,id:'admission-123456',sourceIdentity:spec.creationSourceIdentity,sourceKey:project.key+'-42',sourceIssueId:'1042',destinationProjectKey:project.key,expiresAt:'2099-01-01T00:00:00Z'};
}
const compiled = compileSite(plan,site.site,metadata);
assert(compiled.rows.length > 300);
assert(compiled.blockers.every(b=>b.reason.startsWith('M04:')),JSON.stringify(compiled.blockers));
assert(compiled.rows.every(r=>r.rule.parameters.disabled === 'true'));
assert(compiled.rows.filter(r=>!['validator','condition'].includes(r.type)).every(r=>r.config.type === 'postfunction-' + r.type));
assert.equal(compiled.readyForActivation,false);
assert.deepEqual(compiled,compileSite(plan,site.site,metadata),'Stable identities and deterministic output');
assert.throws(()=>compileSite(plan,'leanzero.atlassian.net',metadata),/approved site/);
assert.throws(()=>compileSite(plan,site.site,{...metadata,site:'wolfaenpak.atlassian.net'}),/mismatch/);
const clone = structuredClone;
let bad = clone(metadata); bad.projects.APEX.fields['APEX Evidence'].projectKeys=['FOREIGN'];
assert(compileSite(plan,site.site,bad).blockers.some(b=>b.reason.includes('Wrong field context')));
bad = clone(metadata); bad.projects.APEX.fields['APEX Disposition'].schema.custom='x:textarea';
assert(compileSite(plan,site.site,bad).blockers.some(b=>b.reason.includes('Wrong field type')));
bad = clone(metadata); bad.projects.APEX.creationAdmissions['APEX.defect.S05'].destinationProjectKey='FOREIGN';
assert(compileSite(plan,site.site,bad).blockers.some(b=>b.reason.includes('Invalid destination')));
bad = clone(metadata); delete bad.projects.APEX.creationAdmissions['APEX.defect.S05'];
assert(compileSite(plan,site.site,bad).blockers.some(b=>b.reason.includes('serialized controller')));
const duplicate = clone(plan); duplicate.sites[0].projects[0].workflows[0].rules.push(duplicate.sites[0].projects[0].workflows[0].rules[0]);
assert(compileSite(duplicate,site.site,metadata).blockers.some(b=>b.reason.includes('Duplicate configuration')));
const noPresence = clone(plan); const wf = noPresence.sites[0].projects[0].workflows.find(w=>w.family==='evidence'); wf.rules = wf.rules.filter(id=>!id.endsWith('.presence'));
assert(compileSite(noPresence,site.site,metadata).blockers.some(b=>b.reason.includes('Presence prerequisite')));
const manifest = await readFile(new URL('../../manifest.yml',import.meta.url),'utf8');
const expression = manifest.split('expression: >-')[1].split('      create:')[0].trim();
const evaluateCondition = new Function('config','issue','user', 'return (' + expression + ');');
const ownerCondition = compiled.rows.find(r=>r.identity.endsWith('.C01')).config;
assert.equal(evaluateCondition({...ownerCondition,disabled:false},{assignee:{accountId:'owner'}},{accountId:'other'}),false);
assert.equal(evaluateCondition({...ownerCondition,disabled:false},{assignee:{accountId:'owner'}},{accountId:'owner'}),true);
assert.equal(evaluateCondition({...ownerCondition,disabled:false,conditionKind:undefined},{assignee:{accountId:'owner'}},{accountId:'other'}),true,'Negative control reproduces missing-kind fail-open');
for (const condition of compiled.rows.filter(r=>r.type==='condition')) {
  assert.equal(condition.config.conditionKind,'deterministic','Must enter actual manifest deterministic branch');
  assert.equal(condition.config.disabled,true);
}
assert(compiled.rows.filter(r=>!['validator','condition'].includes(r.type)).every(r=>r.config.simulationMode===true));
const c = compiled.rows.find(r=>r.config.ruleType==='field-equals'); assert.equal(c.config.exprKind,'opt');
const registry = projectRegistry(compiled.rows,[],{actorAccountId:'synthetic-test-actor',timestamp:'2026-09-10T00:00:00Z'});
assert.equal(registry.rows.length,compiled.rows.length);
assert(registry.bundles.length > 0);
assert.throws(()=>projectRegistry(compiled.rows,[{id:compiled.rows[0].config.id}],{actorAccountId:'test',timestamp:'2026-09-10'}),/overlaps/);
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
for (const row of compiled.rows.filter(r=>r.type==='static')) new AsyncFunction('api',row.config.functions[0].code);
const choose = type=>compiled.rows.find(r=>r.identity.endsWith('.'+type));
const run = (row,api)=>new AsyncFunction('api',row.config.functions[0].code)(api);
const project = 'APEX', fields = metadata.projects.APEX.fields;
const fid = name=>fields['APEX '+name].id;
const changes=[];
let issue = {id:'1042',key:'APEX-42',fields:{project:{key:project},duedate:'2026-12-29'}};
const api = {context:{issueKey:issue.key},getIssue:async()=>clone(issue),updateIssue:async(key,patch)=>changes.push({key,patch}),log:()=>{}};
await run(choose('S04'),api); assert.equal(changes[0].patch[fid('Review Due')],'2027-01-05');
changes.length=0; delete issue.fields.duedate; await run(choose('S04'),api); assert.equal(changes.length,0);
issue.fields.duedate='2026-02-30'; await assert.rejects(run(choose('S04'),api),/Invalid calendar/); assert.equal(changes.length,0);
await assert.rejects(run(choose('S04'),{...api,context:{issueKey:'OTHER-1'}}),/outside approved/);
// Parent inheritance preserves a populated owner and missing child evidence is explicit.
issue={id:'1042',key:'APEX-42',fields:{project:{key:'APEX'},parent:{key:'APEX-7'},[fid('Responsible Owner')]:{accountId:'existing-owner'}}};
changes.length=0;
await run(choose('S01'),{...api,getIssue:async key=>key==='APEX-42'?clone(issue):{fields:{project:{key:'APEX'},[fid('Responsible Owner')]:{accountId:'parent-owner'},[fid('Review Due')]:'2026-10-10'}}});
assert.deepEqual(changes,[{key:'APEX-42',patch:{[fid('Review Due')]:'2026-10-10'}}]);
const s03=choose('S03');
if(s03) {
  const owner=s03.projectKey, impact=metadata.projects[owner].fields[owner+' Impact Score'].id; const effects=[];
  await run(s03,{context:{issueKey:owner+'-1'},log:()=>{},getIssue:async key=>key===owner+'-1'?{fields:{project:{key:owner},subtasks:[{key:owner+'-2'},{key:owner+'-3'}]}}:{fields:{project:{key:owner},parent:{key:owner+'-1'},[impact]:key.endsWith('-2')?5:null}},updateIssue:async(key,patch)=>effects.push(patch),setProperty:async(key,value)=>effects.push(value)});
  assert.equal(effects[0][impact],5); assert.equal(effects[1].missingCount,1); assert.equal(effects[1].complete,false);
}
// Sequential create replay, ambiguous completion, and partial two-child recovery.
const s02=choose('S02'), property=new Map(), created=[], labels=new Map(); let failAfterCreate=false;
const createApi={context:{issueKey:'APEX-42'},log:()=>{},getIssue:async key=>key==='APEX-42'?{id:'1042',fields:{project:{key:'APEX'},issuelinks:[]}}:clone(created.find(i=>i.key===key)),
getProperty:async key=>key==='org-showcase.creation-admission'?{id:'admission-123456',state:'active'}:clone(property.get(key)),
setProperty:async(key,value)=>{if(failAfterCreate && Object.values(value.rows).some(r=>r.state==='created')) {failAfterCreate=false;throw new Error('uncertain property update');} property.set(key,clone(value));},
searchJql:async jql=>({issues:created.filter(i=>jql.includes(i.fields.labels[0])).map(i=>({key:i.key}))}),
createIssue:async fields=>{const row={key:'APEX-'+(100+created.length),fields}; created.push(clone(row));return {key:row.key};}};
failAfterCreate=true; await assert.rejects(run(s02,createApi),/uncertain/); assert.equal(created.length,1);
await run(s02,createApi); assert.equal(created.length,2);
await run(s02,createApi); assert.equal(created.length,2,'Replay never duplicates children');
const hidden={...createApi,searchJql:async()=>({issues:[]})}; property.clear(); property.set('org-showcase.create.'+(await import('node:crypto')).createHash('sha256').update(s02.identity).digest('hex').slice(0,24),{rows:{[plan.sites[0].projects[0].configurations.find(c=>c.id===s02.identity).createdIdentities[0]]:{state:'pending'}}});
await assert.rejects(run(s02,hidden),/Pending creation not visible/); assert.equal(created.length,2);
await assert.rejects(run(s02,{...createApi,getProperty:async()=>null}),/admission/);
console.log(JSON.stringify({status:'PASS',compiled:compiled.rows.length,explicitBlockers:compiled.blockers.length,staticScriptsParsed:compiled.rows.filter(r=>r.type==='static').length,tests:'target, fields, type, presence, duplicate, registry, dates, create partial recovery and replay'}));
