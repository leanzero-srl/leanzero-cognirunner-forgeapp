/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Durable metadata stage only. Workflow, content and app activation are separate gates.
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const folder=resolve(root,'test-harness/results/org-expanded-execution/metadata-sweep');
const manifest=resolve(root,'docs/org-expanded-approval-plan.json');
const executor=resolve(root,'test-harness/scripts/org-metadata-execute.mjs');
const stamp=()=>new Date().toISOString();
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const save=(p,v)=>{const tmp=p+'.tmp';writeFileSync(tmp,JSON.stringify(v,null,2)+'\n',{mode:0o600});renameSync(tmp,p);};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const lock=resolve(folder,'sweep.lock');
const statePath=resolve(folder,'state.json');
const logPath=resolve(folder,'sweep.log');
const version=()=>({manifest:digest(manifest),executor:digest(executor),controller:digest(fileURLToPath(import.meta.url))});
function identity(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function child(mode,site,key,output){
  const args=[executor,mode,'--site',site,'--project',key,'--output',resolve(root,'test-harness/results/org-metadata-v1')];
  const fd=openSync(output,'a',0o600);
  try{return await new Promise((done,reject)=>{
    const p=spawn(process.execPath,args,{cwd:root,stdio:['ignore',fd,fd]});
    const timer=setTimeout(()=>p.kill('SIGTERM'),45*60*1000);
    p.once('error',e=>{clearTimeout(timer);reject(e);});
    p.once('exit',(code,signal)=>{clearTimeout(timer);done({code,signal});});
  });}finally{closeSync(fd);}
}
async function run(){
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:stamp()}));closeSync(fd);
  try{
    const instrument=version();
    const state=existsSync(statePath)?JSON.parse(readFileSync(statePath)):{stage:'metadata',units:{},createdAt:stamp()};
    // Every completed unit is re-verified after an instrument change, never silently relabelled.
    const units=JSON.parse(readFileSync(manifest)).sites.flatMap(s=>s.projects.map(p=>({site:s.site,key:p.key})));
    console.log(JSON.stringify({at:stamp(),event:'start',units:units.length,pid:process.pid,instrument}));
    const durations=[];const failedSites=new Set();
    for(let i=0;i<units.length;i++){
      const {site,key}=units[i];const id=site+'/'+key;const prior=state.units[id];
      if(prior?.status==='verified'&&identity(prior.instrument,instrument))continue;
      if(failedSites.has(site)){state.units[id]={status:'blocked-by-site-failure',at:stamp()};save(statePath,state);continue;}
      const start=Date.now();state.current={id,index:i+1,total:units.length,startedAt:stamp()};save(statePath,state);
      const estimate=durations.length?new Date(Date.now()+durations.reduce((a,b)=>a+b,0)/durations.length*(units.length-i)).toISOString():null;
      console.log(JSON.stringify({at:stamp(),event:'now',...state.current,next:units[i+1]||null,estimatedFinish:estimate}));
      const output=resolve(folder,site+'-'+key+'.log');
      let result;
      try{
        if(prior?.status==='verified')result=await child('verify',site,key,output);
        else result=await child('apply',site,key,output);
        if(result.code!==0)throw Error('Metadata operation failed; inspect project log and durable pending receipt before retry');
        // Fresh process uses a client that rejects POST/PUT, proving readback independently.
        result=await child('verify',site,key,output);
        if(result.code!==0)throw Error('Independent metadata verification failed');
        state.units[id]={status:'verified',instrument,completedAt:stamp(),log:output};
        durations.push(Date.now()-start);
      }catch(e){state.units[id]={status:'failed',instrument,at:stamp(),reason:e.message,log:output};failedSites.add(site);}
      save(statePath,state);console.log(JSON.stringify({at:stamp(),event:'result',id,...state.units[id]}));
    }
    state.current=null;state.finishedAt=stamp();state.status=units.every(u=>state.units[u.site+'/'+u.key]?.status==='verified')?'metadata-verified':'metadata-incomplete';save(statePath,state);
    console.log(JSON.stringify({at:stamp(),event:'finished',status:state.status}));
  }finally{unlinkSync(lock);}
}
const mode=process.argv[2];mkdirSync(folder,{recursive:true});
if(mode==='run')await run();
else if(mode==='start'||mode==='resume'){
  if(existsSync(lock))throw Error('Sweep lock exists; use status and reconcile before relaunch');
  // Verify that the reviewed executable is present before detaching.
  version();
  const fd=openSync(logPath,'a',0o600);
  const p=spawn(process.execPath,[fileURLToPath(import.meta.url),'run'],{cwd:root,detached:true,stdio:['ignore',fd,fd]});p.unref();closeSync(fd);
  console.log(JSON.stringify({pid:p.pid,log:logPath,status:'launched; verify process and first receipt'}));
}else if(mode==='status'){
  const owner=existsSync(lock)?JSON.parse(readFileSync(lock)):null;
  const state=existsSync(statePath)?JSON.parse(readFileSync(statePath)):null;
  console.log(JSON.stringify({running:!!owner&&alive(owner.pid),owner,state},null,2));
}else throw Error('Use start | resume | status | run');
