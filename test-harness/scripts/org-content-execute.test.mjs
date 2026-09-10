/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyFields,transitionPath,runPopulationRows} from './org-content-execute.mjs';
const expected={project:{id:'1'},issuetype:{id:'2'},parent:{key:'LAB-1'},assignee:{accountId:'owner'},labels:['b','a'],customfield_1:{id:'3'},customfield_2:{accountId:'owner'},customfield_3:7,summary:'Case'};
const actual={...expected,project:{id:'1',key:'LAB'},parent:{key:'LAB-1',id:'4'},labels:['a','b'],customfield_1:{id:'3',value:'Ready'},assignee:{accountId:'owner',displayName:'Owner'}};
verifyFields(actual,expected);
for(const field of Object.keys(expected)){const broken=structuredClone(actual);delete broken[field];assert.throws(()=>verifyFields(broken,expected),/drift/);}
const plan=JSON.parse(readFileSync(new URL('../../docs/org-expanded-approval-plan.json',import.meta.url)));
for(const family of Object.values(plan.workflowFamilies))for(const state of family.states){const path=transitionPath(family,family.states[0],state);let current=family.states[0];for(const edge of path){assert.equal(edge.from,current);current=edge.to;}assert.equal(current,state);}
assert.throws(()=>transitionPath({edges:[]},'A','B'),/No approved/);
const rows=[...Array.from({length:6},(_,i)=>({id:'e'+i,type:'Epic'})),...Array.from({length:9},(_,i)=>({id:'t'+i,type:'Task'})),{id:'s',type:'Sub-task',subtask:true}];
const finished=new Set();let active=0,peak=0;
await runPopulationRows(rows,async row=>{
  if(row.type==='Task')assert.equal([...finished].filter(id=>id[0]==='e').length,6);
  if(row.subtask)assert.equal(finished.size,15);
  active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;finished.add(row.id);
});
assert.equal(finished.size,16);assert.equal(peak,4);assert.equal(active,0);
let admitted=0,settled=0;
await assert.rejects(runPopulationRows(rows,async row=>{admitted++;if(row.id==='e0')throw Error('stop');await new Promise(resolve=>setTimeout(resolve,5));settled++;}),/stop/);
assert.equal(admitted,4);assert.equal(settled,3,'Wait for already admitted writes before releasing the writer lock');
await assert.rejects(runPopulationRows([rows.at(-1),rows[0]],async()=>{}),/ordering/);
let planned=0;assert.equal(await runPopulationRows(rows,async()=>{planned++;return false;},1),false);assert.equal(planned,1);
console.log('PASS: every native/custom field is checked; all planned states reachable; missing fields and unreachable paths fail');
