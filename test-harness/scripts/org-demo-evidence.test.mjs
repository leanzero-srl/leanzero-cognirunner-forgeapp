/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import {evidenceCatalog,textAttachment} from '../lib/org-demo-evidence.mjs';
import {canonicalEvidence} from './org-demo-evidence-execute.mjs';
const catalog=evidenceCatalog(),pages=catalog.spaces.flatMap(s=>s.pages),files=pages.flatMap(p=>p.attachments);
assert.equal(pages.length,102);assert.equal(files.length,156);assert(pages.every(p=>p.attachments.length));assert.equal(new Set(files.map(a=>a.name)).size,156);
assert.deepEqual(Object.fromEntries(['pdf','csv','json','txt','svg'].map(f=>[f,files.filter(a=>a.format===f).length])),{pdf:48,csv:36,json:24,txt:24,svg:24});
for(const page of pages){
 assert(page.body.content.some(n=>n.type==='table'));assert(page.paragraphs.every(p=>p.length>150));
 for(const row of page.measurements)assert.equal(row.passed+row.exceptions,row.sample);
 for(const file of page.attachments){if(file.format==='pdf')continue;const content=textAttachment(page,file.format);assert(content.includes(page.identity));if(file.format==='json'){const data=JSON.parse(content);assert(data.synthetic);assert.equal(data.review.actualApproval,null);}}
}
assert.deepEqual(canonicalEvidence({type:'paragraph',attrs:{localId:'generated'}}),{type:'paragraph'});
assert.notDeepEqual(canonicalEvidence({type:'text',text:'human edit'}),canonicalEvidence({type:'text',text:'original'}));
assert.deepEqual(canonicalEvidence({type:'doc',content:[{type:'table',attrs:{layout:'default'},content:[{type:'tableCell',attrs:{colspan:1,rowspan:1}}]}]}),canonicalEvidence({type:'doc',version:1,content:[{type:'table',attrs:{layout:'default',isNumberColumnEnabled:false},content:[{type:'tableCell'}]}]}));
assert.notDeepEqual(canonicalEvidence({type:'tableCell',attrs:{colspan:2}}),canonicalEvidence({type:'tableCell'}));
console.log('PASS: 102 authored pages; exact 156-file mix; unique names; meaningful bodies; consistent measurements; approvals not fabricated');
