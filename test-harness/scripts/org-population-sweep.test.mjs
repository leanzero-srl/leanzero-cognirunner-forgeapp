/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import {metadataAdmission,drainSiteWorkers} from './org-population-sweep.mjs';
const site='apex-coresystems.atlassian.net',key='GATE',id=site+'/'+key;
assert.equal(metadataAdmission(site,key,{units:{[id]:{status:'verified'}}},null),'ready');
for(const status of ['failed','blocked-by-site-failure'])assert.equal(metadataAdmission(site,key,{units:{[id]:{status}}},{pid:process.pid}),'blocked');
assert.equal(metadataAdmission(site,key,{units:{}},{pid:process.pid}),'waiting');
assert.equal(metadataAdmission(site,key,{units:{}},null),'producer-stopped');
assert.equal(metadataAdmission(site,key,{finishedAt:'now',units:{}},{pid:process.pid}),'blocked');
assert.equal(metadataAdmission(site,key,{units:{'other/GATE':{status:'verified'}}},null),'producer-stopped');
assert.equal(metadataAdmission(site,key,{units:{[id]:{status:'verified',instrument:{manifest:'old',executor:'old'}}}},{pid:process.pid},{manifest:'new',executor:'new'}),'waiting');
assert.equal(metadataAdmission(site,key,{units:{[id]:{status:'verified',instrument:{manifest:'new',executor:'new'}}}},null,{manifest:'new',executor:'new'}),'ready');
let stopped=false,drained=0,admittedAfterFailure=0;
await assert.rejects(drainSiteWorkers([0,1,2],async index=>{
  if(index===0)throw Error('receipt write failed');
  await new Promise(resolve=>setTimeout(resolve,5));drained++;
  if(!stopped)admittedAfterFailure++;
},()=>{stopped=true;}),/all started workers have drained/);
assert.equal(drained,2);assert.equal(admittedAfterFailure,0);assert(stopped);
console.log('PASS: exact metadata admission, failures, completion and producer liveness');
