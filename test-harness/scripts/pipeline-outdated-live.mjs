/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-627 — THE OUTDATED / STUCK PIPELINE, LIVE AT LAST.
 *
 * F-604 (the setup form prefilled from the installed row), F-605 (a run that died still
 * shows the banner and the remedy) and F-611 (the deploy resolver refuses an outdated row
 * rather than forwarding it to GitHub's 422) are three fixes to ONE state that no door on
 * a tenant could produce: a `git_pipeline:*` row whose committed scaffold is older than
 * the one this build installs. A setup always stamps the CURRENT `SCAFFOLD_VERSION`. So
 * all three were render-proven (code-tab.test.mjs C16*) and live-UNPROVEN.
 *
 * This driver plants that state through the dev-only `pipelineRow` door and then asks the
 * PRODUCT about it — `getGitPipelineStatus`, the resolver the Code tab calls, and
 * `triggerGitDeploy`, the resolver F-611 fixed. Nothing here restates a predicate: the
 * assertions are on what those resolvers answer.
 *
 * NOTHING IS DISPATCHED AND NO REPOSITORY IS TOUCHED. The hook admits `triggerGitDeploy`
 * only on an OUTDATED row, where `triggerPipelineDeploy` refuses with `pipeline_outdated`
 * before the provider is called at all — the refusal IS the thing under test. The
 * connection used is a TOKENLESS stand-in planted by the hook (`plantHookSecret` with
 * `plantConnection`), so there is no credential on this path and no real repository is
 * named unless the operator names one.
 *
 * THE SHAPE: plant -> assert through the product resolver -> clear -> read again. The
 * second read is the point: a driver that never proves the state GONE has not proved the
 * first read saw anything it planted.
 *
 * Usage (from test-harness/):  node scripts/pipeline-outdated-live.mjs [--env=staging|dev] [--keep]
 *   [--conn=gc_f627harness] [--repo=leanzero-srl/cognirunner-harness]
 * Env: STAGING_TESTSTATE_URL (or TESTSTATE_URL) + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * Nothing secret is printed: not the secret, not the trigger URL.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const ENV_NAME = arg("env", "staging");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const NON_ADMIN = "712020:00000000-0000-0000-0000-000000000000"; // an account that is nobody here
const CONN = arg("conn", "gc_f627harness");
const REPO = arg("repo", "leanzero-srl/cognirunner-harness");
// A repository whose Actions list this gh account can read — the witness for "no dispatch".
const GH_REPO = arg("ghrepo", "");
const KEEP = flag("keep");
const OUT = new URL("../results/pipeline-outdated", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, conn: CONN, repo: REPO, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: e.message }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = async (functionKey, payload = {}, accountId = ADMIN) =>
  hook({ action: "invokeResolver", functionKey, payload, accountId });
const row = (op, extra = {}) => hook({ action: "pipelineRow", op, connId: CONN, repoId: REPO, ...extra });
const status = () => invoke("getGitPipelineStatus", { connectionId: CONN, repo: REPO });
const deploy = (accountId = ADMIN) => invoke("triggerGitDeploy", { connectionId: CONN, repo: REPO, confirm: true }, accountId);

async function main() {
  console.log(`F-627 pipeline outdated/stuck — env=${ENV_NAME} conn=${CONN} repo=${REPO}\n`);
  let plantedConnection = false;
  try {
    /* ── STEP 0 — the NEGATIVE first, on the SAME key ────────────────────────
       An empty read before anything is planted is what makes every later read
       evidence rather than a query that was always going to return something. */
    console.log("STEP 0 - the key is empty BEFORE the plant");
    const before = await row("read");
    ev.before = before.json;
    if (before.status === 200 && before.json && before.json.row === null) {
      PASS("no pipeline row exists for that repository yet", { key: before.json.key });
    } else if (before.status === 200 && before.json && before.json.planted === false) {
      FAIL("a REAL pipeline row already exists there - point this driver at a repo the product has not installed", { status: before.json.row && before.json.row.status });
      return;
    } else {
      FAIL("the pipelineRow read door did not answer", { status: before.status, raw: before.raw });
      return;
    }

    // A TOKENLESS stand-in connection, so `triggerGitDeploy` can get as far as the row.
    // It carries no credential and exactly this one repo (src/git-connections.js).
    const conn = await hook({ action: "plantHookSecret", connId: CONN, repoId: REPO, secret: "f627harnessplaceholder01", plantConnection: true });
    if (conn.status === 200) { plantedConnection = Boolean(conn.json && conn.json.connection); info(`stand-in connection ${plantedConnection ? "planted" : "already present"} (tokenless)`); }
    else info(`stand-in connection not planted (${conn.status}) - the deploy step may refuse earlier than the outdated check`);

    /* ── STEP 1 — the OUTDATED installed row (F-604 / F-611) ──────────────── */
    console.log("\nSTEP 1 - plant an OUTDATED installed row and ask the PRODUCT about it");
    const planted = await row("plant", {
      status: "installed",
      scaffoldVersion: 1,
      scaffoldVars: { APP_NAME: "harness-offshoot", UI_DIR: "static/app" },
      developerSpaceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      appId: "11111111-2222-3333-4444-555555555555",
      branch: "main",
    });
    ev.planted = planted.json;
    if (planted.status !== 200 || !(planted.json && planted.json.ok)) {
      FAIL("the plant was refused", { status: planted.status, body: JSON.stringify(planted.json).slice(0, 300) });
      return;
    }
    PASS("an outdated installed row is planted", { scaffoldVersion: 1, current: planted.json.currentScaffoldVersion });

    const st = await status();
    ev.status = st.json;
    const s = st.json && st.json.status;
    if (s && s.outdated === true) PASS("getGitPipelineStatus - the resolver the Code tab calls - reports outdated:true", { scaffoldVersion: s.scaffoldVersion, current: s.currentScaffoldVersion });
    else FAIL("getGitPipelineStatus did not report the row as outdated", { body: JSON.stringify(st.json).slice(0, 300) });
    if (s && typeof s.outdatedReason === "string" && s.outdatedReason.length > 20) PASS("…and carries the scaffold changelog REASON the banner prints verbatim", { reason: s.outdatedReason.slice(0, 80) + "…" });
    else FAIL("no outdatedReason on the projected row", { reason: s && s.outdatedReason });
    // F-604: the two facts the re-setup form must be able to prefill from.
    if (s && s.scaffoldVars && s.scaffoldVars.UI_DIR === "static/app" && s.scaffoldVars.APP_NAME === "harness-offshoot") {
      PASS("…and `scaffoldVars` reaches the browser, which is what F-604's prefill reads", s.scaffoldVars);
    } else FAIL("scaffoldVars is missing from the public row - F-604's prefill has nothing to read", { scaffoldVars: s && s.scaffoldVars });
    if (s && s.developerSpaceId && s.appId) PASS("…and the developer space and app id survive the projection (F-604's dropped header facts)", { developerSpaceId: s.developerSpaceId, appId: String(s.appId).slice(0, 24) + "…" });
    else FAIL("developerSpaceId/appId are absent from the public row", { developerSpaceId: s && s.developerSpaceId, appId: s && s.appId });
    if (s && s.live === false && s.stuck === false) PASS("…and an installed row is neither live nor stuck");
    else FAIL("an installed row is reported live or stuck", { live: s && s.live, stuck: s && s.stuck });

    /* ── STEP 2 — F-611: the deploy resolver REFUSES ──────────────────────── */
    console.log("\nSTEP 2 - F-611: triggerGitDeploy refuses an outdated row instead of dispatching it");
    /*
     * THE NEGATIVE IS ASKED OF GITHUB, ON A REPOSITORY WHERE A DISPATCH WOULD SHOW.
     * "No dispatch was sent" used to rest on the refusal CODE alone, and the default
     * stand-in repo (`leanzero-srl/cognirunner-harness`) does not exist — GitHub answers
     * 404 for it, so it could never have logged anything and the absence proved nothing.
     * `--ghrepo` names a repository whose Actions list this account CAN read; the run
     * list is read before and after, and the positive control is that the read returns
     * workflow_dispatch runs at all. Skipped, loudly, when `gh` cannot see the repo.
     */
    const ghRuns = () => {
      if (!GH_REPO) return null;
      try {
        const out = execFileSync("gh", ["api", `/repos/${GH_REPO}/actions/runs?per_page=20`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const j = JSON.parse(out);
        return Array.isArray(j.workflow_runs) ? j.workflow_runs : null;
      } catch { return null; }
    };
    const runsBefore = ghRuns();
    if (runsBefore === null) NV(`GitHub's run list for ${GH_REPO || "(no --ghrepo given)"} could not be read, so "no dispatch was sent" rests on the refusal code alone`);
    else if (!runsBefore.some((r) => r.event === "workflow_dispatch")) {
      NV(`${GH_REPO} has no workflow_dispatch run in its recent history, so an absence after the refusal would prove nothing`, { runs: runsBefore.length });
    } else PASS(`GitHub's run list for ${GH_REPO} is readable AND carries workflow_dispatch runs - an absence below is a measured absence`, { runs: runsBefore.length });
    const refused = await deploy();
    ev.deployOutdated = refused.json;
    const d = refused.json;
    if (d && d.success === false && d.code === "pipeline_outdated") {
      PASS("triggerGitDeploy answers pipeline_outdated - no dispatch was sent, so no 422 was ever reached", { code: d.code });
    } else if (d && d.harnessRefusal) {
      FAIL("the HOOK refused before the resolver - the planted row is not outdated by the product's predicate", d);
    } else {
      FAIL("triggerGitDeploy did not refuse with pipeline_outdated", { body: JSON.stringify(d).slice(0, 300) });
    }
    if (d && typeof d.error === "string" && d.error.includes("Set up the pipeline again")) {
      PASS("…with the SAME remedy sentence the Code tab shows (PIPELINE_OUTDATED_REMEDY, one home)");
    } else FAIL("the refusal does not carry the shared remedy sentence", { error: d && String(d.error).slice(0, 160) });
    const runsAfter = ghRuns();
    if (runsBefore && runsAfter) {
      const fresh = runsAfter.filter((r) => !runsBefore.some((b) => b.id === r.id));
      if (fresh.length === 0) PASS(`…and GITHUB logged NO new run on ${GH_REPO} - the dispatch was never attempted, not merely rejected`, { seen: runsAfter.length });
      else FAIL("GitHub logged a new run after a refusal that claims nothing was dispatched", { fresh: fresh.map((r) => ({ id: r.id, event: r.event, at: r.created_at })) });
    }

    const asNobody = await deploy(NON_ADMIN);
    ev.deployNonAdmin = asNobody.json;
    if (asNobody.json && asNobody.json.success === false && asNobody.json.needsRole === "admin") {
      PASS("a non-admin is refused by ROLE before any of this - the hook does not bypass the gate", { reason: asNobody.json.reason });
    } else FAIL("the non-admin answer is not the role refusal", { body: JSON.stringify(asNobody.json).slice(0, 200) });

    /* ── STEP 3 — F-605: the STUCK queued row ─────────────────────────────── */
    console.log("\nSTEP 3 - F-605: a run that died leaves a STUCK queued row, and it still says outdated-free");
    await row("clear");
    const stuck = await row("plant", { status: "queued", scaffoldVersion: 1, ageMs: 30 * 60 * 1000 });
    ev.stuckPlant = stuck.json;
    const st2 = await status();
    ev.stuckStatus = st2.json;
    const s2 = st2.json && st2.json.status;
    if (s2 && s2.stuck === true && s2.live === false) PASS("getGitPipelineStatus reports stuck:true, live:false - the banner F-605 restored", { status: s2.status, queuedAt: s2.queuedAt });
    else FAIL("a 30-minute-old queued row is not reported stuck", { stuck: s2 && s2.stuck, live: s2 && s2.live });
    if (s2 && s2.outdated === false) PASS("…and outdated stays FALSE on a row that never installed - nothing was committed to be stale (F-611's installedAt rule)");
    else FAIL("a never-installed row is reported outdated", { outdated: s2 && s2.outdated, installedAt: s2 && s2.installedAt });

    const deployStuck = await deploy();
    ev.deployStuck = deployStuck.json;
    if (deployStuck.json && deployStuck.json.harnessRefusal === "not-outdated") {
      PASS("the hook refuses to trigger a deploy on the stuck row - it is not outdated, so a dispatch would be REAL");
    } else if (deployStuck.json && deployStuck.json.code === "not_installed") {
      PASS("…and the product would have refused it anyway with not_installed", { code: deployStuck.json.code });
    } else FAIL("the stuck row was not refused on either side", { body: JSON.stringify(deployStuck.json).slice(0, 200) });

    /* ── STEP 4 — a FRESH queued row is live, not stuck ───────────────────── */
    console.log("\nSTEP 4 - a freshly queued row is LIVE, which is what keeps the banner off a healthy run");
    await row("clear");
    await row("plant", { status: "queued", scaffoldVersion: 1, ageMs: 0 });
    const st3 = await status();
    ev.liveStatus = st3.json;
    const s3 = st3.json && st3.json.status;
    if (s3 && s3.live === true && s3.stuck === false) PASS("getGitPipelineStatus reports live:true, stuck:false");
    else FAIL("a fresh queued row is not reported live", { live: s3 && s3.live, stuck: s3 && s3.stuck });

    /* ── STEP 5 — the door plants no secret ───────────────────────────────── */
    console.log("\nSTEP 5 - the door refuses a body that names a credential");
    const leak = await row("plant", { status: "installed", scaffoldVersion: 1, token: "ghp_notarealtoken1234" });
    ev.secretRefusal = leak.json;
    if (leak.status === 400 && leak.json && leak.json.harnessRefusal === "secret-field") {
      PASS("a plant body carrying a token is refused secret-field", { field: leak.json.field });
    } else FAIL("the secret guard did not refuse", { status: leak.status, body: JSON.stringify(leak.json).slice(0, 200) });
  } finally {
    /* ── RESTORE — and the SECOND read, which is what proves the first one ── */
    console.log("\nRESTORE");
    if (!KEEP) {
      const cleared = await row("clear");
      const after = await row("read");
      ev.after = after.json;
      if (after.status === 200 && after.json && after.json.row === null) {
        PASS("the planted pipeline row is GONE - the same read that saw it above now sees nothing");
      } else if (cleared.json && cleared.json.harnessRefusal === "not-planted") {
        FAIL("the clear was refused not-planted - a real row is sitting on that key", { key: cleared.json.key });
      } else {
        FAIL("the planted row survives the clear", { row: after.json && after.json.row });
      }
      if (plantedConnection) {
        const gone = await hook({ action: "deleteHarnessConnection", connId: CONN });
        if (gone.status === 200 && gone.json && gone.json.ok) PASS(`the tokenless stand-in connection ${CONN} is gone`);
        else FAIL("the stand-in connection survives", { status: gone.status, body: JSON.stringify(gone.json).slice(0, 200) });
      } else {
        NV("no stand-in connection was planted by this run, so none was removed");
      }
    } else {
      NV("--keep: the planted row and connection were left in place");
    }
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
  }
}

await main();
process.exit(fails === 0 ? 0 : 1);
