/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { BASE } from '../lib/jira.mjs';
import { rulesApi,ensureRulesApi,closeRulesApi } from '../lib/rules-api.mjs';
assert.equal(new URL(BASE).hostname,'wolfaenpak.atlassian.net');
const dir=new URL('../results/listeners-jobs-campaign/',import.meta.url);
const state=JSON.parse(fs.readFileSync(new URL('state.json',dir)));
const evidence={tag:state.tag,checks:[]};
const record=(name,detail={})=>{evidence.checks.push({name,...detail});console.log('PASS',name);};
const config=({stats,...rest})=>rest;
try{
 const {url,token}=await ensureRulesApi();
 for(const kind of ['listeners','jobs']){
  const id=state[kind][0].id,noun=kind==='listeners'?'listener':'job';
  const before=await rulesApi[kind].get(id);assert.equal(before.status,200);
  for(const method of ['GET','PUT'])for(const credential of ['missing','invalid']){
   const response=await fetch(`${url}?resource=${kind}&id=${id}`,{method,headers:{'Content-Type':'application/json',...(credential==='invalid'?{Authorization:'Bearer cgr_'+'f'.repeat(48)}:{})},...(method==='PUT'?{body:JSON.stringify({name:state.tag+' unauthorized overwrite'})}:{})});
   assert.equal(response.status,401);record(`${kind} existing record ${method} rejects ${credential} token`);
  }
  const bad=await rulesApi[kind].update(id,kind==='jobs'?{schedule:{cron:'99 * * * *'}}:{filters:{commentPattern:'['}});
  assert.equal(bad.status,400);record(`${kind} invalid PUT rejected`,{error:bad.body.error});
  const alternate=await fetch(`${url}?resource=${kind}&id=${id}`,{headers:{'X-Api-Key':token}});assert.equal(alternate.status,200);const reread=await alternate.json();assert.deepEqual(config(reread[noun]),config(before.body[noun]));
  record(`${kind} authorized X-Api-Key read proves refused writes changed nothing`);
 }
 await closeRulesApi();
 const revoked=await fetch(`${url}?resource=whoami`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(revoked.status,401);record('Revoked campaign-owned token is rejected');
 evidence.pass=true;
}catch(e){evidence.pass=false;evidence.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await closeRulesApi();fs.writeFileSync(new URL('rest-contract.json',dir),JSON.stringify(evidence,null,2));}
