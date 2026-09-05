/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline lockstep test: src/shared/jira-events.js (the Listener event catalogue) ⇄
// manifest.yml `trigger` modules. Every catalogued event must be subscribed in the
// manifest and vice versa, and the payload extractors must survive the real shapes.
// Run: node scripts/jira-events.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  JIRA_EVENTS, EVENT_IDS, EVENT_CATEGORIES, getEvent, isKnownEvent, eventsByCategory, filtersForEvents,
  extractEventContext, changedFieldsOf, commentTextOf, adfToPlainText, trimEventPayload, buildEventPromptBlock,
} from "../../src/shared/jira-events.js";

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL:", msg); } };

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = readFileSync(path.join(here, "../../manifest.yml"), "utf8");
const manifestEvents = new Set([...manifest.matchAll(/^\s+- (avi:[a-z0-9:._-]+)\s*$/gm)].map((m) => m[1]));

ok(EVENT_IDS.length >= 68, `catalogue has ${EVENT_IDS.length} events (expected ≥ 68)`);
ok(new Set(EVENT_IDS).size === EVENT_IDS.length, "no duplicate ids");
for (const id of EVENT_IDS) ok(manifestEvents.has(id), `manifest subscribes ${id}`);
for (const id of manifestEvents) ok(isKnownEvent(id), `catalogue knows manifest event ${id}`);
const cats = new Set(EVENT_CATEGORIES.map((c) => c.id));
for (const e of JIRA_EVENTS) {
  ok(cats.has(e.category), `${e.id} has a known category`);
  ok(e.label && e.description, `${e.id} has label + description`);
  ok(Array.isArray(e.scopes) && e.scopes.length, `${e.id} declares scopes`);
}
ok(eventsByCategory().every((c) => c.events.length > 0), "every category has events");
ok(filtersForEvents(["avi:jira:updated:issue"]).includes("changedFields"), "updated:issue offers changedFields");
ok(!filtersForEvents(["avi:jira:created:version"]).includes("jql"), "version events do not offer jql");
ok(getEvent("avi:jira:viewed:issue").volume === "high", "viewed:issue flagged high volume");

// extractors
const issueEv = { eventType: "avi:jira:updated:issue", atlassianId: "acc-1", selfGenerated: false, issue: { id: "10001", key: "LZPT-12", fields: { project: { id: "10000", key: "LZPT" }, issuetype: { id: "10002", name: "Bug" } } }, changelog: { items: [{ field: "priority", fieldId: "priority", fromString: "Low", toString: "High" }] } };
const c1 = extractEventContext("avi:jira:updated:issue", issueEv);
ok(c1.issueKey === "LZPT-12" && c1.projectKey === "LZPT" && c1.projectId === "10000" && c1.issueTypeName === "Bug" && c1.actorAccountId === "acc-1", "issue context extracted");
ok(JSON.stringify(changedFieldsOf(issueEv)) === JSON.stringify(["priority", "priority"]), "changed fields listed (name + id)");
const noProj = extractEventContext("avi:jira:created:issue", { issue: { id: "1", key: "ABC-7", fields: {} } });
ok(noProj.projectKey === "ABC", "project key falls back to the key prefix");
const commentEv = { issue: { key: "LZPT-1", fields: {} }, comment: { id: "5", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Please " }, { type: "mention", attrs: { id: "x", text: "@Ann" } }, { type: "text", text: " escalate ASAP" }] }] } } };
ok(commentTextOf(commentEv) === "Please @Ann escalate ASAP", `comment ADF → text: "${commentTextOf(commentEv)}"`);
ok(commentTextOf({ comment: { body: "plain" } }) === "plain", "plain-string comment body");
const wl = extractEventContext("avi:jira:created:worklog", { worklog: { id: "77", issueId: "10001" } });
ok(wl.issueId === "10001" && wl.issueKey === null && wl.entityName === "worklog 77", "worklog: id-only issue");
for (const id of ["avi:jira:created:attachment", "avi:jira:deleted:attachment"]) {
  // Forge events use fileName; Jira REST attachment objects use filename.
  const payload = { attachment: { id: "10", issueId: "10001", projectId: "10000", fileName: "event-file.txt", filename: "legacy-file.txt", mimeType: "text/plain", size: "17" } };
  const before = JSON.stringify(payload);
  const attachment = extractEventContext(id, payload);
  ok(attachment.entityName === "attachment event-file.txt", `${id}: Forge fileName wins over legacy filename`);
  ok(attachment.issueId === "10001" && attachment.projectId === "10000" && attachment.issueKey === null, `${id}: attachment identity preserves available issue/project ids`);
  ok(JSON.stringify(payload) === before, `${id}: raw payload stays untouched`);
  ok(extractEventContext(id, { attachment: { filename: "old.txt" } }).entityName === "attachment old.txt", `${id}: legacy filename still labels older samples`);
  ok(extractEventContext(id, {}).entityName === "attachment", `${id}: missing attachment metadata is safe`);
  const hint = buildEventPromptBlock([id]);
  ok(hint.includes("fileName") && hint.includes("issueId") && hint.includes("projectId") && !hint.includes("filename"), `${id}: generated prompt and picker hint teach Forge payload casing`);
  ok(hint.includes("api.context.issueKey") && !hint.includes("event.issueKey"), `${id}: resolved key is described on its actual context path`);
}
const link = extractEventContext("avi:jira:created:issuelink", { sourceIssueId: 1, destinationIssueId: 2, sourceProjectId: 9, issueLinkType: { name: "Blocks" } });
ok(link.issueId === "1" && link.projectId === "9", "issue link: source ids extracted");
const ver = extractEventContext("avi:jira:released:version", { version: { id: "3", name: "v1", projectId: 10000 } });
ok(ver.projectId === "10000" && ver.entityName === "version v1", "version: project id + name");
const comp = extractEventContext("avi:jira:created:component", { component: { id: "4", name: "API", project: "LZPT", projectId: 10000 } });
ok(comp.projectKey === "LZPT" && comp.entityName === "component API", "component: project key + name");
const proj = extractEventContext("avi:jira:created:project", { project: { id: 5, key: "NEW", name: "New" } });
ok(proj.projectKey === "NEW" && proj.projectId === "5", "project event context");
const usr = extractEventContext("avi:jira:created:user", { user: { accountId: "u1", displayName: "Ann" } });
ok(usr.entityName === "user Ann" && usr.projectKey === null, "user event context");
ok(extractEventContext("avi:jsm-entity:created:request-type", { entityId: "rt-1", entityType: "request-type" }).entityName === "request-type rt-1", "jsm entity");
ok(adfToPlainText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }] }).trim() === "a\nb", "adf paragraphs separated");

// trimming keeps identity, drops bulk
const big = { eventType: "avi:jira:created:issue", issue: { id: "1", key: "K-1", fields: { summary: "s", project: { key: "K" }, description: "x".repeat(90000), customfield_1: "y".repeat(50000) } } };
const t = trimEventPayload(big, 60000);
ok(t.issue.key === "K-1" && t.issue.fields.summary === "s" && !t.issue.fields.description && t.issue._trimmed === true, "trimmed payload keeps identity + summary, drops bulky fields");
ok(JSON.stringify(trimEventPayload(big, 100)).length < 400, "hard cap produces a stub");
ok(buildEventPromptBlock(["avi:jira:commented:issue"]).includes("event.comment"), "prompt block carries payload hints");

console.log(`JIRA-EVENTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
