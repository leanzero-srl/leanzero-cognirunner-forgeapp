/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import {canonicalField,createFields,verifyFieldAvailability,desiredFieldConfiguration,visibleConfiguration,requireExclusiveConsumers,fieldConfigurationDelta} from './org-field-availability.mjs';
assert.deepEqual(canonicalField({id:'summary',isRequired:true}),{id:'summary',isRequired:true,isHidden:false,description:''});
const binding={issueTypes:{Epic:{id:'1'},Task:{id:'2'}},fields:{Evidence:{id:'customfield_1'},Due:{id:'duedate',system:true}}};
let calls=0;const api=async()=>{calls++;return {total:2,fields:[{fieldId:'customfield_1'},{fieldId:'duedate'}]};};
assert.equal(await verifyFieldAvailability(api,'GATE',binding),2);assert.equal(calls,2);
await assert.rejects(verifyFieldAvailability(async()=>({total:1,fields:[{fieldId:'duedate'}]}),'GATE',binding),/customfield_1/);
await assert.rejects(createFields(async()=>({total:2,fields:[]}), 'GATE','1'),/Incomplete/);
assert.equal(desiredFieldConfiguration([{id:'customfield_1',isHidden:true}],binding.fields)[0].isHidden,false);
assert.deepEqual(visibleConfiguration([{id:'summary'},{id:'other',isHidden:true}]),visibleConfiguration([{id:'summary'}]));
assert.throws(()=>requireExclusiveConsumers('1','2','3',[{fieldConfigurationId:'1',fieldConfigurationSchemeId:'4'}],[]),/another scheme/);
assert.throws(()=>requireExclusiveConsumers(null,'2','3',[],[{fieldConfigurationScheme:{id:'2'},projectIds:['3','4']}]),/another project/);
requireExclusiveConsumers('1','2','3',[{fieldConfigurationId:'1',fieldConfigurationSchemeId:'2'}],[{fieldConfigurationScheme:{id:'2'},projectIds:['3']}]);
assert.deepEqual(fieldConfigurationDelta([{id:'summary',isRequired:true}],[{id:'summary',isRequired:true},{id:'customfield_1'}]),[{id:'customfield_1'}]);
console.log('PASS: every type checks every campaign/native field; missing availability and incomplete pagination fail');
