/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { BASE, post, get, sleep } from '../lib/jira.mjs';
import { rulesApi, closeRulesApi } from '../lib/rules-api.mjs';
assert.equal(new URL(BASE).hostname, 'wolfaenpak.atlassian.net');
const dir = new URL('../results/listeners-jobs-campaign/', import.meta.url);
const state = JSON.parse(fs.readFileSync(new URL('state.json', dir)));
const id = state.listeners.find(row => row.code === 'L20').id;
const witness = state.tag + '-multi-error', receipt = { id, witness, checks: [] };
let original;
try {
  const before = await rulesApi.listeners.get(id); assert.equal(before.status, 200); original = before.body.listener;
  const functions = [
    { name: 'Repeated name', code: 'api.log("first step succeeds");' },
    { name: 'Repeated name', code: `throw '${witness}-first';` },
    { name: 'Null failure', code: 'throw null;' },
    { name: 'Number failure', code: 'throw 42;' },
    { name: 'Later Error', code: `throw new Error('${witness}-last');` },
    { name: 'Continue and record', code: `await api.setProperty('${witness}', {commentId:api.context.event.comment.id,key:api.context.issueKey});` },
  ];
  const updated = await rulesApi.listeners.update(id, { enabled: true, functions }); assert.equal(updated.status, 200);
  await sleep(35000);
  const started = Date.now();
  const comment = await post(`/rest/api/3/issue/${state.A}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: state.tag+'-failure '+witness }] }] } });
  const deadline = Date.now()+180000; let log;
  while (Date.now()<deadline) {
    const response = await rulesApi.logs(id); assert.equal(response.status, 200);
    log = response.body.logs.find(l => l.source === 'async' && Date.parse(l.timestamp)>=started);
    if (log) break; await sleep(3000);
  }
  assert.ok(log, 'Actual comment delivery must arrive'); receipt.log = log;
  assert.equal(log.isValid, false);
  assert.equal(log.reason, `Step "Repeated name" failed: ${witness}-first`);
  assert.ok(log.recommendation.includes(witness+'-first')); assert.ok(!log.recommendation.includes(witness+'-last'));
  assert.deepEqual(log.stepResults.map(s=>s.status), ['success','error','error','error','error','success']);
  assert.deepEqual(log.stepResults.filter(s=>s.status==='error').map(s=>s.error), [witness+'-first','null','42',witness+'-last']);
  const effect = (await get(`/rest/api/3/issue/${state.A}/properties/${witness}`)).value;
  assert.deepEqual(effect, { commentId: comment.id, key: state.A }); receipt.effect = effect;
  receipt.checks.push('Real listener preserves first failure, every thrown value and later Jira write');
  // Test Run's resolver is intentionally outside the dev-hook allowlist.
  // Its separate acceptance leg uses the actual browser controls.
  receipt.pass = true; console.log('PASS actual multi-error listener, all traces and exact later-step write');
} catch (error) { receipt.pass = false; receipt.error = error.stack; process.exitCode = 1; console.error(error.stack); }
finally {
  if (original) {
    try {
      const restored = await rulesApi.listeners.update(id, { ...original, enabled: false }); assert.equal(restored.status, 200);
      const read = await rulesApi.listeners.get(id); assert.equal(read.status, 200);
      assert.deepEqual(read.body.listener.functions, original.functions); assert.equal(read.body.listener.enabled, false);
      receipt.restored = true;
    } catch (error) { receipt.restored = false; receipt.restoreError = error.message; receipt.pass = false; process.exitCode = 1; }
  }
  await closeRulesApi(); fs.writeFileSync(new URL('failure-live.json', dir), JSON.stringify(receipt, null, 2));
}
