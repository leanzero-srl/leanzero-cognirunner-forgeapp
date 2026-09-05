/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http'; import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../admin-panel/build-shot');
const server=http.createServer((req,res)=>{const p=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':'text/html');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();let count=0;
const checked=(name)=>{count++;console.log('PASS',name);};
try {
for(const kind of ['listener','job']){
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.addInitScript(()=>{window.__SHOT__='admin';window.__THEME__='light';window.__RESPONSES__={};});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const tab=kind==='listener'?'Listeners':'Scheduled Jobs', getter=kind==='listener'?'getListener':'getScheduledJob', saver=kind==='listener'?'saveListener':'saveScheduledJob', nameInput=kind==='listener'?'#lst-name':'#job-name';
 const back=()=>page.getByRole('button',{name:kind==='listener'?'← Back to listeners':'← Back to jobs',exact:true}).click();
 const edit=async n=>{await page.locator('.lst-table tbody tr:not(.rule-accordion-row)').nth(n).locator('.btn-edit').click();await page.locator(nameInput).waitFor();};
 const save=()=>page.locator('.section-actions .btn-edit',{hasText:/^Save$/}).click();
 const defer=async fn=>page.evaluate(fn=>{window.__RESPONSES__[fn]={then(resolve){window.__release=resolve;}};window.__release=null;},fn);
 const wait=()=>page.waitForFunction(()=>!!window.__release);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.locator('.tab-btn',{hasText:new RegExp('^\\s*'+tab+'\\s*$')}).click();
 if(kind==='listener'){
  await defer('testListener');await page.getByText('+ Add Listener',{exact:true}).click();await page.locator(nameInput).fill('Unsaved A');await page.locator('.evp-search').fill('comment');await page.locator('.evp-row',{hasText:'Comment added'}).locator('input').check();await page.locator('.mode-btn.mode-agent').click();await page.locator('.agc-textarea').fill('Read only');await page.locator('.lst-test .btn-solid').click();await wait();
  assert.equal(await page.locator('.section-actions .btn-edit').isDisabled(),true);checked('save cannot compete with a test for an unsaved ID');
  await back();await edit(1);
  const opened=await page.evaluate(()=>window.__CALLS__.filter(c=>c.name==='getListener').at(-1).payload.id);
  await page.evaluate(()=>window.__release({success:true,result:{ruleId:'lst-test-A',isValid:true,reason:'A only result'}}));await settle();assert.equal(await page.getByText('A only result',{exact:true}).count(),0);checked('late test never appears in another listener');
  await save();await page.waitForFunction(()=>window.__CALLS__.some(c=>c.name==='saveListener'));const saved=await page.evaluate(()=>window.__CALLS__.filter(c=>c.name==='saveListener').at(-1).payload.listener);assert.equal(saved.id,opened);checked('B save retains B ID after A test completes');await back();
 }
 // A save returning after opening B must not overwrite B identity or close B.
 await edit(0);const aName=await page.locator(nameInput).inputValue();await defer(saver);await save();await wait();await back();await edit(1);const bName=await page.locator(nameInput).inputValue();assert.notEqual(aName,bName);
 const opened=await page.evaluate(getter=>window.__CALLS__.filter(c=>c.name===getter).at(-1).payload.id,getter);
 await page.evaluate(kind=>{window.__release({success:true,[kind]:{id:'old-save-A'}});},kind);await settle();assert.equal(await page.locator(nameInput).inputValue(),bName);await page.evaluate(saver=>{delete window.__RESPONSES__[saver];},saver);await save();await settle();const submitted=await page.evaluate(([saver,kind])=>window.__CALLS__.filter(c=>c.name===saver).at(-1).payload[kind],[saver,kind]);assert.equal(submitted.id,opened);checked(kind+' late save preserves B name and ID');await back();
 // Two edit loads resolving out of order must honor the last clicked row.
 await defer(getter);await page.locator('.lst-table tbody tr:not(.rule-accordion-row)').nth(0).locator('.btn-edit').click();await wait();await page.evaluate(getter=>{delete window.__RESPONSES__[getter];},getter);await edit(1);const lastName=await page.locator(nameInput).inputValue();await page.evaluate(kind=>window.__release({success:true,[kind]:{id:'old-load-A',name:'Stale A',events:[],functions:[]}}),kind);await settle();assert.equal(await page.locator(nameInput).inputValue(),lastName);checked(kind+' out-of-order editor load honors latest selection');
 if(kind==='job'){
  await back();await defer('runScheduledJobNow');await page.locator('.lst-table tbody tr').first().getByRole('button',{name:'▶ Run now',exact:true}).click();await wait();await edit(1);
  const other=page.getByRole('button',{name:'Another job is running',exact:true});assert.equal(await other.count(),1);assert.equal(await other.isDisabled(),true);assert.equal(await page.locator('.lst-test').count(),0);checked('another running job keeps global lock without impersonating this editor');
  await page.evaluate(()=>window.__release({success:true,taskId:'harness-race-task'}));
 }
 await page.close();
}
}finally{await browser.close();server.close();console.log('EDITOR RACES',count,'passed');}
