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
}

// The anonymous refusals (F-227/F-221): no principal is not a pass, and it is
// still a permission refusal, not a fault.
for (const key of ["getConfigs", "explainRule", "buildRule", "narrateDryRun"]) {
  await reset();
  const res = await invoke(key, {}, null);
  assert.equal(res?.success, false, `${key}: anonymous caller must be refused`);
  assert.equal(res?.reason, "no-permission", `${key}: anonymous refusal must be machine-readable`);
  assert.equal(res?.needsRole, "viewer", `${key}: anonymous refusal wants at least a viewer`);
}

// A SUCCESS must never look like a refusal.
await reset();
const ok = await invoke("checkIsAdmin", {});
assert.equal(ok.success, true);
assert.equal(ok.reason, undefined, "a successful result must not carry the refusal flag");
assert.equal(ok.needsRole, undefined);
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
    /success:\s*false\s*,\s*error:\s*["'`](?:[^"'`]*(?:access required|on't have permission)[^"'`]*)["'`]/.test(line));
assert.equal(handBuilt.length, 0,
  `hand-built permission refusals bypass the helper at src/index.js lines: ${handBuilt.map(([n]) => n).join(", ")}`);

console.log("permission-refusal-shape: OK");
