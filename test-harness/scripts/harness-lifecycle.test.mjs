/*
 * CogniRunner - Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanupFixtures, deleteIssueFixture, disposableProject } from "../lib/fixture-cleanup.mjs";

const source = readFileSync(new URL("../lib/rules-api.mjs", import.meta.url), "utf8");
let serial = 0;
const load = async (extra = {}) => {
  const env = { TESTSTATE_URL: "https://test.invalid/state", HARNESS_SECRET: "fixture", RESOLVER_ACCOUNT_ID: "test-admin", ...extra };
  const code = source.replace('import { loadEnv } from "./env.mjs";', `const loadEnv = () => (${JSON.stringify(env)});`);
  return import("data:text/javascript;base64," + Buffer.from(code + `\n// case ${serial++}`).toString("base64"));
};
let minted = 0; let revoked = []; let refuse = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (opts.method === "POST") {
    const body = JSON.parse(opts.body);
    if (body.action === "mintApiToken") {
      minted++;
      await new Promise(r => setTimeout(r, 5));
      return Response.json({ token: `token-${minted}`, row: { id: `id-${minted}` } });
    }
    assert.equal(body.name, "revokeApiToken");
    assert.equal(body.accountId, "test-admin");
    if (refuse) return Response.json({ success: false }, { status: 403 });
    revoked.push(body.payload.id);
    return Response.json({ success: true, revoked: true });
  }
  return Response.json({ url: "https://test.invalid/rules" });
};
try {
  const client = await load();
  const results = await Promise.all(Array.from({ length: 10 }, () => client.ensureRulesApi()));
  assert.equal(minted, 1, "parallel initialization mints once");
  assert.ok(results.every(x => x.token === "token-1"));
  await Promise.all([client.closeRulesApi(), client.closeRulesApi()]);
  assert.deepEqual(revoked, ["id-1"], "parallel close revokes once");
  await client.ensureRulesApi();
  refuse = true;
  await assert.rejects(client.closeRulesApi(), /Could not revoke/);
  refuse = false;
  await client.closeRulesApi();
  assert.deepEqual(revoked, ["id-1", "id-2"], "failed revocation keeps ownership for retry");
  const supplied = await load({ RULES_API_URL: "https://test.invalid/rules", RULES_API_TOKEN: "user-owned" });
  assert.equal((await supplied.ensureRulesApi()).token, "user-owned");
  await supplied.closeRulesApi();
  assert.equal(minted, 2);
  assert.equal(revoked.length, 2, "caller token never revoked");
  const failure = await load();
  await assert.rejects(async () => {
    try { await failure.ensureRulesApi(); throw Error("suite failed"); }
    finally { await failure.closeRulesApi(); }
  }, /suite failed/);
  assert.equal(revoked.at(-1), "id-3", "suite failure still revokes its token");
} finally { globalThis.fetch = originalFetch; }

const responses = [{ok:true,status:200,body:{key:"LZPT-1"}}, {ok:false,status:403}];
const denied = await deleteIssueFixture(async () => responses.shift(), "LZPT-1");
assert.equal(denied.status, 403);
let remainingRan = false;
const oldExitCode = process.exitCode;
assert.equal(await cleanupFixtures([["denied fixture", async () => denied], ["remaining fixture", async () => {remainingRan=true; return {ok:true,status:204};}]]), 1);
assert.equal(process.exitCode, 1);
assert.equal(remainingRan, true, "one failure does not abandon later cleanup");
process.exitCode = oldExitCode;
const good = [{ok:true,status:200,body:{key:"LZPT-1"}}, {ok:true,status:204}, {ok:false,status:404}];
assert.equal((await deleteIssueFixture(async () => good.shift(), "LZPT-1")).status, 204);
const unproven = [{ok:true,status:200,body:{key:"LZPT-1"}}, {ok:true,status:204}, {ok:false,status:403}];
await assert.rejects(deleteIssueFixture(async () => unproven.shift(), "LZPT-1"), /absence unverified/);
let paths = [];
const project = await disposableProject(async (_method,path) => {
  paths.push(path);
  if(path.includes("createmeta"))return {ok:true,body:{issueTypes:[{id:"1",subtask:false}]}};
  if(path.includes("mypermissions"))return {ok:true,body:{permissions:{DELETE_ISSUES:{havePermission:true}}}};
  return {ok:true,body:{key:"LZPT",id:"1"}};
}, {COGTEST_PROJECT_KEY:"COGTEST"});
assert.equal(project.key,"LZPT");
assert.ok(paths.every(p=>!p.includes("COGTEST")),"old workflow bed does not select disposable rule fixtures");
console.log("Harness lifecycle: token concurrency, ownership, error cleanup and fixture second reads passed");
