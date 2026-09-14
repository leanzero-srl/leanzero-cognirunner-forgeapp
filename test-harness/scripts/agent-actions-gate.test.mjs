/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// The agent-action catalogue and THE ONE GATE (src/shared/agent-actions.js).
// Covers: catalogue integrity, the 13 Jira ids frozen by snapshot, the arity-1 vs
// arity-2 return shapes (GOTCHAS trap 3) and one BLOCK + one ALLOW per gating flag.
import assert from "node:assert/strict";
import { maskComments } from "../lib/js-source-scan.mjs";
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
/* ═════ F-865 — THE LEDGER NAMESPACE IS BOUND TO THE VA SURFACE ═════
 *
 * The five ledger ids carried no capability, no product, no `confirm` and no `dangerous`,
 * so every arm of the gate passed them and a LISTENER or a SCHEDULED JOB could SAVE
 * `stage_reply`. `toolDefinitionsFor` then offered the tool to a model on a headless rule
 * that has no ledger and can never speak; F-852's refusal-by-name (src/agent-executors.js)
 * caught it only after a whole round had been spent finding out. `requiresSurface: "va"`
 * on the namespace moves the no to the save, where it can be read by a human.
 *
 * ON THE VA SURFACE NOTHING CHANGES: no capability, no product beyond Jira, an external
 * trigger and a non-admin saver all still keep them. A VA's own notebook must not need an
 * edition, and the flag added here must not become a second capability by accident.
 */
ok(AGENT_ACTION_NAMESPACES.ledger.requiresSurface === "va", "ledger.requiresSurface is the flag, and it is on the NAMESPACE");
ok(LEDGER_SNAPSHOT.every((id) => getAgentAction(id).requiresSurface === undefined),
  "…and on the namespace ONLY — five per-action copies of one rule is how the sixth action forgets it");
eq(normalizeAllowedActions(LEDGER_SNAPSHOT, { surface: "va" }).allowed, LEDGER_SNAPSHOT,
  "ledger.ALLOW_on_the_va_surface_under_the_otherwise_restrictive_context");
{
  const r = normalizeAllowedActions(LEDGER_SNAPSHOT, { surface: "va", triggerSource: "external", savedByRole: null, products: ["jira"] });
  eq(r.refused, [], "ledger.ALLOW_external_non_admin — none of them is confirm or dangerous");
}
// BLOCK — every surface that is not a VA, and the UNNAMED surface too: a caller that did
// not say where the rule lives gets the restrictive answer, not a free pass.
for (const surface of ["listener", "job", "coder", "", null, undefined]) {
  const r = normalizeAllowedActions(LEDGER_SNAPSHOT, { surface, savedByRole: "admin", products: ["jira"] });
  eq(r.allowed, [], `ledger.BLOCK_on_surface_${String(surface) || "(none)"}`);
  eq(r.refused.map((x) => x.reason), LEDGER_SNAPSHOT.map(() => "wrong-surface:va"),
    `ledger.BLOCK_reason_is_wrong-surface:va_on_${String(surface) || "(none)"}`);
}
eq(normalizeAllowedActions(LEDGER_SNAPSHOT), [], "ledger.BLOCK_under_the_arity-1_restrictive_default");
// An ADMIN save does not buy it either: this is not the `confirm` axis.
eq(normalizeAllowedActions(["stage_reply"], { surface: "listener", savedByRole: "admin", capability: true }).refused,
  [{ id: "stage_reply", reason: "wrong-surface:va" }], "ledger.BLOCK_admin_does_not_unlock_a_surface");
// The refusal SENTENCE names the cause, in the ONE vocabulary the gate already speaks.
ok(/Virtual Administrator/.test(agentActionRefusalText("wrong-surface:va")),
  "the wrong-surface refusal names the Virtual Administrator, not the code");
ok(agentActionRefusalText("wrong-surface:va") !== "wrong-surface:va", "…and is not the raw code");
// `finish` is untouched: control wins before any namespace flag is read, so the one tool
// the loop needs to end cleanly is still offered on a listener and on a job.
for (const surface of ["listener", "job"]) {
  eq(toolDefinitionsFor(["get_issue"], { surface }).map((t) => t.function.name), ["get_issue", "finish"],
    `finish.ALLOW_still_offered_on_a_${surface}_run`);
}
// RUN TIME: an ALREADY-SAVED row that somehow holds `ask_human` stops being offered it.
eq(toolDefinitionsFor(["get_issue", "ask_human", "stage_reply"], { surface: "listener" }).map((t) => t.function.name),
  ["get_issue", "finish"], "ledger.BLOCK_a_saved_listener_row_is_offered_no_ledger_tool");
eq(toolDefinitionsFor(["get_issue", "ask_human"], { surface: "va" }).map((t) => t.function.name),
  ["get_issue", "ask_human", "finish"], "ledger.ALLOW_the_va_surface_still_gets_the_tool");
// `pregated: true` is the VA's own door (src/virtual-admin.js: THE POWERS ARE THE GATE)
// and must keep bypassing this, exactly as it bypasses `confirm`.
eq(toolDefinitionsFor(LEDGER_SNAPSHOT, { pregated: true }).map((t) => t.function.name), [...LEDGER_SNAPSHOT, "finish"],
  "ledger.ALLOW_pregated — the VA's powers are the gate and this one does not re-decide them");
// SAVE TIME throws LOUDLY, in the same shape the REST layer and the admin UI render.
assert.throws(() => assertAllowedActions(["get_issue", "stage_reply"], { surface: "listener" }), (e) => {
  ok(e.reason === "action-not-allowed", "ledger.BLOCK_save_throws_the_one_refusal_reason");
  eq(e.refused, [{ id: "stage_reply", reason: "wrong-surface:va" }], "…naming the id that was refused");
  ok(/stage_reply/.test(e.message) && /Virtual Administrator/.test(e.message), "…and the message names both the id and the cause");
  return true;
});
eq(assertAllowedActions(["get_issue", "stage_reply"], { surface: "va" }), ["get_issue", "stage_reply"],
  "ledger.ALLOW_save_on_the_va_surface");
// The executor module the namespace table names actually exists and exports the ids.
{
  const { VA_LEDGER_ACTION_IDS } = await import("../../src/va-ledger-actions.js");
  eq([...VA_LEDGER_ACTION_IDS], LEDGER_SNAPSHOT, "the executor handles exactly the catalogue's ledger ids");
}
// AND THE OLD HOME IS GONE. A second copy of these definitions is the defect this move
// exists to remove, so its absence is asserted rather than assumed.
{
  const { readFileSync } = await import("node:fs");
  const vsrc = maskComments(readFileSync(new URL("../../src/virtual-admin.js", import.meta.url), "utf8"));
  // F-805 — read CODE, not prose. `VA_SPEECH_ACTIONS = …` is exactly what a comment
  // recording WHERE the catalogue moved to would write, and this ban would then fire on
  // the sentence documenting it. maskComments blanks comments and keeps string literals,
  // so the shape-matching assertions below still see the code they are about.
  ok(!/VA_SPEECH_ACTIONS\s*=/.test(vsrc), "ledger.BLOCK_second_definition — VA_SPEECH_ACTIONS is deleted, not duplicated");
  ok(!/VA_SPEECH_ACTIONS\s*=/.test(maskComments("// moved: VA_SPEECH_ACTIONS = [...] now lives in agent-actions.js\nconst x = 1;\n"))
    && /VA_SPEECH_ACTIONS\s*=/.test(maskComments("const VA_SPEECH_ACTIONS = [];\n")),
    "…and the ban reads code only: the same name in a COMMENT passes, in CODE fails");
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
  /* F-865 — THE SURFACE IS STAMPED BY THE NORMALIZER, not by its callers. A listener or
     an `agent`-mode job may not hold a ledger action, and the refusal arrives at the SAVE
     rather than a round into the run. This is driven through the real normalizer on
     purpose: a gate that refuses in isolation while the save door forgets to ask it is
     exactly the F-480 shape, one flag later. */
  assert.throws(() => normalize({ ...base, agent: { instructions: "do it", allowedActions: ["get_issue", "stage_reply"] } }),
    (e) => e.reason === "action-not-allowed"
      && e.refused.length === 1 && e.refused[0].id === "stage_reply" && e.refused[0].reason === "wrong-surface:va"
      && /Virtual Administrator/.test(e.message),
    `F-865: saving a ${what} holding stage_reply is REFUSED BY NAME`);
  n++;
  // Not even with the most permissive context the instance could produce.
  assert.throws(() => normalize({ ...base, agent: { instructions: "do it", allowedActions: ["ask_human"] } }),
    (e) => e.reason === "action-not-allowed" && e.refused[0].reason === "wrong-surface:va",
    `F-865: an admin-saved, fully capable ${what} still may not hold ask_human`);
  n++;
}
/* F-865 ALLOW — the VIRTUAL ADMINISTRATOR still holds them, through the SAME door.
   `mode: "va"` is the only difference between this save and the refused one above, and
   the surface is read from the row's own mode rather than from the caller, so nothing a
   REST client sends can move a listener onto the VA surface. */
{
  const vaRow = normalizeJob({
    name: "va", mode: "va", schedule: { cron: "*/5 * * * *" },
    agent: { instructions: "be useful", allowedActions: ["get_issue", "stage_reply", "ask_human", "propose_change", "ledger_note", "memory_note"] },
    va: { persona: { name: "Ada" }, scope: { read: { projects: ["ABC"] }, write: { projects: ["ABC"] } } },
  });
  eq(vaRow.mode, "va", "F-865 arrange: the row really is a VA");
  eq(vaRow.agent.allowedActions, ["get_issue", "stage_reply", "ask_human", "propose_change", "ledger_note", "memory_note"],
    "F-865: a VA save keeps every ledger action, with no capability, product or admin role supplied");
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
  const lsrc = maskComments(readFileSync(new URL("../../src/listeners.js", import.meta.url), "utf8"));
  const jsrc = maskComments(readFileSync(new URL("../../src/scheduled-jobs.js", import.meta.url), "utf8"));
  // F-852 — the executors DEFAULT is now `null`, not `{}`, and the difference is the
  // whole cut: `{}` was a map that said "this rule holds no git connection" through all
  // four doors, and `null` means "nobody supplied one, so assemble it from the rule".
  // `gateFacts` still defaults to null = the RESTRICTIVE context; a caller-supplied
  // value still wins on both.
  ok(/gateFacts = null, executors = null/.test(lsrc) && /gateFacts = null, executors = null/.test(jsrc),
    "both run sites take gateFacts + executors, gate facts defaulting to the restrictive context");
  ok(/executors \|\| await assembleAgentExecutors\(\{/.test(lsrc) && /executors \|\| null/.test(jsrc),
    "…and both prefer a caller-supplied map, assembling one only when none was passed");
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
  ok(/export const testListener = async \(\{[\s\S]*?gateFacts = null, executors = null/.test(lsrc), "testListener takes the same gate seam");
  ok(/source: "test", gateFacts, executors/.test(lsrc), "…and threads it into runListener");
}

/* ════ F-852 — ONE assembler, and no fourth private executor map ════
 *
 * Three modules were allowed to build a namespace executor before this cut, each for its
 * own surface, and the listener/job seam had none at all — which is how an admin-saved
 * git action reached the dispatcher and was told a connection it had never been asked
 * for was "not configured". The fix is a shared assembler, and the thing that keeps it
 * shared is this gate: the two FACTORIES may be CALLED only from the assembler, the
 * Coder engine and the Virtual Administrator (both of which build from records this
 * assembler cannot see), plus the modules that define them. A fourth caller is a fourth
 * answer to one question and fails here.
 */
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const { assembleAgentExecutors, ASSEMBLER_NAMESPACE_CONTRACT, ASSEMBLED_NAMESPACE_IDS, namespacesHeld, gitNoConnectionReason, LEDGER_NOT_ON_THIS_SURFACE } =
    await import("../../src/agent-executors.js");

  const FACTORIES = ["createGitActionExecutor", "createConfluenceActionExecutor"];
  // The DEFINING modules (they export the factory) and the three permitted CALLERS.
  const HOMES = new Set(["git-actions.js", "confluence-actions.js", "agent-executors.js", "coder-engine.js", "virtual-admin.js"]);
  const files = readdirSync(new URL("../../src/", import.meta.url)).filter((f) => f.endsWith(".js")).sort();
  ok(files.includes("agent-executors.js"), "the assembler module exists in src/");
  for (const f of files) {
    if (HOMES.has(f)) continue;
    // Comments may NAME a factory (several do, explaining why they do not call one);
    // code may not. The shared mask answers "which bytes are code".
    const src = maskComments(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8"));
    for (const fac of FACTORIES) ok(!src.includes(fac), `${f} does not build its own ${fac} — the assembler is the one home`);
  }

  // PARITY: every namespace in the catalogue is accounted for exactly once, and the set
  // this assembler can build is precisely what is left after the inline, runner-owned
  // and VA-only ones are removed. A new namespace therefore cannot land unnoticed.
  const { assembled, runner, va, inline, all } = ASSEMBLER_NAMESPACE_CONTRACT;
  eq([...assembled, ...runner, ...va, ...inline].sort(), [...all].sort(), "the four lists partition AGENT_ACTION_NAMESPACE_IDS");
  eq([...new Set([...assembled, ...runner, ...va, ...inline])].length, all.length, "…with no namespace named twice");
  eq(all.filter((ns) => !["jira", "control", "web", "ledger"].includes(ns)).sort(), [...ASSEMBLED_NAMESPACE_IDS].sort(),
    "the assembler builds exactly the namespaces that are not inline, runner-owned or VA-only");
  ok(!all.includes("refusals"), "`refusals` is not a namespace id — it may ride on the executor map");

  // The dispatcher PREFERS the assembler's named reason over its own generic sentence.
  const asrc = maskComments(readFileSync(new URL("../../src/agent-runner.js", import.meta.url), "utf8"));
  ok(/executors\.refusals\[ns\]/.test(asrc) && /code: "not_configured"/.test(asrc),
    "the dispatcher reads the assembler's named refusal reason on the not_configured branch");

  eq(namespacesHeld(["get_issue", "commit_files", "finish", "web_search", "confluence_search", "commit_files"]), ["git", "web", "confluence"],
    "namespacesHeld skips jira and control ids, keeps order and de-duplicates");

  // The refusal SENTENCES. Each names what the reader must do, and the count decides
  // whether that reader is connecting a provider or choosing between providers.
  ok(/has none/.test(gitNoConnectionReason(0)) && /Settings/.test(gitNoConnectionReason(0)), "0 connections: somebody must connect one");
  ok(/has one/.test(gitNoConnectionReason(1)) && /choose it/.test(gitNoConnectionReason(1)), "1 connection: somebody must choose it — never guessed");
  ok(/has 3/.test(gitNoConnectionReason(3)), "N>1 connections: the sentence says how many");
  ok(!/none is configured/.test(gitNoConnectionReason(2)), "…and never repeats the false generic sentence");
  ok(/Virtual Administrator/.test(LEDGER_NOT_ON_THIS_SURFACE), "the ledger refusal names whose surface it is");

  // The assembler builds NOTHING for a rule with only Jira actions — the pre-1.4 run
  // must stay byte-identical, an empty refusals object and no executor.
  const plain = await assembleAgentExecutors({ surface: "listener", rule: { agent: { allowedActions: ["get_issue", "add_comment"] } } });
  eq(Object.keys(plain), ["refusals"], "a Jira-only rule gets no namespace executor at all");
  eq(plain.refusals, {}, "…and nothing to refuse");
  ok(typeof assembleAgentExecutors === "function", "the assembler is a function");
}

console.log(`agent-actions gate: ${n} assertions passed`);
