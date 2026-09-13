/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// The agent-action catalogue and THE ONE GATE (src/shared/agent-actions.js).
// Covers: catalogue integrity, the 13 Jira ids frozen by snapshot, the arity-1 vs
// arity-2 return shapes (GOTCHAS trap 3) and one BLOCK + one ALLOW per gating flag.
import assert from "node:assert/strict";
import {
  AGENT_ACTIONS, AGENT_ACTION_IDS, AGENT_ACTION_NAMESPACES, AGENT_ACTION_NAMESPACE_IDS,
  agentActionNamespace, normalizeAllowedActions, assertAllowedActions, toolDefinitionsFor, hasWriteActions, getAgentAction,
  buildAgentGateContext, agentActionRefusalText,
} from "../../src/shared/agent-actions.js";
const { normalizeListener } = await import("../../src/listeners.js");
const { normalizeJob } = await import("../../src/scheduled-jobs.js");

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
// NOTHING IS RESERVED ANY MORE (1.5 commits 4a + 4b). The flag stays in the shape so the
// next namespace can be declared before its executor exists; that it is false everywhere
// is asserted so a namespace cannot be quietly re-reserved with its actions still listed.
ok(Object.values(AGENT_ACTION_NAMESPACES).every((r) => r.reserved === false), "no namespace is reserved");
for (const ns of AGENT_ACTION_NAMESPACE_IDS) {
  ok(AGENT_ACTIONS.some((a) => agentActionNamespace(a) === ns), `namespace ${ns} has at least one action`);
}

/* ---------- 1.5 commit 4b — the CONFLUENCE namespace is filled ---------- */
const CONFLUENCE_SNAPSHOT = ["confluence_search", "confluence_get_page", "confluence_create_page", "confluence_update_page", "confluence_add_comment"];
eq(AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "confluence").map((a) => a.id), CONFLUENCE_SNAPSHOT,
  "the confluence namespace is the five planned actions");
ok(AGENT_ACTION_NAMESPACES.confluence.executor === "confluence-actions", "confluence names its executor module");
ok(AGENT_ACTION_NAMESPACES.confluence.requiresCapability === null,
  "confluence requires NO capability — the product is the gate, and the install probe is the run-time half");
for (const id of CONFLUENCE_SNAPSHOT) {
  const a = getAgentAction(id);
  ok(a.requiresProduct === "confluence", `${id} names the product it needs`);
  ok(a.dangerous === undefined, `${id} is not dangerous`);
  ok(!("cql" in a.parameters.properties), `${id} offers the model NO query language`);
}
// A SITE WITHOUT CONFLUENCE refuses every one of them, by name, at save time.
{
  const r = normalizeAllowedActions(CONFLUENCE_SNAPSHOT, { products: ["jira"], savedByRole: "admin" });
  eq(r.allowed, [], "confluence.BLOCK_missing_product");
  ok(r.refused.every((x) => x.reason === "missing-product:confluence"), "…and the reason names the product");
  ok(/does not have confluence/.test(agentActionRefusalText("missing-product:confluence")), "…in a sentence an admin can act on");
}
// ALL THREE writes need an admin-saved rule on a headless surface (F-472): the comment is
// outward speech under the org's name, not a lesser write than the page edits.
{
  const r = normalizeAllowedActions(CONFLUENCE_SNAPSHOT, { products: ["jira", "confluence"], savedByRole: null });
  eq(r.allowed, ["confluence_search", "confluence_get_page"], "confluence.BLOCK_all_writes_without_admin");
  eq(r.refused.map((x) => x.id), ["confluence_create_page", "confluence_update_page", "confluence_add_comment"],
    "…and it is exactly the three writes, the comment included (F-472)");
  ok(r.refused.every((x) => x.reason === "needs-admin"), "…refused for wanting an admin-saved rule");
  const all = normalizeAllowedActions(CONFLUENCE_SNAPSHOT, { products: ["jira", "confluence"], savedByRole: "admin" });
  eq(all.allowed, CONFLUENCE_SNAPSHOT, "confluence.ALLOW_admin_saved_with_the_product");
}
// The three writes are writes: the dispatcher's cross-namespace write ledger counts them.
// …on an ADMIN-saved rule, which since F-472 is the only rule that may hold any of them.
ok(hasWriteActions(["confluence_add_comment"], { products: ["jira", "confluence"], savedByRole: "admin" }),
  "confluence writes count as writes");
ok(!hasWriteActions(["confluence_add_comment"], { products: ["jira", "confluence"] }),
  "…and a non-admin-saved rule holds no confluence write at all to count (F-472)");
ok(!hasWriteActions(["confluence_search", "confluence_get_page"], { products: ["jira", "confluence"] }), "confluence reads do not");

/* ---------- 1.5 commit 4a — the LEDGER namespace is filled ---------- */
// The five speech/state actions lived as `VA_SPEECH_ACTIONS` inside src/virtual-admin.js
// while the namespace was reserved, which meant the gate, the admin checklist and the
// REST validator could not see them at all. They are catalogue rows now.
ok(AGENT_ACTION_NAMESPACES.ledger.reserved === false, "ledger is no longer reserved");
ok(AGENT_ACTION_NAMESPACES.ledger.executor === "va-ledger-actions",
  "ledger names the EXECUTOR module, not the ledger store (va-ledger.js is the store)");
const LEDGER_SNAPSHOT = ["stage_reply", "ask_human", "propose_change", "ledger_note", "memory_note"];
eq(AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "ledger").map((a) => a.id), LEDGER_SNAPSHOT,
  "the ledger namespace holds exactly the five speech/state actions");
// SPEECH IS NEVER DIRECT — the guarantee is the ABSENCE of a tool, asserted by name.
ok(!AGENT_ACTION_IDS.includes("post_comment"), "ledger.BLOCK_no_direct_speech_action_exists");
ok(!AGENT_ACTIONS.some((a) => agentActionNamespace(a) === "ledger" && /scheme|workflow|permission|role|field/i.test(a.id)),
  "ledger.BLOCK_no_configuration_write — propose_change is the ONLY route, not the approved one");
for (const id of LEDGER_SNAPSHOT) {
  const a = getAgentAction(id);
  // `kind` answers "does this change anything OUTSIDE CogniRunner?". Every ledger action
  // answers no — a staged reply is a row, and the post phase (not an action) is what
  // speaks. Calling them writes would spend maxWritesPerRun on drafts.
  ok(a.kind === "read", `${id} is kind "read" — it changes nothing outside CogniRunner`);
  ok(a.confirm === undefined && a.dangerous === undefined, `${id} carries neither confirm nor dangerous`);
  ok(a.requiresCapability === null, `${id} requires no capability`);
  ok(a.parameters && a.parameters.type === "object" && a.parameters.additionalProperties === false,
    `${id} has a closed object schema`);
  ok(Array.isArray(a.parameters.required) && a.parameters.required.every((r) => r in a.parameters.properties),
    `${id}'s required list names only declared properties`);
  ok(Object.values(a.parameters.properties).every((sch) => sch && typeof sch.type === "string"),
    `${id}'s every argument declares a type — buildArgsPreview-style derivation needs it`);
}
// ARG SCHEMAS, by name: a rename here silently changes what the executor reads.
eq(Object.keys(getAgentAction("stage_reply").parameters.properties), ["audience", "body", "reason"], "stage_reply's arguments");
eq(getAgentAction("stage_reply").parameters.properties.audience.enum, ["customer", "internal"], "stage_reply's audience is a closed set");
eq(Object.keys(getAgentAction("ask_human").parameters.properties), ["summary", "needs"], "ask_human's arguments");
eq(Object.keys(getAgentAction("propose_change").parameters.properties), ["kind", "target", "blastRadius", "steps"], "propose_change's arguments");
eq(Object.keys(getAgentAction("ledger_note").parameters.properties), ["note"], "ledger_note's arguments");
eq(Object.keys(getAgentAction("memory_note").parameters.properties), ["note", "constraint"], "memory_note's arguments");

// FINISH: declared in `ledger`, but CONTROL WINS at dispatch. If the declared namespace
// ever won, every listener and scheduled-job run — which carry no ledger executor —
// would get `not_configured` for the one tool the loop needs to end cleanly.
ok(getAgentAction("finish").namespace === "ledger", "finish declares the ledger namespace");
eq(agentActionNamespace(getAgentAction("finish")), "control", "finish.ALLOW_control_wins_over_declared_namespace");
ok(getAgentAction("finish").always === true, "finish is still always available");
// The ledger actions must not have leaked into the gate's write vocabulary.
ok(!hasWriteActions(LEDGER_SNAPSHOT, { products: ["jira"] }), "ledger.BLOCK_not_counted_as_writes");
// They survive the MOST RESTRICTIVE context: no capability, no product but Jira,
// external trigger, not admin-saved. A VA's notebook must not need an edition.
eq(normalizeAllowedActions(LEDGER_SNAPSHOT), LEDGER_SNAPSHOT, "ledger.ALLOW_under_the_restrictive_default");
{
  const r = normalizeAllowedActions(LEDGER_SNAPSHOT, { triggerSource: "external", savedByRole: null, products: ["jira"] });
  eq(r.refused, [], "ledger.ALLOW_external_non_admin — none of them is confirm or dangerous");
}
// The executor module the namespace table names actually exists and exports the ids.
{
  const { VA_LEDGER_ACTION_IDS } = await import("../../src/va-ledger-actions.js");
  eq([...VA_LEDGER_ACTION_IDS], LEDGER_SNAPSHOT, "the executor handles exactly the catalogue's ledger ids");
}
// AND THE OLD HOME IS GONE. A second copy of these definitions is the defect this move
// exists to remove, so its absence is asserted rather than assumed.
{
  const { readFileSync } = await import("node:fs");
  const vsrc = readFileSync(new URL("../../src/virtual-admin.js", import.meta.url), "utf8");
  ok(!/VA_SPEECH_ACTIONS\s*=/.test(vsrc), "ledger.BLOCK_second_definition — VA_SPEECH_ACTIONS is deleted, not duplicated");
  ok(/executors: \{ ledger: ledgerExecutor \}/.test(vsrc) || /ledger: ledgerExecutor/.test(vsrc),
    "the item turn reaches the ledger actions through the dispatcher's namespace delegation");
}
// 1.4 commit 13a — `web` left the reserved set with exactly ONE action.
ok(AGENT_ACTION_NAMESPACES.web.reserved === false, "web is no longer reserved");
eq(AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "web").map((a) => a.id), ["web_search"], "web holds exactly one action");
// Web is gated by the MCP TOGGLE, not by a Coder capability. A requiresCapability here
// would make the gate refuse web_search on every BYOK tenant that never answered for it
// (absent map key = refused, F-281), which is the opposite of the product intent.
ok(AGENT_ACTION_NAMESPACES.web.requiresCapability === null, "web requires NO capability");
ok(AGENT_ACTION_NAMESPACES.web.requiresMcp === "webSearch", "web names its MCP toggle instead");
ok(getAgentAction("web_search").kind === "read", "web_search is a read action");
for (const flag of ["confirm", "dangerous"]) ok(getAgentAction("web_search")[flag] === undefined, `web_search is not ${flag}`);

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
eq(normalizeAllowedActions(["commit_files"], { capability: { git: true }, savedByRole: "admin" }).allowed, ["commit_files"], "ALLOW: a per-capability MAP that names git");
// F-281 — a map that does NOT name the capability is UNANSWERED, and unanswered is refused.
eq(normalizeAllowedActions(["commit_files"], { capability: { confluence: true }, savedByRole: "admin" }).refused,
  [{ id: "commit_files", reason: "capability-off:git" }], "BLOCK: a map without the git key fails CLOSED");
eq(normalizeAllowedActions(["commit_files"], { capability: { git: false }, savedByRole: "admin" }).refused,
  [{ id: "commit_files", reason: "capability-off:git" }], "BLOCK: a map that says git:false");
eq(normalizeAllowedActions(["commit_files"], { capability: { enabled: true, reason: "byok" }, savedByRole: "admin" }).allowed,
  ["commit_files"], "ALLOW: agentCapability()'s own single verdict still applies to any capability");
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
// ORDER IS THE CATALOGUE'S, and 1.5 commit 4a moved `finish` out of the Jira block into
// the ledger one, so it is now LAST rather than first. Nothing reads tool order — every
// provider matches by name — so the assertion is about the SET, plus `finish` being in it.
eq(tools.map((t) => t.function.name).sort(), ["commit_files", "finish"], "a dangerous tool never reaches the model on an external run");
ok(tools.every((t) => t.function.parameters && t.function.parameters.type === "object"), "every tool definition carries its schema");

/* ---------- F-275: a pregated list is NOT re-gated ---------- */
const verdict = normalizeAllowedActions(["commit_files", "get_issue"], CAP_ON).allowed;
eq(verdict, ["commit_files", "get_issue"], "the gate allowed both");
eq(toolDefinitionsFor(verdict, { pregated: true }).map((t) => t.function.name), ["get_issue", "commit_files", "finish"],
  "pregated tool definitions keep the gate's verdict verbatim (finish is last since 4a moved it to the ledger block)");
eq(toolDefinitionsFor(verdict).map((t) => t.function.name), ["get_issue", "finish"],
  "…and WITHOUT pregated the arity-1 default would have dropped the git tool — this is the F-275 trap");
eq(toolDefinitionsFor(["zzz", "finish"], { pregated: true }).map((t) => t.function.name), ["finish"],
  "pregated still drops unknown and control ids");

/* ---------- F-277: save time refuses LOUDLY ---------- */
eq(assertAllowedActions(["get_issue", "zzz", "get_issue"]), ["get_issue"], "unknown and duplicate ids are still dropped quietly");
assert.throws(() => assertAllowedActions(["commit_files"]), (e) => {
  ok(e.reason === "action-not-allowed", "the save-time refusal carries reason:action-not-allowed");
  eq(e.refused, [{ id: "commit_files", reason: "capability-off:git" }], "…and the refused list");
  ok(/commit_files/.test(e.message), "…and names the action in the message");
  return true;
}, "a capability-off action is REFUSED at save time, not stripped");
n++;
for (const [what, normalize] of [["listener", normalizeListener], ["job", normalizeJob]]) {
  const base = what === "listener"
    ? { name: "n", events: ["avi:jira:created:issue"], mode: "agent" }
    : { name: "n", schedule: { cron: "*/5 * * * *" }, mode: "agent" };
  const good = normalize({ ...base, agent: { instructions: "do it", allowedActions: ["get_issue", "add_comment"] } });
  eq(good.agent.allowedActions, ["get_issue", "add_comment"], `a ${what} saves the Jira actions it was given`);
  assert.throws(() => normalize({ ...base, agent: { instructions: "do it", allowedActions: ["get_issue", "commit_files"] } }),
    (e) => e.reason === "action-not-allowed" && e.refused.length === 1, `saving a ${what} with a gated action is REFUSED, never silently reduced`);
  n += 2;
  const gated = normalize({ ...base, agent: { instructions: "do it", allowedActions: ["commit_files"] } }, { gate: { capability: true, savedByRole: "admin" } });
  eq(gated.agent.allowedActions, ["commit_files"], `a ${what} saved with the right context keeps the git action`);
}

/* ---------- F-302: the gate CONTEXT has one home, and the refusal names the cause ---------- */
// BYOK: any provider that is not Atlassian enables the git capability.
const byok = buildAgentGateContext({ provider: "openai", savedByRole: "admin" });
eq(normalizeAllowedActions(["commit_files"], byok).allowed, ["commit_files"], "BYOK + an admin save keeps a git write");
// Forge LLM needs the Coder edition AND a frontier model AND allowance.
const forge = (over) => buildAgentGateContext({ provider: "atlassian", edition: "advanced", agentModel: "not-frontier", savedByRole: "admin", ...over });
eq(normalizeAllowedActions(["commit_files"], forge({})).refused, [{ id: "commit_files", reason: "needs-frontier-model" }], "Forge LLM on a non-frontier model refuses with the REAL cause");
eq(normalizeAllowedActions(["commit_files"], buildAgentGateContext({ provider: "atlassian", edition: "standard", savedByRole: "admin" })).refused,
  [{ id: "commit_files", reason: "needs-coder-edition" }], "…and a non-Coder edition says so, not 'capability-off'");
// THE DEFAULT IS RESTRICTIVE — a context built with no provider must not enable git,
// even though agentCapability() answers "byok" for a null provider.
eq(normalizeAllowedActions(["commit_files"], buildAgentGateContext({ savedByRole: "admin" })).refused,
  [{ id: "commit_files", reason: "capability-off:git" }], "a context built WITHOUT a provider refuses git (an unanswered question is refused)");
ok(buildAgentGateContext({ provider: "openai" }).capability.web === undefined, "the capability is a MAP: a namespace nobody answered for stays unanswered");
eq(normalizeAllowedActions(["approve_pull_request"], buildAgentGateContext({ provider: "openai", savedByRole: "admin", triggerSource: "external" })).refused,
  [{ id: "approve_pull_request", reason: "external-trigger" }], "an externally triggered run never holds a dangerous action, even admin-saved");
eq(normalizeAllowedActions(["add_pr_comment"], buildAgentGateContext({ provider: "openai" })).refused,
  [{ id: "add_pr_comment", reason: "needs-admin" }], "a confirm action needs an admin-saved rule");
// The refusal SENTENCE names something an admin can act on.
for (const [code, must] of [["capability-off:git", /Coder edition/], ["needs-coder-edition", /Coder edition/], ["needs-frontier-model", /frontier/], ["allowance-exhausted", /allowance/], ["external-trigger", /externally triggered/], ["needs-admin", /ADMIN/]]) {
  ok(must.test(agentActionRefusalText(code)), `the refusal text for ${code} names the cause`);
}
assert.throws(() => assertAllowedActions(["commit_files"], {}), (e) => {
  ok(/Coder edition/.test(e.message), "the SAVE-time message names the real cause, not the code");
  eq(e.refused, [{ id: "commit_files", reason: "capability-off:git" }], "…while the machine-readable code still rides on refused[]");
  return true;
}, "save time still refuses");
n++;

// The RUN sites accept a caller-supplied context and default to the restrictive one.
{
  const { readFileSync } = await import("node:fs");
  const lsrc = readFileSync(new URL("../../src/listeners.js", import.meta.url), "utf8");
  const jsrc = readFileSync(new URL("../../src/scheduled-jobs.js", import.meta.url), "utf8");
  ok(/gateFacts = null, executors = \{\}/.test(lsrc) && /gateFacts = null, executors = \{\}/.test(jsrc),
    "both run sites take gateFacts + executors, defaulting to the restrictive context");
  // F-448 — assert the PROPERTIES the gate context carries, not their position in the
  // call literal. A key added after `savedByRole` must not fail a test about what is
  // passed, and a wrong value in the right slot must still fail.
  const gateArgs = (src) => (src.match(/buildAgentGateContext\(\{([^}]*)\}\)/) || [, null])[1];
  const lArgs = gateArgs(lsrc), jArgs = gateArgs(jsrc);
  ok(lArgs !== null && jArgs !== null, "both run sites build a gate context from an object literal");
  ok(/gateFacts\s*\?\s*buildAgentGateContext\([\s\S]*?\)\s*:\s*undefined/.test(lsrc),
    "a LISTENER builds a context only when it was given gate facts (no facts → undefined)");
  ok(!!lArgs && /\.\.\.gateFacts\b/.test(lArgs) && /\btriggerSource:\s*"external"/.test(lArgs)
    && /\bsavedByRole:\s*listener\.savedByRole\b/.test(lArgs),
    "a LISTENER run is external and reads savedByRole from the rule row");
  ok(!!jArgs && /\.\.\.gateFacts\b/.test(jArgs) && /\btriggerSource:\s*null\b/.test(jArgs)
    && /\bsavedByRole:\s*job\.savedByRole\b/.test(jArgs),
    "a SCHEDULED JOB is not external (the app's own clock started it)");
  ok(/gate: agentGate, executors/.test(lsrc) && /gate: agentGate, executors/.test(jsrc), "…and both hand the context to runAgentTask");
  // F-302 seam — a TEST run must gate exactly like the live delivery, or "Test with an
  // issue" reports a rule that cannot do what the real run will do.
  ok(/export const testListener = async \(\{[\s\S]*?gateFacts = null, executors = \{\}/.test(lsrc), "testListener takes the same gate seam");
  ok(/source: "test", gateFacts, executors/.test(lsrc), "…and threads it into runListener");
}

console.log(`agent-actions gate: ${n} assertions passed`);
