/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// F-242 — every permission refusal must be MACHINE-READABLE.
//
// The gates used to return a sentence and nothing else, so the frontends had to
// regex English ("don't have permission" / "access required") to tell a refusal
// from a fault. Every refusal built by noPerm / needRole / notAuthorized /
// permissionDenied now carries `reason: "no-permission"`, plus `needsRole` where
// the gate knows the level it wanted. This suite proves that on the real
// resolvers, and proves a SUCCESS never carries the flag.
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");
const { handler } = await import("../../src/index.js");

const CALLER = "acct-norole";

// A Jira that answers cleanly and says: this caller is NOT an administrator, and
// no admin group contains them. Role resolves to null (a real "no role"), not the
// F-230 "unknown" fail-closed path.
const scriptJira = () => {
  forgeApi.__respond((path) => {
    if (path.includes("mypermissions")) {
      return forgeApi.__response(200, { permissions: { ADMINISTER: { havePermission: false } } });
    }
    if (path.includes("/group/member")) return forgeApi.__response(200, { values: [] });
    return forgeApi.__response(200, {});
  });
};

const invoke = (functionKey, payload = {}, accountId = CALLER) =>
  handler({ call: { functionKey, payload }, context: {} },
    accountId ? { principal: { accountId } } : {});

const reset = async () => {
  storage.__reset(); forgeApi.__reset(); scriptJira();
  // A non-empty roster in which our caller has no row: keeps the bootstrap path
  // out of the way so the gates refuse for the ordinary reason.
  await storage.set("app_admins", [{ accountId: "acct-someone-else", role: "admin", scope: "all" }]);
};

// Resolvers spanning every refusal builder: noPerm (viewer + editor floors),
// needRole("editor"), needRole("admin"), notAuthorized() for the anonymous gates.
const GATED = [
  ["getLogs", {}, "viewer"],
  ["getFields", {}, "viewer"],
  ["getKnowledgeCounts", {}, "viewer"],
  ["getMemories", {}, "viewer"],
  ["getMemorySettings", {}, "viewer"],
  ["getSkills", {}, "viewer"],
  ["getContextDocs", {}, "viewer"],
  ["getAsyncTaskResult", { taskId: "t1" }, "viewer"],
  ["addMemory", { text: "x" }, "editor"],
  ["deleteMemory", { id: "m1" }, "editor"],
  ["suggestEndpoint", { description: "x" }, "editor"],
  ["generatePostFunctionCode", { description: "x" }, "editor"],
  ["fixPostFunctionCode", { code: "x" }, "editor"],
  ["testValidation", { prompt: "x" }, "editor"],
  ["testPostFunction", { code: "x" }, "editor"],
  ["saveContextDoc", { title: "t", content: "c" }, "editor"],
  ["saveSkill", { skill: { name: "s", content: "c" } }, "editor"],
  // F-291 — the delete resolvers have a resolver-level role floor of their own,
  // so a role-less caller never reaches the registry (and its per-row reasons).
  ["removeConfig", { id: "r-anything" }, "editor"],
  ["removePostFunction", { id: "p-anything" }, "editor"],
  ["saveMemorySettings", { settings: {} }, "admin"],
  ["getAppAdmins", {}, "admin"],
  ["addAppAdmin", { accountId: "x" }, "admin"],
  ["updateUserRole", { accountId: "x", role: "viewer" }, "admin"],
  ["saveAiBudget", { budget: {} }, "admin"],
  ["resetAiUsage", {}, "admin"],
];

for (const [key, payload, expectedRole] of GATED) {
  await reset();
  const res = await invoke(key, payload);
  assert.equal(res?.success, false, `${key}: a no-role caller must be refused`);
  assert.equal(res?.reason, "no-permission",
    `${key}: refusal must carry reason:"no-permission" (got ${JSON.stringify(res?.reason)})`);
  assert.equal(res?.needsRole, expectedRole,
    `${key}: refusal must name the role it wanted (got ${JSON.stringify(res?.needsRole)})`);
  assert.match(String(res?.error || ""), /permission|access required|Not authorized/i,
    `${key}: the human sentence must not have changed`);
  // F-241 — a role-floor refusal names the ONE route that works. Roles come from
  // the app roster or Jira SITE admin only; a Jira project admin gets no role, so
  // the UI must say "ask a CogniRunner admin", never "retry" or "ask Jira".
  assert.equal(res?.hint, "ask-app-admin",
    `${key}: a needsRole refusal must carry the ask-app-admin hint`);
}

// The anonymous refusals (F-227/F-221): no principal is not a pass, and it is
// still a permission refusal, not a fault.
for (const key of ["getConfigs", "explainRule", "buildRule", "narrateDryRun"]) {
  await reset();
  const res = await invoke(key, {}, null);
  assert.equal(res?.success, false, `${key}: anonymous caller must be refused`);
  assert.equal(res?.reason, "no-permission", `${key}: anonymous refusal must be machine-readable`);
  assert.equal(res?.needsRole, "viewer", `${key}: anonymous refusal wants at least a viewer`);
  assert.equal(res?.hint, "ask-app-admin", `${key}: anonymous refusal carries the hint too`);
}

// F-241/F-252/F-254 — the OWNERSHIP table. The caller HAS editor; the row is
// someone else's. Every one of these refusals must carry `reason:"no-permission"`,
// NO `needsRole`, and `hint:"not-owner"` — never "ask-app-admin", which would send
// a role-holder to beg for scope:"all" over the whole site to touch one row.
const OWNED_BY_OTHER = "acct-someone-else";
const seedOwnership = async () => {
  await storage.set("app_admins", [{ accountId: CALLER, role: "editor", scope: "own" }]);
  await storage.set("listener:l-other", { id: "l-other", name: "Other", createdBy: OWNED_BY_OTHER, enabled: true, events: [] });
  await storage.set("listeners_index", ["l-other"]);
  await storage.set("job:j-other", { id: "j-other", name: "Other", createdBy: OWNED_BY_OTHER, enabled: true, schedule: { kind: "interval", minutes: 60 } });
  await storage.set("jobs_index", ["j-other"]);
  await storage.set("doc_repo_index", [{ id: "d-other", title: "Other doc", createdBy: OWNED_BY_OTHER }]);
  await storage.set("skill_repo_index", [{ id: "s-other", name: "Other skill", createdBy: OWNED_BY_OTHER }]);
  await storage.set("config_registry", [
    { id: "r-other", type: "validator", createdBy: OWNED_BY_OTHER, prompt: "x", transitionId: "1", workflowName: "wf" },
  ]);
};
const OWNERSHIP = [
  ["setListenerEnabled", { id: "l-other", enabled: false }],
  ["saveListener", { listener: { id: "l-other", name: "Renamed", events: [] } }],
  ["deleteListener", { id: "l-other" }],
  ["testListener", { id: "l-other" }],
  ["saveScheduledJob", { job: { id: "j-other", name: "Renamed" } }],
  ["deleteScheduledJob", { id: "j-other" }],
  ["setScheduledJobEnabled", { id: "j-other", enabled: false }],
  ["runScheduledJobNow", { id: "j-other" }],
  ["deleteContextDoc", { id: "d-other" }],
  // saveSkill takes a FLAT payload (id/name/instructions), unlike the GATED row
  // above where the role gate fires before the body is read.
  ["saveSkill", { id: "s-other", name: "Other skill", instructions: "do a thing" }],
  ["deleteSkill", { id: "s-other" }],
  ["removeConfig", { id: "r-other" }],
];
for (const [key, payload] of OWNERSHIP) {
  await reset();
  await seedOwnership();
  const res = await invoke(key, payload);
  assert.equal(res?.success, false, `${key}: a scope-own editor cannot act on another owner's row`);
  assert.equal(res?.reason, "no-permission",
    `${key}: an ownership refusal is still machine-readable (got ${JSON.stringify(res?.reason)})`);
  assert.equal(res?.needsRole, undefined,
    `${key}: an ownership refusal names no role floor (got ${JSON.stringify(res?.needsRole)})`);
  assert.equal(res?.hint, "not-owner",
    `${key}: an ownership refusal must say not-owner, never ask-app-admin (got ${JSON.stringify(res?.hint)})`);
}

// ==========================================================================
// F-260 — A VIEWER WHO OWNS THE ROW.
//
// The fixture above seeds the caller as an EDITOR for every ownership case, so
// it could never see the defect: `canActOnConfig` answers one boolean for three
// different refusals, and every converted site rendered all three as `notOwner`.
// A viewer therefore heard "it belongs to someone else" — about a row they OWN.
// That is not just wrong, it is misdirecting: `notOwner` carries hint
// "not-owner", which tells the UI that asking an admin for a role will NOT help,
// when a role is exactly what this caller is missing.
//
// The rule: the ROLE question is answered FIRST. A caller below the floor gets a
// role refusal (needsRole + ask-app-admin) no matter who owns the row.
const seedViewerOwnsEverything = async () => {
  await storage.set("app_admins", [{ accountId: CALLER, role: "viewer", scope: "own" }]);
  // Every row below is owned by the CALLER — ownership is not the problem here.
  await storage.set("listener:l-mine", { id: "l-mine", name: "Mine", createdBy: CALLER, enabled: true, events: [] });
  await storage.set("listeners_index", ["l-mine"]);
  await storage.set("job:j-mine", { id: "j-mine", name: "Mine", createdBy: CALLER, enabled: true, schedule: { kind: "interval", minutes: 60 } });
  await storage.set("jobs_index", ["j-mine"]);
  await storage.set("doc_repo_index", [{ id: "d-mine", title: "My doc", createdBy: CALLER }]);
  await storage.set("skill_repo_index", [{ id: "s-mine", name: "My skill", createdBy: CALLER }]);
  await storage.set("config_registry", [
    { id: "r-mine", type: "validator", createdBy: CALLER, prompt: "x", transitionId: "1", workflowName: "wf" },
  ]);
};
const VIEWER_OWNS = [
  ["setListenerEnabled", { id: "l-mine", enabled: false }, "editor"],
  ["saveListener", { listener: { id: "l-mine", name: "Renamed", events: [] } }, "editor"],
  ["deleteListener", { id: "l-mine" }, "editor"],
  ["setScheduledJobEnabled", { id: "j-mine", enabled: false }, "editor"],
  ["deleteScheduledJob", { id: "j-mine" }, "editor"],
  ["runScheduledJobNow", { id: "j-mine" }, "editor"],
  ["deleteContextDoc", { id: "d-mine" }, "editor"],
  ["deleteSkill", { id: "s-mine" }, "editor"],
  ["removeConfig", { id: "r-mine" }, "editor"],
];
for (const [key, payload, expectedRole] of VIEWER_OWNS) {
  await reset();
  await seedViewerOwnsEverything();
  const res = await invoke(key, payload);
  assert.equal(res?.success, false, `${key}: a VIEWER cannot act, even on their own row`);
  assert.equal(res?.reason, "no-permission", `${key}: still machine-readable`);
  assert.equal(res?.needsRole, expectedRole,
    `${key}: a viewer who OWNS the row is refused for the ROLE, and the refusal names it (got ${JSON.stringify(res?.needsRole)})`);
  assert.equal(res?.hint, "ask-app-admin",
    `${key}: the remedy is a role from an app admin, NOT "this belongs to someone else" (got ${JSON.stringify(res?.hint)})`);
}

// ==========================================================================
// F-261 — THE EXISTENCE LEAK.
//
// `deleteListener("someone-elses-id")` answered "belongs to someone else" while
// `deleteListener("made-up-id")` answered "Listener not found", so any editor
// could enumerate which ids exist on the instance. For a caller who could not
// have acted on the row ANYWAY, the two answers must be identical — byte for
// byte, including the sentence.
const UNKNOWN_ID = [
  ["deleteListener", { id: "l-other" }, { id: "l-nonexistent" }],
  ["setListenerEnabled", { id: "l-other", enabled: false }, { id: "l-nonexistent", enabled: false }],
  ["saveListener", { listener: { id: "l-other", name: "R", events: [] } }, { listener: { id: "l-nonexistent", name: "R", events: [] } }],
  ["testListener", { id: "l-other" }, { id: "l-nonexistent" }],
  ["deleteScheduledJob", { id: "j-other" }, { id: "j-nonexistent" }],
  ["setScheduledJobEnabled", { id: "j-other", enabled: false }, { id: "j-nonexistent", enabled: false }],
  ["saveScheduledJob", { job: { id: "j-other", name: "R" } }, { job: { id: "j-nonexistent", name: "R" } }],
  ["runScheduledJobNow", { id: "j-other" }, { id: "j-nonexistent" }],
];
for (const [key, existsPayload, missingPayload] of UNKNOWN_ID) {
  await reset();
  await seedOwnership();
  const exists = await invoke(key, existsPayload);
  await reset();
  await seedOwnership();
  const missing = await invoke(key, missingPayload);
  assert.equal(missing?.success, false, `${key}: an unknown id is still refused`);
  assert.deepEqual(
    { success: missing?.success, error: missing?.error, reason: missing?.reason, hint: missing?.hint, needsRole: missing?.needsRole },
    { success: exists?.success, error: exists?.error, reason: exists?.reason, hint: exists?.hint, needsRole: exists?.needsRole },
    `${key}: "exists but not yours" and "does not exist" must be the SAME answer for a scope-own caller ` +
    `(exists=${JSON.stringify(exists)} missing=${JSON.stringify(missing)})`
  );
  assert.doesNotMatch(String(missing?.error || ""), /not found/i,
    `${key}: a scope-own caller is never told an id does not exist`);
}

// …and "not found" is RESERVED for callers who may act on every row, for whom it
// leaks nothing. Without this half, "hide everything from everyone" would pass
// the test above while making the product unusable for admins.
{
  const seedAdmin = async () => {
    await storage.set("app_admins", [{ accountId: CALLER, role: "admin", scope: "all" }]);
  };
  for (const [key, payload, notFoundRe] of [
    ["deleteListener", { id: "l-nope" }, /listener not found/i],
    ["setListenerEnabled", { id: "l-nope", enabled: false }, /listener not found/i],
    ["deleteScheduledJob", { id: "j-nope" }, /job not found/i],
    ["runScheduledJobNow", { id: "j-nope" }, /save the job first/i],
  ]) {
    await reset();
    await seedAdmin();
    const res = await invoke(key, payload);
    assert.equal(res?.success, false, `${key}: an admin still gets a failure for an unknown id`);
    assert.equal(res?.reason, undefined, `${key}: and it is a NOT-FOUND, not a permission refusal`);
    assert.match(String(res?.error || ""), notFoundRe, `${key}: an admin is told plainly (got ${JSON.stringify(res?.error)})`);
  }
}

// F-254 — the BULK delete path speaks the same vocabulary in its per-row results,
// so an ownership refusal there is machine-readable too and "forbidden" is gone.
{
  await reset();
  await seedOwnership();
  const bulk = await invoke("deleteRules", { ids: ["r-other"] });
  const row = (bulk?.results || [])[0];
  assert.ok(row, "deleteRules reports a row per id");
  assert.equal(row.ok, false, "the row is refused");
  assert.equal(row.reason, "no-permission", `bulk ownership refusal uses the shared vocabulary (got ${JSON.stringify(row.reason)})`);
  assert.equal(row.hint, "not-owner", "bulk ownership refusal carries the not-owner hint");
}

// F-257 — a refusal is never dressed as an empty success.
{
  await reset();
  const refused = await invoke("searchUsers", { query: "ab" });
  assert.equal(refused?.success, false, "a non-admin searchUsers is a refusal, not an empty result set");
  assert.equal(refused?.reason, "no-permission", "searchUsers refusal is machine-readable");
  assert.equal(refused?.needsRole, "admin", "searchUsers names the admin floor");
  assert.equal(refused?.hint, "ask-app-admin", "searchUsers refusal carries the roster hint");
}

// A SUCCESS must never look like a refusal.
await reset();
const ok = await invoke("checkIsAdmin", {});
assert.equal(ok.success, true);
assert.equal(ok.reason, undefined, "a successful result must not carry the refusal flag");
assert.equal(ok.needsRole, undefined);
assert.equal(ok.hint, undefined, "a successful result must not carry the refusal hint");
await reset();
const okIntent = await invoke("takeUiIntent", {});
assert.equal(okIntent.success, true);
assert.equal(okIntent.reason, undefined, "takeUiIntent success must not carry the refusal flag");

// ONE HOME — no gate may hand-build a permission refusal again. Every such shape
// goes through permissionDenied(); a literal { success:false, error:"...access
// required"/"You don't have permission..." } in src/index.js is the defect.
const src = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
const handBuilt = src
  .split("\n")
  .map((line, i) => [i + 1, line])
  .filter(([, line]) =>
    // F-258 — the guard used to grep only two English phrasings, so two refusals
    // worded "Only admins can …" sailed past the "one home" invariant for a whole
    // release. Any sentence that REFUSES belongs in permissionDenied().
    /success:\s*false\s*,\s*error:\s*["'`](?:[^"'`]*(?:access required|on't have permission|Only admins|Only editors|Only viewers|dmin access|ditor access)[^"'`]*)["'`]/.test(line));
assert.equal(handBuilt.length, 0,
  `hand-built permission refusals bypass the helper at src/index.js lines: ${handBuilt.map(([n]) => n).join(", ")}`);

console.log("permission-refusal-shape: OK");

// ==========================================================================
// F-291 — THE SAME EXISTENCE LEAK, ON THE DELETE PATH.
//
// removeConfig/removePostFunction had no resolver-level role gate at all, and
// removeRegistryRowsCore pushed "not-found" (and "wrong-family") BEFORE the
// per-row ownership verdict — so a caller who could never delete anything could
// enumerate every rule id on the instance and its kind. For a scope-"own"
// caller the three answers must now be one answer.
{
  const seedRules = async () => {
    await storage.set("app_admins", [{ accountId: CALLER, role: "editor", scope: "own" }]);
    await storage.set("config_registry", [
      { id: "r-other", type: "validator", createdBy: OWNED_BY_OTHER, prompt: "x", transitionId: "1", workflowName: "wf" },
      { id: "p-other", type: "postfunction", createdBy: OWNED_BY_OTHER, transitionId: "1", workflowName: "wf" },
    ]);
  };
  const shape = (r) => ({ success: r?.success, error: r?.error, reason: r?.reason, hint: r?.hint, needsRole: r?.needsRole });
  const call = async (key, payload) => { await reset(); await seedRules(); return invoke(key, payload); };

  for (const [key, existsId, missingId, otherFamilyId] of [
    ["removeConfig", "r-other", "r-nonexistent", "p-other"],
    ["removePostFunction", "p-other", "p-nonexistent", "r-other"],
  ]) {
    const exists = await call(key, { id: existsId, detach: false });
    const missing = await call(key, { id: missingId, detach: false });
    const wrongFamily = await call(key, { id: otherFamilyId, detach: false });
    assert.equal(exists?.reason, "no-permission", `${key}: another owner's row is an ownership refusal`);
    assert.equal(exists?.hint, "not-owner", `${key}: ...with the not-owner hint`);
    assert.deepEqual(shape(missing), shape(exists),
      `${key}: an unknown id must answer exactly as another owner's row does ` +
      `(exists=${JSON.stringify(exists)} missing=${JSON.stringify(missing)})`);
    assert.deepEqual(shape(wrongFamily), shape(exists),
      `${key}: a row of the OTHER family must not be distinguishable either ` +
      `(got ${JSON.stringify(wrongFamily)})`);
    assert.doesNotMatch(String(missing?.error || ""), /registry|not found/i,
      `${key}: a scope-own caller is never told whether an id exists`);
  }

  // The other half: an all-scope caller keeps the honest answers.
  const seedAdminRules = async () => {
    await storage.set("app_admins", [{ accountId: CALLER, role: "admin", scope: "all" }]);
    await storage.set("config_registry", [
      { id: "p-other", type: "postfunction", createdBy: OWNED_BY_OTHER, transitionId: "1", workflowName: "wf" },
    ]);
  };
  await reset(); await seedAdminRules();
  const adminMissing = await invoke("removeConfig", { id: "r-nope", detach: false });
  assert.equal(adminMissing?.success, false, "an admin still gets a failure for an unknown id");
  assert.equal(adminMissing?.reason, "not-found", "and it is a NOT-FOUND, not a permission refusal");
  assert.match(String(adminMissing?.error || ""), /no longer in the registry/i, "an admin is told plainly");
  await reset(); await seedAdminRules();
  const adminFamily = await invoke("removeConfig", { id: "p-other", detach: false });
  assert.equal(adminFamily?.reason, "wrong-family", "an admin still learns a family mismatch");

  // And a legitimate delete still works (the gate is not "refuse everything").
  await reset();
  await storage.set("app_admins", [{ accountId: CALLER, role: "editor", scope: "own" }]);
  await storage.set("config_registry", [
    { id: "r-mine", type: "validator", createdBy: CALLER, prompt: "x", transitionId: "1", workflowName: "wf" },
  ]);
  const done = await invoke("removeConfig", { id: "r-mine", detach: false });
  assert.equal(done?.success, true, `a scope-own editor still deletes their OWN rule (got ${JSON.stringify(done)})`);
  assert.deepEqual(await storage.get("config_registry"), [], "and the row is gone");
}
