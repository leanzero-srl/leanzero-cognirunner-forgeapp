/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-566 — THE KNOWLEDGE PACKS MUST BE REACHABLE FROM THE HARNESS.
 *
 * `getKnowledgePacks` and `saveKnowledgeSettings` shipped as orphans: no UI called them,
 * `src/rules-api.js` has no knowledge route, and `src/test-hook.js`'s `invokeResolver`
 * allow-list carried neither key. The settings row could be READ through `?what=kvs` and
 * written by nobody, on any path — so "the knowledge packs are opt-out" was a product
 * claim with no live proof anywhere. The Knowledge tab (78db911) closed the product half;
 * this closes the testability half.
 *
 * What is pinned here:
 *   1. `getKnowledgePacks` is reachable and answers the INDEX (packs, settings, budgets) —
 *      and never a pack BODY.
 *   2. `saveKnowledgeSettings` is reachable AND still carries its own admin gate: the hook
 *      does not bypass it, so a non-admin accountId is refused by the resolver.
 *   3. An admin write lands, and the read reflects it — the disable path, end to end.
 *   4. `COGNIRUNNER_KNOWLEDGE_SETTINGS` is on the `kvSet` allow-list (so a driver can
 *      restore the row it changed) and the allow-list is still a LIST — a secret slot is
 *      not writable through it.
 *
 * Run: node scripts/knowledge-hook.test.mjs (auto-discovered by run-offline.mjs)
 */
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const ADMIN = "acct-admin";
const VIEWER = "acct-viewer";
await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: VIEWER, role: "viewer", scope: "all" },
]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { testStateTrigger } = await import("../../src/test-hook.js");
const { KNOWLEDGE_SETTINGS_KEY } = await import("../../src/knowledge-packs.js");

const SECRET = "offline-knowledge-hook-secret";
const previousSecret = process.env.HARNESS_SECRET;
process.env.HARNESS_SECRET = SECRET;

const hook = (body, authorization = `Bearer ${SECRET}`) =>
  testStateTrigger({ method: "POST", headers: { authorization: [authorization] }, body: JSON.stringify(body) });
const invoke = (functionKey, payload = {}, accountId = ADMIN) =>
  hook({ action: "invokeResolver", functionKey, payload, accountId });

/* ═══ 1. getKnowledgePacks — a pure read, reachable, index only ═══ */
let firstPackId = null;
{
  const r = await invoke("getKnowledgePacks");
  eq(r.statusCode, 200, "getKnowledgePacks is allowlisted");
  const body = JSON.parse(r.body);
  eq(body.success, true, `…and answers (${JSON.stringify(body).slice(0, 160)})`);
  ok(Array.isArray(body.packs) && body.packs.length > 0, "…with the pack index");
  ok(body.settings && typeof body.settings === "object", "…and the settings row");
  ok(body.budgets && typeof body.budgets === "object", "…and the per-audience byte budgets");
  // NO BODIES, ever — the tab costs kilobytes on a corpus that is hundreds of KB.
  const dump = JSON.stringify(body.packs);
  ok(dump.length < 60000, "…and carries no pack BODY (the index stays small)");
  firstPackId = body.packs[0] && body.packs[0].id;
  ok(typeof firstPackId === "string" && firstPackId.length > 0, "…each pack is identified by an id");
}

/* ═══ 2. saveKnowledgeSettings keeps its OWN admin gate through the hook ═══ */
{
  const r = await invoke("saveKnowledgeSettings", { disabled: [] }, VIEWER);
  eq(r.statusCode, 200, "the resolver is reached (the refusal is the resolver's, not the hook's)");
  const body = JSON.parse(r.body);
  eq(body.success, false, "a non-admin account is REFUSED — the hook does not bypass requireAdmin");
}

/* ═══ 3. the disable path, end to end, for an admin ═══ */
{
  const before = (await storage.get(KNOWLEDGE_SETTINGS_KEY)) ?? null;
  const r = await invoke("saveKnowledgeSettings", { disabled: [firstPackId] }, ADMIN);
  eq(r.statusCode, 200, "an admin write is reachable");
  const body = JSON.parse(r.body);
  eq(body.success, true, `…and accepted (${JSON.stringify(body).slice(0, 200)})`);
  ok(Array.isArray(body.settings?.disabled) && body.settings.disabled.includes(firstPackId),
    "…and the resolver returns what was STORED, not what was asked for");
  const read = JSON.parse((await invoke("getKnowledgePacks")).body);
  ok(read.settings.disabled.includes(firstPackId), "…and the read reflects the disable");
  const row = read.packs.find((p) => p.id === firstPackId);
  ok(row && row.enabled === false, "…and the pack row itself reports disabled");
  // A phantom id cannot be stored: the clamp runs BEFORE the write.
  const phantom = JSON.parse((await invoke("saveKnowledgeSettings", { disabled: ["no-such-pack"] }, ADMIN)).body);
  ok(!phantom.settings.disabled.includes("no-such-pack"), "an id naming no pack is clamped away, not stored");
  await storage.set(KNOWLEDGE_SETTINGS_KEY, before);
}

/* ═══ 4. the kvSet allow-list carries the settings row — and is still a list ═══ */
{
  const set = await hook({ action: "kvSet", key: KNOWLEDGE_SETTINGS_KEY, value: { disabled: [] } });
  eq(set.statusCode, 200, "COGNIRUNNER_KNOWLEDGE_SETTINGS is on the kvSet allow-list (a driver can RESTORE the row)");
  const del = await hook({ action: "kvSet", key: KNOWLEDGE_SETTINGS_KEY, value: null });
  eq(JSON.parse(del.body).set, "deleted", "…and can clear it back to the default");
  for (const key of ["COGNIRUNNER_KEY_openai_secret", "git_conn_secret:x", "coder_thread:x"]) {
    const r = await hook({ action: "kvSet", key, value: "planted" });
    eq(r.statusCode, 400, `${key} is still refused — the allow-list is a LIST, never a KVS bridge`);
  }
  const wrong = await hook({ action: "invokeResolver", functionKey: "getKnowledgePacks", payload: {}, accountId: ADMIN }, "Bearer wrong-secret");
  eq(wrong.statusCode, 404, "…and the whole hook is still behind HARNESS_SECRET");
}

if (previousSecret === undefined) delete process.env.HARNESS_SECRET;
else process.env.HARNESS_SECRET = previousSecret;

console.log(`\nknowledge hook: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
