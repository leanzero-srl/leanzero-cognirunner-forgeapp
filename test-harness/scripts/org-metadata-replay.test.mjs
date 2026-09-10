/* CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from 'node:assert/strict';
import { durableMutation } from './org-metadata-execute.mjs';
const state={pending:{}};const snapshots=[];let present=true;let writes=0;
const save=()=>snapshots.push(structuredClone(state));
const api=async()=>{writes++;present=false;};
const invoke=()=>durableMutation(state,save,api,'apply','field/detach/1','DELETE','/rest/api/3/config/fieldschemes/fields',{},async()=>!present);
await invoke();assert.equal(writes,1);
assert(state.completedMutations['field/detach/1']);assert.deepEqual(state.pending,{});
assert(snapshots.every(s=>s.pending['field/detach/1']||s.completedMutations?.['field/detach/1']));
// Interrupt after the individual removal but before the field's overall isolation completes.
present=true;
await assert.rejects(invoke(),/Completed mutation drift/);assert.equal(writes,1);
const uncertain={pending:{x:{bodyHash:'known'}}};
await assert.rejects(durableMutation(uncertain,()=>{},api,'apply','x','DELETE','/rest/api/3/config/fieldschemes/fields',{},async()=>false),/Uncertain/);
assert.equal(writes,1);
console.log('PASS: human re-addition after individual deletion is preserved; no completion receipt gap; uncertain writes are not replayed');
