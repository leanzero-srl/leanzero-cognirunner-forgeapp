/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-432 — AN ADMIN RE-ARMING AN EDITOR'S RULE MUST NOT ERASE IT FROM THE EDITOR'S VIEWS.
//
// `armingStamp` (F-409) moves `createdBy` to whoever last SAVED a rule, and `createdBy`
// was also the only visibility key. So an admin who re-saved an editor's Coder rule —
// exactly what the F-390 refusal text instructs ("Re-save this rule as an admin to arm its
// write actions") — silently took the rule out of that editor's Rules tab, out of their
// "My rules" filter, and took every historical run of it out of their Logs tab. Only an
// admin could hand it back, because the editor could no longer see the row.
//
// Asserted through the REAL resolvers (registerPostFunction / registerConfig / getConfigs /
// getLogs), because the defect was three surfaces disagreeing about "is this row yours?" —
// a pure-function test of one of them is what let it through. `configs-filter.test.mjs`
// covers the predicate itself.
//
// The rows carry NO workflow context on purpose: getConfigs' orphan sweep only judges rows
// that name a workflow + transition, and this suite is about visibility, not attachment.
//
// Run: node --import ../lib/register-mocks-index.mjs scripts/rule-visibility.test.mjs
//   (auto-discovered by run-offline.mjs)
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const EDITOR = "acct-editor";
const OTHER = "acct-other";

await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: EDITOR, role: "editor", scope: "own" },
  { accountId: OTHER, role: "editor", scope: "own" },
]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const registry = async () => (await storage.get("config_registry")) || [];
const rowOf = async (id) => (await registry()).find((c) => c.id === id);
const ids = (r) => (r.configs || []).map((c) => c.id).sort();

/* ================================================================== *
 * 1. A POST-FUNCTION the editor authored, then an admin re-arms.
 * ================================================================== */
const PF_ID = "wf-alpha::11::pf";
{
  const made = await call("registerPostFunction", {
    id: PF_ID, type: "postfunction-semantic", fieldId: "summary", prompt: "summarise",
  }, EDITOR);
  ok(made && made.success === true, `the editor creates the rule (${JSON.stringify(made).slice(0, 160)})`);
  const row = await rowOf(PF_ID);
  ok(row.createdBy === EDITOR && row.firstCreatedBy === EDITOR, "it is owned and authored by the editor");
}
{
  const mine = await call("getConfigs", { filter: "mine" }, EDITOR);
  ok(ids(mine).includes(PF_ID), "the editor sees it under My rules");
}
{
  // THE RE-ARM. An admin saves the same rule to arm its write actions.
  const again = await call("registerPostFunction", {
    id: PF_ID, type: "postfunction-semantic", fieldId: "summary", prompt: "summarise",
  }, ADMIN);
  ok(again && again.success === true, "an admin re-arms it");
  const row = await rowOf(PF_ID);
  ok(row.createdBy === ADMIN, "the ACTING account moves to the admin — the F-409 trade, unchanged");
  ok(row.firstCreatedBy === EDITOR, "and the first author is still recorded");
}
{
  const all = await call("getConfigs", {}, EDITOR);
  ok(ids(all).includes(PF_ID), "THE EDITOR STILL SEES THE RULE after the admin re-arm");
  const mine = await call("getConfigs", { filter: "mine" }, EDITOR);
  ok(ids(mine).includes(PF_ID), "…and it is still under their My rules");
  const asAdmin = await call("getConfigs", {}, ADMIN);
  ok(ids(asAdmin).includes(PF_ID), "the admin sees it too");
  const adminsMine = await call("getConfigs", { filter: "mine" }, ADMIN);
  ok(adminsMine.configs.length >= 1 && ids(adminsMine).includes(PF_ID),
    "the admin's My rules holds it as well — they are the acting account now");
  const stranger = await call("getConfigs", {}, OTHER);
  ok(!ids(stranger).includes(PF_ID), "a third editor sees nothing of it");
  const strangerMine = await call("getConfigs", { filter: "mine" }, OTHER);
  ok(!ids(strangerMine).includes(PF_ID), "…and nothing under their My rules");
}

/* ================================================================== *
 * 2. THE LOGS. The history of the same rule must not vanish either.
 * ================================================================== */
await storage.set("validation_logs", [
  { ruleId: PF_ID, issueKey: "AAA-1", type: "postfunction", isValid: true, reason: "ran", timestamp: new Date().toISOString() },
  { ruleId: "gone-rule", issueKey: "AAA-2", type: "validator", isValid: false, reason: "deleted rule", timestamp: new Date().toISOString() },
]);
{
  const logs = await call("getLogs", {}, EDITOR);
  ok(logs.success === true, "the editor may read logs");
  const forRule = (logs.logs || []).filter((l) => l.ruleId === PF_ID);
  ok(forRule.length === 1, "THE EDITOR STILL SEES THE RULE'S HISTORY after the re-arm");
  ok((logs.logs || []).some((l) => l.ruleId === "gone-rule"),
    "entries for a deleted rule stay visible — there is no row to own them");
}
{
  const logs = await call("getLogs", {}, ADMIN);
  ok((logs.logs || []).some((l) => l.ruleId === PF_ID), "the admin sees every entry");
}
{
  const logs = await call("getLogs", {}, OTHER);
  ok(!(logs.logs || []).some((l) => l.ruleId === PF_ID),
    "a third editor sees none of another's rule history");
}

/* ================================================================== *
 * 3. A VALIDATOR row records its first author too (registerConfig, which F-409
 *    left alone). Set ONCE, never moved.
 * ================================================================== */
const V_ID = "wf-beta::21";
{
  const made = await call("registerConfig", {
    id: V_ID, type: "validator", fieldId: "description", prompt: "must be filled",
  }, EDITOR);
  ok(made && made.success === true, `the editor creates a validator (${JSON.stringify(made).slice(0, 160)})`);
  const row = await rowOf(V_ID);
  ok(row.createdBy === EDITOR && row.firstCreatedBy === EDITOR, "firstCreatedBy is stamped at creation");
}
{
  const again = await call("registerConfig", {
    id: V_ID, type: "validator", fieldId: "description", prompt: "must be filled in",
  }, ADMIN);
  ok(again && again.success === true, "an admin edits it");
  const row = await rowOf(V_ID);
  ok(row.firstCreatedBy === EDITOR, "the first author is NEVER moved by a later save");
  const mine = await call("getConfigs", { filter: "mine" }, EDITOR);
  ok(ids(mine).includes(V_ID), "the editor still sees their validator");
}

console.log(`\nrule-visibility: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
