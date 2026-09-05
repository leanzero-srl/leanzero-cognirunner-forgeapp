/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// Twenty rules receive each real comment together. Two issues keep the test below
// the established per-issue brake while producing two simultaneous completion batches.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { BASE, post, get, sleep } from '../lib/jira.mjs';
import { rulesApi, closeRulesApi } from '../lib/rules-api.mjs';
assert.equal(new URL(BASE).hostname, 'wolfaenpak.atlassian.net');
const dir = new URL('../results/listeners-jobs-campaign/', import.meta.url);
const state = JSON.parse(fs.readFileSync(new URL('state.json', dir)));
const tag = state.tag + '-concurrent-' + Date.now().toString(36);
const receipt = { tag, rules: [], batches: [], cleanup: [] };
const save = () => fs.writeFileSync(new URL('listener-concurrency.json', dir), JSON.stringify(receipt, null, 2));
const poll = async (fn, predicate) => {
  const deadline = Date.now() + 240000; let value;
  do { value = await fn(); if (predicate(value)) return value; await sleep(3000); } while (Date.now() < deadline);
  throw new Error('Expected delivery/statistics did not arrive: ' + JSON.stringify(value).slice(0, 600));
};
const property = async (key, name) => {
  try { return (await get(`/rest/api/3/issue/${key}/properties/${name}`)).value; }
  catch (error) { if (error.status === 404) return null; throw error; }
};
try {
  for (let i = 1; i <= 20; i++) {
    const failure = i % 5 === 0, name = `${tag}-${i}`;
    const response = await rulesApi.listeners.create({ name, enabled: true,
      events: ['avi:jira:commented:issue'], filters: { projectKeys: ['LZPT'], commentPattern: tag },
      functions: [{ name: failure ? 'Deliberate error' : 'Record exact comment', code: failure
        ? `throw new Error('${name}-expected');`
        : `await api.setProperty('${name}', {commentId:api.context.event.comment.id,key:api.context.issueKey});` }],
    });
    assert.equal(response.status, 201);
    receipt.rules.push({ id: response.body.listener.id, name, failure }); save();
  }
  await sleep(35000);
  for (const [batch, key] of [state.A, state.B].entries()) {
    const started = Date.now();
    const comment = await post(`/rest/api/3/issue/${key}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${tag} batch ${batch+1}` }] }] } });
    const result = { batch: batch+1, key, commentId: comment.id, outcomes: [] }; receipt.batches.push(result); save();
    for (const rule of receipt.rules) {
      const response = await poll(() => rulesApi.logs(rule.id), r => r.status === 200 && r.body.logs.some(l => l.source === 'async' && l.issueKey === key && Date.parse(l.timestamp) >= started));
      const log = response.body.logs.find(l => l.source === 'async' && l.issueKey === key && Date.parse(l.timestamp) >= started);
      assert.equal(log.isValid, !rule.failure);
      const effect = await property(key, rule.name);
      if (rule.failure) { assert.equal(effect, null); assert.ok(log.reason.includes(rule.name+'-expected')); }
      else assert.deepEqual(effect, { commentId: comment.id, key });
      const current = await poll(() => rulesApi.listeners.get(rule.id), r => r.status === 200 && r.body.listener.stats.runCount === batch+1);
      const stats = current.body.listener.stats;
      assert.equal(stats.errorCount, rule.failure ? batch+1 : 0);
      assert.equal(stats.lastStatus, rule.failure ? 'error' : 'ok'); assert.equal(stats.lastIssueKey, key);
      assert.ok(Date.parse(stats.lastRunAt) >= Date.parse(log.timestamp));
      if (rule.failure) assert.ok(stats.lastError.includes(rule.name+'-expected')); else assert.equal(stats.lastError, null);
      result.outcomes.push({ id: rule.id, log, effect, stats }); save();
    }
    console.log(`PASS concurrent listener batch ${batch+1}: 20 exact logs, effects and counters`);
  }
  receipt.pass = true;
} catch (error) { receipt.pass = false; receipt.error = error.stack; process.exitCode = 1; console.error(error.stack); }
finally {
  for (const rule of receipt.rules) {
    try {
      const removed = await rulesApi.listeners.remove(rule.id); assert.ok([200,404].includes(removed.status));
      assert.equal((await rulesApi.listeners.get(rule.id)).status, 404);
      receipt.cleanup.push({ id: rule.id, deleted: true });
    } catch (error) { receipt.cleanup.push({ id: rule.id, deleted: false, error: error.message }); process.exitCode = 1; receipt.pass = false; }
    save();
  }
  await closeRulesApi(); save();
}
