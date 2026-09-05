/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '../../static/_screenshot-harness/node_modules/playwright/index.mjs';
import { testState } from '../lib/rules-api.mjs';
import { getMyself,get,getIssue,post,del,BASE } from '../lib/jira.mjs';
assert.equal(new URL(BASE).hostname,'wolfaenpak.atlassian.net');
const out=new URL('../results/listeners-jobs-review',import.meta.url).pathname;fs.mkdirSync(out,{recursive:true});
const tag='cgrux'+Date.now().toString(36), evidence={tag,checks:[],cleanup:[]};
const created={issues:[],jobs:[],listeners:[]};let browser;
const record=(name,data={})=>{evidence.checks.push({name,...data});console.log('PASS',name,JSON.stringify(data));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const me=await getMyself();
const call=async(name,payload={})=>{const r=await testState.post({action:'invokeResolver',functionKey:name,accountId:me.accountId,payload});assert.ok(r.ok,name+' HTTP '+r.status);assert.ok(r.body.success!==false,name+': '+r.body.error);return r.body;};
const poll=async(fn,predicate,tries=40,interval=2000)=>{let value;for(let i=0;i<tries;i++){value=await fn();if(predicate(value))return value;await sleep(interval);}throw Error('Timed out: '+JSON.stringify(value).slice(0,600));};
const property=async key=>{try{return await get(`/rest/api/3/issue/${key}/properties/${tag}`);}catch(e){if(e.status===404)return null;throw e;}};
try{
const types=await get('/rest/api/3/issue/createmeta/LZPT/issuetypes?maxResults=100');
const type=(types.issueTypes||types.values||[]).find(t=>!t.subtask&&/task/i.test(t.name))||(types.issueTypes||types.values||[]).find(t=>!t.subtask);assert.ok(type);
for(const name of ['A','B']){const i=await post('/rest/api/3/issue',{fields:{project:{key:'LZPT'},issuetype:{id:type.id},summary:tag+' '+name,labels:[tag]}});created.issues.push(i.key);}
const [A,B]=created.issues;console.log('Fixtures',A,B);assert.equal((await getIssue(B,['summary'])).key,B);
await poll(()=>post('/rest/api/3/search/jql',{jql:`key in (${A},${B})`,fields:['key'],maxResults:2}),r=>r.issues?.length===2);
const draft={name:tag+' filter test',enabled:false,events:['avi:jira:updated:issue'],functions:[{id:'fn-1',name:'label',code:`await api.addLabels('${tag}-sim');`} ]};
for(const [name,filters,skipped] of [['matching',{projectKeys:['LZPT'],issueTypes:[type.name],changedFields:['summary'],jql:`key = ${A}`},false],['project',{projectKeys:['COGTEST']},true],['type',{issueTypes:['DefinitelyNotAType']},true],['field',{changedFields:['definitelynotafield']},true],['JQL',{jql:`key = ${B}`},true]]){
const {result}=await call('testListener',{listener:{...draft,filters},issueKey:A,eventType:draft.events[0]});assert.equal(result.skipped,skipped);assert.equal(result.isValid,true);assert.equal((result.changes||[]).length,skipped?0:1);if(skipped)assert.equal(result.decision,'SKIP');record('filter '+name,result);
}
const jqlError=await call('testListener',{listener:{...draft,filters:{jql:'this is definitely invalid JQL ('}},issueKey:A});assert.equal(jqlError.result.isValid,false);assert.equal(jqlError.result.skipped,true);record('invalid JQL stops test',jqlError.result);
const after=await getIssue(A,['labels']);assert.ok(!after.fields.labels.includes(tag+'-sim'));record('whole listener test wrote nothing',{key:A,labels:after.fields.labels});
// Save a disabled job to exercise the REAL code-step tester via the browser, not the test hook.
const beforeStep=await getIssue(A,['labels','assignee','comment']);
const job=(await call('saveScheduledJob',{job:{name:tag+' step-test',enabled:false,schedule:{cron:'0 9 * * 1-5',timeZone:'UTC'},functions:[{id:'fn-1',name:'Null context witness',code:"await api.addComment('must not be written');"}]}})).job;created.jobs.push(job.id);
browser=await chromium.launch({headless:true});const ctx=await browser.newContext({storageState:new URL('../../../forge-live-harness/.auth/storage-state.json',import.meta.url).pathname,viewport:{width:1440,height:1100}});const page=await ctx.newPage();
await page.goto(`${BASE}/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-261b-406e-b444-78c01c0d7772`,{waitUntil:'domcontentloaded'});
let frame;await poll(async()=>{frame=page.frames().find(f=>f.url().includes('cdn.prod.atlassian-dev.net'));return !!frame&&await frame.locator('.tab-btn').count()>0;},v=>v,60,1000);
const tab=async name=>{await frame.locator('.tab-btn',{hasText:new RegExp('^\\s*'+name+'\\s*$')}).click();};
await tab('Scheduled Jobs');await frame.locator('tr',{hasText:job.name}).locator('button',{hasText:'Edit'}).click();await frame.locator('#job-name').waitFor();
assert.match(await frame.locator('.schp-zone .dropdown-trigger').innerText(),/UTC/);record('saved UTC visibly selected');
await frame.locator('.btn-test-run').click();await frame.locator('.btn-run-test').click();await frame.locator('.test-result.test-fail').waitFor({timeout:30000});
const failed=await frame.locator('.test-result').innerText();assert.match(failed,/needs a current issue/);assert.doesNotMatch(failed,/MOCK-1|Mock data/);record('real step tester rejects null issue',{text:failed});
await frame.locator('.test-panel').screenshot({path:out+'/step-null-fails.png'});
await frame.locator('.cm-content').fill(`await api.forIssue('${A}').addLabels('${tag}-sim'); await api.forIssue('${A}').setAssignee('${me.accountId}');`);
await frame.locator('.btn-run-test').click();await frame.locator('.test-result.test-pass').waitFor({timeout:30000});
const passed=await frame.locator('.test-result').innerText();assert.doesNotMatch(passed,/Mock data/);record('real step tester supports full API and explicit target',{text:passed});
await frame.locator('.test-panel').screenshot({path:out+'/step-explicit-simulates.png'});
const simRead=await getIssue(A,['labels','assignee','comment']);assert.deepEqual(simRead.fields,beforeStep.fields);record('step tests wrote no label, assignee or comment',{fieldsUnchanged:true});
// Cancel a scoped run AFTER its first independently observed write. Keep all per-issue outcomes.
const cancelJob=(await call('saveScheduledJob',{job:{name:tag+' cancel-after-first',enabled:false,schedule:{cron:'0 9 * * *',timeZone:'UTC'},scope:{jql:`key in (${A},${B}) ORDER BY key ASC`,maxIssues:2},functions:[{id:'fn-1',name:'Mark then wait',code:`await api.setProperty('${tag}',{tag:'${tag}'}); await new Promise(r=>setTimeout(r,25000)); return true;`}]}})).job;created.jobs.push(cancelJob.id);
await tab('Execution Logs');const run=await call('runScheduledJobNow',{id:cancelJob.id});
await poll(()=>property(A),v=>v?.value?.tag===tag,30,1000);record('first scoped issue write observed',{key:A,taskId:run.taskId});
const active=frame.locator('.section').filter({has:frame.locator('.section-title',{hasText:'Active Jobs'})}).first();await active.locator('button',{hasText:/^Refresh$/}).click();
const activeRow=frame.locator('.job-entry',{hasText:cancelJob.name});await activeRow.locator('.job-stop').waitFor({timeout:10000});await activeRow.locator('.job-stop').click();
const done=await poll(()=>call('getLogs',{ruleId:cancelJob.id}),r=>r.logs?.some(l=>l.ruleId===cancelJob.id&&l.perIssue?.length===2),40,2000);const log=done.logs.find(l=>l.ruleId===cancelJob.id&&l.perIssue?.length===2);
assert.equal(log.isValid,false);assert.match(log.reason,/1\/2 issue\(s\) processed OK/);assert.equal(log.perIssue[0].success,true);assert.equal(log.perIssue[1].success,false);assert.match(log.perIssue[1].reason,/cancelled/);assert.equal((await property(A)).value.tag,tag);assert.equal(await property(B),null);record('cancelled job accounts for every issue, preserves first write and skips second',log);
// Whole-listener result SKIP must be visible both in its own accordion and global logs.
const saved=(await call('saveListener',{listener:{...draft,name:tag+' visible-skip',filters:{projectKeys:['COGTEST']}}})).listener;created.listeners.push(saved.id);
await call('testListener',{id:saved.id,issueKey:A});await tab('Listeners');await frame.locator('tr',{hasText:saved.name}).locator('.rule-expand-btn').click();await frame.locator('.rule-accordion-inner .runres-badge.skip').waitFor();record('listener accordion displays SKIPPED');await frame.locator('.rule-accordion-inner').screenshot({path:out+'/listener-skipped.png'});
} catch(e){evidence.error=e.stack;console.error(e.stack);process.exitCode=1;}finally{
if(browser)await browser.close();
for(const id of created.listeners){try{await call('deleteListener',{id});evidence.cleanup.push({listener:id,removed:true});}catch(e){evidence.cleanup.push({listener:id,error:e.message});process.exitCode=1;}}
for(const id of created.jobs){try{await call('deleteScheduledJob',{id});evidence.cleanup.push({job:id,removed:true});}catch(e){evidence.cleanup.push({job:id,error:e.message});process.exitCode=1;}}
for(const key of created.issues){try{await del('/rest/api/3/issue/'+key);let missing=false;try{await getIssue(key,['summary']);}catch(e){if(e.status===404)missing=true;else throw e;}assert.ok(missing);evidence.cleanup.push({issue:key,removed:true});}catch(e){evidence.cleanup.push({issue:key,error:e.message});process.exitCode=1;}}
fs.writeFileSync(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log('Evidence',out,'checks',evidence.checks.length,'cleanup',JSON.stringify(evidence.cleanup));
}
