/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Persistent, additive fixtures requested by the owner. Never targets LeanZero.
// Auth is loaded from the existing gitignored harness .env, never from receipts.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireEnv } from '../lib/env.mjs';

const packs = {
  'apex-coresystems': ['APEX', 'Apex Platform Delivery', 'platform services', 'API gateway'],
  'beacon-logistics': ['BEAC', 'Beacon Logistics Delivery', 'shipment operations', 'shipment tracking'],
  'factory-liberation': ['FACT', 'Factory Operations Delivery', 'manufacturing operations', 'production scheduling'],
  'krypton-cybersec': ['KRYP', 'Krypton Security Delivery', 'security operations', 'vulnerability triage'],
  'leanzero-apps-demo': ['COGDEMO', 'CogniRunner Workflow Showcase', 'workflow automation', 'release readiness'],
  'solace-ai-labs': ['SOLA', 'Solace Research Delivery', 'AI research', 'evaluation pipeline'],
  'strata-datalabs': ['STRAT', 'Strata Data Delivery', 'data engineering', 'data quality checks'],
  'wolfaenpak': ['COGLAB', 'CogniRunner Scenario Showcase', 'workflow automation', 'change control'],
};
const site = process.argv[2];
const mode = process.argv[3] ?? 'plan';
if (!Object.hasOwn(packs, site) || !['plan', 'apply', 'verify'].includes(mode)) throw new Error('Use an explicitly allowlisted site and plan|apply|verify');
const [key, name, domain, feature] = packs[site];
const base = `https://${site}.atlassian.net`;
const marker = 'leanzero-org-showcase-20260910';
const root = resolve('test-harness/results/org-showcase-20260910');
mkdirSync(root, { recursive: true });
const receiptPath = resolve(root, `${site}.json`);
const state = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : { site, key, marker, issues: [], components: [], versions: [], links: [] };
if (state.site !== site || state.key !== key || state.marker !== marker) throw new Error('Receipt identity mismatch');
const save = () => { writeFileSync(receiptPath + '.tmp', JSON.stringify(state, null, 2) + '\n'); renameSync(receiptPath + '.tmp', receiptPath); };
const auth = Buffer.from(`${requireEnv('JIRA_ADMIN_EMAIL')}:${requireEnv('JIRA_API_TOKEN')}`).toString('base64');
async function request(path, method = 'GET', body) {
  if (!path.startsWith('/rest/')) throw new Error('Only relative product API paths allowed');
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(base + path, { method, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (r.status === 429 && attempt < 4) { await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1000, Number(r.headers.get('retry-after') ?? 2) * 1000)))); continue; }
    if (!r.ok) throw new Error(`${method} ${path} HTTP ${r.status}: ${text.slice(0,1200)}`);
    return text ? JSON.parse(text) : null;
  }
}
const adf = paragraphs => ({ type: 'doc', version: 1, content: paragraphs.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
async function metadata(path, key) {
  const rows=[];
  for(let startAt=0;;) {
    const page=await request(`${path}?startAt=${startAt}&maxResults=100`);
    const batch=page[key] ?? page.values ?? []; rows.push(...batch);
    if(page.isLast || !batch.length || rows.length >= (page.total ?? rows.length))return rows;
    startAt+=batch.length;
  }
}
const descriptions = [
  ['Release dependable ' + feature, 'Epic', 'Release scope includes delivery, review, operational readiness and measurable acceptance criteria.'],
  ['Define acceptance criteria for ' + feature, 'Task', 'Given an authorised operator, when the primary workflow completes, then the result is recorded and visible in the audit trail. Test normal, empty and denied inputs.'],
  ['Implement the primary ' + feature + ' flow', 'Task', 'Build the happy path with explicit validation and observable errors. Acceptance: saved values survive a reload and duplicate requests do not create duplicate records.'],
  ['Document retry and recovery procedures', 'Task', 'Describe transient failures, retry limits and operator recovery. Acceptance: recovery restores service without deleting the original evidence.'],
  ['Add automated acceptance coverage', 'Task', 'Exercise success, rejection and permission failures against the same target record. Acceptance: verify every visible field through an independent read.'],
  ['Review operational risks before release', 'Task', 'Record dependency failures, missing input and rollback steps. Acceptance: risks have an owner, impact and mitigation, and no critical item remains unexplained.'],
  ['Prepare a release summary for stakeholders', 'Task', 'Summarise the change, customer benefit, known limitations and verification evidence. Acceptance: the summary is understandable without reading implementation details.'],
  ['Investigate duplicate processing on retry', 'Bug', 'Steps: submit the same delivery request twice after a simulated timeout. Expected: one business outcome. Actual: two processing attempts appear. This is synthetic demo data, not a reported product defect.'],
  ['Triage an intentionally incomplete request', 'Task', 'Demo rejection case: this request deliberately omits acceptance criteria so a configured quality validator can explain what is missing.'],
  ['Classify incoming work for ' + domain, 'Task', 'Classify this request as an operational improvement. Acceptance: preserve the description, add the agreed label, and record the classification reason.'],
  ['Create a linked follow-up for release review', 'Task', 'Demonstrate a post-function that creates or links a follow-up without duplication. Acceptance: the follow-up refers to the original issue and a repeated run is safe.'],
  ['Check overdue work and publish a digest', 'Task', 'Demonstrate a scoped scheduled review. Acceptance: inspect only this showcase project and include the issue key, due date and required next step.'],
];
console.log(JSON.stringify({ site, mode, project: { key, name }, issueCount: descriptions.length, components: ['Delivery', 'Quality', 'Operations'], release: 'Showcase 1.0' }));
if (mode === 'plan') process.exit(0);
const me = await request('/rest/api/3/myself');
const permissions = await request('/rest/api/3/mypermissions?permissions=ADMINISTER,CREATE_PROJECT');
if (!me.active || !permissions.permissions.ADMINISTER.havePermission || !permissions.permissions.CREATE_PROJECT.havePermission) throw new Error('Admin preflight failed');
let project;
if (state.project) project = await request(`/rest/api/3/project/${state.project.id}`);
else if(state.pendingProject) {
  project=await request(`/rest/api/3/project/${key}`);
  if(project.key!==key || project.name!==name || !project.description?.includes(marker))throw new Error('Uncertain project create requires reconciliation');
  state.project={id:String(project.id),key};delete state.pendingProject;save();
}
else {
  // Positive site-level admin + key validation, not an empty search, licences creation.
  const validation = await request(`/rest/api/3/projectvalidate/key?key=${key}`);
  if (validation.errorMessages?.length || Object.keys(validation.errors ?? {}).length) throw new Error('Project key unavailable; refuse to adopt unowned project');
  if (mode !== 'apply') throw new Error('No owned project receipt');
  state.pendingProject=true;save();
  const created = await request('/rest/api/3/project', 'POST', { key, name, projectTypeKey: 'software', projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic', description: `${marker}. Persistent synthetic showcase for ${domain}.`, leadAccountId: me.accountId, assigneeType: 'UNASSIGNED' });
  state.project = { id: String(created.id), key }; delete state.pendingProject; save();
  project = await request(`/rest/api/3/project/${created.id}`);
}
if (project.key !== key || project.name !== name || !project.description?.includes(marker)) throw new Error('Project readback identity failed');
const components = await request(`/rest/api/3/project/${key}/components`);
for (const n of ['Delivery','Quality','Operations']) {
  let c = components.find(x => x.name === n);
  if (!c && mode === 'apply') { c = await request('/rest/api/3/component','POST',{name:n,project:key,description:`${marker}: ${n.toLowerCase()} workstream`}); state.components.push({id:c.id,name:n}); save(); }
  if (!c) throw new Error(`Missing component ${n}`);
}
let versions = await request(`/rest/api/3/project/${key}/versions`);
let version = versions.find(x => x.name === 'Showcase 1.0');
if (!version && mode === 'apply') { version = await request('/rest/api/3/version','POST',{name:'Showcase 1.0',projectId:Number(project.id),description:marker,released:false,releaseDate:'2026-10-16'});state.versions.push({id:version.id,name:version.name});save(); }
if (!version) throw new Error('Missing release');
const issueTypes = await metadata(`/rest/api/3/issue/createmeta/${key}/issuetypes`, 'issueTypes');
const fieldsByType = new Map();
for (let i=0;i<descriptions.length;i++) {
  const [summary,typeName,detail] = descriptions[i];
  const type = issueTypes.find(t => t.name === typeName);
  if (!type) throw new Error(`Missing ${typeName} create type`);
  if (!fieldsByType.has(type.id)) {
    const meta = await metadata(`/rest/api/3/issue/createmeta/${key}/issuetypes/${type.id}`, 'fields');
    fieldsByType.set(type.id, meta);
  }
  const meta=fieldsByType.get(type.id);
  const supported = new Set(meta.map(f=>f.fieldId ?? f.key));
  const scenarioLabel=`org-showcase-scenario-${i+1}`;
  const expected = { summary, project:{key}, issuetype:{id:type.id}, description:adf([`${name}: ${domain}. Synthetic demo content.`,detail,`Scenario ${i+1} of ${descriptions.length}. Created for persistent demonstrations of CogniRunner. No customer data.`]),labels:[marker, scenarioLabel, 'cognirunner-showcase',i===8?'quality-gate-incomplete':'quality-gate-ready'] };
  const allComponents = await request(`/rest/api/3/project/${key}/components`);
  if (supported.has('components')) expected.components=[{id:allComponents.find(c=>c.name===['Delivery','Quality','Operations'][i%3]).id}];
  if (supported.has('fixVersions')) expected.fixVersions=[{id:version.id}];
  if (supported.has('duedate')) expected.duedate = i===11 ? '2026-09-09' : `2026-10-${String(2+i).padStart(2,'0')}`;
  if (i>0 && supported.has('parent')) expected.parent={key:state.issues[0].key};
  if(i>0 && !expected.parent)throw new Error('Required epic parent unavailable; stop rather than create flat fixtures');
  for(const f of meta) {
    const id=f.fieldId ?? f.key;
    if(f.name==='Epic Name' && typeName==='Epic')expected[id]=summary;
    if(f.required && !f.hasDefaultValue && !Object.hasOwn(expected,id))throw new Error(`Required field ${f.name} needs a value`);
  }
  if (!state.issues[i]) {
    if (mode !== 'apply') throw new Error(`Missing issue receipt ${i}`);
    let issue;
    if(state.pendingIssue) {
      if(state.pendingIssue.index!==i)throw new Error('Pending scenario identity mismatch');
      const matches=await request('/rest/api/3/search/jql','POST',{jql:`project = ${key} AND labels = "${marker}" AND labels = "${scenarioLabel}"`,fields:['summary'],maxResults:2});
      if(matches.issues?.length!==1)throw new Error('Uncertain issue POST: wait for indexing and reconcile; refusing duplicate creation');
      issue=matches.issues[0];
    } else {
      state.pendingIssue={index:i,expected};save();
      issue = await request('/rest/api/3/issue','POST',{fields:expected});
    }
    state.issues[i]={key:issue.key,id:issue.id,expected};delete state.pendingIssue;save();
  }
  const actual = await request(`/rest/api/3/issue/${state.issues[i].key}?fields=summary,description,project,issuetype,labels,components,fixVersions,duedate,parent,status`);
  const want = state.issues[i].expected;
  for (const f of ['summary','description','duedate']) if (Object.hasOwn(want,f) && JSON.stringify(actual.fields[f])!==JSON.stringify(want[f])) throw new Error(`${actual.key} ${f} mismatch`);
  if(JSON.stringify([...actual.fields.labels].sort())!==JSON.stringify([...want.labels].sort()))throw new Error(`${actual.key} labels mismatch`);
  if(actual.fields.project.key!==key || actual.fields.issuetype.id!==want.issuetype.id)throw new Error('Issue project/type mismatch');
  for (const f of ['components','fixVersions']) if(want[f] && JSON.stringify(actual.fields[f].map(x=>x.id).sort())!==JSON.stringify(want[f].map(x=>x.id).sort()))throw new Error(`${actual.key} ${f} mismatch`);
  if(want.parent && actual.fields.parent?.key!==want.parent.key)throw new Error('Parent mismatch');
  state.issues[i].verifiedAt=new Date().toISOString();save();
  console.log(JSON.stringify({site,issue:actual.key,verified:true}));
}
state.verifiedAt=new Date().toISOString();save();
console.log(JSON.stringify({site,verified:state.issues.length,receipt:receiptPath}));
