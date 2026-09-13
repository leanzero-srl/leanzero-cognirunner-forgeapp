/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of the GIT VALIDATOR fail-open / fail-closed contract (1.4 commit 10,
 * src/premade-rules.js runGitValidator), driven through the REAL Jira workflow engine.
 *
 * THE LEVER. A validator that must answer "the credential is dead" needs a connection
 * whose credential IS dead — without planting a token anywhere. The harness STAND-IN
 * (plantHookSecret {plantConnection:true}) is exactly that: a tokenless `git_conn:*` row
 * that `providerForConnection` refuses by name with `code:"auth_dead"` BEFORE any egress
 * (src/git-connections.js isHarnessConnection). So every answer below is produced by the
 * same code a really-dead GitHub token would take, and nothing ever calls GitHub.
 *
 * THE PROPERTY IS THE INDEX. `runGitValidator` returns `no-pull-request` and never
 * reaches the provider unless `cognirunner.git` NOMINATES a pull request number for the
 * repo. So the advisory property is planted first, in the WRITER's shape (taken from
 * `mergeGitProperty` in src/listeners.js — never retyped from the manifest). The
 * number is all that is needed here: the F-362 binding check runs AFTER the live read,
 * and the live read is what throws.
 *
 * WHAT IS PROVEN, on the same rule and the same issue:
 *   strict:false → the transition is ALLOWED and the execution log carries
 *                  banner:"auth_dead" (the admin is told WHY it passed)
 *   strict:true  → the transition is BLOCKED, the message NAMES the connection label,
 *                  and no part of any token or secret appears in it
 *
 * A BLOCK is only evidence if the same transition can be seen to pass — so the
 * strict:false ALLOW runs first on the same transition and is the positive control.
 *
 *   GIT_WEBHOOK_URL is not needed. Env: test-harness/.env (TESTSTATE_URL, HARNESS_SECRET,
 *   HARNESS_ADMIN_ACCOUNT_ID, and the Jira REST creds).
 *
 *   node scripts/git-validator-live.mjs
 *
 * Cleans up: removes its PROBE- transitions from the COGTEST workflow, deletes the
 * planted property and the stand-in connection (KEEP=1 to leave the stand-in).
 */
import { post, getTransitions, doTransition } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";
import { testState } from "../lib/rules-api.mjs";

const s = loadState();
const CONN = process.env.GIT_CONN_ID || "harness-git-val";
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const KEEP = process.env.KEEP === "1";
const PR_NUMBER = 4242;
const TRANSITION = "PROBE-gitval";

let failures = 0;
const check = (label, actual, expected, note = "") => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}${note ? ` — ${note}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanupWorkflow = async () => {
  const { top, wf } = await readWorkflow(s.workflowName);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith(TRANSITION));
  if (wf.transitions.length !== before) await updateWorkflow(top, wf);
};

/** Attach ONE git validator with the given strictness, replacing any previous copy. */
const attach = async (strict) => {
  await cleanupWorkflow();
  await attachSelfLoopRules(s.workflowName, s.hubStatusRef, [{
    name: TRANSITION, type: "validator",
    config: { ruleKind: "premade", ruleType: "git-pr-merged", connectionId: CONN, repo: REPO, strict },
  }], 9701);
};

/** Fire the self-loop. `doTransition` returns the RAW status + body, so a validator
 *  BLOCK (400 with the message in `errorMessages`) is read as data, never scraped out
 *  of an exception string — a PR number in the sentence would fool a regex. */
const fire = async (issueKey) => {
  const tr = await getTransitions(issueKey);
  const t = (tr.transitions || []).find((x) => x.name === TRANSITION);
  if (!t) return { ok: false, status: 0, messages: ["the probe transition is not on the issue"] };
  const res = await doTransition(issueKey, t.id);
  let messages = [];
  try {
    const j = res.text ? JSON.parse(res.text) : null;
    messages = [...(j?.errorMessages || []), ...Object.values(j?.errors || {})];
  } catch { messages = res.text ? [String(res.text).slice(0, 600)] : []; }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, messages };
};

/** The newest premade execution-log row for this issue, read through the REAL resolver. */
const latestLog = async (issueKey) => {
  const r = await testState.post({ action: "invokeResolver", functionKey: "getLogs", payload: {}, accountId: process.env.HARNESS_ADMIN_ACCOUNT_ID });
  const rows = (r.body?.logs || []).filter((l) => l.issueKey === issueKey && l.premadeRuleType === "git-pr-merged");
  return rows.length ? rows[0] : null;
};

const main = async () => {
  // ---- the stand-in connection (tokenless, one repo) ----
  const secret = Array.from({ length: 40 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("");
  const planted = await testState.post({ action: "plantHookSecret", connId: CONN, repoId: REPO, secret, plantConnection: true });
  check("stand-in connection planted", planted.status, 200, JSON.stringify(planted.body).slice(0, 160));
  if (planted.status !== 200) process.exit(1);
  const label = planted.body?.connection?.label || planted.body?.connection?.id || CONN;
  console.log(`      connection label as the admin sees it: “${label}”, hasToken=${planted.body?.connection?.hasToken}`);

  const issueKey = (await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary: "git validator probe (auth_dead)" } })).key;
  console.log(`      issue ${issueKey}, repo ${REPO}, rule git-pr-merged`);

  // The property NOMINATES the candidate PR. Without it the validator answers
  // `no-pull-request` and never reaches the provider — so this is what makes the
  // auth_dead path reachable at all.
  const prop = await testState.post({ action: "probeProperty", issueKey, value: {
    version: 1,
    repos: { [REPO]: { repoId: REPO, pr: { number: PR_NUMBER, state: "open", headSha: null }, updatedAt: new Date().toISOString() } },
    updatedAt: new Date().toISOString(),
  } });
  check("candidate PR nominated on cognirunner.git", prop.body?.put === 200 || prop.body?.put === 201, true, `put=${prop.body?.put}`);

  // ---- strict:false → ALLOW + banner auth_dead (the positive control) ----
  await attach(false);
  await sleep(3000);
  const lax = await fire(issueKey);
  check("strict:false — the transition is ALLOWED", lax.ok, true, `HTTP ${lax.status} ${lax.messages.join(" ").slice(0, 200)}`);
  await sleep(3000);
  const laxLog = await latestLog(issueKey);
  if (!laxLog) { failures += 1; console.log("FAIL  no execution log row was written for the strict:false run"); }
  else {
    check("strict:false — the execution log says banner auth_dead", laxLog.banner, "auth_dead");
    check("strict:false — the row records a PASS", laxLog.isValid, true);
    console.log(`      log reason: ${String(laxLog.reason).slice(0, 160)}`);
  }

  // ---- strict:true → BLOCK, message names the connection, never the token ----
  await attach(true);
  await sleep(3000);
  const strict = await fire(issueKey);
  check("strict:true — the transition is BLOCKED", strict.ok, false, `HTTP ${strict.status}`);
  check("strict:true — blocked with a 400, not a server error", strict.status, 400);
  const text = strict.messages.join(" ");
  check("strict:true — the block message NAMES the connection", text.includes(label), true, text.slice(0, 240));
  // The secret this run planted must not appear anywhere in what the user is shown.
  check("strict:true — no secret text in the message", text.includes(secret), false);
  check("strict:true — the word 'token' is not in the message", /token/i.test(text), false, "the copy says 're-connect', never anything about a credential's value");
  await sleep(3000);
  const strictLog = await latestLog(issueKey);
  if (!strictLog) { failures += 1; console.log("FAIL  no execution log row was written for the strict:true run"); }
  else {
    check("strict:true — the row records a BLOCK", strictLog.isValid, false);
    check("strict:true — the row carries banner auth_dead", strictLog.banner, "auth_dead");
    check("strict:true — the logged reason names the connection", String(strictLog.reason).includes(label), true, String(strictLog.reason).slice(0, 200));
    check("strict:true — no secret text in the logged reason", String(strictLog.reason).includes(secret), false);
  }

  // ---- cleanup ----
  await testState.post({ action: "probeProperty", issueKey, remove: true });
  await cleanupWorkflow();
  if (!KEEP) {
    const gone = await testState.post({ action: "deleteHarnessConnection", connId: CONN });
    check("stand-in removed", gone.body?.ok === true, true, JSON.stringify(gone.body).slice(0, 120));
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  console.log(`(probe issue ${issueKey} left in place — no property, no rule)`);
  process.exit(failures ? 1 : 0);
};

main().catch(async (e) => { console.error("harness error:", e && e.message); try { await cleanupWorkflow(); } catch {} process.exit(2); });
