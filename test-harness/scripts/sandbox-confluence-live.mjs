/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-495 — `api.confluence.*` IN THE SANDBOX, LIVE, AND NOTHING OUTSIDE SIMULATION.
 *
 * TWO CLAIMS, and they pull in opposite directions, which is why both are needed:
 *   READS ARE REAL.  `api.confluence.searchCql` is not a write, so simulation does not
 *                    intercept it: on an instance where CogniRunner IS installed on
 *                    Confluence it must come back with actual pages. A read that
 *                    answered nothing would make the write arm below meaningless — an
 *                    "intercepted" write is indistinguishable from a Confluence the app
 *                    cannot reach at all.
 *   WRITES ARE NOT.  `api.confluence.createPage` is a write, so `confluenceMember`'s
 *                    `simulated && write` arm must stage a CHANGE LEDGER row and return
 *                    `{simulated:true}` without creating anything.
 *
 * THE VEHICLE IS `testListener`, and deliberately. `testPostFunction` is NOT on the test
 * hook's `invokeResolver` allow-list, and widening that allow-list to run this probe is
 * the one thing a verification run must never do. `testListener` IS allow-listed and
 * calls `runListener` with `forceSimulation: true` — the same sandbox session, the same
 * `simulated` flag, the same change ledger. Nothing in this script can run unsimulated.
 *
 * THE NEGATIVE IS PROVEN, NOT OBSERVED. "no page with that title exists" is worthless
 * until the same query has been shown to FIND a page. So the second read runs twice, in
 * the same sandbox, through the same member: once for a title that the first arm proved
 * is really there (the positive control) and once for the title the intercepted write
 * would have created. Only the pair is evidence.
 *
 * Usage (from test-harness/):
 *   node scripts/sandbox-confluence-live.mjs
 *   node scripts/sandbox-confluence-live.mjs --env=staging --issue=LZPT-186
 *
 * Env: TESTSTATE_URL (or STAGING_TESTSTATE_URL) + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * Nothing secret is printed - not the trigger URL, not the Bearer.
 */

import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { formatResultLine, resultExitCode } from "../lib/driver-report.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["listeners"], defaultEnv: "dev" });
const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);

const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "JT");
const ISSUE = arg("issue", "");
const KEEP = flag("keep");

/* The title the intercepted write would have used. Unique per run, so "it is not there"
 * cannot be satisfied by a leftover from a previous run either way. */
const PROBE_TITLE = `CogniRunner F-495 probe ${Date.now().toString(36)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);

const cleanup = { listenerIds: [] };

async function fetchRetry(url, init, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; console.log(`        (transport retry ${i + 1}/${tries}: ${e.message})`); await sleep(2000 * (i + 1)); }
  }
  return { __transportError: last };
}
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  const res = await fetchRetry(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (res && res.__transportError) return { status: 0, body: null, raw: `transport: ${res.__transportError.message}` };
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, body: null, raw: e.message }; }
  let body2 = null; try { body2 = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: body2, raw: body2 ? null : text.slice(0, 400) };
}
const invoke = async (functionKey, payload = {}) => {
  const r = await hook({ action: "invokeResolver", functionKey, payload, accountId: ADMIN });
  return { status: r.status, body: r.body, raw: r.raw };
};

/** Push a one-function script listener, dry-run it, return the log. Deleted by the finally. */
const runSandbox = async (label, code) => {
  const saved = await invoke("saveListener", {
    listener: {
      name: `F-495 ${label} ${Date.now().toString(36)}`,
      enabled: false, mode: "script",
      events: ["avi:jira:updated:issue"],
      /* NO project filter. `testListener` builds its event from the last captured SAMPLE
       * for the type, which may belong to any project on the site, and a projectKeys
       * filter then answers "Filtered out: project X not in filter" before the sandbox
       * ever runs - a SKIP that looks exactly like a clean run with empty logs. The
       * matcher is not what this probe is about, so it is given nothing to match on. */
      filters: {},
      functions: [{ name: "probe", code }],
    },
  });
  const row = saved.body && saved.body.listener;
  if (!row || !row.id) throw new Error(`saveListener refused: ${JSON.stringify(saved.body).slice(0, 400)}`);
  cleanup.listenerIds.push(row.id);
  const t = await invoke("testListener", { id: row.id, listener: row, ...(ISSUE ? { issueKey: ISSUE } : {}), eventType: "avi:jira:updated:issue" });
  if (t.status !== 200) throw new Error(`testListener HTTP ${t.status}: ${JSON.stringify(t.body).slice(0, 400)}`);
  return t.body && (t.body.result || t.body);
};
const logsOf = (r) => (r && (r.executionLogs || r.logs)) || [];
const changesOf = (r) => (r && r.changes) || [];
const logText = (r) => JSON.stringify(logsOf(r));

async function main() {
  console.log(`\nF-495 - api.confluence.* IN THE SANDBOX, live on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable / the secret was rejected (GET -> ${ping.status}). Rotating HARNESS_SECRET needs a redeploy of ${ENV_NAME}.`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);
  info(`the probe title for this run is "${PROBE_TITLE}"`);

  /* ── ARM 1 — the READ is real ────────────────────────────────────────────── */
  console.log("\nARM 1 - api.confluence.searchCql('type=page', limit 1) in a SIMULATED run");
  const read = await runSandbox("read", `
    const hits = await api.confluence.searchCql({ cql: "type = page", limit: 1 });
    const rows = (hits && hits.results) || [];
    api.log("CQL_COUNT=" + rows.length);
    if (rows[0]) api.log("CQL_FIRST_TITLE=" + rows[0].title + "|ID=" + rows[0].id);
    return rows.length;
  `);
  info(`decision=${read && read.decision} reason=${String((read && read.reason) || "").slice(0, 220)}`);
  info(`logs: ${logText(read).slice(0, 500)}`);
  const countLine = logsOf(read).map(String).find((l) => l.includes("CQL_COUNT="));
  const titleLine = logsOf(read).map(String).find((l) => l.includes("CQL_FIRST_TITLE="));
  const count = countLine ? Number(countLine.split("CQL_COUNT=")[1]) : null;
  let control = null;
  if (logText(read).includes("confluence_unavailable")) {
    NV(`Confluence is not reachable from ${ENV_NAME} (the member threw confluence_unavailable), so NEITHER arm can be proven here: an intercepted write and an unreachable Confluence look identical. Install CogniRunner on this site's Confluence and re-run.`);
    return;
  }
  if (count >= 1) {
    control = titleLine ? titleLine.split("CQL_FIRST_TITLE=")[1].split("|ID=")[0] : null;
    PASS(`the READ is NOT intercepted: searchCql returned ${count} real page(s) - first title "${control}"`);
  } else if (count === 0) {
    NV(`searchCql answered 0 pages. The call SUCCEEDED (no confluence_unavailable), but with no page to find, the second read below has no positive control and its "not found" would prove nothing.`);
  } else {
    FAIL(`could not read a CQL count out of the run: ${logText(read).slice(0, 400)}`);
  }
  if (!changesOf(read).length) PASS(`a READ staged NO change-ledger row (changes=[]) - reads are not writes`);
  else FAIL(`the read staged ${changesOf(read).length} change row(s): ${JSON.stringify(changesOf(read)).slice(0, 250)}`);

  /* ── ARM 2 — the WRITE is intercepted ────────────────────────────────────── */
  console.log("\nARM 2 - api.confluence.createPage(...) in the SAME simulated run");
  const spaceKey = arg("space", "");
  const write = await runSandbox("write", `
    const out = await api.confluence.createPage({
      spaceKey: ${JSON.stringify(spaceKey || "DOCS")},
      title: ${JSON.stringify(PROBE_TITLE)},
      storage: "<p>F-495 probe - this page must never exist.</p>"
    });
    api.log("CREATE_RETURNED=" + JSON.stringify(out));
    return true;
  `);
  info(`decision=${write && write.decision} reason=${String((write && write.reason) || "").slice(0, 220)}`);
  info(`logs: ${logText(write).slice(0, 600)}`);
  info(`changes: ${JSON.stringify(changesOf(write)).slice(0, 400)}`);
  const simLog = logsOf(write).map(String).find((l) => l.includes("[SIMULATION]") && l.includes("createPage"));
  if (simLog) PASS(`the write was INTERCEPTED and said so in the execution log: "${simLog.slice(0, 160)}…"`);
  else FAIL(`no [SIMULATION] line for createPage in the logs: ${logText(write).slice(0, 400)}`);
  const row = changesOf(write).find((c) => c && c.action === "confluence.createPage");
  if (row) PASS(`a CHANGE LEDGER row was staged: ${JSON.stringify(row)}`);
  else FAIL(`no confluence.createPage row in the change ledger: ${JSON.stringify(changesOf(write)).slice(0, 300)}`);
  if (row && row.simulated === true) PASS(`the staged row is flagged simulated:true`);
  else FAIL(`the staged row is not flagged simulated: ${JSON.stringify(row)}`);
  const returnedLine = String(logsOf(write).map(String).find((l) => l.includes("CREATE_RETURNED=")) || "");
  /* Read the RAW log line, not logText(): logText JSON-stringifies the array, so the
     inner quotes arrive escaped and a substring test for '"simulated":true' never fires. */
  if (returnedLine.includes('"simulated":true')) PASS(`createPage RETURNED {simulated:true} to the step instead of a page: ${returnedLine.slice(0, 160)}`);
  else FAIL(`createPage did not return a simulated marker to the step: ${returnedLine.slice(0, 200) || "(not logged)"}`);

  /* ── ARM 3 — THE SECOND READ, with its positive control ──────────────────── */
  console.log("\nARM 3 - the SECOND READ: does a page with that title exist? (and can this query find one at all?)");
  if (!control) {
    NV(`no positive control is available (ARM 1 found no page), so a "not found" for "${PROBE_TITLE}" cannot be told apart from a query that finds nothing ever. The interception is evidenced by ARM 2's ledger row alone, which is weaker.`);
  } else {
    const verify = await runSandbox("verify", `
      const mine = await api.confluence.searchCql({ cql: 'type = page AND title = "${PROBE_TITLE.replace(/"/g, '')}"', limit: 5 });
      api.log("PROBE_HITS=" + (((mine && mine.results) || []).length));
      const ctl = await api.confluence.searchCql({ cql: 'type = page AND title = "${String(control).replace(/"/g, '')}"', limit: 5 });
      api.log("CONTROL_HITS=" + (((ctl && ctl.results) || []).length));
      return true;
    `);
    info(`logs: ${logText(verify).slice(0, 500)}`);
    const pick = (k) => { const l = logsOf(verify).map(String).find((x) => x.includes(k + "=")); return l ? Number(l.split(k + "=")[1]) : null; };
    const probeHits = pick("PROBE_HITS"), ctlHits = pick("CONTROL_HITS");
    if (ctlHits >= 1) PASS(`POSITIVE CONTROL: the same title query FINDS the page ARM 1 saw ("${control}" -> ${ctlHits} hit(s)) - this query can see pages`);
    else { NV(`the positive control found ${ctlHits} hit(s) for a title that ARM 1 read back, so the probe's 0 below proves nothing (CQL title matching may differ from the search index)`); }
    if (ctlHits >= 1 && probeHits === 0) PASS(`PROVEN NEGATIVE: NO page titled "${PROBE_TITLE}" exists - the simulated createPage created nothing`);
    else if (probeHits > 0) FAIL(`THE WRITE LANDED: ${probeHits} page(s) titled "${PROBE_TITLE}" exist on this site. Simulation did not intercept createPage.`);
  }

  console.log("\n" + formatResultLine({ passes, fails, unproven, dash: "-" }));
  if (resultExitCode({ fails })) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.message); process.exitCode = 1; })
  /* CLEANUP IS AN ASSERTION: every listener this run pushed is deleted and RE-READ. */
  .finally(async () => {
    if (KEEP) { console.log("\nCLEANUP SKIPPED (--keep)"); return; }
    console.log("\nCLEANUP");
    const residue = [];
    for (const id of cleanup.listenerIds) {
      const r = await invoke("deleteListener", { id }).catch((e) => ({ body: { error: e.message } }));
      const back = await invoke("getListener", { id }).catch(() => null);
      const still = !!(back && back.body && back.body.listener);
      console.log(`        deleteListener ${id}: ${JSON.stringify(r.body).slice(0, 110)} | second read: ${still ? "STILL PRESENT" : "gone"}`);
      if (still) residue.push(`listener ${id}`);
    }
    if (residue.length) { console.error(`\nCLEANUP FAILED - survived their delete:\n        ${residue.join("\n        ")}`); process.exitCode = 1; }
  });
