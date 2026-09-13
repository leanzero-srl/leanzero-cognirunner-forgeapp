/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// The agent-action catalogue and THE ONE GATE (src/shared/agent-actions.js).
// Covers: catalogue integrity, the 13 Jira ids frozen by snapshot, the arity-1 vs
// arity-2 return shapes (GOTCHAS trap 3) and one BLOCK + one ALLOW per gating flag.
import assert from "node:assert/strict";
import {
  AGENT_ACTIONS, AGENT_ACTION_IDS, AGENT_ACTION_NAMESPACES, AGENT_ACTION_NAMESPACE_IDS,
  agentActionNamespace, normalizeAllowedActions, toolDefinitionsFor, hasWriteActions, getAgentAction,
} from "../../src/shared/agent-actions.js";

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg + " — got " + JSON.stringify(a)); n++; };

/* ---------- catalogue ---------- */
ok(new Set(AGENT_ACTION_IDS).size === AGENT_ACTION_IDS.length, "action ids are unique");
for (const a of AGENT_ACTIONS) {
  ok(typeof a.label === "string" && a.label, `${a.id} has a label`);
  ok(["read", "write", "control"].includes(a.kind), `${a.id} has a valid kind`);
  ok(a.parameters && a.parameters.type === "object", `${a.id} has an object schema`);
  ok(AGENT_ACTION_NAMESPACE_IDS.includes(agentActionNamespace(a)) || a.kind === "control", `${a.id} is in a known namespace`);
  for (const flag of ["confirm", "dangerous"]) ok(a[flag] === undefined || a[flag] === true, `${a.id}.${flag} is true or absent`);
}
for (const ns of ["jira", "git", "confluence", "web", "ledger"]) {
  const row = AGENT_ACTION_NAMESPACES[ns];
  ok(row && typeof row.label === "string", `namespace ${ns} exists`);
  ok("requiresCapability" in row && "requiresProduct" in row, `namespace ${ns} declares its flags`);
}
for (const ns of ["confluence", "web", "ledger"]) {
  ok(AGENT_ACTION_NAMESPACES[ns].reserved === true, `${ns} is reserved`);
  eq(AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === ns).map((a) => a.id), [], `${ns} is still empty`);
}

// SNAPSHOT: the 13 Jira actions + finish. 1.4 must not renumber, rename or reorder them —
// a saved rule stores these ids and the REST API validates against them.
const JIRA_SNAPSHOT = ["get_issue", "search_issues", "add_comment", "update_fields", "add_labels", "remove_labels",
  "set_assignee", "transition_issue", "create_issue", "link_issues", "add_watcher", "send_notification", "add_worklog"];
eq(AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "jira").map((a) => a.id), JIRA_SNAPSHOT, "the 13 Jira actions are unchanged");
eq(AGENT_ACTIONS.filter((a) => a.kind === "control").map((a) => a.id), ["finish"], "finish is the only control action");
for (const id of JIRA_SNAPSHOT) {
  const a = getAgentAction(id);
  ok(!a.requiresCapability && !a.confirm && !a.dangerous, `${id} carries no new flag`);
}

const GIT_SNAPSHOT = ["create_repo", "create_branch", "commit_files", "open_pull_request", "get_pull_request",
  "add_pr_comment", "approve_pull_request", "request_changes", "get_build_state", "trigger_deploy", "get_deploy_status"];
eq(AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "git").map((a) => a.id), GIT_SNAPSHOT, "the git namespace is the 11 planned actions");
for (const id of GIT_SNAPSHOT) ok(getAgentAction(id).requiresCapability === "git", `${id} requires the git capability`);
for (const id of ["create_repo", "create_branch", "commit_files", "open_pull_request", "add_pr_comment"]) {
  ok(getAgentAction(id).confirm === true && !getAgentAction(id).dangerous, `${id} is a confirm write, not dangerous`);
}
for (const id of ["approve_pull_request", "request_changes", "trigger_deploy"]) ok(getAgentAction(id).dangerous === true, `${id} is dangerous`);
for (const id of ["get_pull_request", "get_build_state", "get_deploy_status"]) {
  ok(getAgentAction(id).kind === "read" && !getAgentAction(id).confirm, `${id} is a read and needs no confirmation`);
}

/* ---------- arity (GOTCHAS trap 3) ---------- */
const arity1 = normalizeAllowedActions(["finish", "get_issue", "get_issue", "zzz"]);
ok(Array.isArray(arity1), "arity-1 still returns an ARRAY");
eq(arity1, ["get_issue"], "arity-1 keeps today's behaviour (finish implicit, dupes/unknown dropped)");
const arity2 = normalizeAllowedActions(["get_issue"], {});
ok(!Array.isArray(arity2) && Array.isArray(arity2.allowed) && Array.isArray(arity2.refused), "arity-2 returns { allowed, refused }");
eq(arity2.allowed, ["get_issue"], "arity-2 allows a plain Jira action with an empty context");
// The no-context call defaults to the MOST RESTRICTIVE context, never the most permissive.
eq(normalizeAllowedActions(["get_issue", "commit_files"]), ["get_issue"], "arity-1 drops a capability-gated action");
eq(toolDefinitionsFor(["get_issue", "commit_files"]).map((t) => t.function.name), ["get_issue", "finish"], "toolDefinitionsFor never emits a gated tool");
ok(hasWriteActions(["get_issue", "commit_files"]) === false, "hasWriteActions sees only what the gate allowed");
ok(hasWriteActions(["get_issue", "add_comment"]) === true, "hasWriteActions still detects a Jira write");

/* ---------- capability ---------- */
const CAP_ON = { capability: { enabled: true, reason: "byok" }, savedByRole: "admin" };
eq(normalizeAllowedActions(["commit_files"], CAP_ON).allowed, ["commit_files"], "ALLOW: capability on + admin keeps a git write");
const off = normalizeAllowedActions(["commit_files"], { capability: { enabled: false, reason: "needs-coder-edition" }, savedByRole: "admin" });
eq(off.allowed, [], "BLOCK: capability off drops the git action");
eq(off.refused, [{ id: "commit_files", reason: "needs-coder-edition" }], "the refusal carries the capability's own reason");
eq(normalizeAllowedActions(["commit_files"], { savedByRole: "admin" }).refused, [{ id: "commit_files", reason: "capability-off:git" }], "BLOCK: no capability at all");
eq(normalizeAllowedActions(["commit_files"], { capability: true, savedByRole: "admin" }).allowed, ["commit_files"], "ALLOW: capability may be a plain true");
eq(normalizeAllowedActions(["commit_files"], { capability: { git: true }, savedByRole: "admin" }).allowed, ["commit_files"], "ALLOW: capability may be a per-capability map");
eq(normalizeAllowedActions(["get_issue"], { capability: false }).allowed, ["get_issue"], "a Jira action needs no capability");

/* ---------- product ---------- */
eq(normalizeAllowedActions(["get_issue"], { products: ["jira"] }).allowed, ["get_issue"], "ALLOW: Jira present");
eq(normalizeAllowedActions(["get_issue"], { products: ["confluence"] }).refused, [{ id: "get_issue", reason: "missing-product:jira" }], "BLOCK: Jira absent");
ok(AGENT_ACTION_NAMESPACES.confluence.requiresProduct === "confluence", "the reserved confluence namespace already declares its product");

/* ---------- triggerSource: an external run never holds a dangerous action ---------- */
const ext = normalizeAllowedActions(["approve_pull_request", "commit_files", "get_pull_request"], { ...CAP_ON, triggerSource: "external" });
eq(ext.allowed, ["commit_files", "get_pull_request"], "BLOCK: external trigger drops dangerous, keeps the rest");
eq(ext.refused, [{ id: "approve_pull_request", reason: "external-trigger" }], "the drop names the trigger");
eq(normalizeAllowedActions(["approve_pull_request"], { ...CAP_ON, triggerSource: "manual" }).allowed, ["approve_pull_request"], "ALLOW: a manual run may hold it");
eq(normalizeAllowedActions(["approve_pull_request"], CAP_ON).allowed, ["approve_pull_request"], "ALLOW: no triggerSource is not 'external'");

/* ---------- savedByRole: a headless confirm action needs an admin-saved rule ---------- */
const nonAdmin = normalizeAllowedActions(["commit_files", "get_pull_request"], { capability: true, savedByRole: "editor" });
eq(nonAdmin.allowed, ["get_pull_request"], "BLOCK: an editor-saved rule keeps only the read");
eq(nonAdmin.refused, [{ id: "commit_files", reason: "needs-admin" }], "the refusal says it needs an admin");
eq(normalizeAllowedActions(["commit_files"], { capability: true }).refused, [{ id: "commit_files", reason: "needs-admin" }], "an omitted role is NOT admin");
eq(normalizeAllowedActions(["commit_files"], { capability: true, savedByRole: "admin" }).allowed, ["commit_files"], "ALLOW: admin-saved");

/* ---------- order of refusal: capability first, then product, then dangerous, then confirm ---------- */
eq(normalizeAllowedActions(["approve_pull_request"], { capability: false, triggerSource: "external" }).refused[0].reason, "capability-off:git", "capability is answered before the trigger");

/* ---------- tool definitions with a context ---------- */
const tools = toolDefinitionsFor(["commit_files", "approve_pull_request"], { ...CAP_ON, triggerSource: "external" });
eq(tools.map((t) => t.function.name), ["finish", "commit_files"], "a dangerous tool never reaches the model on an external run");
ok(tools.every((t) => t.function.parameters && t.function.parameters.type === "object"), "every tool definition carries its schema");

console.log(`agent-actions gate: ${n} assertions passed`);
