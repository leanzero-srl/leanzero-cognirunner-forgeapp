/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import {spawnSync} from 'node:child_process';
import {readFileSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicSave} from './org-metadata-execute.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),folder=resolve(root,'test-harness/results/org-demo-evidence-v1');
const lock=resolve(folder,'run.lock'),fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);
const state={startedAt:new Date().toISOString(),stages:[]};
try{
  for(const mode of ['apply','verify']){
    state.current=mode;atomicSave(resolve(folder,'run.json'),state);console.log(JSON.stringify({at:new Date().toISOString(),stage:mode}));
    const result=spawnSync(process.execPath,[resolve(root,'test-harness/scripts/org-demo-evidence-execute.mjs'),mode],{cwd:root,stdio:'inherit',timeout:4*60*60*1000});
    state.stages.push({mode,status:result.status,signal:result.signal,at:new Date().toISOString()});atomicSave(resolve(folder,'run.json'),state);
    if(result.status!==0)throw Error(mode+' failed; inspect durable receipts before resuming');
    const receipt=JSON.parse(readFileSync(resolve(folder,'receipt.json')));if(!receipt.lastRun.complete||receipt.lastRun.mode!==mode)throw Error('Full '+mode+' receipt missing');
  }
  state.status='content-verified';state.completedAt=new Date().toISOString();atomicSave(resolve(folder,'run.json'),state);
}catch(e){state.status='failed';state.reason=e.message;atomicSave(resolve(folder,'run.json'),state);console.error(e.message);process.exitCode=1;}
finally{unlinkSync(lock);}
