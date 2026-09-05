/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// Provisioning pipelines must be able to replay saved configurations without duplicates.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { BASE } from '../lib/jira.mjs';
import { rulesApi, closeRulesApi } from '../lib/rules-api.mjs';
assert.equal(new URL(BASE).hostname, 'wolfaenpak.atlassian.net');
const dir = new URL('../results/listeners-jobs-campaign/', import.meta.url);
const state = JSON.parse(fs.readFileSync(new URL('state.json', dir)));
const evidence = { tag: state.tag, startedAt: new Date().toISOString(), checks: [] };
const stable = ({ stats, updatedAt, ...config }) => config;
try {
  for (const kind of ['listeners', 'jobs']) {
    const noun = kind === 'listeners' ? 'listener' : 'job';
    const before = [];
    for (const item of state[kind]) {
      const response = await rulesApi[kind].get(item.id);
      assert.equal(response.status, 200);
      assert.equal(response.body[noun].enabled, false, 'Only quiesced owned fixtures');
      before.push(response.body[noun]);
    }
    const result = await rulesApi[kind].create(before.map(({ stats, ...config }) => config));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.errors, []);
    assert.equal(result.body[kind].length, before.length);
    for (const original of before) {
      const read = await rulesApi[kind].get(original.id);
      assert.equal(read.status, 200);
      assert.deepEqual(stable(read.body[noun]), stable(original));
    }
    const collection = await rulesApi[kind].list();
    assert.equal(collection.status, 200);
    assert.equal(collection.body[kind].filter(row => row.name.startsWith(state.tag)).length, before.length);
    evidence.checks.push({ kind, count: before.length, status: result.status, identicalConfigAndOwnership: true, noDuplicates: true });
    console.log(`PASS ${kind}: bulk replay ${before.length}, exact independent GETs, no duplicates`);
    const { stats, ...valid } = before[0];
    const invalid = { ...valid, ...(kind === 'jobs' ? { schedule: { cron: '99 * * * *' } } : { filters: { commentPattern: '[' } }) };
    const mixed = await rulesApi[kind].create([valid, invalid]);
    assert.equal(mixed.status, 207);
    assert.equal(mixed.body[kind].length, 1);
    assert.equal(mixed.body.errors.length, 1);
    assert.equal(mixed.body.errors[0].index, 1);
    const after = await rulesApi[kind].get(valid.id);
    assert.deepEqual(stable(after.body[noun]), stable(valid));
    evidence.checks.push({ kind, status: 207, validCount: 1, invalidIndex: 1, refusedConfigUnchanged: true });
    console.log(`PASS ${kind}: mixed batch207 identifies invalid row and preserves saved config`);
  }
  evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.error = error.stack; process.exitCode = 1; console.error(error.stack);
} finally {
  await closeRulesApi();
  fs.writeFileSync(new URL('rest-bulk.json', dir), JSON.stringify(evidence, null, 2));
}
