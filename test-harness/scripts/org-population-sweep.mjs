/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// One worker per site; each project owns a graph → resolution → content → readback chain.
import {readFileSync,existsSync,mkdirSync,openSync,closeSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {atomicSave} from './org-metadata-execute.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const self=fileURLToPath(import.meta.url),folder=resolve(root,'test-harness/results/org-expanded-execution/population-sweep');
const lock=resolve(folder,'sweep.lock'),stateFile=resolve(folder,'state.json');
const read=path=>JSON.parse(readFileSync(path)),stamp=()=>new Date().toISOString();
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const files=['docs/org-expanded-approval-plan.json','test-harness/scripts/org-population-sweep.mjs','test-harness/scripts/org-metadata-execute.mjs','test-harness/scripts/org-workflow-graphs.mjs','test-harness/lib/org-workflow-graphs.mjs','test-harness/scripts/org-workflow-resolution.mjs','test-harness/lib/org-content-model.mjs','test-harness/scripts/org-content-execute.mjs','test-harness/scripts/org-field-availability.mjs'];
const version=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function metadataAdmission(site,key,producer,owner,expected){
  const unit=producer?.units?.[site+'/'+key];
  if(unit?.status==='verified'&&(!expected||(unit.instrument?.manifest===expected.manifest&&unit.instrument?.executor===expected.executor)))return 'ready';
  if(unit?.status==='failed'||unit?.status==='blocked-by-site-failure')return 'blocked';
  if(producer?.finishedAt&&!producer?.current)return 'blocked';
  return owner?.pid&&alive(owner.pid)?'waiting':'producer-stopped';
}
export async function drainSiteWorkers(items,visit,onFailure){
  const results=await Promise.allSettled(items.map(async item=>{
    try{return await visit(item);}catch(e){onFailure(e);throw e;}
  }));
  const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
  if(errors.length)throw new AggregateError(errors,'Site workers failed; all started workers have drained');
}
async function child(args,log,timeoutMs){
  const fd=openSync(log,'a',0o600);
  try{return await new Promise((done,reject)=>{
    const p=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe',fd]});let timedOut=false,tail='';
    p.stdout.on('data',chunk=>{writeFileSync(fd,chunk);tail=(tail+chunk.toString()).slice(-65536);});
    const timer=setTimeout(()=>{timedOut=true;p.kill('SIGTERM');},timeoutMs);
    p.once('error',e=>{clearTimeout(timer);reject(e);});
    p.once('close',(code,signal)=>{clearTimeout(timer);let result=null;try{result=JSON.parse(tail.trim().split('\n').at(-1));}catch{}done({code,signal,timedOut,result});});
  });}finally{closeSync(fd);}
}
async function run(){
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:stamp()}));closeSync(fd);
  try{
    const instrument=version(),plan=read(resolve(root,files[0]));
    const state=existsSync(stateFile)?read(stateFile):{createdAt:stamp(),units:{}};
    state.status='running';state.pid=process.pid;state.startedAt=stamp();delete state.finishedAt;atomicSave(stateFile,state);
    let drift=false,aborted=false;
    const current=()=>{if(aborted)throw Error('Another site worker failed; stop admission');if(!same(version(),instrument)){drift=true;throw Error('Instrument changed; stop admission and reconcile before resume');}};
    const save=()=>atomicSave(stateFile,state);
    const record=(event,data)=>console.log(JSON.stringify({at:stamp(),event,...data}));
    async function unit(site,project){
      const id=site+'/'+project.key,prior=state.units[id];
      if(prior?.status==='verified'&&same(prior.instrument,instrument))return true;
      current();const log=resolve(folder,site+'-'+project.key+'.log');
      const graph=resolve(root,'test-harness/results/org-expanded-execution',site==='leanzero-apps-demo.atlassian.net'?'demo-graphs.json':site+'-graphs.json');
      const graphArgs=['--manifest',resolve(root,files[0]),'--metadata',resolve(root,'test-harness/results/org-metadata-v1',site+'.json'),'--project',project.key,'--output',graph,'--env-module',resolve(root,'test-harness/lib/env.mjs')];
      const steps=[
        ['fields-apply',['test-harness/scripts/org-field-availability.mjs','apply',site,project.key]],
        ['fields-verify',['test-harness/scripts/org-field-availability.mjs','verify',site,project.key]],
        ['graphs-apply',['test-harness/scripts/org-workflow-graphs.mjs','apply',...graphArgs]],
        ['graphs-verify',['test-harness/scripts/org-workflow-graphs.mjs','verify',...graphArgs]],
        ['resolution-apply',['test-harness/scripts/org-workflow-resolution.mjs','apply',site,project.key]],
        ['resolution-verify',['test-harness/scripts/org-workflow-resolution.mjs','verify',site,project.key]],
        ['content-apply',['test-harness/scripts/org-content-execute.mjs','apply',site,project.key]],
        ['content-verify',['test-harness/scripts/org-content-execute.mjs','verify',site,project.key]],
      ];
      state.units[id]={status:'running',startedAt:stamp(),instrument,log,steps:[]};save();
      try{
        for(const [name,args] of steps){
          current();state.units[id].current=name;save();record('now',{id,stage:name});
          const outcome=await child(args,log,name.startsWith('content')?8*60*60*1000:45*60*1000);
          state.units[id].steps.push({name,...outcome,at:stamp()});save();
          if(outcome.code!==0||outcome.timedOut)throw Error(name+' failed; inspect log and pending receipts before retry');
          if(outcome.result?.project!==project.key)throw Error(name+' returned no matching project result');
          if(name.startsWith('fields')&&outcome.result.status!=='CREATE_FIELDS_READBACK_PASS')throw Error(name+' did not prove every issue type create screen');
          if(name.startsWith('graphs')&&outcome.result.status!=='GRAPH_AND_SCHEME_READBACK_PASS')throw Error(name+' did not prove the assigned graph');
          if(name.startsWith('resolution')&&(!outcome.result.nativeResolutionId||outcome.result.workflows!==project.workflows.length))throw Error(name+' did not prove every workflow resolution action');
          if(name.startsWith('content')&&(!outcome.result.complete||outcome.result.verified!==outcome.result.total))throw Error(name+' did not prove the full population');
          current();
        }
        const result=read(resolve(root,'test-harness/results/org-content-v1',site,project.key,'result.json'));
        if(result.mode!=='verify'||!result.complete||result.verified!==result.total||result.fingerprint.site!==site||result.fingerprint.key!==project.key)throw Error('Independent full population receipt missing');
        state.units[id].status='verified';state.units[id].verified=result.verified;state.units[id].completedAt=stamp();delete state.units[id].current;save();record('verified',{id,issues:result.verified});return true;
      }catch(e){state.units[id].status='failed';state.units[id].reason=e.message;state.units[id].failedAt=stamp();save();record('failed',{id,reason:e.message});return false;}
    }
    // Expand the live-tested demo bed before admitting any other project's population.
    const demo=plan.sites.find(s=>s.site==='leanzero-apps-demo.atlassian.net'),lab=demo.projects.find(p=>p.key==='LAB');
    if(!await unit(demo.site,lab))throw Error('LAB full-population gate failed; other sites have not been admitted');
    await drainSiteWorkers(plan.sites,async site=>{
      for(const project of site.projects){
        const id=site.site+'/'+project.key;if(id===demo.site+'/LAB')continue;
        if(project.existingOwnedIssues>0){state.units[id]={status:'blocked-existing-project-migration',at:stamp()};save();continue;}
        try{
          while(true){
            current();
            const producerFile=resolve(root,'test-harness/results/org-expanded-execution/metadata-sweep/state.json'),ownerFile=resolve(root,'test-harness/results/org-expanded-execution/metadata-sweep/sweep.lock');
            const admission=metadataAdmission(site.site,project.key,existsSync(producerFile)?read(producerFile):null,existsSync(ownerFile)?read(ownerFile):null,{manifest:instrument[files[0]],executor:instrument['test-harness/scripts/org-metadata-execute.mjs']});
            if(admission==='ready'){await unit(site.site,project);break;}
            state.units[id]={status:admission==='waiting'?'waiting-metadata':'blocked-metadata',at:stamp(),reason:admission};save();
            if(admission!=='waiting')break;
            await new Promise(resolve=>setTimeout(resolve,30000));
          }
        }catch(e){state.units[id]={status:'failed',reason:e.message,at:stamp()};save();if(drift)break;}
      }
    },()=>{aborted=true;});
    state.status=Object.values(state.units).every(u=>u.status==='verified')?'population-verified':'population-incomplete';state.finishedAt=stamp();save();record('finished',{status:state.status,verified:Object.values(state.units).filter(u=>u.status==='verified').length});
  }finally{unlinkSync(lock);}
}
export async function main(mode){
  mkdirSync(folder,{recursive:true});
  if(mode==='run')await run();
  else if(mode==='start'||mode==='resume'){
    if(existsSync(lock))throw Error('Population lock exists; inspect status and reconcile before relaunch');
    version();const fd=openSync(resolve(folder,'sweep.log'),'a',0o600);const p=spawn(process.execPath,[self,'run'],{cwd:root,detached:true,stdio:['ignore',fd,fd]});p.unref();closeSync(fd);console.log(JSON.stringify({pid:p.pid,log:resolve(folder,'sweep.log')}));
  }else if(mode==='status'){
    const owner=existsSync(lock)?read(lock):null;console.log(JSON.stringify({running:!!owner&&alive(owner.pid),owner,state:existsSync(stateFile)?read(stateFile):null},null,2));
  }else throw Error('Use start | resume | status | run');
}
if(process.argv[1]&&resolve(process.argv[1])===self)main(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
