/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// Real REST-created rules, Jira product events and the platform scheduler. Commands:
// provision | listeners | jobs | snapshot | cleanup. State is persisted after every write.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { rulesApi, ensureRulesApi, closeRulesApi } from '../lib/rules-api.mjs';
import { BASE, get, post, put, del, getIssue, getMyself, sleep, request } from '../lib/jira.mjs';
assert.equal(new URL(BASE).hostname, 'wolfaenpak.atlassian.net');
const dir = new URL('../results/listeners-jobs-campaign/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const file = new URL('state.json', dir), phase = process.argv[2];
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { tag: 'campaign'+Date.now().toString(36), startedAt:new Date().toISOString(), listeners:[], jobs:[], fixtures:{issues:[],versions:[],components:[]}, checks:[] };
const save = () => fs.writeFileSync(file, JSON.stringify(state,null,2));
const record = (name, data={}) => { state.checks.push({name,at:new Date().toISOString(),pass:true,...data});save();console.log('PASS',name); };
const attempt = async (name, fn) => { state.activeTriggerAt=Date.now();save();try { await fn(); } catch(e) { state.checks.push({name,at:new Date().toISOString(),pass:false,error:e.stack});save();console.error('FAIL',name,e.message);process.exitCode=1; } };
const must = (r, what) => { assert.ok(r.ok,`${what}: HTTP${r.status} ${JSON.stringify(r.body).slice(0,500)}`);return r.body; };
const adf = text => ({type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text}]}]});
const plain = n => typeof n?.text==='string'?n.text:(n?.content||[]).map(plain).join('');
const poll = async (fn, predicate, seconds=180) => { const end=Date.now()+seconds*1000;let value;do{value=await fn();if(predicate(value))return value;await sleep(3000);}while(Date.now()<end);throw Error('Timed out: '+JSON.stringify(value).slice(0,700)); };
const logs = async id => must(await rulesApi.logs(id),'logs').logs||[];
const prop = async (key, code) => {try{return (await get(`/rest/api/3/issue/${key}/properties/${state.tag}-${code}`)).value;}catch(e){if(e.status===404)return null;throw e;}};
const comments = async key => (await get(`/rest/api/3/issue/${key}/comment?maxResults=100`)).comments;
const markerComments = async (key, marker) => (await comments(key)).filter(c=>plain(c.body).includes(marker));
const row = (kind, code) => state[kind].find(r=>r.code===code);
async function createIssue(name, extra={}) {
 const i=await post('/rest/api/3/issue',{fields:{project:{key:'LZPT'},issuetype:{id:state.type.id},summary:`${state.tag} ${name}`,labels:[state.tag],...extra}});
 state.fixtures.issues.push(i.key);save();return i.key;
}
async function newRule(kind, code, title, config) {
 const noun=kind==='listeners'?'listener':'job';
 const body={name:`${state.tag} ${code} ${title}`,description:`Campaign ${code}: ${title}`,enabled:kind==='listeners',...config};
 const r=await rulesApi[kind].create(body);assert.equal(r.status,201,JSON.stringify(r.body));
 const full=r.body[noun];state[kind].push({code,id:full.id,name:full.name,config:full});save();
 const read=must(await rulesApi[kind].get(full.id),'independent GET')[noun];
 assert.equal(read.name,body.name);assert.match(read.createdBy,/^api:/);
 for(const key of ['mode','events','filters','functions','agent','schedule','scope','simulationMode','ignoreSelf','enabled']) if(full[key]!==undefined) assert.deepEqual(read[key],full[key],`${code} ${key}`);
 record(`${code} REST201 and full GET`,{id:full.id,createdBy:read.createdBy});return full;
}
async function provision() {
 assert.equal(state.listeners.length+state.jobs.length,0,'Existing campaign: use its next phase or cleanup first');
 state.baseline={listeners:must(await rulesApi.listeners.list(),'listeners').listeners,jobs:must(await rulesApi.jobs.list(),'jobs').jobs};save();
 const {url}=await ensureRulesApi();
 for(const resource of ['listeners','jobs']) for(const auth of ['', 'Bearer cgr_'+'0'.repeat(48)]) {
  const rejected=await fetch(`${url}?resource=${resource}`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify({name:state.tag+'-unauthorized'})});
  assert.equal(rejected.status,401);record(`${resource} rejects ${auth?'invalid':'missing'} token`);
 }
 const types=await get('/rest/api/3/issue/createmeta/LZPT/issuetypes?maxResults=100');
 state.type=(types.issueTypes||types.values).find(t=>!t.subtask&&/task/i.test(t.name));assert.ok(state.type);state.project=await get('/rest/api/3/project/LZPT');state.accountId=(await getMyself()).accountId;save();
 state.A=await createIssue('issue events');state.B=await createIssue('child events');state.C=await createIssue('scope third');state.ledger=await createIssue('event ledger');state.ai=await createIssue('AI events');save();
 await poll(()=>post('/rest/api/3/search/jql',{jql:`key in (${state.fixtures.issues.join(',')})`,fields:['key'],maxResults:10}),r=>r.issues?.length===5);
 const T=state.tag,A=state.A,B=state.B,C=state.C,D=state.ai,ledger=state.ledger;
 const eventCode=(code,target,extract='{}')=>`await api.forIssue(${JSON.stringify(target)}).setProperty('${T}-${code}', {marker:'${code}', issueKey:api.context.issueKey, eventType:api.context.eventType, data:${extract}});`;
 const add=async(code,title,event,target,extra={},extract='{}')=>newRule('listeners',code,title,{events:[event],filters:{projectKeys:['LZPT'],jql:`key = ${target}`,...extra.filters},functions:[{name:title,code:eventCode(code,target,extract)}],...extra});
 await newRule('listeners','L01','Created issue label',{events:['avi:jira:created:issue'],filters:{projectKeys:['LZPT'],issueTypes:[state.type.id]},functions:[{name:'Initialize label',code:`const i=await api.getIssue(); if(!i.fields.summary.startsWith('${T}')) return; await api.addLabels('${T}-L01');`}]});
 await add('L02','Summary and type filter','avi:jira:updated:issue',A,{filters:{projectKeys:['LZPT'],jql:`key = ${A}`,changedFields:['summary'],issueTypes:[state.type.id]}},'api.context.event.changelog.items');
 await add('L03','Priority change context','avi:jira:updated:issue',A,{filters:{projectKeys:['LZPT'],jql:`key = ${A}`,changedFields:['priority']}},'api.context.event.changelog.items');
 await add('L04','Assignment event','avi:jira:assigned:issue',A,{},'api.context.event.issue.fields.assignee');
 await add('L05','Comment regex match','avi:jira:commented:issue',A,{filters:{projectKeys:['LZPT'],jql:`key = ${A}`,commentPattern:T+'-regex'}},'{commentId:api.context.event.comment.id}');
 await add('L06','Semantic refund gate','avi:jira:commented:issue',D,{filters:{projectKeys:['LZPT'],jql:`key = ${D}`,commentPattern:T+'-semantic'},aiCondition:'The new comment requests a refund or asks to have money returned.'},'{commentId:api.context.event.comment.id}');
 await add('L07','Runtime AI actions','avi:jira:commented:issue',D,{filters:{projectKeys:['LZPT'],jql:`key = ${D}`,commentPattern:T+'-agent-trigger'},mode:'agent',agent:{instructions:`Add label ${T}-L07 and one comment containing exactly ${T}-L07-ack to the current issue. Then finish.`,allowedActions:['add_labels','add_comment'],maxRounds:4}});
 await newRule('listeners','L08','Deleted issue snapshot',{events:['avi:jira:deleted:issue'],filters:{projectKeys:['LZPT']},functions:[{name:'Record deletion',code:`if(!(api.context.event.issue.fields.summary||'').startsWith('${T}'))return; ${eventCode('L08',ledger,'{key:api.context.issueKey}')} `}]});
 await add('L09','Deleted comment identity','avi:jira:deleted:comment',B,{},'{id:api.context.event.comment.id}');
 await add('L10','Created worklog identity','avi:jira:created:worklog',B,{},'api.context.event.worklog');
 await add('L11','Updated worklog value','avi:jira:updated:worklog',B,{},'api.context.event.worklog');
 await add('L12','Deleted worklog identity','avi:jira:deleted:worklog',B,{},'api.context.event.worklog');
 await add('L13','Attachment created identity','avi:jira:created:attachment',B,{},'api.context.event.attachment');
 await add('L14','Attachment deleted identity','avi:jira:deleted:attachment',B,{},'api.context.event.attachment');
 await add('L15','Link created endpoints','avi:jira:created:issuelink',B,{filters:{projectKeys:['LZPT'],jql:`key in (${B},${C})`}},'{source:api.context.event.sourceIssueId,destination:api.context.event.destinationIssueId}');
 await add('L16','Link deleted endpoints','avi:jira:deleted:issuelink',B,{filters:{projectKeys:['LZPT'],jql:`key in (${B},${C})`}},'{source:api.context.event.sourceIssueId,destination:api.context.event.destinationIssueId}');
 for(const[code,title,event,entity]of[['L17','Version created','avi:jira:created:version','version'],['L18','Version released','avi:jira:released:version','version'],['L19','Component created','avi:jira:created:component','component']]) await newRule('listeners',code,title,{events:[event],filters:{projectKeys:['LZPT']},functions:[{name:title,code:`if(!(api.context.event.${entity}.name||'').startsWith('${T}'))return; ${eventCode(code,ledger,`api.context.event.${entity}`)}`} ]});
 await add('L20','Partial failure continues later steps','avi:jira:commented:issue',A,{filters:{projectKeys:['LZPT'],jql:`key = ${A}`,commentPattern:T+'-failure'},functions:[{name:'Expected deliberate failure',code:`throw new Error('${T}-expected-failure');`},{name:'Independent following step',code:`await api.addLabels('${T}-L20-continued');`}]});
 await add('L21','Simulation records no write','avi:jira:commented:issue',A,{filters:{projectKeys:['LZPT'],jql:`key = ${A}`,commentPattern:T+'-simulation'},simulationMode:true});
 await add('L22','Disabled then enabled','avi:jira:commented:issue',A,{filters:{projectKeys:['LZPT'],jql:`key = ${A}`,commentPattern:T+'-disabled'},enabled:false});
 const job=(code,title,config)=>newRule('jobs',code,title,{schedule:{cron:'*/5 * * * *',timeZone:'UTC'},...config});
 const jprop=code=>`await api.setProperty('${T}-${code}',{key:api.context.issueKey,manual:api.context.manual,scheduledFor:api.context.scheduledFor});`;
 await job('J01','Explicit target and schedule context',{functions:[{name:'Audit invocation',code:`await api.forIssue('${ledger}').addComment('${T}-J01 '+JSON.stringify({manual:api.context.manual,scheduledFor:api.context.scheduledFor,issueKey:api.context.issueKey}));`}]});
 await job('J02','Scoped two issues',{scope:{jql:`key in (${A},${B}) ORDER BY key ASC`,maxIssues:5},functions:[{code:jprop('J02')}]});
 await job('J03','Scope cap excludes third',{scope:{jql:`key in (${A},${B},${C}) ORDER BY key ASC`,maxIssues:2},functions:[{code:jprop('J03')}]});
 await job('J04','Empty scope',{scope:{jql:`labels = ${T}-absent`,maxIssues:5},functions:[{code:jprop('J04')}]});
 await job('J05','Invalid JQL fails visibly',{scope:{jql:'this is invalid JQL (',maxIssues:5},functions:[{code:jprop('J05')}]});
 await job('J06','Partial scope failure',{scope:{jql:`key in (${A},${B},${C}) ORDER BY key ASC`,maxIssues:5},functions:[{name:'Fail only middle issue',code:`if(api.context.issueKey==='${B}')throw new Error('${T}-partial-expected'); ${jprop('J06')}`}]});
 await job('J07','Simulated scoped writes',{scope:{jql:`key = ${C}`,maxIssues:5},simulationMode:true,functions:[{code:`await api.addLabels('${T}-J07-never');await api.addComment('${T}-J07-never');${jprop('J07')}`}]});
 await job('J08','Missing current issue fails',{functions:[{name:'No implicit target',code:`await api.addComment('${T}-J08-never');`}]});
 await job('J09','Scoped AI actions',{scope:{jql:`key = ${D}`,maxIssues:1},mode:'agent',agent:{instructions:`Add label ${T}-J09 and one comment containing exactly ${T}-J09-ack to the current issue. Then finish.`,allowedActions:['add_labels','add_comment'],maxRounds:4}});
 await job('J10','Global AI explicit target',{mode:'agent',agent:{instructions:`On issue ${D}, add label ${T}-J10 and one comment containing exactly ${T}-J10-ack. Always specify issueKey ${D} explicitly. Then finish.`,allowedActions:['add_labels','add_comment'],maxRounds:4},schedule:{cron:'*/5 * * * *',timeZone:'Europe/Bucharest'}});
 for(const kind of ['listeners','jobs']){
  const list=must(await rulesApi[kind].list(),'list')[kind];assert.ok(state[kind].every(r=>list.some(x=>x.id===r.id)));assert.ok(!list.some(r=>r.name===T+'-unauthorized'));record(`${kind} complete REST collection`,{count:state[kind].length});
  const item=state[kind][0],noun=kind==='listeners'?'listener':'job',patch={description:`${T} REST PUT verified`,...(kind==='listeners'?{filters:{issueTypes:[state.type.id]}}:{schedule:{timeZone:'UTC'}})};
  const updated=must(await rulesApi[kind].update(item.id,patch),'PUT')[noun];assert.equal(updated.id,item.id);assert.equal(updated.description,patch.description);
  if(kind==='listeners')assert.deepEqual(updated.filters.projectKeys,['LZPT']);else assert.equal(updated.schedule.cron,'*/5 * * * *');
  item.config=must(await rulesApi[kind].get(item.id),'PUT readback')[noun];save();record(`${kind} PUT preserves siblings and ID`);
  for(const action of ['disable','enable','disable']){const out=must(await rulesApi[kind][action](item.id),action)[noun];assert.equal(out.enabled,action==='enable');}
  if(kind==='listeners')must(await rulesApi.listeners.enable(item.id),'restore enabled');
  record(`${kind} enable disable REST roundtrip`);
 }
 state.provisionedAt=new Date().toISOString();save();
}
async function listenerResult(code,target,expected={}, valid=true) {
 const item=row('listeners',code);const fresh=l=>l.source==='async'&&l.isValid===valid&&new Date(l.timestamp).getTime()>=state.activeTriggerAt;
 const entries=await poll(()=>logs(item.id),x=>x.some(fresh));
 const log=entries.find(fresh);item.logs=entries;save();
 if(valid&&code!=='L07') {const value=await poll(()=>prop(target,code),x=>x?.marker===code);for(const[k,v]of Object.entries(expected)){if(/id$/i.test(k))assert.equal(String(value.data?.[k]),String(v),`${code} data.${k}`);else assert.deepEqual(value.data?.[k],v,`${code} data.${k}`);}item.effect=value;save();}
 record(`${code} actual event, persisted log and Jira readback`,{ruleId:item.id,logId:log.id,valid});return log;
}
async function listeners() {
 const {tag:T,A,B,C,ai:D,ledger}=state;await sleep(35000);
 const send=(key,text)=>post(`/rest/api/3/issue/${key}/comment`,{body:adf(text)});
 await attempt('L01 create',async()=>{state.created=await createIssue('new event');save();await poll(()=>getIssue(state.created,['labels']),i=>i.fields.labels.includes(T+'-L01'));const ls=await poll(()=>logs(row('listeners','L01').id),ls=>ls.some(l=>l.issueKey===state.created&&l.isValid));row('listeners','L01').logs=ls;record('L01 real create label',{key:state.created});});
 await attempt('L02 summary',async()=>{await put(`/rest/api/3/issue/${A}`,{fields:{summary:T+' changed summary'}});await listenerResult('L02',A);assert.ok((await prop(A,'L02')).data.some(x=>x.field==='summary'));});
 await attempt('L03 priority',async()=>{const before=await getIssue(A,['priority']);const priorities=await get('/rest/api/3/priority');const next=priorities.find(p=>p.id!==before.fields.priority?.id);await put(`/rest/api/3/issue/${A}`,{fields:{priority:{id:next.id}}});await listenerResult('L03',A);assert.ok((await prop(A,'L03')).data.some(x=>x.field==='priority'&&String(x.to)===next.id));});
 await attempt('L04 assigned',async()=>{if((await getIssue(A,['assignee'])).fields.assignee?.accountId===state.accountId){await put(`/rest/api/3/issue/${A}/assignee`,{accountId:null});await sleep(5000);}await put(`/rest/api/3/issue/${A}/assignee`,{accountId:state.accountId});await poll(()=>prop(A,'L04'),v=>v?.data?.accountId===state.accountId);await listenerResult('L04',A,{accountId:state.accountId});});
 await attempt('L05 regex rejects then accepts',async()=>{await send(A,T+' does not match regex');await sleep(7000);assert.equal(await prop(A,'L05'),null);const c=await send(A,T+'-regex');await listenerResult('L05',A,{commentId:c.id});});
 await attempt('L06 semantic accept and reject',async()=>{const accepted=await send(D,T+'-semantic I was charged twice. Please return the extra payment.');await listenerResult('L06',D,{commentId:accepted.id});const prior=await prop(D,'L06');await send(D,T+'-semantic Thanks for the release announcement; no payment issue or refund needed.');const ls=await poll(()=>logs(row('listeners','L06').id),ls=>ls.some(l=>l.decision==='SKIP'));assert.deepEqual(await prop(D,'L06'),prior);row('listeners','L06').logs=ls;record('L06 semantic negative SKIP with unchanged Jira property');});
 await attempt('L07 agent',async()=>{await send(D,T+'-agent-trigger');await listenerResult('L07',D);const i=await getIssue(D,['labels']);assert.ok(i.fields.labels.includes(T+'-L07'));assert.equal((await markerComments(D,T+'-L07-ack')).length,1);assert.ok(row('listeners','L07').logs.some(l=>l.agentSummary&&l.agentOutcome));record('L07 exact label, one comment and AI summary');});
 await attempt('L08 deleted issue',async()=>{const key=await createIssue('delete event');await sleep(7000);await del(`/rest/api/3/issue/${key}`);state.fixtures.issues=state.fixtures.issues.filter(k=>k!==key);save();await listenerResult('L08',ledger,{key});await assert.rejects(()=>getIssue(key,['summary']),e=>e.status===404);});
 await attempt('L09 deleted comment',async()=>{const c=await send(B,T+' delete this comment');await del(`/rest/api/3/issue/${B}/comment/${c.id}`);await listenerResult('L09',B,{id:c.id});await assert.rejects(()=>get(`/rest/api/3/issue/${B}/comment/${c.id}`),e=>e.status===404);});
 await attempt('L10 L11 L12 worklog lifecycle',async()=>{const w=await post(`/rest/api/3/issue/${B}/worklog`,{timeSpentSeconds:600,comment:adf(T+' worklog')});state.worklog=w.id;save();await listenerResult('L10',B,{id:w.id,timeSpentSeconds:600});await put(`/rest/api/3/issue/${B}/worklog/${w.id}`,{timeSpentSeconds:900});await listenerResult('L11',B,{id:w.id,timeSpentSeconds:900});assert.equal((await get(`/rest/api/3/issue/${B}/worklog/${w.id}`)).timeSpentSeconds,900);await del(`/rest/api/3/issue/${B}/worklog/${w.id}`);await listenerResult('L12',B,{id:w.id});});
 await attempt('L13 L14 attachment lifecycle',async()=>{const content=Buffer.from(T+' exact attachment bytes\n');const fd=new FormData();fd.append('file',new Blob([content],{type:'text/plain'}),T+'.txt');const {loadEnv}=await import('../lib/env.mjs');const env=loadEnv();const auth='Basic '+Buffer.from(env.JIRA_ADMIN_EMAIL+':'+env.JIRA_API_TOKEN).toString('base64');const response=await fetch(BASE+`/rest/api/3/issue/${B}/attachments`,{method:'POST',headers:{Authorization:auth,'X-Atlassian-Token':'no-check'},body:fd});assert.equal(response.status,200);const [a]=await response.json();state.attachment=a.id;save();await listenerResult('L13',B,{id:a.id,fileName:T+'.txt'});const download=await fetch(BASE+`/rest/api/3/attachment/content/${a.id}`,{headers:{Authorization:auth}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),content);await del(`/rest/api/3/attachment/${a.id}`);await listenerResult('L14',B,{id:a.id});});
 await attempt('L15 L16 link lifecycle',async()=>{const lt=(await get('/rest/api/3/issueLinkType')).issueLinkTypes[0];await post('/rest/api/3/issueLink',{type:{name:lt.name},inwardIssue:{key:B},outwardIssue:{key:C}});const ls=(await getIssue(B,['issuelinks'])).fields.issuelinks;const link=ls.find(l=>(l.outwardIssue||l.inwardIssue)?.key===C);assert.ok(link);state.link=link.id;save();const ids=[(await getIssue(B,['summary'])).id,(await getIssue(C,['summary'])).id];await listenerResult('L15',B);const val=await prop(B,'L15');assert.deepEqual([String(val.data.source),String(val.data.destination)].sort(),ids.sort());await del(`/rest/api/3/issueLink/${link.id}`);await listenerResult('L16',B);});
 await attempt('L17 L18 version',async()=>{const v=await post('/rest/api/3/version',{name:T+'-version',projectId:Number(state.project.id)});state.fixtures.versions.push(v.id);save();await listenerResult('L17',ledger,{id:v.id,name:v.name});await put(`/rest/api/3/version/${v.id}`,{released:true});await listenerResult('L18',ledger,{id:v.id,name:v.name,released:true});assert.equal((await get(`/rest/api/3/version/${v.id}`)).released,true);});
 await attempt('L19 component',async()=>{const c=await post('/rest/api/3/component',{name:T+'-component',project:'LZPT'});state.fixtures.components.push(c.id);save();await listenerResult('L19',ledger,{id:c.id,name:c.name});});
 await attempt('L20 expected error',async()=>{await send(A,T+'-failure');const log=await listenerResult('L20',A,{},false);assert.ok(log.reason.includes(T+'-expected-failure'));assert.equal(log.stepResults[0].status,'error');assert.equal(log.stepResults[1].status,'success');assert.ok((await getIssue(A,['labels'])).fields.labels.includes(T+'-L20-continued'));record('L20 overall failure and later-step write are reported');});
 await attempt('L21 simulation',async()=>{await send(A,T+'-simulation');const ls=await poll(()=>logs(row('listeners','L21').id),x=>x.some(l=>l.isValid&&l.source==='async'));assert.equal(await prop(A,'L21'),null);assert.ok(ls.some(l=>l.changes?.length));row('listeners','L21').logs=ls;record('L21 real event simulation with no Jira property');});
 await attempt('L22 disabled then enabled',async()=>{await send(A,T+'-disabled');await sleep(7000);assert.equal(await prop(A,'L22'),null);assert.equal((await logs(row('listeners','L22').id)).length,0);const item=row('listeners','L22');must(await rulesApi.listeners.update(item.id,{functions:[{name:'Record enabled comment identity',code:`await api.setProperty('${T}-L22',{marker:'L22',data:{commentId:api.context.event.comment.id}});`}]}),'update enabled witness');must(await rulesApi.listeners.enable(item.id),'enable');await sleep(35000);const c=await send(A,T+'-disabled');await listenerResult('L22',A,{commentId:c.id});record('L22 negative and positive delivered event');});
 state.listenersFinishedAt=new Date().toISOString();save();
}
async function jobs() {
 const T=state.tag;
 const commentBaseline={J01:(await markerComments(state.ledger,T+'-J01')).length};
 for(const code of ['J09','J10'])commentBaseline[code]=(await markerComments(state.ai,T+'-'+code+'-ack')).length;
 state.jobCommentBaseline=commentBaseline;save();
 // Every job is first exercised through the public queueing Run endpoint, sequentially.
 for(const item of state.jobs) await attempt(item.code+' manual',async()=>{
  const before=await markerComments(state.ai,T+'-'+item.code+'-ack');
  const queued=await rulesApi.jobs.run(item.id);assert.equal(queued.status,202);assert.ok(queued.body.taskId);item.taskId=queued.body.taskId;save();
  const task=await poll(async()=>must(await rulesApi.task(item.taskId),'task'),v=>['done','error'].includes(v.status));item.task=task;save();assert.equal(task.status,'done');
  const fail=['J05','J06','J08'].includes(item.code);assert.equal(task.result.success,!fail,JSON.stringify(task.result).slice(0,900));
  const ls=await poll(()=>logs(item.id),x=>x.some(l=>l.manual===true));item.logs=ls;save();
  if(item.code==='J01')assert.equal((await markerComments(state.ledger,T+'-J01')).length,commentBaseline.J01+1);
  if(['J02','J03'].includes(item.code)){assert.equal(task.result.issues.length,2);for(const key of [state.A,state.B])assert.equal((await prop(key,item.code)).key,key);assert.equal(await prop(state.C,item.code),null);}
  if(item.code==='J04'){assert.equal(task.result.issues.length,0);assert.equal(task.result.changes.length,0);assert.match(task.result.reason,/0\/0/);}
  if(item.code==='J05')assert.match(task.result.reason,/Scope JQL failed/);
  if(item.code==='J06'){assert.equal(task.result.issues.length,3);assert.equal(task.result.issues.filter(x=>x.success).length,2);for(const key of [state.A,state.C])assert.equal((await prop(key,'J06')).key,key);assert.equal(await prop(state.B,'J06'),null);}
  if(item.code==='J07'){assert.equal(await prop(state.C,'J07'),null);assert.ok(!(await getIssue(state.C,['labels'])).fields.labels.includes(T+'-J07-never'));assert.equal((await markerComments(state.C,T+'-J07-never')).length,0);assert.equal(task.result.changes.length,3);}
  if(item.code==='J08')assert.match(task.result.reason,/needs a current issue/);
  if(['J09','J10'].includes(item.code)){assert.ok((await getIssue(state.ai,['labels'])).fields.labels.includes(T+'-'+item.code));const after=await markerComments(state.ai,T+'-'+item.code+'-ack');assert.equal(after.length,before.length+1);if(item.code==='J09')assert.ok(task.result.issues[0].agentSummary);else assert.ok(task.result.agentSummary);}
  record(item.code+' public Run202, terminal result, log and exact effects',{expectedFailure:fail});
 });
 // A negative control: disabled jobs never ran automatically during manual verification.
 for(const item of state.jobs)assert.ok(!(await logs(item.id)).some(l=>l.manual===false));record('All ten disabled jobs had no automatic run');
 // Exercise all ten through genuine five-minute scheduling, then promptly disable each.
 state.tickStartedAt=new Date().toISOString();save();
 for(const item of state.jobs)must(await rulesApi.jobs.enable(item.id),'enable for actual tick');
 const pending=new Set(state.jobs.map(j=>j.id));const deadline=Date.now()+12*60*1000;
 while(pending.size&&Date.now()<deadline){
  for(const item of state.jobs.filter(j=>pending.has(j.id))){const ls=await logs(item.id);const automatic=ls.find(l=>l.manual===false&&l.scheduledFor);if(!automatic)continue;item.scheduled=automatic;item.logs=ls;save();must(await rulesApi.jobs.disable(item.id),'disable after actual tick');pending.delete(item.id);await attempt(item.code+' scheduled',async()=>{assert.equal(automatic.isValid,!['J05','J06','J08'].includes(item.code));assert.ok(Number.isFinite(automatic.queueDelayMs));record(item.code+' actual non-manual scheduler execution',{scheduledFor:automatic.scheduledFor,logId:automatic.id});});}
  console.log('Scheduler waiting:',pending.size,'job(s)');if(pending.size)await sleep(15000);
 }
 for(const id of pending)await attempt('missing automatic '+id,async()=>{must(await rulesApi.jobs.disable(id),'disable timeout');throw Error('No actual scheduled log within12 minutes');});
 await attempt('scheduled Jira readbacks',async()=>{const audit=await markerComments(state.ledger,T+'-J01');assert.equal(audit.length,commentBaseline.J01+2);assert.ok(audit.some(c=>plain(c.body).includes('"manual":false')));for(const code of ['J02','J03','J06'])for(const key of(code==='J06'?[state.A,state.C]:[state.A,state.B])){const p=await prop(key,code);assert.equal(p.manual,false);assert.ok(p.scheduledFor);}for(const code of ['J09','J10'])assert.equal((await markerComments(state.ai,T+'-'+code+'-ack')).length,commentBaseline[code]+2);assert.equal(await prop(state.C,'J07'),null);record('All scheduled writes independently reread; failures/simulation remain truthful');});
 await attempt('scheduled negative and per-issue details',async()=>{assert.equal(await prop(state.C,'J03'),null);assert.equal(await prop(state.B,'J06'),null);assert.ok(!(await getIssue(state.C,['labels'])).fields.labels.includes(T+'-J07-never'));assert.equal((await markerComments(state.C,T+'-J07-never')).length,0);for(const code of ['J02','J03','J06','J09']){const result=row('jobs',code).scheduled;assert.ok(result);const expected=code==='J06'?3:code==='J09'?1:2;assert.equal(result.perIssue.length,expected);for(const item of result.perIssue)assert.equal(item.success,!(code==='J06'&&item.key===state.B));}for(const code of ['J09','J10'])assert.ok((await getIssue(state.ai,['labels'])).fields.labels.includes(T+'-'+code));record('Scheduled excluded, failed and simulated targets unchanged; all scoped statuses exact');});
 state.jobsFinishedAt=new Date().toISOString();save();
}
async function retryListeners() {
 const {tag:T,A,B}=state;
 // Preserve the first-run failures; retry only the corrected fixture expectations.
 const item=row('listeners','L20');
 must(await rulesApi.listeners.update(item.id,{name:`${T} L20 Partial failure continues later steps`,functions:[{name:'Expected deliberate failure',code:`throw new Error('${T}-expected-failure');`},{name:'Independent following step',code:`await api.addLabels('${T}-L20-continued');`}]}),'rename partial failure witness');
 for(const code of ['L13','L14','L20'])must(await rulesApi.listeners.enable(row('listeners',code).id),'enable retry');
 await sleep(35000);
 await attempt('L13 L14 exact Forge fileName retry',async()=>{
  const content=Buffer.from(T+' retry exact bytes\n'), filename=T+'-retry.txt';
  const fd=new FormData();fd.append('file',new Blob([content],{type:'text/plain'}),filename);
  const {loadEnv}=await import('../lib/env.mjs');const e=loadEnv();const auth='Basic '+Buffer.from(e.JIRA_ADMIN_EMAIL+':'+e.JIRA_API_TOKEN).toString('base64');
  const r=await fetch(BASE+`/rest/api/3/issue/${B}/attachments`,{method:'POST',headers:{Authorization:auth,'X-Atlassian-Token':'no-check'},body:fd});assert.equal(r.status,200);const[a]=await r.json();
  await listenerResult('L13',B,{id:a.id,fileName:filename});
  const d=await fetch(BASE+`/rest/api/3/attachment/content/${a.id}`,{headers:{Authorization:auth}});assert.equal(d.status,200);assert.deepEqual(Buffer.from(await d.arrayBuffer()),content);
  await del(`/rest/api/3/attachment/${a.id}`);await listenerResult('L14',B,{id:a.id,fileName:filename});
  await assert.rejects(()=>get(`/rest/api/3/attachment/${a.id}`),e=>e.status===404);record('L13 L14 corrected payload field and downloaded bytes');
 });
 await attempt('L20 established continuation contract',async()=>{
  await post(`/rest/api/3/issue/${A}/comment`,{body:adf(T+'-failure retry')});const log=await listenerResult('L20',A,{},false);
  assert.equal(log.stepResults[0].status,'error');assert.equal(log.stepResults[1].status,'success');assert.ok(log.reason.includes(T+'-expected-failure'));
  assert.ok((await getIssue(A,['labels'])).fields.labels.includes(T+'-L20-continued'));record('L20 overall FAILED with independently verified later-step write');
 });
}
async function snapshot() {
 for(const kind of ['listeners','jobs'])for(const item of state[kind]){item.final=must(await rulesApi[kind].get(item.id),'final GET')[kind==='listeners'?'listener':'job'];item.logs=await logs(item.id);save();}
 state.finalIssues={};for(const key of state.fixtures.issues)state.finalIssues[key]=await getIssue(key,['summary','labels','assignee','priority','comment','attachment','issuelinks']);save();
 record('Full rule, execution and Jira snapshot',{listeners:state.listeners.length,jobs:state.jobs.length});
}
async function freshJobs() {
 assert.equal(state.jobs.length,10);assert.ok(!state.archivedJobs,'Only one deliberate recreation per campaign');
 for(const item of state.jobs){const current=must(await rulesApi.jobs.get(item.id),'before recreation').job;assert.equal(current.enabled,false);item.final=current;item.logs=await logs(item.id);}
 state.archivedJobs=structuredClone(state.jobs);state.jobs=[];save();
 for(const item of state.archivedJobs){
  must(await rulesApi.jobs.remove(item.id),'delete old job');assert.equal((await rulesApi.jobs.get(item.id)).status,404);item.deletedAt=new Date().toISOString();save();
  const {id,stats,createdAt,createdBy,updatedAt,...config}=item.final;
  const created=await newRule('jobs',item.code,'Recreated statistics witness',{...config,enabled:false});
  assert.notEqual(created.id,item.id);assert.equal(created.stats.runCount,0);assert.equal(created.stats.errorCount,0);
  record(item.code+' old DELETE404 and new zero-count REST record',{oldId:item.id,newId:created.id});
 }
}
async function stats() {
 for(const item of state.jobs){
  const fail=['J05','J06','J08'].includes(item.code);
  const current=await poll(async()=>must(await rulesApi.jobs.get(item.id),'stats read').job,j=>j.stats.runCount===2,240);
  assert.equal(current.enabled,false);assert.equal(current.stats.errorCount,fail?2:0);
  assert.equal(current.stats.lastStatus,fail?'error':'ok');assert.equal(current.stats.nextRunAt,null);
  assert.ok(Date.parse(current.stats.lastRunAt)>=Date.parse(item.scheduled.timestamp));
  assert.ok(Date.parse(current.stats.lastRunAt)<=Date.parse(item.scheduled.timestamp)+120000);
  if(fail)assert.ok(current.stats.lastError);else assert.equal(current.stats.lastError,null);
  item.final=current;record(item.code+' exact manual plus scheduled counters and latest outcome',{stats:current.stats});
 }
}
async function cleanup() {
 for(const kind of ['listeners','jobs'])for(const item of state[kind])await attempt('DELETE '+item.code,async()=>{must(await rulesApi[kind].remove(item.id),'delete');assert.equal((await rulesApi[kind].get(item.id)).status,404);record(item.code+' REST DELETE and independent404');});
 for(const id of state.fixtures.versions)await attempt('delete version '+id,async()=>{await post(`/rest/api/3/version/${id}/removeAndSwap`,{});await assert.rejects(()=>get(`/rest/api/3/version/${id}`),e=>e.status===404);record('version removed '+id);});
 for(const id of state.fixtures.components)await attempt('delete component '+id,async()=>{await del(`/rest/api/3/component/${id}`);await assert.rejects(()=>get(`/rest/api/3/component/${id}`),e=>e.status===404);record('component removed '+id);});
 for(const key of state.fixtures.issues)await attempt('delete issue '+key,async()=>{await del(`/rest/api/3/issue/${key}`);await assert.rejects(()=>getIssue(key,['summary']),e=>e.status===404);record('issue removed '+key);});
 for(const kind of ['listeners','jobs']){const list=must(await rulesApi[kind].list(),'final collection')[kind];assert.ok(!list.some(x=>state[kind].some(y=>y.id===x.id)));for(const old of state.baseline[kind])assert.ok(list.some(x=>x.id===old.id&&x.enabled===old.enabled));record(kind+' cleanup collection and unrelated state preserved');}
 state.cleanedAt=new Date().toISOString();save();
}
try { assert.ok(['provision','listeners','jobs','snapshot','cleanup','retryListeners','freshJobs','stats'].includes(phase),'Choose provision|listeners|jobs|snapshot|cleanup|retryListeners|freshJobs|stats');await ({provision,listeners,jobs,snapshot,cleanup,retryListeners,freshJobs,stats})[phase](); }
catch(e){state.fatal={phase,error:e.stack};save();console.error(e.stack);process.exitCode=1;}
finally {
 // A transport failure during a phase must not leave recurring AI jobs enabled.
 // Each owned rule gets its own cleanup attempt; one failure cannot skip siblings.
 if(phase==='jobs'||phase==='listeners'||phase==='retryListeners'||process.exitCode){
  const kinds=process.exitCode?['listeners','jobs']:[phase==='retryListeners'?'listeners':phase];
  for(const kind of kinds)for(const item of state[kind]){
   try{const response=await rulesApi[kind].disable(item.id);if(response.status!==404)must(response,'quiesce '+item.code);item.quiesced=true;save();}
   catch(e){state.checks.push({name:'quiesce '+item.code,pass:false,error:e.message});process.exitCode=1;save();}
  }
 }
 await closeRulesApi();save();
}
