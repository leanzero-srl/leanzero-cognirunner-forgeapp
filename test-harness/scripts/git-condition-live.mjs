/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of the F-365 git CONDITION branches on the REAL Jira expression engine.
 *
 * The `git-pr-merged` / `git-pr-approved` / `git-build-passed` branches of the
 * `ai-text-field-condition` manifest expression read `issue.properties["cognirunner.git"]`.
 * Jira — not our code — evaluates that expression, so the only honest proof is to attach
 * the condition to real self-loop transitions and ask `GET /issue/{key}/transitions`
 * whether the transition is SHOWN.
 *
 * The property value planted here is the WRITER's shape, taken from
 * `mergeGitProperty` in src/listeners.js: { version:1, repos:{ "<repo>": { repoId, pr:{…},
 * updatedAt } }, updatedAt }. It is never retyped from the manifest — that would prove
 * the expression agrees with itself rather than with the writer.
 *
 * Cases (the safety pattern: every SHAPE oddness must SHOW):
 *   missing property  → SHOWN     repos absent    → SHOWN
 *   merged:true       → SHOWN     version:2       → SHOWN
 *   merged:false      → HIDDEN    (the only hide)
 *
 *   node scripts/git-condition-live.mjs
 *
 * Env (test-harness/.env): TESTSTATE_URL + HARNESS_SECRET + the Jira REST creds.
 * Cleans up: deletes the property and removes its PROBE- transitions from the workflow.
 */
import { post, getTransitions } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";
import { readFileSync } from "node:fs";

const s = loadState();
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const hook = async (body) => (await fetch(env.TESTSTATE_URL, { method: "POST", headers: { Authorization: `Bearer ${env.HARNESS_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const TRANSITION = "PROBE-gitcond-merged";

// The WRITER's shape. `pr.merged` is present only when the writer saw a merged flag
// (src/listeners.js gitPropertyEntry), which is why the "entry without the flag" case
// is a real one and must SHOW.
const writerShape = (pr, over = {}) => ({
  version: 1,
  repos: { [REPO]: { repoId: REPO, pr, updatedAt: new Date().toISOString() } },
  updatedAt: new Date().toISOString(),
  ...over,
});

const cleanup = async () => {
  const { top, wf } = await readWorkflow(s.workflowName);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("PROBE-gitcond"));
  if (wf.transitions.length !== before) await updateWorkflow(top, wf);
};

let failures = 0;
const check = (label, shown, expectShown, note = "") => {
  const ok = shown === expectShown;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: transition ${shown ? "SHOWN" : "HIDDEN"}, expected ${expectShown ? "SHOWN" : "HIDDEN"}${note ? ` — ${note}` : ""}`);
};

const main = async () => {
  await cleanup();
  await attachSelfLoopRules(s.workflowName, s.hubStatusRef, [{
    name: TRANSITION, type: "condition",
    config: { ruleKind: "premade", conditionKind: "deterministic", ruleType: "git-pr-merged", repo: REPO },
  }], 9601);

  const key = (await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary: "F-365 git condition probe" } })).key;
  console.log(`issue ${key}, repo ${REPO}, condition git-pr-merged`);
  const shown = async () => {
    // Jira caches nothing here, but the property write and the transition read are two
    // calls: give the property a beat to be visible to the expression evaluator.
    await new Promise((r) => setTimeout(r, 2500));
    const tr = await getTransitions(key);
    return (tr.transitions || []).some((t) => t.name === TRANSITION);
  };

  // THE POSITIVE CONTROL FIRST: without the property the transition must be visible at
  // all. An "absent" result proves nothing until the query has been shown to see it.
  check("missing property → shown", await shown(), true, "positive control: the transition exists and is reachable");

  const plant = async (value) => {
    const r = await hook({ action: "probeProperty", issueKey: key, value });
    if (r.put !== 200 && r.put !== 201) { failures += 1; console.log(`FAIL  property write returned ${r.put ?? JSON.stringify(r).slice(0, 160)}`); }
    return r;
  };

  const t = await plant(writerShape({ number: 7, state: "merged", headSha: null, merged: true }));
  console.log(`      read-back: ${String(t.value).slice(0, 160)}`);
  check("merged:true → shown", await shown(), true);

  await plant(writerShape({ number: 7, state: "open", headSha: null, merged: false }));
  check("merged:false → hidden", await shown(), false, "the ONLY case that hides");

  await plant({ ...writerShape({ number: 7, state: "open", merged: false }), version: 2 });
  check("version:2 → shown", await shown(), true, "a future property version SHOWS rather than guesses");

  const noRepos = writerShape({ number: 7, state: "open", merged: false });
  delete noRepos.repos;
  await plant(noRepos);
  check("repos absent → shown", await shown(), true);

  // An entry that exists without the flag at all — the writer produces this whenever it
  // never saw a merged flag — must also SHOW (the per-branch null guard).
  await plant(writerShape({ number: 7, state: "open", headSha: null }));
  check("entry without a merged flag → shown", await shown(), true, "per-branch null guard");

  await hook({ action: "probeProperty", issueKey: key, remove: true });
  await cleanup();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  console.log(`(probe issue ${key} left in place — it carries no property and no rule)`);
  process.exit(failures ? 1 : 0);
};

main().catch(async (e) => { console.error("harness error:", e && e.message); try { await cleanup(); } catch {} process.exit(2); });
