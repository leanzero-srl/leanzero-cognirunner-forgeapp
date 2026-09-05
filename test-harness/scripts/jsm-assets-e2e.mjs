/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE E2E for the JIRA SERVICE MANAGEMENT + ASSETS surface (wolfaenpak, JSM Premium).
//
// What the other live scripts do NOT cover:
//   1. The three avi:jsm-entity:*:request-type events — listeners-e2e could never fire them
//      (the API user was not a service-desk agent). Needs SERVICEDESK_AGENT + ADMINISTER_PROJECTS
//      on the JSM project; this script asserts that gate up front and says exactly what is missing.
//   2. A real customer request raised through /rest/servicedeskapi/request → the issue events a
//      listener sees for a JSM ticket (project key, request type, reporter).
//   3. The JSM-only sandbox capability: api.addComment(text, { properties: [{ key:
//      "sd.public.comment", value: { internal: true } }] }) — the INTERNAL note. Asserted through
//      the *portal* comment API (public:false), not just through Jira's comment list.
//   4. The same thing through the AI AGENT surface (add_comment { internal: true }).
//   5. ASSETS (JSM Premium): workspace + object schema + objects over the Assets REST API, an
//      Assets object custom field wired to the JSM screens, and — when the field has been given
//      an object-schema configuration in the UI — the value actually landing on an issue and
//      CogniRunner's extractor reading it from inside a listener.
//
// Run: node scripts/jsm-assets-e2e.mjs        (KEEP=1 keeps the listeners + issues)
//      JSM_PROJECT_KEY=JT overrides the project choice.
//
// Env: JIRA_* (site + admin token) and TESTSTATE_URL + HARNESS_SECRET (or RULES_API_URL/TOKEN).
import { loadEnv } from "../lib/env.mjs";
import { rulesApi, waitForLogs } from "../lib/rules-api.mjs";

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const KEEP = process.env.KEEP === "1";
const RUN = Date.now().toString(36).slice(-5);
const TAG = `crjsm${RUN}`;

let pass = 0; let fail = 0; let skip = 0; const notes = [];
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } return !!c; };
const skipped = (msg) => { skip++; console.log("  ⊘ SKIP " + msg); notes.push("SKIPPED: " + msg); };
const note = (m) => { notes.push(m); console.log("  · " + m); };
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
const EXP = { "X-ExperimentalApi": "opt-in" };

// Assets lives on api.atlassian.com, NOT on the site host.
let ASSETS_BASE = null;
const assets = async (method, path, body) => {
  const res = await fetch(`${ASSETS_BASE}${path}`, {
    method,
    headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};

const created = { listeners: [], issues: [], requestTypes: [], fields: [] };

async function main() {
  console.log(`JSM + ASSETS E2E on ${BASE} (run ${RUN})`);

  // ── 0. Project + permission gate ────────────────────────────────────────────
  const projects = must(await jira("GET", "/rest/api/3/project/search?maxResults=100"), "projects").values || [];
  const wanted = process.env.JSM_PROJECT_KEY || env.JSM_PROJECT_KEY || null;
  let proj = wanted ? projects.find((p) => p.key === wanted) : null;
  if (!proj) {
    // mypermissions LIES on demo service projects (CREATE_ISSUES:true, create 400s).
    // createmeta is the honest probe — it lists only what this user can really create.
    for (const p of projects.filter((x) => x.projectTypeKey === "service_desk")) {
      const cm = await jira("GET", `/rest/api/3/issue/createmeta/${p.key}/issuetypes`);
      const usable = cm.ok && (cm.body.issueTypes || cm.body.values || []).filter((t) => !t.subtask);
      if (usable && usable.length) { proj = p; break; }
      note(`${p.key}: createmeta offers no creatable issue type for the API user — skipped`);
    }
  }
  if (!proj) throw new Error("no JSM (service_desk) project this user can create issues in");
  console.log(`  JSM project ${proj.key} (${proj.name}${proj.simplified ? ", team-managed" : ", company-managed"})`);

  const desks = must(await jira("GET", "/rest/servicedeskapi/servicedesk?limit=50"), "servicedesks").values || [];
  const desk = desks.find((d) => String(d.projectId) === String(proj.id) || d.projectKey === proj.key);
  ok(!!desk, `service desk resolved (id ${desk && desk.id})`);

  const perms = must(await jira("GET", `/rest/api/3/mypermissions?projectKey=${proj.key}&permissions=SERVICEDESK_AGENT,ADMINISTER_PROJECTS,CREATE_ISSUES`), "mypermissions").permissions || {};
  const isAgent = !!(perms.SERVICEDESK_AGENT && perms.SERVICEDESK_AGENT.havePermission);
  const isProjAdmin = !!(perms.ADMINISTER_PROJECTS && perms.ADMINISTER_PROJECTS.havePermission);
  ok(isAgent, `API user is a service-desk AGENT on ${proj.key}`);
  ok(isProjAdmin, `API user administers ${proj.key} (needed for request-type CRUD)`);
  if (!isAgent || !isProjAdmin) {
    note(`FIX: add the API user to ${proj.key}'s "Service Desk Team" + "Administrators" project roles ` +
      `(POST /rest/api/3/project/${proj.key}/role/{roleId} { "user": ["<accountId>"] }). Request-type events cannot fire without it.`);
  }

  const types = must(await jira("GET", `/rest/api/3/project/${proj.id}`), "project").issueTypes || [];
  const stdType = types.find((t) => !t.subtask && /task|request|incident/i.test(t.name)) || types.find((t) => !t.subtask);

  // ── ledger issue: one comment per caught event (append-only; not the 50-entry log window) ──
  const ledger = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} JSM event ledger` } }), "create ledger");
  created.issues.push(ledger.key);
  console.log(`  ledger issue ${ledger.key}`);

  // ── 1. Listeners ────────────────────────────────────────────────────────────
  const JSM_EVENTS = ["avi:jsm-entity:created:request-type", "avi:jsm-entity:updated:request-type", "avi:jsm-entity:deleted:request-type"];
  const entityL = must(await rulesApi.listeners.create({
    name: `JSM entity events ${RUN}`, description: "records jsm-entity events on the ledger", events: JSM_EVENTS, ignoreSelf: true,
    functions: [{ name: "record", code: `const e = api.context.event || {};\nawait api.forIssue("${ledger.key}").addComment("caught " + api.context.eventType + " entityId=" + (e.entityId || "?"));\nreturn api.context.eventType;` }],
  }), "create entity listener").listener;
  created.listeners.push(entityL.id);
  ok(!!entityL.id, `listener on the 3 jsm-entity events (id ${entityL.id})`);

  const createdL = must(await rulesApi.listeners.create({
    name: `JSM issue created ${RUN}`, events: ["avi:jira:created:issue"], filters: { projectKeys: [proj.key] },
    functions: [{ name: "label", code: `const f = (await api.getIssue(api.context.issueKey)).fields || {};\nawait api.addLabels("${TAG}-created");\nawait api.setProperty("${TAG}-jsm", { key: api.context.issueKey, requestType: (f.customfield_10010 && (f.customfield_10010.requestType || {}).name) || null, reporter: (f.reporter || {}).displayName || null, project: (f.project || {}).key || null });\nreturn "ok";` }],
  }), "create createdL").listener;
  created.listeners.push(createdL.id);

  // The JSM-only sandbox capability: an INTERNAL note (not visible to the customer).
  const internalL = must(await rulesApi.listeners.create({
    name: `JSM internal note ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key], commentPattern: `${TAG}-needsnote` },
    functions: [{ name: "note", code: `await api.addComment("${TAG} internal note — agents only", { properties: [{ key: "sd.public.comment", value: { internal: true } }] });\nawait api.addComment("${TAG} public reply — customer visible");\nreturn "commented";` }],
  }), "create internalL").listener;
  created.listeners.push(internalL.id);

  // Same thing through the AI agent surface.
  const agentL = must(await rulesApi.listeners.create({
    name: `JSM agent internal note ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key], commentPattern: `${TAG}-agentnote` },
    mode: "agent",
    agent: {
      instructions: `Add ONE internal note (internal = true) to this issue whose text contains exactly "${TAG} agent internal". Do not post a public comment. Then finish.`,
      allowedActions: ["get_issue", "add_comment"], maxRounds: 3,
    },
  }), "create agentL").listener;
  created.listeners.push(agentL.id);

  await sleep(35000); // the trigger's listener index is cached 30s per warm container

  // ── 2. Request-type events ──────────────────────────────────────────────────
  let rtId = null;
  if (desk && isAgent && isProjAdmin) {
    const rt = await jira("POST", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype`, { issueTypeId: String(stdType.id), name: `${TAG} request type`, description: "harness", helpText: "harness" }, EXP);
    if (ok(rt.ok, `request type created over REST (${rt.status})`)) { rtId = rt.body.id; created.requestTypes.push(rtId); }
    else note(`request type create → ${rt.status} ${JSON.stringify(rt.body).slice(0, 200)}`);
    // There is NO REST update for a request type (PUT → 405), so the "updated" event is UI-only.
    if (rtId) {
      const upd = await jira("PUT", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${rtId}`, { name: `${TAG} renamed` }, EXP);
      if (upd.status === 405 || upd.status === 404) skipped(`avi:jsm-entity:updated:request-type — no REST update for request types (PUT → ${upd.status}); UI-only`);
      else ok(upd.ok, `request type updated over REST (${upd.status})`);
      // Delete it NOW, not at cleanup: both entity events then have the whole run
      // (~4 min) to arrive, instead of firing after the last assertion.
      const rdl = await jira("DELETE", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${rtId}`, undefined, EXP);
      if (ok(rdl.ok || rdl.status === 204, `request type deleted over REST (${rdl.status})`)) created.requestTypes.length = 0;
    }
  } else {
    skipped("request-type events — the API user is not an agent/admin on the JSM project");
  }

  // ── 3. A real customer request through the portal API ────────────────────────
  let requestKey = null;
  if (desk) {
    const rts = must(await jira("GET", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype?limit=50`), "request types").values || [];
    // Use a PRE-EXISTING request type: one created over REST carries only `summary`,
    // and /request 400s on any field the type does not declare.
    const useRt = rts.find((r) => String(r.id) !== String(rtId)) || rts[0];
    if (useRt) {
      const rtFields = await jira("GET", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${useRt.id}/field`);
      const declared = new Set(((rtFields.body && rtFields.body.requestTypeFields) || []).map((f) => f.fieldId));
      const requestFieldValues = { summary: `${TAG} portal request` };
      if (declared.has("description")) requestFieldValues.description = "Raised by the CogniRunner harness over the portal API.";
      const req = await jira("POST", "/rest/servicedeskapi/request", {
        serviceDeskId: String(desk.id), requestTypeId: String(useRt.id), requestFieldValues,
      });
      if (ok(req.ok, `customer request raised through /rest/servicedeskapi/request (${req.status}, type "${useRt.name}")`)) {
        requestKey = req.body.issueKey; created.issues.push(requestKey);
        console.log(`  request ${requestKey}`);
      } else note(`request create → ${req.status} ${JSON.stringify(req.body).slice(0, 250)}`);
    } else skipped("portal request — no request type available");
  }

  // Fall back to a plain issue so the comment tests still run.
  const target = requestKey || must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} comment target` } }), "create target").key;
  if (!requestKey) created.issues.push(target);

  // ── 4. Internal vs public comments ──────────────────────────────────────────
  must(await jira("POST", `/rest/api/3/issue/${target}/comment`, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `${TAG}-needsnote please investigate` }] }] } }), "trigger comment");
  must(await jira("POST", `/rest/api/3/issue/${target}/comment`, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `${TAG}-agentnote please investigate` }] }] } }), "agent trigger comment");

  // ── 5. Assets ───────────────────────────────────────────────────────────────
  console.log("\n  ASSETS");
  const ws = await jira("GET", "/rest/servicedeskapi/assets/workspace");
  const workspaceId = ws.ok && ws.body.values && ws.body.values[0] && ws.body.values[0].workspaceId;
  if (!ok(!!workspaceId, `Assets workspace reachable (${workspaceId || ws.status}) — JSM Premium`)) {
    skipped("all Assets checks — no Assets workspace (Premium not active?)");
  } else {
    ASSETS_BASE = `https://api.atlassian.com/jsm/assets/workspace/${workspaceId}/v1`;
    const schemas = await assets("GET", "/objectschema/list");
    ok(schemas.ok, `Assets object schemas listed (${(schemas.body && schemas.body.values || []).length})`);
    let schema = (schemas.body.values || []).find((s) => s.objectSchemaKey === "CRT");
    if (!schema) {
      const c = await assets("POST", "/objectschema/create", { name: "CogniRunner Test Assets", objectSchemaKey: "CRT", description: "harness test schema" });
      if (c.ok) schema = c.body; else note(`objectschema create → ${c.status} ${JSON.stringify(c.body).slice(0, 200)}`);
    }
    ok(!!schema, `Assets schema CRT present (id ${schema && schema.id})`);

    let objects = [];
    if (schema) {
      const flat = await assets("GET", `/objectschema/${schema.id}/objecttypes/flat`);
      let objType = (flat.body || []).find((t) => t.name === "Laptop");
      if (!objType) {
        const icons = await assets("GET", "/icon/global");
        const icon = (icons.body || []).find((i) => /laptop|computer/i.test(i.name)) || (icons.body || [])[0];
        const c = await assets("POST", "/objecttype/create", { name: "Laptop", objectSchemaId: String(schema.id), iconId: String(icon.id), description: "harness laptops" });
        if (c.ok) objType = c.body;
      }
      ok(!!objType, `Assets object type Laptop present (id ${objType && objType.id})`);
      if (objType) {
        const aql = await assets("POST", "/object/aql?startAt=0&maxResults=10", { qlQuery: `objectTypeId = ${objType.id}` });
        objects = (aql.body && aql.body.values) || [];
        if (!objects.length) {
          const attrs = await assets("GET", `/objecttype/${objType.id}/attributes`);
          const nameAttr = (attrs.body || []).find((a) => a.name === "Name");
          const c = await assets("POST", "/object/create", { objectTypeId: String(objType.id), attributes: [{ objectTypeAttributeId: String(nameAttr.id), objectAttributeValues: [{ value: "MacBook Pro 16 (harness)" }] }] });
          if (c.ok) objects = [c.body];
        }
        ok(objects.length > 0, `Assets objects available (${objects.length}; e.g. ${objects[0] && objects[0].objectKey} "${objects[0] && objects[0].label}")`);
      }
    }

    // The Assets object CUSTOM FIELD.
    const allFields = must(await jira("GET", "/rest/api/3/field"), "fields");
    const assetFields = allFields.filter((f) => f.schema && f.schema.custom === "com.atlassian.jira.plugins.cmdb:cmdb-object-cftype");
    const assetField = assetFields.find((f) => f.name === "COGTEST Asset") || assetFields[0];
    if (!ok(!!assetField, `Assets object custom field exists (${assetField && assetField.id} "${assetField && assetField.name}")`)) {
      note("create one with POST /rest/api/3/field { type: 'com.atlassian.jira.plugins.cmdb:cmdb-object-cftype' } and add it to the JSM screens");
    } else {
      ok(assetField.schema.items === "cmdb-object-field", `field schema is array/cmdb-object-field (${assetField.schema.type}/${assetField.schema.items})`);
      // A 204 can also hide an invalid payload: use the documented update/set identifiers,
      // then verify the exact object. An empty read alone cannot diagnose field configuration.
      // https://support.atlassian.com/jira/kb/format-the-payload-to-update-assets-custom-fields-via-rest-api/
      const objectId = objects[0] && String(objects[0].id);
      if (objectId) {
        const expected = { workspaceId, id: `${workspaceId}:${objectId}`, objectId };
        const w = await jira("PUT", `/rest/api/3/issue/${target}`, { update: { [assetField.id]: [{ set: [expected] }] } });
        ok(w.ok, `Assets field update accepted (${w.status})`);
        const rb = await jira("GET", `/rest/api/3/issue/${target}?fields=${assetField.id}`);
        const value = rb.ok && rb.body.fields && rb.body.fields[assetField.id];
        const persisted = Array.isArray(value) && value.length === 1 &&
          Object.entries(expected).every(([key, val]) => value[0][key] === val);
        if (ok(persisted, `Assets field persisted the exact selected object on ${target}`)) {
          ok(true, `Assets value stored on ${target}: ${JSON.stringify(value).slice(0, 200)}`);
          console.log(`  REAL ASSETS VALUE SHAPE: ${JSON.stringify(value[0])}`);
          // Prove CogniRunner reads it: a listener that extracts the field into a property.
          const assetsL = must(await rulesApi.listeners.create({
            name: `JSM assets read ${RUN}`, events: ["avi:jira:updated:issue"], filters: { projectKeys: [proj.key], changedFields: ["labels"], jql: `key = ${target}` },
            functions: [{ name: "readasset", code: `const f = (await api.getIssue(api.context.issueKey)).fields || {};\nawait api.setProperty("${TAG}-asset", { raw: f["${assetField.id}"] || null });\nreturn "ok";` }],
          }), "create assetsL").listener;
          created.listeners.push(assetsL.id);
          await sleep(35000);
          await jira("PUT", `/rest/api/3/issue/${target}`, { update: { labels: [{ add: `${TAG}-assetping` }] } });
          const seen = await waitForLogs(assetsL.id, (logs) => logs.length > 0, { tries: 24 });
          if (ok(seen.ok, "listener ran and read the Assets field through api.getIssue")) {
            const prop = await jira("GET", `/rest/api/3/issue/${target}/properties/${TAG}-asset`);
            const raw = prop.body && prop.body.value && prop.body.value.raw;
            ok(prop.ok && JSON.stringify(raw) === JSON.stringify(value), `Exact Assets value visible inside the sandbox: ${JSON.stringify(raw).slice(0, 200)}`);
          }
        } else {
          note(`Assets value mismatch (GET ${rb.status}, value ${JSON.stringify(value)}). Inspect field schema/AQL, ` +
            `screen applicability and permissions; this is a failed write proof, not evidence of a specific cause.`);
        }
      } else skipped("Assets field write — no Assets object to reference");
    }
  }

  // ── 6. Wait for the comment-driven listeners ────────────────────────────────
  console.log("\n  waiting for listener runs (Forge events can take ~3 min)…");
  const entityRan = await waitForLogs(entityL.id, (l) => l.length > 0, { tries: 48 });
  if (rtId) {
    if (entityRan.ok) {
      ok(true, `jsm-entity request-type listener ran (${entityRan.logs.length} entries: ${entityRan.logs.map((l) => l.fieldId || l.eventType).join(", ")})`);
    } else {
      // SELF-DIAGNOSING: `captureSample` in listeners.js runs BEFORE every filter, the candidate
      // slice, the brakes and the enqueue — so a stored sample proves the trigger was invoked for
      // this event type. No runs + no sample = Forge never delivered the event (platform, F-006).
      // No runs + a sample = the app received it and dropped it, which IS an app bug and must fail.
      const s = await rulesApi.sample("avi:jsm-entity:created:request-type");
      const sampled = s.status === 200 && s.body && (s.body.sample || s.body.payload || s.body.event);
      if (sampled) {
        ok(false, "APP BUG: a jsm-entity payload sample was captured (so the trigger DID fire) but no listener run was queued — candidate selection or filtering dropped it");
      } else {
        skipped("avi:jsm-entity:created/deleted:request-type never reached the app — REST create (201) + delete (204) " +
          "produced no listener run AND no captured payload sample, while other events in the same window did. " +
          "Forge does not deliver these for REST-driven request-type changes (finding F-006, platform-side). " +
          "This assertion flips to a FAILURE the moment a sample appears without a run.");
      }
    }
  }
  const createdRan = await waitForLogs(createdL.id, (l) => l.length > 0, { tries: 12 });
  ok(createdRan.ok, `created:issue listener ran on the JSM project (${createdRan.logs.length} entries)`);
  const internalRan = await waitForLogs(internalL.id, (l) => l.length > 0, { tries: 24 });
  ok(internalRan.ok, `internal-note listener ran (${internalRan.logs.length} entries)`);
  const agentRan = await waitForLogs(agentL.id, (l) => l.length > 0, { tries: 24 });
  ok(agentRan.ok, `AI-agent internal-note listener ran (${agentRan.logs.length} entries)`);
  // The agent's summary rides the log entry's `reason` ("Agent done: <summary>") — there is no
  // `message` or `result` field on a log entry (those are REST response envelopes). Reading the
  // wrong name printed an empty summary for a run that had demonstrably worked. listeners-e2e
  // already reads `reason`; keep the two suites reading the same field.
  if (agentRan.ok) {
    const summary = String((agentRan.logs[0] || {}).reason || "").slice(0, 200);
    ok(/^Agent /.test(summary), `AI-agent run summary persisted: ${summary || "(empty)"}`);
  }

  // ── 7. Assert the JSM-visible outcome (portal comment API is the real judge) ─
  const jsmComments = await jira("GET", `/rest/servicedeskapi/request/${target}/comment?expand=body&limit=50&public=true&internal=true`);
  const cvals = (jsmComments.body && jsmComments.body.values) || [];
  const textOf = (c) => JSON.stringify((c.body && (c.body.content || c.body)) || c.body || "");
  const internalNote = cvals.find((c) => c.public === false && textOf(c).includes(`${TAG} internal note`));
  const publicReply = cvals.find((c) => c.public === true && textOf(c).includes(`${TAG} public reply`));
  ok(!!internalNote, "sandbox addComment(properties sd.public.comment internal) produced an INTERNAL note (public:false)");
  ok(!!publicReply, "a plain sandbox addComment stays PUBLIC (public:true) on a JSM request");
  const agentNote = cvals.find((c) => c.public === false && textOf(c).includes(`${TAG} agent internal`));
  ok(!!agentNote, "AI agent add_comment { internal: true } produced an INTERNAL note");
  if (!cvals.length) note(`portal comment API returned ${jsmComments.status} ${JSON.stringify(jsmComments.body).slice(0, 200)} — ${target} may not be a portal request`);

  // property written by the created:issue listener
  if (requestKey) {
    const p = await jira("GET", `/rest/api/3/issue/${requestKey}/properties/${TAG}-jsm`);
    ok(p.ok && p.body.value && p.body.value.project === proj.key, `listener saw the JSM issue context: ${JSON.stringify(p.body && p.body.value)}`);
  }

  // ── cleanup ─────────────────────────────────────────────────────────────────
  if (!KEEP) {
    for (const id of created.listeners) await rulesApi.listeners.remove(id);
    if (desk) for (const id of created.requestTypes) await jira("DELETE", `/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${id}`, undefined, EXP);
    for (const k of created.issues) { const d = await jira("DELETE", `/rest/api/3/issue/${k}`); if (!d.ok) note(`issue delete ${k} → ${d.status}`); }
    console.log("  cleaned up listeners + test data");
  } else console.log(`  KEEP=1 — kept ${created.listeners.length} listeners, ${created.issues.length} issues`);

  console.log("\nNOTES:");
  for (const n of notes) console.log("  - " + n);
  console.log(`\nJSM + ASSETS E2E: ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e && e.stack || e); process.exit(1); });
