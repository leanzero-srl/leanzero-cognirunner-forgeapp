/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// FOCUSED PROBE for finding F-006: do the three avi:jsm-entity:*:request-type events reach
// the app at all?
//
// The JSM E2E showed a listener subscribed to those three events recording ZERO runs after a
// successful REST create (201) + delete (204), while issue events on the same project ran
// normally. `forge logs --since` would not return the exact minutes, so "did the trigger even
// fire" was left unproven. This script settles the app half of the question with two listeners
// that cannot both be wrong:
//
//   A. TARGETED — subscribed to exactly the three jsm-entity events, no project filter.
//   B. CATCH-ALL — subscribed to EVERY catalogued event, no project filter, ignoreSelf OFF.
//
// Both append to a ledger issue. Then it fires a request-type create + delete and polls both
// listeners' execution logs for 6 minutes.
//
//   both silent   → the event never reached the app (Forge does not emit it for REST-driven
//                   request-type changes, OR the manifest subscription is not delivering).
//   catch-all only→ the app RECEIVED it and the targeted listener's matching dropped it: an
//                   app bug in candidate selection / filtering.
//   both fired    → the original observation was a timing artefact; re-run the JSM E2E.
//
// Run: node scripts/jsm-entity-probe.mjs      (KEEP=1 keeps the listeners + ledger issue)
//      JSM_PROJECT_KEY=JT overrides the project choice.
import { loadEnv } from "../lib/env.mjs";
import { disposableProject, cleanupFixtures, deleteIssueFixture } from "../lib/fixture-cleanup.mjs";
import { closeRulesApi, rulesApi } from "../lib/rules-api.mjs";
import { EVENT_IDS } from "../../src/shared/jira-events.js";

try {
const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const KEEP = process.env.KEEP === "1";
const RUN = Date.now().toString(36).slice(-5);
const TAG = `crent${RUN}`;
const EXP = { "X-ExperimentalApi": "opt-in" };
const JSM_EVENTS = ["avi:jsm-entity:created:request-type", "avi:jsm-entity:updated:request-type", "avi:jsm-entity:deleted:request-type"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jira = async (method, path, body, extraHeaders = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const must = (r, what) => { if (!r.ok) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };

const created = {listeners:[],issues:[],requestTypes:[]};
let cleanupDeskId;
async function main() {
  console.log(`JSM ENTITY-EVENT PROBE on ${BASE} (run ${RUN})`);

  const proj = await disposableProject(jira, {RULES_TEST_PROJECT_KEY: env.JSM_PROJECT_KEY || "JT"});
  const desks = must(await jira("GET", "/rest/servicedeskapi/servicedesk?limit=50"), "servicedesks").values || [];
  const desk = desks.find((d) => String(d.projectId) === String(proj.id) || d.projectKey === proj.key);
  if (!desk) throw new Error(`no service desk for ${proj.key}`);
  cleanupDeskId = desk.id;
  const perms = must(await jira("GET", `/rest/api/3/mypermissions?projectKey=${proj.key}&permissions=SERVICEDESK_AGENT,ADMINISTER_PROJECTS`), "perms").permissions || {};
  if (!(perms.SERVICEDESK_AGENT || {}).havePermission || !(perms.ADMINISTER_PROJECTS || {}).havePermission) {
    throw new Error(`API user needs SERVICEDESK_AGENT + ADMINISTER_PROJECTS on ${proj.key} — add it to "Service Desk Team" and "Administrators"`);
  }
  console.log(`  project ${proj.key}, service desk ${desk.id}`);

  const types = proj.issueTypes;
  const stdType = types.find((t) => !t.subtask);
  const ledger = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} entity-event ledger` } }), "ledger");
  created.issues.push(ledger.key);
  console.log(`  ledger ${ledger.key}`);

  const mk = (name, events, ignoreSelf) => rulesApi.listeners.create({
    name, events, ignoreSelf,
    functions: [{ name: "record", code: `const e = api.context.event || {};\nawait api.forIssue("${ledger.key}").addComment("${TAG} caught " + api.context.eventType + " entityId=" + (e.entityId || "?"));\nreturn api.context.eventType;` }],
  });
  const targeted = must(await mk(`${TAG} targeted jsm-entity`, JSM_EVENTS, true), "targeted").listener;
  created.listeners.push(targeted.id);
  // The catch-all WRITES NOTHING. With ignoreSelf OFF, a listener that commented would
  // re-trigger itself on avi:jira:commented:issue and spin until the brakes cut it — the
  // execution log is evidence enough, so this step only logs and returns.
  const catchAll = must(await rulesApi.listeners.create({
    name: `${TAG} catch-all ignoreSelf-off (no writes)`, events: EVENT_IDS, ignoreSelf: false,
    functions: [{ name: "observe", code: `api.log("${TAG} observed " + api.context.eventType);\nreturn api.context.eventType;` }],
  }), "catch-all").listener;
  created.listeners.push(catchAll.id);
  console.log(`  targeted ${targeted.id} (3 events) · catch-all ${catchAll.id} (${EVENT_IDS.length} events, ignoreSelf OFF)`);

  console.log("  waiting 40s for the 30s listener-index cache…");
  await sleep(40000);

  const rt = await jira("POST", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype`, { issueTypeId: String(stdType.id), name: `${TAG} probe type`, description: "probe" }, EXP);
  console.log(`  request type create → ${rt.status} (id ${rt.body && rt.body.id})`);
  const firedAt = new Date().toISOString();
  await sleep(3000);
  let delStatus = null;
  if (rt.ok) {
    created.requestTypes.push(rt.body.id);
    const d = await jira("DELETE", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${rt.body.id}`, undefined, EXP);
    delStatus = d.status;
    console.log(`  request type delete → ${d.status}`);
  }

  console.log("  polling both listeners for 6 minutes…");
  let tSeen = []; let cSeen = [];
  for (let i = 0; i < 36; i++) {
    await sleep(10000);
    const t = await rulesApi.logs(targeted.id);
    const c = await rulesApi.logs(catchAll.id);
    tSeen = (t.body && t.body.logs) || [];
    cSeen = (c.body && c.body.logs) || [];
    const cJsm = cSeen.filter((l) => String(l.eventType || l.fieldId || "").startsWith("avi:jsm-entity"));
    process.stdout.write(`\r    t=${tSeen.length} c=${cSeen.length} (jsm-entity in catch-all: ${cJsm.length})   `);
    if (tSeen.length || cJsm.length) break;
  }
  console.log("");

  const cEvents = [...new Set(cSeen.map((l) => l.eventType || l.fieldId).filter(Boolean))];
  const cJsm = cEvents.filter((e) => String(e).startsWith("avi:jsm-entity"));

  console.log(`\n  RESULT (events fired at ${firedAt}; create ${rt.status}, delete ${delStatus})`);
  console.log(`    targeted listener runs : ${tSeen.length}`);
  console.log(`    catch-all listener runs: ${cSeen.length}  distinct events: ${cEvents.join(", ") || "(none)"}`);
  let verdict;
  if (tSeen.length) verdict = "BOTH/TARGETED FIRED — the app receives and matches jsm-entity events. The earlier zero was a timing artefact; re-run test:jsm-assets.";
  else if (cJsm.length) verdict = "APP BUG — the catch-all received a jsm-entity event but the targeted listener did not match it. Candidate selection / filtering drops it.";
  else if (cSeen.length) verdict = "EVENT NEVER ARRIVED — the catch-all was live and caught other events in the window, but no jsm-entity event reached the app. Forge does not deliver these for REST-driven request-type changes (or the subscription is not delivering). NOT an app matching bug.";
  else verdict = "INCONCLUSIVE — the catch-all caught nothing at all, so the probe cannot separate 'no event' from 'listener not live'. Re-run and generate unrelated traffic (create an issue) to prove the catch-all is live.";
  console.log(`\n  VERDICT: ${verdict}`);

}
try { await main(); } catch (e) { console.error("FATAL:", e?.stack || e); process.exitCode = 1; }
finally {
  if (!KEEP) await cleanupFixtures([
    ...created.listeners.map(id => [`listener ${id}`, () => rulesApi.listeners.remove(id)]),
    ...created.requestTypes.map(id => [`request type ${id}`, () => jira("DELETE", `/rest/servicedeskapi/servicedesk/${cleanupDeskId}/requesttype/${id}`, undefined, EXP)]),
    ...created.issues.map(key => [`issue ${key}`, () => deleteIssueFixture(jira, key)]),
  ]);
}
} finally { await closeRulesApi(); }
