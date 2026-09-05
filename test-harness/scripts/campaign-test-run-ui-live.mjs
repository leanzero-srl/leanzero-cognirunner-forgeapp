/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '../../static/_screenshot-harness/node_modules/playwright/index.mjs';
const out=new URL('../results/listeners-jobs-campaign/ui-final/',import.meta.url).pathname;fs.mkdirSync(out,{recursive:true});
const state=JSON.parse(fs.readFileSync(new URL('../results/listeners-jobs-campaign/state.json',import.meta.url)));
const item=state.listeners.find(x=>x.code==='L20');
const evidence={startedAt:new Date().toISOString(),checks:[],pageErrors:[],saveRequests:[]};
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({storageState:'/Users/mihaiperdum/Projects/forge-live-harness/.auth/storage-state.json',viewport:{width:1440,height:1100}});
const page=await ctx.newPage(),frame=page.frameLocator('iframe').first();
page.on('pageerror',e=>evidence.pageErrors.push(e.message));
page.on('request',r=>{if((r.postData()||'').includes('"saveListener"'))evidence.saveRequests.push({url:r.url(),method:r.method()});});
const responseFor=name=>page.waitForResponse(r=>(r.request().postData()||'').includes('"'+name+'"'),{timeout:60000});
const open=async()=>{await frame.getByRole('textbox',{name:'Search listeners',exact:true}).fill(state.tag+' L20 ');const row=frame.locator('.lst-name').filter({hasText:new RegExp('^'+state.tag+' L20 ')}).locator('..').locator('..');const pending=responseFor('getListener');await row.getByRole('button',{name:'Edit',exact:true}).click();const response=await pending;const config=(await response.json()).data.invokeExtension.response.body.listener;await frame.locator('.function-block').first().waitFor();assert.equal(config.id,item.id);return config;};
try{
 await page.goto('https://wolfaenpak.atlassian.net/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-261b-406e-b444-78c01c0d7772',{waitUntil:'domcontentloaded'});
 await frame.locator('.tab-btn').filter({hasText:/^Listeners$/}).waitFor({timeout:60000});await frame.locator('.tab-btn').filter({hasText:/^Listeners$/}).click();
 evidence.before=await open();
 const block=frame.locator('.function-block').first(),editor=block.locator('.cm-content');
 await block.locator('.btn-test-run').click();
 for(const [name,code,message] of [['null','throw null;','null'],['number','throw 42;','42'],['string',"throw 'cgr-ui-thrown-string';",'cgr-ui-thrown-string']]){
  await editor.fill(code);const pending=responseFor('testPostFunction');await block.locator('.btn-run-test').click();const response=await pending;const data=(await response.json()).data.invokeExtension.response.body;
  assert.equal(data.success,false,JSON.stringify(data));await block.locator('.test-result.test-fail').waitFor();const text=await block.locator('.test-result').innerText();assert.equal(await block.locator('.test-badge').innerText(),'FAIL');assert.ok(text.includes(message),text);assert.ok(data.logs.includes('ERROR: '+message),JSON.stringify(data));
  evidence.checks.push({name,code,response:data,text,request:JSON.parse(response.request().postData())});
  for(const theme of ['light','dark']){await frame.locator('html').evaluate((html,t)=>{html.setAttribute('data-color-mode',t);html.setAttribute('data-theme',`${t}:${t}`)},theme);await block.locator('.test-panel').screenshot({path:out+`test-run-${name}-${theme}.png`,animations:'disabled'});}
  console.log('PASS',name,JSON.stringify(data.logs));
 }
 await frame.getByRole('button',{name:'← Back to listeners',exact:true}).click();
 evidence.after=await open();assert.deepEqual(evidence.after.functions,evidence.before.functions);assert.equal(evidence.after.updatedAt,evidence.before.updatedAt);assert.equal(await frame.locator('.function-block').first().locator('.cm-content').innerText(),evidence.before.functions[0].code);
 await frame.getByRole('button',{name:'← Back to listeners',exact:true}).click();assert.deepEqual(evidence.saveRequests,[]);assert.deepEqual(evidence.pageErrors,[]);evidence.pass=true;
}catch(e){evidence.pass=false;evidence.error=e.stack;process.exitCode=1;console.error(e.stack);await page.screenshot({path:out+'test-run-failure.png'});}
finally{evidence.finishedAt=new Date().toISOString();for(const check of evidence.checks)delete check.request;fs.writeFileSync(out+'test-run.json',JSON.stringify(evidence,null,2));await browser.close();}
