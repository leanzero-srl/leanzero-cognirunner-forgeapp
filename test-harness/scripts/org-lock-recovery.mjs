/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
// One bounded recovery pass for pre-write lock refusals, after this site's main worker drains.
import {readFileSync,existsSync,readdirSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {atomicSave} from './org-metadata-execute.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),site='beacon-logistics.atlassian.net',keys=['CUSTOPS','CUSTOMS'];
const folder=resolve(root,'test-harness/results/org-expanded-execution'),stateFile=resolve(folder,'beacon-lock-recovery.json'),lock=stateFile+'.lock';
const read=p=>JSON.parse(readFileSync(p)),stamp=()=>new Date().toISOString();
export function siteDrained(projectKeys,units){return projectKeys.every(key=>['verified','failed','blocked-existing-project-migration','blocked-metadata'].includes(units?.[site+'/'+key]?.status));}
async function main(){
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);
  const state={site,keys,pid:process.pid,status:'waiting-for-site-worker',startedAt:stamp(),units:{}};const save=()=>atomicSave(stateFile,state);
  try{
    const manifest=resolve(root,'docs/org-expanded-approval-plan.json'),projectKeys=read(manifest).sites.find(s=>s.site===site).projects.map(p=>p.key);
    const files=['scripts/org-workflow-graphs.mjs','lib/org-workflow-graphs.mjs','scripts/org-workflow-resolution.mjs','scripts/org-content-execute.mjs','scripts/org-field-availability.mjs','scripts/org-metadata-execute.mjs','lib/org-content-model.mjs'];
    const signature=()=>createHash('sha256').update(readFileSync(manifest)).update(files.map(f=>readFileSync(resolve(root,'test-harness',f))).join('')).digest('hex');const instrument=signature();state.instrument=instrument;save();
    const start=Date.now();
    while(true){
      if(signature()!==instrument)throw Error('Recovery instrument changed; reconcile before relaunch');
      const sweep=read(resolve(folder,'population-sweep/state.json')),content=resolve(root,'test-harness/results/org-content-v1',site);
      const active=existsSync(content)&&readdirSync(content).some(key=>existsSync(resolve(content,key,'writer.lock')));
      if(siteDrained(projectKeys,sweep.units)&&!active&&!existsSync(resolve(folder,site+'-graphs.json.lock')))break;
      if(Date.now()-start>8*60*60*1000)throw Error('Site worker did not drain within eight hours');state.checkedAt=stamp();save();await new Promise(r=>setTimeout(r,30000));
    }
    for(const key of keys){
      const sweep=read(resolve(folder,'population-sweep/state.json')),prior=sweep.units[site+'/'+key];if(prior?.status==='verified')continue;
      if(prior?.status!=='failed'||!readFileSync(prior.log,'utf8').includes('EEXIST: file already exists'))throw Error('Not an established pre-write lock refusal: '+key);
      const graph=resolve(folder,site+'-graphs.json'),args=['--manifest',manifest,'--metadata',resolve(root,'test-harness/results/org-metadata-v1',site+'.json'),'--project',key,'--output',graph,'--env-module',resolve(root,'test-harness/lib/env.mjs')];
      const steps=[...['apply','verify'].map(mode=>['test-harness/scripts/org-workflow-graphs.mjs',mode,...args]),...['org-workflow-resolution.mjs','org-content-execute.mjs'].flatMap(script=>['apply','verify'].map(mode=>['test-harness/scripts/'+script,mode,site,key]))];
      for(const step of steps){
        if(signature()!==instrument)throw Error('Instrument changed');state.status='running';state.current={key,script:step[0],mode:step[1]};save();console.log(JSON.stringify({at:stamp(),...state.current}));
        const result=spawnSync(process.execPath,step,{cwd:root,stdio:'inherit',timeout:4*60*60*1000});if(result.status!==0)throw Error('Controlled recovery failed for '+key);
      }
      if(signature()!==instrument)throw Error('Instrument changed during verification');
      const result=read(resolve(root,'test-harness/results/org-content-v1',site,key,'result.json'));if(!result.complete||result.mode!=='verify')throw Error('Independent verification missing');state.units[key]={status:'verified',issues:result.verified,at:stamp()};save();
    }
    state.status='recovery-verified';state.completedAt=stamp();delete state.current;save();
  }catch(e){state.status='failed';state.reason=e.message;save();console.error(e.message);process.exitCode=1;}
  finally{unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
