/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyFields,transitionPath} from './org-content-execute.mjs';
const expected={project:{id:'1'},issuetype:{id:'2'},parent:{key:'LAB-1'},assignee:{accountId:'owner'},labels:['b','a'],customfield_1:{id:'3'},customfield_2:{accountId:'owner'},customfield_3:7,summary:'Case'};
const actual={...expected,project:{id:'1',key:'LAB'},parent:{key:'LAB-1',id:'4'},labels:['a','b'],customfield_1:{id:'3',value:'Ready'},assignee:{accountId:'owner',displayName:'Owner'}};
verifyFields(actual,expected);
for(const field of Object.keys(expected)){const broken=structuredClone(actual);delete broken[field];assert.throws(()=>verifyFields(broken,expected),/drift/);}
const plan=JSON.parse(readFileSync(new URL('../../docs/org-expanded-approval-plan.json',import.meta.url)));
for(const family of Object.values(plan.workflowFamilies))for(const state of family.states){const path=transitionPath(family,family.states[0],state);let current=family.states[0];for(const edge of path){assert.equal(edge.from,current);current=edge.to;}assert.equal(current,state);}
assert.throws(()=>transitionPath({edges:[]},'A','B'),/No approved/);
console.log('PASS: every native/custom field is checked; all planned states reachable; missing fields and unreachable paths fail');
