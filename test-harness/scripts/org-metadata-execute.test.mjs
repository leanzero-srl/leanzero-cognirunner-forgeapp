/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOSTS, selection, makeClient, fieldPayload, atomicSave, isolationRemovals } from './org-metadata-execute.mjs';
const plan=JSON.parse(readFileSync(new URL('../../docs/org-expanded-approval-plan.json',import.meta.url)));
assert.equal(selection(plan).flatMap(s=>s.projects).length,90);
assert.equal(selection(plan).flatMap(s=>s.projects).flatMap(p=>p.customFields).length,1084);
assert.throws(()=>selection(plan,'leanzero.atlassian.net'),/allowlist/);
assert.throws(()=>selection(plan,HOSTS[0],'NONEXISTENT'),/No matching/);
const poisoned=structuredClone(plan);poisoned.sites[0].site='leanzero.atlassian.net';assert.throws(()=>selection(poisoned),/boundary/);
const malformed=structuredClone(plan);malformed.sites[0].projects[0].customFields[0].name='OTHER Evidence';assert.throws(()=>selection(malformed),/scoped/);
let calls=0;
const spy=async()=>{calls++;return {ok:true,status:200,text:async()=>'{"ok":true}'};};
for(const mode of ['inspect','verify','plan']){const api=makeClient(HOSTS[0],mode,'redacted',spy);for(const verb of ['POST','PUT','DELETE'])await assert.rejects(api('/rest/api/3/field',verb,{}),/prohibits/);}
assert.equal(calls,0);
const api=makeClient(HOSTS[0],'apply','redacted',spy);await assert.rejects(api('https://leanzero.atlassian.net/rest/api/3/field'),/Forbidden/);await assert.rejects(api('/rest/api/3/../field'),/Forbidden/);assert.equal(calls,0);
let mutations=0;const broken=makeClient(HOSTS[0],'apply','redacted',async()=>{mutations++;throw Error('ambiguous secret server data');});await assert.rejects(broken('/rest/api/3/field','POST',{}),/transport uncertain/);assert.equal(mutations,1);
const failed=makeClient(HOSTS[0],'apply','redacted',async()=>{mutations++;return {ok:false,status:429};});await assert.rejects(failed('/rest/api/3/field','POST',{}),/HTTP 429/);assert.equal(mutations,2);
assert.equal(fieldPayload({name:'LAB Evidence',type:'paragraph'}).type,'com.atlassian.jira.plugin.system.customfieldtypes:textarea');
const file=join(mkdtempSync(join(tmpdir(),'org-meta-test-')),'receipt.json');atomicSave(file,{pending:'field'});atomicSave(file,{done:'field'});assert.deepEqual(JSON.parse(readFileSync(file)),{done:'field'});
console.log('PASS: 90 projects/1084 fields; host, scoped-field, read-only, no mutation retry, atomic receipt controls');

assert.deepEqual(isolationRemovals({initialSchemeIds:['1'],complete:false},['1','2'],'2'),['1']);
assert.deepEqual(isolationRemovals({initialSchemeIds:['1'],complete:true},['2'],'2'),[]);
assert.throws(()=>isolationRemovals({initialSchemeIds:['1'],complete:true},['2','3'],'2'),/preserve external/);
assert.throws(()=>isolationRemovals({initialSchemeIds:['1'],complete:false},['1','2','3'],'2'),/preserve external/);
assert.throws(()=>isolationRemovals(null,['1'],'2'),/provenance/);
console.log('PASS: completed isolation refuses later additions; interrupted initialization removes only snapshot associations');
