/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPopulation,renderCase} from '../lib/org-content-model.mjs';
const plan=JSON.parse(readFileSync(new URL('../../docs/org-expanded-approval-plan.json',import.meta.url)));
let projects=0,issues=0;
for(const site of plan.sites)for(const project of site.projects){
  if(project.existingOwnedIssues){assert.throws(()=>buildPopulation(plan,site.site,project.key),/baseline/);continue;}
  const population=buildPopulation(plan,site.site,project.key);projects++;issues+=population.rows.length;
  const seen=new Set();const typeCounts={},states={};
  for(const row of population.rows){
    assert(!seen.has(row.identity));
    if(row.parentIdentity)assert(seen.has(row.parentIdentity),'Parents must precede children');
    seen.add(row.identity);typeCounts[row.type]=(typeCounts[row.type]||0)+1;
    states[row.workflowId]||={};states[row.workflowId][row.state]=(states[row.workflowId][row.state]||0)+1;
  }
  assert.deepEqual(typeCounts,project.initialSeedByType);
  for(const reserved of Object.values(project.reservedGeneratedStates))states[reserved.workflow][reserved.state]=(states[reserved.workflow][reserved.state]||0)+reserved.count;
  assert.deepEqual(states,project.workflowStateCounts);
  const metadata={key:project.key,id:'1000',createdByCampaign:true,checkedAt:'2026-09-10',issueTypes:Object.fromEntries(Object.keys(typeCounts).map((t,i)=>[t,{id:String(2000+i)}])),fields:Object.fromEntries(project.customFields.map((f,i)=>[f.name,{id:'customfield_'+(10000+i),projectKeys:[project.key],options:f.options?.map((value,j)=>({id:String(30000+j),value,disabled:false}))}]))};
  const rendered=renderCase(plan,population,population.rows[0],metadata,[{active:true,accountId:'offline-only'}]);
  assert.equal(rendered.fields.project.id,'1000');assert(rendered.fields.description.content.length>=8);
  const wrong=structuredClone(metadata);wrong.fields[project.customFields[0].name].projectKeys=['OTHER'];
  assert.throws(()=>renderCase(plan,population,population.rows[0],wrong,[{active:true,accountId:'offline-only'}]),/context/);
}
assert.equal(projects,83);assert.equal(issues,77546);
assert.throws(()=>buildPopulation(plan,'leanzero.atlassian.net','LAB'),/Unapproved/);
console.log('PASS: 83 new project populations, 77546 seed slots, all type/state totals, parent ordering, reserved exclusions and cross-project field refusal');
