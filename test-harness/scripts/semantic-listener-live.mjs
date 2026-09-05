/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs';import assert from 'node:assert/strict';
import {testState} from '../lib/rules-api.mjs';
import {getMyself,get,getIssue,post,put,del,BASE} from '../lib/jira.mjs';
assert.equal(new URL(BASE).hostname,'wolfaenpak.atlassian.net');
const me=await getMyself(),tag='cgrsemantic'+Date.now().toString(36),issues=[],evidence={tag,checks:[],cleanup:[]};let rule;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const call=async(name,payload={})=>{const r=await testState.post({action:'invokeResolver',functionKey:name,payload,accountId:me.accountId});assert.ok(r.ok);assert.ok(r.body.success!==false,JSON.stringify(r.body));return r.body;};
const wait=async(fn,p,tries=45)=>{let v;for(let i=0;i<tries;i++){v=await fn();if(p(v))return v;await pause(2000);}throw Error('Timeout '+JSON.stringify(v).slice(0,1000));};
try{
 const types=await get('/rest/api/3/issue/createmeta/LZPT/issuetypes');const type=(types.issueTypes||types.values).find(t=>!t.subtask&&/task/i.test(t.name));
 for(const summary of ['Customer cannot sign in to the service and requests help','Routine release announcement: all systems healthy, no user problem reported']){const issue=await post('/rest/api/3/issue',{fields:{project:{key:'LZPT'},issuetype:{id:type.id},summary,labels:[tag]}});issues.push(issue.key);}
 await wait(()=>post('/rest/api/3/search/jql',{jql:`key in (${issues.join(',')})`,maxResults:2,fields:['key']}),v=>v.issues?.length===2);
 const listener={name:tag,enabled:false,events:['avi:jira:updated:issue'],filters:{projectKeys:['LZPT'],changedFields:['summary'],jql:`key in (${issues.join(',')})`},aiCondition:'The issue summary describes a customer who cannot sign in and needs assistance.',functions:[{name:'Acknowledge sign-in problem',code:`await api.addComment('${tag} condition matched');`}]};
 for(const [i,key] of issues.entries()){
  const {result}=await call('testListener',{listener,issueKey:key});assert.equal(result.gate.match,i===0);assert.equal(result.skipped,i!==0);assert.equal((result.changes||[]).length,i===0?1:0);const data=await getIssue(key,['comment']);assert.ok(!JSON.stringify(data.fields.comment).includes(tag+' condition matched'));evidence.checks.push({kind:'simulated semantic gate',key,result,commentUnchanged:true});console.log('PASS simulated AI gate',key,result.gate.match);
 }
 rule=(await call('saveListener',{listener:{...listener,enabled:true}})).listener;
 await pause(35000);
 for(const key of issues){const issue=await getIssue(key,['summary']);await put('/rest/api/3/issue/'+key,{fields:{summary:issue.fields.summary+' [review]'}});}
 const logs=await wait(()=>call('getLogs',{ruleId:rule.id}),r=>issues.every(key=>r.logs?.some(l=>l.issueKey===key&&l.source==='async')));
 for(const [i,key] of issues.entries()){
  const log=logs.logs.find(l=>l.issueKey===key&&l.source==='async');const issue=await getIssue(key,['comment']);const comments=issue.fields.comment.comments.filter(c=>JSON.stringify(c.body).includes(tag+' condition matched'));
  assert.equal(comments.length,i===0?1:0);if(i===0){assert.equal(log.isValid,true);assert.notEqual(log.decision,'SKIP');}else assert.equal(log.decision,'SKIP');evidence.checks.push({kind:'real event semantic gate',key,log,matchingComments:comments.map(c=>c.id)});console.log('PASS real AI gate',key,'exact comments',comments.length);
 }
}catch(e){evidence.error=e.stack;console.error(e.stack);process.exitCode=1;}finally{
 if(rule){await call('deleteListener',{id:rule.id});const r=await call('getListeners');assert.ok(!r.listeners.some(l=>l.id===rule.id));evidence.cleanup.push({listener:rule.id,removed:true});}
 for(const key of issues){await del('/rest/api/3/issue/'+key);let missing=false;try{await getIssue(key,['summary']);}catch(e){if(e.status===404)missing=true;else throw e;}assert.ok(missing);evidence.cleanup.push({issue:key,removed:true});}
 fs.mkdirSync(new URL('../results',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../results/semantic-listener-live.json',import.meta.url),JSON.stringify(evidence,null,2));console.log('CHECKS',evidence.checks.length,'cleanup',evidence.cleanup.length);
}
