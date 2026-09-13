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
  eventLabel, eventSource, isGitEvent, GIT_EVENT_IDS, requiresRepoFilter,
} from "../../src/shared/jira-events.js";

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL:", msg); } };

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = readFileSync(path.join(here, "../../manifest.yml"), "utf8");
const manifestEvents = new Set([...manifest.matchAll(/^\s+- (avi:[a-z0-9:._-]+)\s*$/gm)].map((m) => m[1]));

// THE LOCKSTEP, AND ITS ONE EXEMPTION.
// `source:"jira"` rows are Forge product events and MUST appear under a manifest
// `trigger`. `source:"git"` rows (1.4) have no trigger and never will — they are
// delivered by the app's own git webhook — so they are exempt from the manifest
// half of the lockstep and are instead held to their own invariants below. This
// exemption landed in the same commit as the git rows; without it the suite would
// fail and the next person would delete an assertion.
const jiraIds = EVENT_IDS.filter((id) => eventSource(id) === "jira");
ok(jiraIds.length >= 68, `catalogue has ${jiraIds.length} Jira events (expected ≥ 68)`);
ok(new Set(EVENT_IDS).size === EVENT_IDS.length, "no duplicate ids");
for (const id of jiraIds) ok(manifestEvents.has(id), `manifest subscribes ${id}`);
for (const id of manifestEvents) ok(isKnownEvent(id), `catalogue knows manifest event ${id}`);
for (const id of GIT_EVENT_IDS) ok(!manifestEvents.has(id), `${id} is webhook-delivered, so it must NOT be a manifest trigger`);

// Git rows: the invariants that replace the manifest half of the lockstep.
const EXPECTED_GIT = [
  "git:pull_request:opened", "git:pull_request:synchronize", "git:pull_request:closed",
  "git:pull_request:merged", "git:pull_request_review:submitted", "git:issue_comment:created",
  "git:push", "git:check_run:completed", "git:pipeline:completed",
];
ok(JSON.stringify(GIT_EVENT_IDS) === JSON.stringify(EXPECTED_GIT), `git catalogue is exactly the 9 expected ids (got ${GIT_EVENT_IDS.join(", ")})`);
ok(EVENT_CATEGORIES.some((c) => c.id === "git" && c.hue), "the Git category exists and carries a hue");
for (const id of GIT_EVENT_IDS) {
  const e = getEvent(id);
  ok(isGitEvent(id) && e.source === "git", `${id} is source:"git"`);
  ok(e.category === "git", `${id} is in the Git category`);
  ok(e.projectScoped === false, `${id} is not project-scoped (a repo is not a project)`);
  ok(e.repos === true && requiresRepoFilter(id), `${id} requires a repos allow-list`);
  ok(JSON.stringify(e.filters) === JSON.stringify(["repos"]), `${id} offers only the repos filter`);
  ok(e.issueBound === false && e.issueIdOnly === false, `${id} carries no Jira issue by construction`);
  ok(eventLabel(id) !== id && /\S/.test(eventLabel(id)), `eventLabel works for ${id}: "${eventLabel(id)}"`);
  ok(e.payloadHint.includes("event.repoId"), `${id} documents event.repoId`);
}
ok(eventSource("avi:jira:created:issue") === "jira" && !isGitEvent("avi:jira:created:issue"), "Jira rows default to source \"jira\"");
ok(!requiresRepoFilter("avi:jira:created:issue"), "Jira rows need no repos filter");
ok(filtersForEvents(["git:pull_request:opened"]).includes("repos"), "git events offer the repos filter");
ok(!filtersForEvents(["git:pull_request:opened"]).includes("projects"), "git events do not offer the project filter");

// git context extraction
const gitEv = {
  eventType: "git:pull_request:opened", source: "git", connectionId: "gc_1", repoId: "LeanZero/CogniRunner",
  deliveryId: "d-1", actor: { login: "Octocat" },
  pullRequest: { number: 42, title: "t", headSha: "abc", headRef: "feat/x", baseRef: "main" },
  issueKeys: ["LZPT-9"],
};
const gc = extractEventContext("git:pull_request:opened", gitEv);
ok(gc.repoId === "leanzero/cognirunner", "repo id normalised to lower case");
ok(gc.connectionId === "gc_1" && gc.actorLogin === "Octocat" && gc.prNumber === "42" && gc.deliveryId === "d-1", "git identity extracted");
ok(gc.actorAccountId === null, "a git login is NOT reported as an Atlassian accountId");
ok(gc.issueKey === "LZPT-9" && gc.projectKey === null, "advisory issue key kept; no project is inferred");
ok(gc.entityName === "leanzero/cognirunner PR #42", `git entity name: "${gc.entityName}"`);
ok(extractEventContext("git:push", { source: "git", repoId: "o/r" }).entityName === "o/r", "push without a PR still names the repo");
const gitTrim = trimEventPayload({ ...gitEv, diff: "x".repeat(90000) }, 60000);
ok(gitTrim.repoId === "LeanZero/CogniRunner" && gitTrim.pullRequest.number === 42 && !gitTrim.diff, "git payload trim keeps identity, drops the diff");
ok(buildEventPromptBlock(["git:pull_request:opened"]).includes("event.pullRequest"), "git prompt block carries payload hints");
const cats = new Set(EVENT_CATEGORIES.map((c) => c.id));
for (const e of JIRA_EVENTS) {
  ok(cats.has(e.category), `${e.id} has a known category`);
  ok(e.label && e.description, `${e.id} has label + description`);
  // Git delivery costs no Jira scope — an empty array is the honest answer there,
  // and only there.
  ok(Array.isArray(e.scopes) && (e.source === "git" ? e.scopes.length === 0 : e.scopes.length > 0), `${e.id} declares scopes`);
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

// F-327 — the trimmer asks the CATALOGUE, not the payload. An envelope that omits
// `source` must still be trimmed as git: otherwise the diff, the file list and the
// patch survive, which is the one thing trimEventPayload exists to prevent.
{
  const big = "x".repeat(70000);
  const env = { eventType: "git:pull_request:opened", repoId: "o/r", connectionId: "c1", pullRequest: { number: 1, title: "t", headSha: "a" }, diff: big, files: [big], patch: big };
  const out = trimEventPayload(env, 60000);
  ok(out.diff === undefined && out.files === undefined && out.patch === undefined, "a git envelope with NO source field is still trimmed as git (F-327)");
  ok(out.eventType === "git:pull_request:opened" && (out.pullRequest || {}).number === 1, "…keeping the identity the consumer needs");
  ok(JSON.stringify(out).length <= 60000, "…and landing inside the transport budget");
}

console.log(`JIRA-EVENTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
