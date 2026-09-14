/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-637 / F-638 — THE ALLOW-LIST IS THE DOOR, AND IT HAS TO OPEN ON THE RIGHT FIVE.
 *
 * Five shipped fixes had no live arm because `invokeResolver` refused their function key
 * by name: F-622 (saveSkill existence parity), F-624 (deleteSkill), F-625
 * (deleteContextDoc), F-626 (the getContextDocContent viewer floor) and F-629/F-633
 * (getOpenAIKey — the only consumer of the key-read fault lever, and the door F-633
 * floored). The hook is the right instrument because it is the only path that can choose
 * the CALLING PRINCIPAL, which is what all five findings are about.
 *
 * What is pinned here:
 *   1. All five keys are ACCEPTED — no `functionKey not allowlisted` for any of them.
 *   2. The REFUSED keys stay refused: `setupGitPipeline` and every other deploy/dispatch
 *      or credential door. Widening the list for a knowledge door must not widen it for a
 *      door onto a customer's repository.
 *   3. `triggerGitDeploy` is reachable ONLY through the F-627 outdated-only wrapper — with
 *      no pipeline row it is refused by the hook itself, before the resolver.
 *   4. `getOpenAIKey` through the hook with a CHOSEN NON-VIEWER principal answers the
 *      F-633 refusal, and carries no `baseUrl` — the principal override reaches the new
 *      keys exactly as it reaches the old ones.
 *   5. F-762 — `listGitWebhooks` is accepted, its write-side neighbours (`setupGitWebhook`,
 *      `rotateGitWebhookSecret`) stay refused by name, and every hook url leaves MASKED:
 *      the webtrigger token and the signing secret appear nowhere in the response.
 *
 * Run: node scripts/test-hook-parity-doors-allowlist.test.mjs (auto-discovered by run-offline.mjs)
 */
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const ADMIN = "acct-admin";
const OUTSIDER = "acct-outsider";          // on no roster row at all — below the viewer floor
await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const SECRET = "offline-parity-doors-secret";
const previousSecret = process.env.HARNESS_SECRET;
process.env.HARNESS_SECRET = SECRET;

const { testStateTrigger } = await import("../../src/test-hook.js");

const hook = (body) => testStateTrigger({
  method: "POST",
  headers: { authorization: [`Bearer ${SECRET}`] },
  body: JSON.stringify(body),
});
const invoke = async (functionKey, payload = {}, accountId = ADMIN) => {
  const res = await hook({ action: "invokeResolver", functionKey, payload, accountId });
  let body = null; try { body = JSON.parse(res.body); } catch { /* text */ }
  return { status: res.statusCode, body, raw: String(res.body || "") };
};
const notAllowlisted = (r) => r.status === 400 && /not allowlisted/.test(String((r.body && r.body.error) || r.raw));

/* ═══ 1. the five F-637/F-638 keys are ACCEPTED ═══ */
for (const [fk, finding] of [
  ["saveSkill", "F-622"],
  ["deleteSkill", "F-624"],
  ["deleteContextDoc", "F-625"],
  ["getContextDocContent", "F-626"],
  ["getOpenAIKey", "F-629/F-633"],
]) {
  const r = await invoke(fk, { id: "probe_does_not_exist" });
  ok(!notAllowlisted(r), `${finding}: ${fk} is on the allow-list (answer: ${String(r.raw).slice(0, 120)})`);
}

/* ═══ 2. the deploy / dispatch / credential doors STAY refused ═══ */
for (const fk of [
  "setupGitPipeline",
  "saveGitConnection", "deleteGitConnection", "rotateGitCredential",
  "saveForgeIdentity", "clearForgeIdentity",
  "vaWizardStep", "runVaTickNow", "runVaPostNow", "approveVaDraft", "pauseVa",
  "saveContextDoc",
]) {
  const r = await invoke(fk, {});
  ok(notAllowlisted(r), `${fk} is still REFUSED by name`);
}

/* ═══ 3. triggerGitDeploy is reachable only through the F-627 outdated-only wrapper ═══ */
{
  const r = await invoke("triggerGitDeploy", { connectionId: "conn_nope", repo: "acme/none" });
  ok(!notAllowlisted(r), "triggerGitDeploy is on the list (the F-627 wrapper, not the allow-list, is its gate)");
  eq(r.status, 400, "…and with no pipeline row the HOOK refuses it before the resolver");
  eq(r.body && r.body.harnessRefusal, "not-outdated", "…with the F-627 reason named");
}

/* ═══ 4. the principal override reaches the new keys — F-633 on getOpenAIKey ═══ */
{
  const r = await invoke("getOpenAIKey", {}, OUTSIDER);
  eq(r.status, 200, "getOpenAIKey is dispatched for a chosen non-viewer principal");
  const b = r.body || {};
  eq(b.success, false, "…and is REFUSED — the hook chose the principal, the resolver applied F-633's floor");
  eq(b.reason, "no-permission", "…with the permission-refusal reason");
  eq(b.needsRole, "viewer", "…naming the viewer floor");
  eq(b.error, "You don't have permission to read the AI provider settings.", "…and F-633's sentence");
  ok(!("baseUrl" in b), "…and NO baseUrl — the infrastructure hostname never crosses the floor");
  ok(!("hasKey" in b) && !("isByok" in b), "…and no key-status booleans either");
}
/* …while the admin principal DOES get through, so the check above is a floor and not a
 * resolver that is broken for everyone. */
{
  const r = await invoke("getOpenAIKey", {}, ADMIN);
  eq((r.body || {}).success, true, "an admin principal reads the provider settings through the same door");
}

/* ═══ 5. F-762 — `listGitWebhooks` is ACCEPTED, and its urls leave MASKED ═══
 *
 * The key was refused by name, so the F-481 rotation banner could only be read live
 * through `listGitConnections` (our own record) and never against what the provider
 * actually has. It is admitted as a READ — but `hooks[].url` is this installation's
 * webtrigger URL, an unguessable capability, so the hook must never repeat it. The
 * control below is BOTH halves: the name is now accepted, and its neighbours that were
 * never admitted (`setupGitWebhook`, `rotateGitWebhookSecret` — a WRITE that installs a
 * signing secret at a provider) are still refused by name. */
{
  const r = await invoke("listGitWebhooks", { connectionId: "conn_nope", repo: "acme/none" });
  ok(!notAllowlisted(r), `F-762: listGitWebhooks is on the allow-list (answer: ${String(r.raw).slice(0, 140)})`);
}
for (const fk of ["setupGitWebhook", "rotateGitWebhookSecret"]) {
  ok(notAllowlisted(await invoke(fk, {})), `…and its write-side neighbour ${fk} is still REFUSED by name`);
}
{
  // A real connection + a provider that answers with a real hook url, so the masking is
  // proved on the shape the resolver actually returns rather than on a hand-made one.
  const savedFetch = globalThis.fetch;
  const queue = [];
  const httpRes = (status, body) => ({
    status, headers: { get: () => null },
    async json() { return body; }, async text() { return JSON.stringify(body); },
  });
  globalThis.fetch = async () => queue.shift() || httpRes(200, {});
  const { handler: realHandler } = await import("../../src/index.js");
  const direct = (functionKey, payload) => realHandler(
    { call: { functionKey, payload }, context: {} }, { principal: { accountId: ADMIN } },
  );
  queue.push(httpRes(200, { login: "octo" }));
  const conn = await direct("saveGitConnection", {
    kind: "github", label: "F-762 hooks", token: "ghp_F762_PLANTED_TOKEN_0123456789", repos: ["acme/app"],
  });
  const connId = conn && conn.connection && conn.connection.id;
  ok(Boolean(connId), `a connection to read hooks on (${JSON.stringify(conn).slice(0, 120)})`);
  const HOOK_URL = `https://mock.webtrigger/x/UNGUESSABLE_TRIGGER_TOKEN?conn=${encodeURIComponent(connId)}&repo=acme%2Fapp`;
  const HOOK_SECRET = "F762_PLANTED_HOOK_SECRET";
  queue.push(httpRes(200, [{ id: 4242, active: true, events: ["push"], config: { url: HOOK_URL, secret: HOOK_SECRET } }]));
  const r = await invoke("listGitWebhooks", { connectionId: connId, repo: "acme/app" });
  const b = r.body || {};
  const h = (b.hooks || [])[0] || {};
  eq(b.success, true, "…and it dispatches for an admin principal");
  eq(h.hookId, "4242", "…returning the provider's hook id");
  eq(b.urlsMasked, true, "…flagged as masked, so a reader is never left guessing");
  ok(!("url" in h), "…with `url` ABSENT, not nulled — the trigger token never leaves the hook");
  ok(!r.raw.includes("UNGUESSABLE_TRIGGER_TOKEN"), "…and the token appears NOWHERE in the response body");
  ok(!r.raw.includes(HOOK_SECRET), "…nor does the signing secret, even though the provider echoed it");
  eq(h.urlMasked && h.urlMasked.host, "mock.webtrigger", "…the masked projection keeps the host");
  eq(h.urlMasked && h.urlMasked.conn, connId, "…and the conn routing the caller already supplied");
  eq(h.urlMasked && h.urlMasked.repo, "acme/app", "…and the repo");
  ok(typeof (h.urlMasked || {}).fingerprint === "string" && h.urlMasked.fingerprint.length === 16,
    `…and a one-way fingerprint two hooks can be compared by (${JSON.stringify(h.urlMasked)})`);
  globalThis.fetch = savedFetch;
}

if (previousSecret === undefined) delete process.env.HARNESS_SECRET;
else process.env.HARNESS_SECRET = previousSecret;

console.log(`test-hook-parity-doors-allowlist (F-637, F-638): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
