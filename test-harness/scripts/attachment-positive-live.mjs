/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { get, post, del, getIssue, doTransition, BASE, sleep } from "../lib/jira.mjs";
import { loadEnv } from "../lib/env.mjs";
import { readWorkflow, updateWorkflow, attachSelfLoopRules, initialStatusRef } from "../lib/workflow.mjs";
assert.equal(new URL(BASE).hostname, "wolfaenpak.atlassian.net");
const tag = "cgr-attachment-" + Date.now().toString(36), evidence = { tag, cleanup: [] };
const adfText = node => typeof node?.text === "string" ? node.text : (node?.content || []).map(adfText).join("");
const expectedComment = attachment => `📎 CogniRunner generated and attached "${attachment.filename}".`;
let key, workflowName, transitionId;
try {
  const project = await get("/rest/api/3/project/JT");
  const types = await get("/rest/api/3/issue/createmeta/JT/issuetypes?maxResults=100");
  const type = (types.issueTypes || types.values).find(t => !t.subtask);
  const association = await get(`/rest/api/3/workflowscheme/project?projectId=${project.id}`);
  const scheme = await get(`/rest/api/3/workflowscheme/${association.values[0].workflowScheme.id}`);
  workflowName = scheme.issueTypeMappings?.[type.id] || scheme.defaultWorkflow;
  const { wf } = await readWorkflow(workflowName);
  const spec = { name: tag, type: "generate-doc", config: {
    id: tag, type: "postfunction-generate-doc", fieldId: "description", docFormat: "markdown",
    contentPrompt: `Write a short verification note containing the exact marker ${tag}. Include the following literal lines verbatim inside one fenced code block, preserving every equals sign and adding no spaces within each line. Do not reformat these lines as prose, a table, or bold labels:\ntransport=multipart\nbytes=verified\nenvironment=wolfaenpak`,
    docTitlePrompt: tag, attachComment: true, debugTrace: true,
  } };
  const attached = await attachSelfLoopRules(workflowName, initialStatusRef(wf), [spec], 9870);
  transitionId = attached[0].transitionId;
  key = (await post("/rest/api/3/issue", { fields: { project: { key: "JT" }, issuetype: { id: type.id }, summary: tag,
    description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `${tag}: attachment transport validation on the test site.` }] }] }, labels: [tag] } })).key;
  const before = await getIssue(key, ["attachment", "comment"]);
  evidence.issue = key;
  evidence.before = { attachments: before.fields.attachment, comments: before.fields.comment };
  assert.equal(before.fields.attachment.length, 0);
  assert.equal(before.fields.comment.total, 0);
  const fired = await doTransition(key, transitionId);
  assert.ok(fired.status >= 200 && fired.status < 300, JSON.stringify(fired));
  let after;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    after = await getIssue(key, ["attachment", "comment"]);
    if (after.fields.attachment.length === 1 && after.fields.comment.total === 1 &&
        adfText(after.fields.comment.comments[0]?.body) === expectedComment(after.fields.attachment[0])) break;
  }
  // Retain the actual user-visible state even when the positive proof fails.
  // An endpoint failure must not be hidden by reporting only the assertion.
  evidence.after = { attachments: after.fields.attachment, comments: after.fields.comment };
  assert.equal(after.fields.attachment.length, 1, "exactly one actual Jira attachment required");
  const attachment = after.fields.attachment[0];
  assert.match(attachment.filename, /\.md$/);
  assert.ok(attachment.filename.includes(tag), attachment.filename);
  const env = loadEnv();
  const downloaded = await fetch(`${BASE}/rest/api/3/attachment/content/${attachment.id}`, { headers: { Authorization: "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64") } });
  assert.equal(downloaded.status, 200);
  const bytes = Buffer.from(await downloaded.arrayBuffer()), content = bytes.toString("utf8");
  evidence.attachment = { id: attachment.id, filename: attachment.filename, size: attachment.size, mimeType: attachment.mimeType, downloadedBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), content };
  assert.equal(bytes.length, attachment.size);
  for (const text of [tag, "transport=multipart", "bytes=verified", "environment=wolfaenpak"]) assert.ok(content.includes(text), `missing exact document fact ${text}`);
  assert.equal(after.fields.comment.total, 1, "exactly one requested attachment comment required");
  const comment = after.fields.comment.comments[0];
  assert.equal(adfText(comment.body), expectedComment(attachment));
  const second = await getIssue(key, ["attachment", "comment"]);
  evidence.second = { attachments: second.fields.attachment, comments: second.fields.comment };
  assert.equal(second.fields.attachment.length, 1);
  assert.equal(second.fields.attachment[0].id, attachment.id);
  assert.equal(second.fields.comment.total, 1);
  assert.equal(second.fields.comment.comments[0].id, comment.id);
  assert.equal(adfText(second.fields.comment.comments[0].body), expectedComment(attachment));
  evidence.deliveryPass = true;
  evidence.issue = key; evidence.workflow = workflowName; evidence.transitionId = transitionId;
} catch (e) { evidence.error = e.stack; console.error(e.stack); process.exitCode = 1; }
finally {
  if (transitionId) try {
    const { top, wf } = await readWorkflow(workflowName);
    wf.transitions = wf.transitions.filter(t => !(t.id === transitionId && t.name === tag));
    await updateWorkflow(top, wf);
    assert.ok(!(await readWorkflow(workflowName)).wf.transitions.some(t => t.id === transitionId && t.name === tag));
    evidence.cleanup.push({ transitionId, absent: true });
  } catch (e) { evidence.cleanup.push({ transitionId, error: e.message }); process.exitCode = 1; }
  if (key) try {
    await del(`/rest/api/3/issue/${key}?deleteSubtasks=true`);
    await assert.rejects(() => getIssue(key, ["summary"]), e => e.status === 404);
    evidence.cleanup.push({ key, absent: true });
  } catch (e) { evidence.cleanup.push({ key, error: e.message }); process.exitCode = 1; }
  evidence.pass = evidence.deliveryPass === true && evidence.cleanup.length === 2 && evidence.cleanup.every(item => item.absent === true) && !process.exitCode;
  if (evidence.pass) console.log("PASS actual workflow → AI document → Jira attachment + comment → byte download → verified cleanup", JSON.stringify({ key, id: evidence.attachment.id, filename: evidence.attachment.filename, bytes: evidence.attachment.downloadedBytes }));
  fs.mkdirSync(new URL("../results/attachment-positive/", import.meta.url), { recursive: true });
  fs.writeFileSync(new URL("../results/attachment-positive/evidence.json", import.meta.url), JSON.stringify(evidence, null, 2));
}
