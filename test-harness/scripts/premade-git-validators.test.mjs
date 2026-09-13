/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OFFLINE unit test for the GIT premade validators (1.4 commit 10).
 *
 * Everything outside src/premade-rules.js is injected: the connection row, the
 * allow-list predicate, the adapter and the cognirunner.git property reader. No
 * Jira, no network, no KVS.
 *
 * What it pins, in the order it matters:
 *   1. each validator's pass and fail,
 *   2. the property is an INDEX, never evidence (a forged merged:true does not pass),
 *   3. strict vs fail-OPEN on auth_dead / network / timeout, and the banner,
 *   4. the repo-not-on-the-allow-list refusal — fail CLOSED whatever strict says,
 *   5. no pull request found,
 *   6. the dry-run (testValidation) shape: result + a message, nothing else.
 *
 *   node --import ./lib/register-mocks.mjs scripts/premade-git-validators.test.mjs
 */
import { executePremadeRule, GIT_VALIDATOR_TYPES, GIT_VALIDATOR_BUDGET_MS } from "../../src/premade-rules.js";
import { mergeGitProperty } from "../../src/listeners.js";

let passed = 0;
const failures = [];

const REPO = "leanzero/cognirunner";
const CONN = { id: "c1", label: "LeanZero GitHub", kind: "github", repos: [REPO] };

/** The REAL property shape: built by the REAL writer, so this test cannot drift
 *  from listeners.js mergeGitProperty (repos → { repoId, pr:{…} }). */
const property = (pr) => mergeGitProperty(null, { repoId: REPO, pr });

class ProviderErr extends Error {
  constructor(code) { super(code); this.code = code; }
}

const provider = ({ pr = {}, state = {}, build = null, comments = [], throws = null, slow = 0 } = {}) => ({
  async getPullRequestState() {
    if (throws) throw new ProviderErr(throws);
    if (slow) await new Promise((r) => setTimeout(r, slow));
    return { kind: "github", state: pr.state || "open", approved: false, changesRequested: false, ...state, pr: { number: 7, sourceBranch: "feature/T-1-thing", headSha: "abc", state: "open", ...pr } };
  },
  async getBuildState() {
    if (throws) throw new ProviderErr(throws);
    return build || { kind: "github", state: "none", name: null, url: null, checks: [] };
  },
  async listPullRequestComments() {
    if (throws) throw new ProviderErr(throws);
    return comments;
  },
});

/** Run one git validator with everything injected. */
const run = (cfg, {
  prop = property({ number: 7 }),
  conn = CONN,
  prov = provider(),
  issueKey = "T-1",
  raceDeadline = null,
} = {}) =>
  executePremadeRule(
    { connectionId: "c1", repo: REPO, ...cfg },
    { issue: { key: issueKey }, modifiedFields: {} },
    "validator",
    {
      gitDeps: {
        getConnection: async () => conn,
        isRepoAllowed: (row, repo) => !!row && (row.repos || []).includes(repo),
        providerForConnection: async () => prov,
        readGitProperty: async () => prop,
        ...(raceDeadline ? { raceDeadline } : {}),
      },
    },
  );

async function check(name, promise, expect) {
  try {
    const out = await promise;
    const okResult = out?.result === expect.result;
    const okMsg = expect.hasMsg === undefined
      ? true
      : (expect.hasMsg ? typeof out?.errorMessage === "string" && out.errorMessage.length > 0 : out?.errorMessage === undefined);
    const okBanner = expect.banner === undefined ? true : (out?.banner || null) === expect.banner;
    const okIn = expect.msgIncludes === undefined ? true : String(out?.errorMessage || "").includes(expect.msgIncludes);
    if (okResult && okMsg && okBanner && okIn) passed++;
    else failures.push(`${name}: expected ${JSON.stringify(expect)}, got ${JSON.stringify(out)}`);
  } catch (e) {
    failures.push(`${name}: THREW ${e.message}`);
  }
}

const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

async function main() {
  // ---- 0. the catalogue ⇄ executor surface ----
  eq("four git validator types", GIT_VALIDATOR_TYPES.length, 4);
  eq("budget is 8s (inside the 25s resolver cap)", GIT_VALIDATOR_BUDGET_MS <= 8000, true);

  // ---- 1. git-pr-merged ----
  await check("merged: live merged → pass",
    run({ ruleType: "git-pr-merged" }, { prov: provider({ state: { state: "merged" }, pr: { state: "merged" } }) }),
    { result: true });
  await check("merged: live open → block",
    run({ ruleType: "git-pr-merged" }), { result: false, hasMsg: true });

  // THE PROPERTY IS NOT EVIDENCE — a forged merged:true with an open PR still blocks.
  await check("merged: forged property merged:true, live open → BLOCK",
    run({ ruleType: "git-pr-merged" }, { prop: property({ number: 7, merged: true, state: "merged" }) }),
    { result: false, hasMsg: true });

  // ---- 2. git-pr-approved ----
  await check("approved: approved → pass",
    run({ ruleType: "git-pr-approved" }, { prov: provider({ state: { approved: true } }) }), { result: true });
  await check("approved: no approval → block",
    run({ ruleType: "git-pr-approved" }), { result: false, hasMsg: true });
  await check("approved: approved but changes requested → block",
    run({ ruleType: "git-pr-approved" }, { prov: provider({ state: { approved: true, changesRequested: true } }) }),
    { result: false, msgIncludes: "changes requested" });

  // ---- 3. git-build-passed ----
  const build = (state, name) => provider({ build: { kind: "github", state, name: name || null, url: null, checks: [] } });
  await check("build: success → pass", run({ ruleType: "git-build-passed" }, { prov: build("success") }), { result: true });
  await check("build: failed → block", run({ ruleType: "git-build-passed" }, { prov: build("failed", "ci") }), { result: false, hasMsg: true });
  await check("build: running → block (not an error — it has not passed)",
    run({ ruleType: "git-build-passed" }, { prov: build("running") }), { result: false, msgIncludes: "not finished" });
  await check("build: no checks at all, strict off → allow",
    run({ ruleType: "git-build-passed" }, { prov: build("none") }), { result: true });
  await check("build: no checks at all, strict on → block",
    run({ ruleType: "git-build-passed", strict: true }, { prov: build("none") }), { result: false, hasMsg: true });

  // ---- 4. git-pr-comments-resolved ----
  const comment = (resolved) => ({ id: 1, body: "x", resolved });
  await check("comments: all resolved → pass",
    run({ ruleType: "git-pr-comments-resolved" }, { prov: provider({ comments: [comment(true)] }) }), { result: true });
  await check("comments: none at all → pass",
    run({ ruleType: "git-pr-comments-resolved" }, { prov: provider({ comments: [] }) }), { result: true });
  await check("comments: one proven unresolved → block",
    run({ ruleType: "git-pr-comments-resolved" }, { prov: provider({ comments: [comment(true), comment(false)] }) }),
    { result: false, msgIncludes: "1 unresolved" });
  // F-269: null is NOT PROVEN — never read as resolved.
  await check("comments: resolution unknown (GitHub REST), strict off → allow",
    run({ ruleType: "git-pr-comments-resolved" }, { prov: provider({ comments: [comment(null)] }) }), { result: true });
  await check("comments: resolution unknown, strict on → block",
    run({ ruleType: "git-pr-comments-resolved", strict: true }, { prov: provider({ comments: [comment(null)] }) }),
    { result: false, msgIncludes: "cannot be read" });

  // ---- 5. auth_dead: fail OPEN with a banner, or fail CLOSED naming the connection ----
  for (const t of GIT_VALIDATOR_TYPES) {
    await check(`${t}: auth_dead strict off → allow + banner`,
      run({ ruleType: t }, { prov: provider({ throws: "auth_dead" }) }), { result: true, banner: "auth_dead" });
    await check(`${t}: auth_dead strict on → block + banner`,
      run({ ruleType: t, strict: true }, { prov: provider({ throws: "auth_dead" }) }),
      { result: false, banner: "auth_dead", msgIncludes: "LeanZero GitHub" });
  }
  // …and the message never carries a credential.
  const dead = await run({ ruleType: "git-pr-merged", strict: true }, { prov: provider({ throws: "auth_dead" }) });
  eq("auth_dead message carries no token-ish text", /ghp_|token [A-Za-z0-9]{8}|Bearer /.test(dead.errorMessage), false);

  // ---- 6. network / rate limit ----
  await check("network error, strict off → allow + banner",
    run({ ruleType: "git-pr-merged" }, { prov: provider({ throws: "network" }) }), { result: true, banner: "git_unavailable" });
  await check("network error, strict on → block + banner",
    run({ ruleType: "git-pr-merged", strict: true }, { prov: provider({ throws: "network" }) }),
    { result: false, banner: "git_unavailable" });
  await check("rate_limited, strict off → allow",
    run({ ruleType: "git-pr-approved" }, { prov: provider({ throws: "rate_limited" }) }), { result: true, banner: "git_unavailable" });

  // ---- 7. the 8 s deadline (index.js's raceDeadline, injected) ----
  const timeOut = async () => { const e = new Error("Git validator timed out"); e.pfDeadline = true; throw e; };
  await check("timeout, strict off → allow + banner",
    run({ ruleType: "git-pr-merged" }, { raceDeadline: timeOut }), { result: true, banner: "git_unavailable" });
  await check("timeout, strict on → block + banner",
    run({ ruleType: "git-pr-merged", strict: true }, { raceDeadline: timeOut }),
    { result: false, banner: "git_unavailable", msgIncludes: "too long" });
  // A deadline that does NOT fire must pass the real answer through untouched.
  await check("deadline that does not fire is transparent",
    run({ ruleType: "git-pr-merged" }, {
      prov: provider({ state: { state: "merged" } }),
      raceDeadline: (promise) => promise,
    }), { result: true });

  // ---- 8. repo NOT on the connection's allow-list → fail CLOSED, strict or not ----
  // Why closed: the rule is MISCONFIGURED, not unlucky. A gate that silently
  // passes when it points at a repository it may not read is decoration, and
  // nothing would ever say so (§8 "dead gate").
  const otherRepo = { ...CONN, repos: ["someone/else"] };
  await check("repo not allowed, strict off → BLOCK (fail closed)",
    run({ ruleType: "git-pr-merged" }, { conn: otherRepo }), { result: false, msgIncludes: "allow-list" });
  await check("repo not allowed, strict on → BLOCK",
    run({ ruleType: "git-pr-merged", strict: true }, { conn: otherRepo }), { result: false, msgIncludes: "allow-list" });
  await check("connection deleted → BLOCK (fail closed)",
    run({ ruleType: "git-pr-merged" }, { conn: null }), { result: false, msgIncludes: "no longer exists" });
  // …but an UNFINISHED rule (nothing picked yet) fails OPEN, like every other premade rule.
  await check("no connection/repo configured → allow (unfinished config)",
    executePremadeRule({ ruleType: "git-pr-merged" }, { issue: { key: "T-1" } }, "validator", { gitDeps: {} }),
    { result: true });

  // ---- 9. no pull request found ----
  await check("no property entry, strict off → allow",
    run({ ruleType: "git-pr-merged" }, { prop: null }), { result: true });
  await check("no property entry, strict on → block and say so",
    run({ ruleType: "git-pr-merged", strict: true }, { prop: null }), { result: false, msgIncludes: "No pull request" });
  await check("property for a DIFFERENT repo, strict on → block",
    run({ ruleType: "git-pr-merged", strict: true }, { prop: mergeGitProperty(null, { repoId: "other/repo", pr: { number: 9 } }) }),
    { result: false, msgIncludes: "No pull request" });

  // ---- 10. prMatch: how the candidate is accepted ----
  await check("prMatch branch: branch names the issue key → checked",
    run({ ruleType: "git-pr-merged", prMatch: "branch" }, { prov: provider({ state: { state: "merged" }, pr: { sourceBranch: "feature/T-1-thing" } }) }),
    { result: true });
  await check("prMatch branch: branch does NOT name the issue → treated as no PR (strict blocks)",
    run({ ruleType: "git-pr-merged", prMatch: "branch", strict: true }, { prov: provider({ state: { state: "merged" }, pr: { sourceBranch: "chore/unrelated" } }) }),
    { result: false, msgIncludes: "No pull request" });
  await check("prMatch both (default): property candidate is enough",
    run({ ruleType: "git-pr-merged", prMatch: "both" }, { prov: provider({ state: { state: "merged" }, pr: { sourceBranch: "chore/unrelated" } }) }),
    { result: true });
  await check("prMatch property: branch is irrelevant",
    run({ ruleType: "git-pr-merged", prMatch: "property" }, { prov: provider({ state: { state: "merged" }, pr: { sourceBranch: "chore/unrelated" } }) }),
    { result: true });

  // ---- 11. the dry-run (testValidation / simulation) shape ----
  // A premade dry-run is the SAME call — there is no second engine — so the
  // contract to pin is the returned shape: a boolean result and, when it blocks,
  // a user-facing message. Nothing else may leak (no token, no connection row).
  const dry = await run({ ruleType: "git-pr-approved", strict: true }, { prov: provider({ throws: "auth_dead" }) });
  eq("dry-run keys are bounded", Object.keys(dry).sort(), ["banner", "errorMessage", "result"]);
  eq("dry-run result is a boolean", typeof dry.result, "boolean");
  const dryOpen = await run({ ruleType: "git-pr-approved" }, { prov: provider({ throws: "auth_dead" }) });
  eq("allow keys are bounded", Object.keys(dryOpen).sort(), ["banner", "gitReason", "result"]);

  // ---- 12. a custom errorMessage wins, on every blocking path ----
  await check("custom errorMessage is used",
    run({ ruleType: "git-pr-merged", errorMessage: "Merge the PR first." }), { result: false, msgIncludes: "Merge the PR first." });

  console.log(failures.length
    ? `✗ premade GIT validators: ${passed} passed, ${failures.length} FAILED\n  - ${failures.join("\n  - ")}`
    : `✓ premade GIT validators: ${passed}/${passed} assertions passed.`);
  process.exit(failures.length ? 1 : 0);
}

main();
