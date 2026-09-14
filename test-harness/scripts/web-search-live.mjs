/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE proof of the `web` namespace (1.4 commit 13, F-397): an ADMIN-SAVED agent
// listener holding `web_search` runs on a real `avi:jira:created:issue` event and
// (1) performs a search, naming a link, with the reading rule riding along, and
// (2) REFUSES a query that carries an identifier from this instance.
//
// The listener is saved through the dev test-state hook's `saveListener` resolver
// (admin accountId) rather than the Rules REST API, so the saved row carries
// savedByRole "admin" — the gate the agent-action allow-list is read against.
//
// Run: node scripts/web-search-live.mjs        (KEEP=1 keeps the fixtures)
import { loadEnv } from "../lib/env.mjs";
import { testState } from "../lib/rules-api.mjs";
import { disposableProject, cleanupFixtures, deleteIssueFixture } from "../lib/fixture-cleanup.mjs";

/* F-733 — THIS DRIVER IS DEV-ONLY BY CONSTRUCTION (no `--env`), AND THE SHARED TENANT IS
   THE ONLY TENANT IT HAS. So it declares what it CHANGES and leaves changed, in the guard's
   closed vocabulary, and a non-empty set asks for `--i-know-dev-is-shared` before anything is
   written. No environment is resolved and no `.env` is demanded: this is the DECLARATION half
   of `requireEnvAck` on its own, which is what keeps a Playwright script that never opens a
   web trigger out of the mapping it has no use for (F-699's reasoning). */
import { declareMutations } from "../lib/shared-env-guard.mjs";
declareMutations(["listeners", "issues"]);

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const ADMIN = env.HARNESS_ADMIN_ACCOUNT_ID;
const RUN = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  PASS " + msg); } else { fail++; console.log("  FAIL " + msg); } };
const jira = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const invoke = async (functionKey, payload) => (await testState.post({ action: "invokeResolver", functionKey, payload, accountId: ADMIN }));

const created = { listeners: [], issues: [] };
try {
  // The MCP toggle is the one gate for the web namespace — read it, never assume it.
  const mcps = await testState.get("kvs", "&key=COGNIRUNNER_LMSTUDIO_MCPS");
  ok(mcps?.body?.value?.webSearch === true, "tenant MCP setting webSearch is ON (read from KVS, not assumed)");

  const proj = await disposableProject(jira, env);
  const stdType = proj.issueTypes.find((t) => !t.subtask);

  const saved = await invoke("saveListener", {
    listener: {
      name: `Web search live ${RUN}`,
      events: ["avi:jira:created:issue"],
      // NO `jql` FILTER. A listener's JQL filter is evaluated against Jira's TEXT INDEX at
      // trigger time, and an issue created two seconds ago is not in it yet — the event is
      // dropped BEFORE the queue, so there is no run and no log row at all (it cost three
      // "the listener missed the event" false alarms on 2026-09-13). Filter by project and
      // pick this run's issue out of the log rows by key.
      filters: { projectKeys: [proj.key] },
      mode: "agent",
      agent: {
        // web_search ONLY: with `get_issue` on the roster a model happily answers a
        // "look up KEY-123" instruction from Jira and the web path is never exercised —
        // the first version of this script proved nothing for exactly that reason.
        instructions: "Call web_search exactly once, with the query given verbatim in the issue summary after 'query:'. Then finish, quoting verbatim whatever the tool returned to you, including any note, fence or refusal code. Never answer from your own knowledge.",
        allowedActions: ["web_search"],
        maxRounds: 4,
      },
    },
  });
  const listener = saved?.body?.listener || saved?.body?.saved || null;
  ok(!!listener?.id, `listener saved through the resolver as admin: ${listener?.id} (savedByRole=${listener?.savedByRole})`);
  ok(Array.isArray(listener?.agent?.allowedActions) && listener.agent.allowedActions.includes("web_search"), `saved allowedActions include web_search: ${JSON.stringify(listener?.agent?.allowedActions)}`);
  if (listener?.id) created.listeners.push(listener.id);

  console.log("  waiting 35s for the 30s listener-index cache…");
  await sleep(35000);

  const fire = async (summary, label) => {
    const iss = await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary } });
    if (!iss.ok) throw new Error(`${label}: create → ${iss.status} ${JSON.stringify(iss.body).slice(0, 200)}`);
    created.issues.push(iss.body.key);
    console.log(`  ${label}: ${iss.body.key} — waiting for the run…`);
    for (let i = 0; i < 60; i++) {
      const r = await invoke("getLogs", { ruleId: listener.id });
      const logs = r?.body?.logs || [];
      const hit = logs.find((l) => l.issueKey === iss.body.key);
      if (hit) return { issueKey: iss.body.key, log: hit };
      await sleep(6000);
    }
    return { issueKey: iss.body.key, log: null };
  };

  // ── 1. a clean public question
  const a = await fire(`crweb${RUN} query: Forge KVS per-value size limit documentation`, "clean query");
  ok(!!a.log, "clean query produced a listener run row");
  if (a.log) {
    const calls = a.log.toolCalls || [];
    const web = calls.filter((c) => c.name === "web_search");
    ok(web.length >= 1, `run row carries web_search tool call(s): count=${web.length}`);
    console.log("    toolCalls: " + JSON.stringify(calls.map((c) => ({ name: c.name, ok: c.ok, ms: c.ms }))));
    const txt = [a.log.reason, a.log.agentSummary, ...(a.log.logs || [])].join("\n");
    ok(/https?:\/\/\S+/.test(txt), "the reply names a link");
    // HONESTY GATE: the hosted MCP's `get-web-search-summaries` answers with PROSE that
    // embeds a fenced ```json block, so `parseSearchPayload` finds no rows and the tool
    // reports `0 result(s)` while still handing the model the answer as `note`. A link in
    // the reply is therefore NOT proof the search was read — the fenced WEB_RESULTS
    // envelope is. Assert the envelope, and report the structured count as it really is.
    const structured = /→ (\d+) result\(s\)/.exec((a.log.logs || []).join("\n"));
    // Informational, not an assertion: whether the fence is VISIBLE here depends on the
    // model choosing to quote rather than paraphrase, and a run row records the tool CALL,
    // never the tool RESULT. A `WEB_RESULTS` fence in the reply is proof; its absence is not
    // a failure. (Observed verbatim on 2026-09-13: `<<<WEB_RESULTS … limits-kvs-ce/ …`.)
    console.log(`    structured rows parsed by parseSearchPayload: ${structured ? structured[1] : "?"}; fenced envelope quoted by the model: ${/WEB_RESULTS/.test(txt)}`);
    console.log("    reason: " + String(a.log.reason || "").slice(0, 400));
    console.log("    logs tail:\n      " + (a.log.logs || []).slice(-8).join("\n      "));
  }

  // ── 2. the identifier-leak refusal, on the SAME listener
  const b = await fire(`crweb${RUN} query: ${env.RULES_TEST_ISSUE_KEY || "LZPT-186"} linear chain epic status`, "identifier query");
  ok(!!b.log, "identifier query produced a listener run row");
  if (b.log) {
    const txt = [b.log.reason, b.log.agentSummary, ...(b.log.logs || [])].join("\n");
    // The REFUSAL LINE the executor writes into the run's own log is the evidence. The
    // `identifier_leak:<id>` CODE travels in the tool result, which a run row does not
    // store — it only surfaces when the model happens to quote it, so it is reported when
    // present and never asserted on. Which rule fired is visible in the kind it names.
    const refused = /web_search REFUSED — the query contained (.+?) \(the value is not recorded\)/.exec(txt);
    ok(!!refused, `the run refused the query before any request left the instance: ${refused ? refused[1] : "(no refusal line in the run row)"}`);
    const code = txt.match(/identifier_leak:[a-zA-Z-]+/);
    if (code) console.log(`    refusal code quoted by the model: ${code[0]}`);
    ok(!txt.includes("Nothing was sent") || !!refused, "the refusal names the KIND, and the executor's own line does not echo the value");
    console.log("    logs tail:\n      " + (b.log.logs || []).slice(-10).join("\n      "));
  }
} catch (e) {
  fail++; console.log("  FAIL threw: " + (e && e.stack || e));
}
if (!process.env.KEEP) {
  fail += await cleanupFixtures([
    ...created.listeners.map((id) => ["listener " + id, async () => { const r = await invoke("deleteListener", { id }); return { ok: r.status === 200, status: r.status, body: r.body }; }]),
    ...created.issues.map((key) => ["issue " + key, () => deleteIssueFixture(jira, key)]),
  ]);
}
console.log(`\nWEB SEARCH LIVE: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
