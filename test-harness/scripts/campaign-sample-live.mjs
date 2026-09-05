/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// Run after the sample sanitizer deploy: compare a legacy stored sample, then
// deliver a real attachment event. Never persist or print the opaque token.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { BASE, get, del, sleep } from '../lib/jira.mjs';
import { loadEnv } from '../lib/env.mjs';
import { rulesApi, closeRulesApi } from '../lib/rules-api.mjs';
assert.equal(new URL(BASE).hostname, 'wolfaenpak.atlassian.net');
const dir = new URL('../results/listeners-jobs-campaign/', import.meta.url);
const state = JSON.parse(fs.readFileSync(new URL('state.json', dir)));
const before = JSON.parse(fs.readFileSync(new URL('sample-before.json', dir)));
const receipt = { startedAt: new Date().toISOString(), legacy: [], cleanup: [] };
const save = () => fs.writeFileSync(new URL('sample-live.json', dir), JSON.stringify(receipt, null, 2));
const eventType = 'avi:jira:created:attachment';
const witness = state.tag + '-sample-' + Date.now().toString(36);
let ruleId, attachmentId;
try {
  for (const previous of before) {
    assert.equal(previous.tokenPresent, true, 'Legacy exposure must have been measured before deployment');
    const response = await rulesApi.sample(previous.eventType);
    assert.equal(response.status, 200);
    const sample = response.body;
    assert.equal(sample.capturedAt, previous.capturedAt, 'Verify the same cached sample');
    assert.equal(Object.hasOwn(sample.payload, 'contextToken'), false, 'Legacy sample must omit the context token');
    assert.equal(sample.payload.fileName, previous.fileName);
    assert.equal(sample.payload.issueId, previous.issueId);
    receipt.legacy.push({ eventType: previous.eventType, capturedAt: sample.capturedAt, tokenAbsent: true, identityPreserved: true }); save();
  }
  const response = await rulesApi.listeners.create({ name: witness, enabled: true,
    events: [eventType], filters: { projectKeys: ['LZPT'] },
    functions: [{ name: 'Record event shape without its token', code: `await api.setProperty('${witness}', {tokenPresent:typeof api.context.event.contextToken==='string'&&api.context.event.contextToken.length>0,fileName:api.context.event.fileName,issueId:String(api.context.event.issueId)});` }],
  });
  assert.equal(response.status, 201); ruleId = response.body.listener.id; receipt.ruleId = ruleId; save();
  await sleep(35000);
  const env = loadEnv(), auth = 'Basic ' + Buffer.from(env.JIRA_ADMIN_EMAIL + ':' + env.JIRA_API_TOKEN).toString('base64');
  const content = Buffer.from('CogniRunner sample redaction live witness\n');
  const filename = witness + '.txt', form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  const upload = await fetch(BASE + `/rest/api/3/issue/${state.A}/attachments`, { method: 'POST', headers: { Authorization: auth, 'X-Atlassian-Token': 'no-check' }, body: form });
  assert.equal(upload.status, 200); const attachment = (await upload.json())[0]; attachmentId = attachment.id; receipt.attachmentId = attachmentId; save();
  const downloaded = await fetch(BASE + `/rest/api/3/attachment/content/${attachmentId}`, { headers: { Authorization: auth } });
  assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content);
  const deadline = Date.now() + 180000; let log;
  do {
    const logs = await rulesApi.logs(ruleId); assert.equal(logs.status, 200);
    log = logs.body.logs.find(row => row.source === 'async' && row.issueKey === state.A);
    if (log) break; await sleep(3000);
  } while (Date.now() < deadline);
  assert.ok(log, 'A real attachment event must execute'); assert.equal(log.isValid, true);
  const issue = await get(`/rest/api/3/issue/${state.A}?fields=summary`);
  const effect = (await get(`/rest/api/3/issue/${state.A}/properties/${witness}`)).value;
  assert.deepEqual(effect, { tokenPresent: true, fileName: filename, issueId: String(issue.id) });
  receipt.execution = { logId: log.id, timestamp: log.timestamp, effect, exactAttachmentBytes: content.length };
  const result = await rulesApi.sample(eventType); assert.equal(result.status, 200);
  const sample = result.body;
  assert.ok(Date.parse(sample.capturedAt) >= Date.parse(receipt.startedAt));
  assert.equal(sample.payload.fileName, filename); assert.equal(String(sample.payload.issueId), String(issue.id));
  assert.equal(Object.hasOwn(sample.payload, 'contextToken'), false, 'Fresh sample must omit the context token');
  receipt.fresh = { capturedAt: sample.capturedAt, fileName: filename, issueId: String(issue.id), tokenAbsent: true };
  receipt.pass = true;
} catch (error) { receipt.pass = false; receipt.error = error.stack; process.exitCode = 1; }
finally {
  if (ruleId) try { const r = await rulesApi.listeners.remove(ruleId); assert.ok([200,404].includes(r.status)); assert.equal((await rulesApi.listeners.get(ruleId)).status, 404); receipt.cleanup.push({ ruleId, absent: true }); } catch (error) { receipt.pass = false; receipt.cleanup.push({ ruleId, error: error.message }); process.exitCode = 1; }
  if (attachmentId) try { await del(`/rest/api/3/attachment/${attachmentId}`); await assert.rejects(() => get(`/rest/api/3/attachment/${attachmentId}`), error => error.status === 404); receipt.cleanup.push({ attachmentId, absent: true }); } catch (error) { receipt.pass = false; receipt.cleanup.push({ attachmentId, error: error.message }); process.exitCode = 1; }
  try { await closeRulesApi(); } catch (error) { receipt.pass = false; receipt.cleanup.push({ token: 'owned', error: error.message }); process.exitCode = 1; }
  receipt.finishedAt = new Date().toISOString(); save();
  console.log(receipt.pass ? 'PASS legacy/fresh sample redaction, unchanged real event, exact bytes and cleanup' : 'FAIL sample acceptance; inspect sanitized receipt');
}
