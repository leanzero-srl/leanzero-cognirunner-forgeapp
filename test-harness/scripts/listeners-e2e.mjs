/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE E2E for Listeners against a real Jira Cloud site (wolfaenpak test instance).
//
// 1. Pushes listeners through the Rules REST API (a catch-all over EVERY catalogued event,
//    plus targeted script / AI-agent / AI-condition / changed-field listeners).
// 2. Fires as many Jira product events as REST can produce: issue created/updated/assigned/
//    commented/mentioned/deleted, worklog + attachment + link create/update/delete, versions,
//    components, filters, boards + sprints (when an agile board exists), issue types, custom
//    fields (+ contexts), projects (create/update/trash/restore/delete), global configuration,
//    time-tracking provider, JSM request types (when a service project exists).
// 3. Polls the execution logs through the REST API and asserts per event type + the real
//    side effects (labels / comments) on the test issue. Prints an event coverage matrix.
//
// Run: node scripts/listeners-e2e.mjs            (KEEP=1 keeps the listeners + test data)
//      SKIP_ADMIN=1 skips project/field/issue-type/config events (slower, admin-heavy).
import { loadEnv } from "../lib/env.mjs";
import { rulesApi, waitForLogs, ensureRulesApi } from "../lib/rules-api.mjs";
import { EVENT_IDS } from "../../src/shared/jira-events.js";

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const KEEP = process.env.KEEP === "1";
const SKIP_ADMIN = process.env.SKIP_ADMIN === "1";
const RUN = Date.now().toString(36).slice(-5);
const TAG = `cre2e${RUN}`;

let pass = 0; let fail = 0; const notes = [];
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };
const note = (m) => { notes.push(m); console.log("  · " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jira = async (method, path, body, extraHeaders = {}) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...extraHeaders }, body: body instanceof FormData ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const must = (r, what) => { if (!r.ok) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const adf = (text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const created = { listeners: [], issues: [], versions: [], components: [], filters: [], boards: [], sprints: [], issueTypes: [], fields: [], projects: [], requestTypes: [] };
const fired = new Set(); // events we believe we fired

async function main() {
  console.log(`LISTENERS E2E on ${BASE} (run ${RUN})`);
  const me = must(await jira("GET", "/rest/api/3/myself"), "myself");
  const who = await rulesApi.whoami();
  ok(who.ok && who.body.token, `REST API auth works (token ${who.body && who.body.token && who.body.token.prefix}…)`);
  const cat = await rulesApi.events();
  ok(cat.ok && cat.body.events.length === EVENT_IDS.length, `event catalogue served over REST (${cat.body && cat.body.events && cat.body.events.length} events)`);
  const bad = await fetch(`${(await ensureRulesApi()).url}?resource=listeners`, { headers: { Authorization: "Bearer cgr_" + "0".repeat(48) } });
  ok(bad.status === 401, "bad token → 401");

  // ── test bed: a project + a scrum board if possible ──
  const projects = must(await jira("GET", "/rest/api/3/project/search?maxResults=100"), "projects").values || [];
  const proj = projects.find((p) => p.key === (env.COGTEST_PROJECT_KEY || "COGTEST")) || projects.find((p) => p.key === "LZPT") || projects.find((p) => p.projectTypeKey === "software") || projects[0];
  if (!proj) throw new Error("no project available on the site");
  console.log(`  using project ${proj.key} (${proj.name}, ${proj.projectTypeKey})`);
  const types = must(await jira("GET", `/rest/api/3/project/${proj.id}`), "project").issueTypes || [];
  const stdType = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask);
  const subType = types.find((t) => t.subtask);
  const jsmProject = projects.find((p) => p.projectTypeKey === "service_desk");

  // ── ledger issue: the catch-all appends one comment per caught event (append-only, no
  // race, not subject to the app's 50-entry log window). Its own comments are app-generated
  // (selfGenerated) and ignored by every listener (ignoreSelf), so it cannot loop. ──
  const ledger = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} event ledger` } }), "create ledger");
  created.issues.push(ledger.key);
  console.log(`  ledger issue ${ledger.key}`);

  // ── listeners ──
  const catchAll = must(await rulesApi.listeners.create({
    name: `E2E catch-all ${RUN}`, description: "records every event on the ledger issue", events: EVENT_IDS, ignoreSelf: true,
    functions: [{ name: "record", code: `await api.forIssue("${ledger.key}").addComment("caught " + api.context.eventType + " " + (api.context.issueKey || "(no issue)"));\nreturn api.context.eventType;` }],
  }).then((r) => ({ ok: r.ok, body: r.body, status: r.status })), "create catch-all").listener;
  created.listeners.push(catchAll.id);
  ok(catchAll.events.length === EVENT_IDS.length, `catch-all listener subscribed to all ${EVENT_IDS.length} events (id ${catchAll.id})`);

  const onCreate = must(await rulesApi.listeners.create({
    name: `E2E created→label ${RUN}`, events: ["avi:jira:created:issue"], filters: { projectKeys: [proj.key] },
    functions: [{ name: "label", code: `await api.addLabels("${TAG}-created");\nreturn "labelled";` }],
  }), "create onCreate").listener;
  created.listeners.push(onCreate.id);
  const onPriority = must(await rulesApi.listeners.create({
    name: `E2E priority-changed→comment ${RUN}`, events: ["avi:jira:updated:issue"], filters: { projectKeys: [proj.key], changedFields: ["priority"] },
    functions: [{ name: "comment", code: `const it = (api.context.event.changelog.items || []).find((i) => i.field === "priority");\nawait api.addComment("${TAG}: priority changed " + (it ? it.fromString + " → " + it.toString : "?"));\nreturn true;` }],
  }), "create onPriority").listener;
  created.listeners.push(onPriority.id);
  const onRefund = must(await rulesApi.listeners.create({
    name: `E2E AI-condition refund ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key], commentPattern: TAG },
    aiCondition: "the comment asks for a refund or money back",
    functions: [{ name: "label", code: `await api.addLabels("${TAG}-refund");\nreturn true;` }],
  }), "create onRefund").listener;
  created.listeners.push(onRefund.id);
  const onAgent = must(await rulesApi.listeners.create({
    name: `E2E AI agent ack ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key], commentPattern: `${TAG}-agentping` },
    mode: "agent", agent: { instructions: `Add the label "${TAG}-agent" to the issue and reply with a comment that contains exactly the text "${TAG} agent acknowledged". Then finish.`, allowedActions: ["get_issue", "add_comment", "add_labels"], maxRounds: 4 },
  }), "create onAgent").listener;
  created.listeners.push(onAgent.id);
  const onVersion = must(await rulesApi.listeners.create({
    name: `E2E version released→comment ${RUN}`, events: ["avi:jira:released:version"], filters: { projectKeys: [proj.key] },
    functions: [{ name: "announce", code: `const v = api.context.event.version || {};\nawait api.forIssue("${ledger.key}").addComment("${TAG}: version released " + v.name);\nreturn v.name;` }],
  }), "create onVersion").listener;
  created.listeners.push(onVersion.id);
  const disabledOne = must(await rulesApi.listeners.create({ name: `E2E disabled ${RUN}`, events: ["avi:jira:created:issue"], enabled: false, functions: [{ name: "x", code: `await api.addLabels("${TAG}-should-not-appear");` }] }), "create disabled").listener;
  created.listeners.push(disabledOne.id);
  const listed = await rulesApi.listeners.list();
  ok(listed.ok && created.listeners.every((id) => listed.body.listeners.some((l) => l.id === id)), "all E2E listeners appear in GET ?resource=listeners");
  const upd = await rulesApi.listeners.update(disabledOne.id, { description: "updated via PUT" });
  ok(upd.ok && upd.body.listener.description === "updated via PUT" && upd.body.listener.enabled === false, "PUT merge-updates a listener and keeps enabled=false");
  const rej = await rulesApi.listeners.create({ name: "bad", events: ["avi:jira:nope"] });
  ok(rej.status === 400 && /events must contain/.test(rej.body.error || (rej.body.errors && rej.body.errors[0] && rej.body.errors[0].error) || ""), `validation error → 400 with message (${rej.status})`);
  await sleep(35000); // let the trigger container's 30s index cache expire
  console.log("  listeners in place; firing events…");

  // ── issue lifecycle ──
  const issue = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} listener bed`, description: adf("created by the listeners E2E") } }), "create issue");
  created.issues.push(issue.key); fired.add("avi:jira:created:issue");
  console.log(`  issue ${issue.key}`);
  const issue2 = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} link target` } }), "create issue2");
  created.issues.push(issue2.key);
  // updated (priority change) + mentioned in description
  const prios = must(await jira("GET", "/rest/api/3/priority"), "priorities");
  const other = prios.find((p) => p.name !== "Medium") || prios[0];
  must(await jira("PUT", `/rest/api/3/issue/${issue.key}`, { fields: { priority: { id: other.id } } }), "update priority"); fired.add("avi:jira:updated:issue");
  must(await jira("PUT", `/rest/api/3/issue/${issue.key}`, { fields: { description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `${TAG} hello ` }, { type: "mention", attrs: { id: me.accountId, text: `@${me.displayName}` } }] }] } } }), "mention in description"); fired.add("avi:jira:mentioned:issue");
  must(await jira("PUT", `/rest/api/3/issue/${issue.key}/assignee`, { accountId: me.accountId }), "assign"); fired.add("avi:jira:assigned:issue");
  // comments: plain (refund → AI condition true), non-refund (AI condition false), agent ping, mention
  const c1 = must(await jira("POST", `/rest/api/3/issue/${issue.key}/comment`, { body: adf(`${TAG} I want my money back, please refund this order`) }), "refund comment"); fired.add("avi:jira:commented:issue");
  const c2 = must(await jira("POST", `/rest/api/3/issue/${issue.key}/comment`, { body: adf(`${TAG} thanks, all good here`) }), "non-refund comment");
  must(await jira("POST", `/rest/api/3/issue/${issue.key}/comment`, { body: adf(`${TAG}-agentping please acknowledge`) }), "agent ping comment");
  must(await jira("POST", `/rest/api/3/issue/${issue.key}/comment`, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: me.accountId, text: `@${me.displayName}` } }, { type: "text", text: ` ${TAG} mention in comment` }] }] } }), "mention comment"); fired.add("avi:jira:mentioned:comment");
  must(await jira("DELETE", `/rest/api/3/issue/${issue.key}/comment/${c2.id}`), "delete comment"); fired.add("avi:jira:deleted:comment");
  // worklog
  const wl = must(await jira("POST", `/rest/api/3/issue/${issue.key}/worklog`, { timeSpentSeconds: 600, comment: adf(`${TAG} worklog`) }), "worklog"); fired.add("avi:jira:created:worklog");
  must(await jira("PUT", `/rest/api/3/issue/${issue.key}/worklog/${wl.id}`, { timeSpentSeconds: 900 }), "worklog update"); fired.add("avi:jira:updated:worklog");
  must(await jira("DELETE", `/rest/api/3/issue/${issue.key}/worklog/${wl.id}`), "worklog delete"); fired.add("avi:jira:deleted:worklog");
  // attachment
  const fd = new FormData(); fd.append("file", new Blob([`${TAG} attachment body`], { type: "text/plain" }), `${TAG}.txt`);
  const att = must(await jira("POST", `/rest/api/3/issue/${issue.key}/attachments`, fd, { "X-Atlassian-Token": "no-check" }), "attachment"); fired.add("avi:jira:created:attachment");
  must(await jira("DELETE", `/rest/api/3/attachment/${att[0].id}`), "attachment delete"); fired.add("avi:jira:deleted:attachment");
  // issue link
  const linkTypes = must(await jira("GET", "/rest/api/3/issueLinkType"), "link types").issueLinkTypes || [];
  const lt = linkTypes.find((t) => /relate/i.test(t.name)) || linkTypes[0];
  if (lt) {
    must(await jira("POST", "/rest/api/3/issueLink", { type: { name: lt.name }, inwardIssue: { key: issue.key }, outwardIssue: { key: issue2.key } }), "link"); fired.add("avi:jira:created:issuelink");
    const links = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=issuelinks`), "links").fields.issuelinks || [];
    for (const l of links) { await jira("DELETE", `/rest/api/3/issueLink/${l.id}`); fired.add("avi:jira:deleted:issuelink"); }
  } else note("no issue link types — link events not fired");
  // versions
  const ver = must(await jira("POST", "/rest/api/3/version", { name: `${TAG}-v1`, projectId: Number(proj.id) }), "version"); created.versions.push(ver.id); fired.add("avi:jira:created:version");
  must(await jira("PUT", `/rest/api/3/version/${ver.id}`, { description: "updated" }), "version update"); fired.add("avi:jira:updated:version");
  must(await jira("PUT", `/rest/api/3/version/${ver.id}`, { released: true }), "version release"); fired.add("avi:jira:released:version");
  must(await jira("PUT", `/rest/api/3/version/${ver.id}`, { released: false }), "version unrelease"); fired.add("avi:jira:unreleased:version");
  must(await jira("PUT", `/rest/api/3/version/${ver.id}`, { archived: true }), "version archive"); fired.add("avi:jira:archived:version");
  must(await jira("PUT", `/rest/api/3/version/${ver.id}`, { archived: false }), "version unarchive"); fired.add("avi:jira:unarchived:version");
  const ver2 = must(await jira("POST", "/rest/api/3/version", { name: `${TAG}-v2`, projectId: Number(proj.id) }), "version2"); created.versions.push(ver2.id);
  const mv = await jira("POST", `/rest/api/3/version/${ver2.id}/move`, { position: "First" }); if (mv.ok) fired.add("avi:jira:moved:version"); else note(`version move → ${mv.status}`);
  const mg = await jira("POST", `/rest/api/3/version/${ver2.id}/removeAndSwap`, { moveFixIssuesTo: Number(ver.id), moveAffectedIssuesTo: Number(ver.id) }); if (mg.ok || mg.status === 204) { fired.add("avi:jira:merged:version"); fired.add("avi:jira:deleted:version"); created.versions = created.versions.filter((v) => v !== ver2.id); } else note(`version merge (removeAndSwap) → ${mg.status} ${JSON.stringify(mg.body).slice(0, 120)}`);
  const vd = await jira("POST", `/rest/api/3/version/${ver.id}/removeAndSwap`, {}); if (vd.ok || vd.status === 204) { fired.add("avi:jira:deleted:version"); created.versions = created.versions.filter((v) => v !== ver.id); } else note(`version delete → ${vd.status} ${JSON.stringify(vd.body).slice(0, 120)}`);
  // components
  const comp = must(await jira("POST", "/rest/api/3/component", { name: `${TAG}-comp`, project: proj.key }), "component"); created.components.push(comp.id); fired.add("avi:jira:created:component");
  must(await jira("PUT", `/rest/api/3/component/${comp.id}`, { description: "updated" }), "component update"); fired.add("avi:jira:updated:component");
  const cd = await jira("DELETE", `/rest/api/3/component/${comp.id}`); if (cd.ok || cd.status === 204) { fired.add("avi:jira:deleted:component"); created.components = []; }
  // filters + boards + sprints
  const filt = must(await jira("POST", "/rest/api/3/filter", { name: `${TAG} filter`, jql: `project = ${proj.key} ORDER BY Rank ASC` }), "filter"); created.filters.push(filt.id); fired.add("avi:jira:created:filter");
  must(await jira("PUT", `/rest/api/3/filter/${filt.id}`, { name: `${TAG} filter`, jql: `project = ${proj.key} ORDER BY Rank ASC`, description: "updated" }), "filter update"); fired.add("avi:jira:updated:filter");
  const board = await jira("POST", "/rest/agile/1.0/board", { name: `${TAG} board`, type: "scrum", filterId: Number(filt.id), location: { type: "project", projectKeyOrId: proj.key } });
  if (board.ok) {
    created.boards.push(board.body.id); fired.add("avi:jira-software:created:board");
    const sp = await jira("POST", "/rest/agile/1.0/sprint", { name: `${TAG} sprint`, originBoardId: board.body.id });
    if (sp.ok) {
      created.sprints.push(sp.body.id); fired.add("avi:jira-software:created:sprint");
      const upd2 = await jira("PUT", `/rest/agile/1.0/sprint/${sp.body.id}`, { name: `${TAG} sprint`, goal: "updated goal" }); if (upd2.ok) fired.add("avi:jira-software:updated:sprint");
      const start = new Date(); const end = new Date(Date.now() + 7 * 86400000);
      const st = await jira("POST", `/rest/agile/1.0/sprint/${sp.body.id}`, { name: `${TAG} sprint`, state: "active", startDate: start.toISOString(), endDate: end.toISOString() });
      if (st.ok) { fired.add("avi:jira-software:started:sprint"); const cl = await jira("POST", `/rest/agile/1.0/sprint/${sp.body.id}`, { name: `${TAG} sprint`, state: "closed" }); if (cl.ok) fired.add("avi:jira-software:closed:sprint"); else note(`sprint close → ${cl.status} ${JSON.stringify(cl.body).slice(0, 120)}`); } else note(`sprint start → ${st.status} ${JSON.stringify(st.body).slice(0, 120)}`);
      const sd = await jira("DELETE", `/rest/agile/1.0/sprint/${sp.body.id}`); if (sd.ok || sd.status === 204) { fired.add("avi:jira-software:deleted:sprint"); created.sprints = []; }
    } else note(`sprint create → ${sp.status} ${JSON.stringify(sp.body).slice(0, 120)}`);
    const bd = await jira("DELETE", `/rest/agile/1.0/board/${board.body.id}`); if (bd.ok || bd.status === 204) { fired.add("avi:jira-software:deleted:board"); created.boards = []; }
  } else note(`board create → ${board.status} ${JSON.stringify(board.body).slice(0, 160)} (board/sprint events not fired)`);
  const fdl = await jira("DELETE", `/rest/api/3/filter/${filt.id}`); if (fdl.ok || fdl.status === 204) { fired.add("avi:jira:deleted:filter"); created.filters = []; }

  if (!SKIP_ADMIN) {
    // issue types
    const it = await jira("POST", "/rest/api/3/issuetype", { name: `${TAG} type`, type: "standard" });
    if (it.ok) {
      created.issueTypes.push(it.body.id); fired.add("avi:jira:created:issuetype");
      const iu = await jira("PUT", `/rest/api/3/issuetype/${it.body.id}`, { description: "updated" }); if (iu.ok) fired.add("avi:jira:updated:issuetype");
      const idl = await jira("DELETE", `/rest/api/3/issuetype/${it.body.id}`); if (idl.ok || idl.status === 204) { fired.add("avi:jira:deleted:issuetype"); created.issueTypes = []; }
    } else note(`issue type create → ${it.status}`);
    // custom field + contexts + configuration
    const cf = await jira("POST", "/rest/api/3/field", { name: `${TAG} field`, type: "com.atlassian.jira.plugin.system.customfieldtypes:select", searcherKey: "com.atlassian.jira.plugin.system.customfieldtypes:multiselectsearcher" });
    if (cf.ok) {
      created.fields.push(cf.body.id); fired.add("avi:jira:created:field");
      const fu = await jira("PUT", `/rest/api/3/field/${cf.body.id}`, { description: "updated" }); if (fu.ok) fired.add("avi:jira:updated:field");
      const ctxs = await jira("GET", `/rest/api/3/field/${cf.body.id}/context`);
      const ctx0 = ctxs.ok && ctxs.body.values && ctxs.body.values[0];
      const nc = await jira("POST", `/rest/api/3/field/${cf.body.id}/context`, { name: `${TAG} ctx`, projectIds: [String(proj.id)], issueTypeIds: [] });
      if (nc.ok) {
        fired.add("avi:jira:created:field:context");
        const cu = await jira("PUT", `/rest/api/3/field/${cf.body.id}/context/${nc.body.id}`, { name: `${TAG} ctx renamed` }); if (cu.ok) fired.add("avi:jira:updated:field:context");
        const oa = await jira("POST", `/rest/api/3/field/${cf.body.id}/context/${nc.body.id}/option`, { options: [{ value: "Alpha" }, { value: "Beta" }] });
        if (oa.ok) {
          const opt = oa.body.options && oa.body.options[0];
          const dv = await jira("PUT", `/rest/api/3/field/${cf.body.id}/context/defaultValue`, { defaultValues: [{ contextId: String(nc.body.id), optionId: String(opt.id), type: "option.single" }] });
          if (dv.ok || dv.status === 204) fired.add("avi:jira:updated:field:context:configuration"); else note(`field default value → ${dv.status} ${JSON.stringify(dv.body).slice(0, 120)}`);
        }
        const cdl = await jira("DELETE", `/rest/api/3/field/${cf.body.id}/context/${nc.body.id}`); if (cdl.ok || cdl.status === 204) fired.add("avi:jira:deleted:field:context");
      } else note(`field context create → ${nc.status} ${JSON.stringify(nc.body).slice(0, 120)}${ctx0 ? "" : " (no default context)"}`);
      const tr = await jira("DELETE", `/rest/api/3/field/${cf.body.id}`); // moves to trash
      if (tr.ok || tr.status === 303 || tr.status === 204 || tr.status === 202) {
        fired.add("avi:jira:trashed:field");
        const rs = await jira("POST", `/rest/api/3/field/${cf.body.id}/restore`); if (rs.ok || rs.status === 204) { fired.add("avi:jira:restored:field"); const tr2 = await jira("DELETE", `/rest/api/3/field/${cf.body.id}`); if (tr2.ok || tr2.status === 303 || tr2.status === 204 || tr2.status === 202) fired.add("avi:jira:trashed:field"); }
        note(`custom field ${cf.body.id} left in trash (permanent deletion is async / trash-only via REST — deleted:field not fired)`);
      } else note(`field trash → ${tr.status} ${JSON.stringify(tr.body).slice(0, 120)}`);
    } else note(`custom field create → ${cf.status} ${JSON.stringify(cf.body).slice(0, 160)}`);
    // project lifecycle
    const pk = `E${RUN.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}`;
    const np = await jira("POST", "/rest/api/3/project", { key: pk, name: `${TAG} project`, projectTypeKey: "software", projectTemplateKey: "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic", leadAccountId: me.accountId, assigneeType: "UNASSIGNED" });
    if (np.ok) {
      created.projects.push(np.body.id); fired.add("avi:jira:created:project");
      const pu = await jira("PUT", `/rest/api/3/project/${np.body.id}`, { description: "updated" }); if (pu.ok) fired.add("avi:jira:updated:project");
      const pa = await jira("POST", `/rest/api/3/project/${np.body.id}/archive`); if (pa.ok || pa.status === 204) { fired.add("avi:jira:archived:project"); const pr = await jira("POST", `/rest/api/3/project/${np.body.id}/restore`); if (pr.ok) fired.add("avi:jira:unarchived:project"); } else note(`project archive → ${pa.status} (archiving needs Premium)`);
      const sdel = await jira("DELETE", `/rest/api/3/project/${np.body.id}?enableUndo=true`); if (sdel.ok || sdel.status === 204) { fired.add("avi:jira:softdeleted:project"); const rst = await jira("POST", `/rest/api/3/project/${np.body.id}/restore`); if (rst.ok) fired.add("avi:jira:restored:project"); else note(`project restore → ${rst.status}`); }
      const hdel = await jira("DELETE", `/rest/api/3/project/${np.body.id}?enableUndo=false`); if (hdel.ok || hdel.status === 204 || hdel.status === 303) { fired.add("avi:jira:deleted:project"); created.projects = []; } else note(`project delete → ${hdel.status}`);
    } else note(`project create → ${np.status} ${JSON.stringify(np.body).slice(0, 160)}`);
    // global configuration + time tracking provider
    const voting = await jira("GET", "/rest/api/3/application-properties?key=jira.option.voting");
    const cur = voting.ok && (Array.isArray(voting.body) ? voting.body[0] : voting.body);
    if (cur) {
      const flip = String(cur.value) === "true" ? "false" : "true";
      const set1 = await jira("PUT", "/rest/api/3/application-properties/jira.option.voting", { id: "jira.option.voting", value: flip });
      const set2 = await jira("PUT", "/rest/api/3/application-properties/jira.option.voting", { id: "jira.option.voting", value: String(cur.value) });
      if (set1.ok && set2.ok) fired.add("avi:jira:changed:configuration"); else note(`configuration toggle → ${set1.status}/${set2.status}`);
    }
    const tt = await jira("GET", "/rest/api/3/configuration/timetracking");
    const ttList = await jira("GET", "/rest/api/3/configuration/timetracking/list");
    if (tt.ok && ttList.ok && Array.isArray(ttList.body)) {
      const current = tt.body && tt.body.key;
      const off = await jira("DELETE", "/rest/api/3/configuration/timetracking"); // disable
      const on = await jira("PUT", "/rest/api/3/configuration/timetracking", { key: current || "JIRA" });
      if ((off.ok || off.status === 204) && (on.ok || on.status === 204)) fired.add("avi:jira:timetracking:provider:changed"); else note(`time tracking toggle → ${off.status}/${on.status}`);
    }
    // JSM request types
    if (jsmProject) {
      const sds = await jira("GET", "/rest/servicedeskapi/servicedesk");
      const sd = sds.ok && (sds.body.values || []).find((s) => String(s.projectId) === String(jsmProject.id));
      if (sd) {
        const jsmTypes = (await jira("GET", `/rest/api/3/project/${jsmProject.id}`)).body?.issueTypes || [];
        const rt = await jira("POST", `/rest/servicedeskapi/servicedesk/${sd.id}/requesttype`, { issueTypeId: String((jsmTypes.find((t) => !t.subtask) || {}).id || stdType.id), name: `${TAG} request`, description: "e2e" }, { "X-ExperimentalApi": "opt-in" });
        if (rt.ok) {
          fired.add("avi:jsm-entity:created:request-type");
          const rdl = await jira("DELETE", `/rest/servicedeskapi/servicedesk/${sd.id}/requesttype/${rt.body.id}`, undefined, { "X-ExperimentalApi": "opt-in" }); if (rdl.ok || rdl.status === 204) fired.add("avi:jsm-entity:deleted:request-type"); else note(`request type delete → ${rdl.status}`);
        } else note(`request type create → ${rt.status} ${JSON.stringify(rt.body).slice(0, 120)}`);
      }
    } else note("no JSM project on the site — request-type events not fired");
  }
  note("not fired by this script: avi:jira:viewed:issue (UI-only), user created/updated/deleted (needs user provisioning), avi:jira:failed:expression (needs a failing workflow expression), avi:jira:deleted:field (trash-only via REST)");

  // ── assertions: targeted listeners' side effects ──
  console.log("  waiting for listener runs (Forge events can take up to ~3 min)…");
  const w1 = await waitForLogs(onCreate.id, (logs) => logs.some((l) => l.issueKey === issue.key && l.isValid));
  ok(w1.ok, "created:issue listener ran (script) on the new issue");
  const w2 = await waitForLogs(onPriority.id, (logs) => logs.some((l) => l.issueKey === issue.key && l.isValid), { tries: 24 });
  ok(w2.ok, "updated:issue + changedFields[priority] listener ran");
  const w3 = await waitForLogs(onRefund.id, (logs) => logs.filter((l) => l.issueKey === issue.key).length >= 2, { tries: 30 });
  const refundRuns = w3.logs.filter((l) => l.issueKey === issue.key);
  ok(refundRuns.some((l) => l.isValid && l.decision !== "SKIP"), `AI condition listener RAN for the refund comment (${refundRuns.length} entries)`);
  ok(refundRuns.some((l) => l.decision === "SKIP" && /not met/i.test(l.reason || "")), "AI condition listener SKIPPED the non-refund comment (gate reason logged)");
  const w4 = await waitForLogs(onAgent.id, (logs) => logs.some((l) => l.issueKey === issue.key), { tries: 30 });
  const agentRun = w4.logs.find((l) => l.issueKey === issue.key);
  ok(agentRun && agentRun.isValid, `AI agent listener ran: ${agentRun ? agentRun.reason : "(no log)"}`);
  const w5 = await waitForLogs(onVersion.id, (logs) => logs.some((l) => l.isValid), { tries: 24 });
  ok(w5.ok, "released:version listener ran (non-issue event, api.forIssue write)");
  const d = await rulesApi.logs(disabledOne.id);
  ok(d.ok && !(d.body.logs || []).some((l) => l.isValid && l.decision !== "SKIP"), "disabled listener never ran");
  // real side effects on the issue
  await sleep(5000);
  const fin = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=labels,comment`), "final issue");
  const labels = fin.fields.labels || []; const comments = (fin.fields.comment.comments || []).map((c) => JSON.stringify(c.body));
  ok(labels.includes(`${TAG}-created`), `label ${TAG}-created present on ${issue.key}`);
  ok(labels.includes(`${TAG}-refund`), `label ${TAG}-refund present (AI condition + script write)`);
  ok(labels.includes(`${TAG}-agent`), `label ${TAG}-agent present (AI agent add_labels)`);
  ok(!labels.includes(`${TAG}-should-not-appear`), "disabled listener wrote nothing");
  ok(comments.some((c) => c.includes("priority changed")), "priority-changed comment posted (changelog read from api.context.event)");
  ok(comments.some((c) => c.includes(`${TAG} agent acknowledged`)), "AI agent acknowledgement comment posted");
  const ledgerNow = must(await jira("GET", `/rest/api/3/issue/${ledger.key}?fields=comment`), "ledger");
  ok((ledgerNow.fields.comment.comments || []).some((c) => JSON.stringify(c.body).includes("version released")), "version-released comment posted on the ledger via api.forIssue (non-issue event)");
  // REST test action
  const t = await rulesApi.listeners.test(onCreate.id, { issueKey: issue.key, eventType: "avi:jira:created:issue" });
  ok(t.ok && t.body.result && t.body.result.isValid && (t.body.result.changes || []).some((c) => c.simulated), "POST action=test runs the listener in simulation via REST");
  // sample captured
  const smp = await rulesApi.sample("avi:jira:created:issue");
  ok(smp.ok && smp.body.payload && smp.body.payload.issue, "last-seen payload sample captured for created:issue");

  // ── delete the issue last (deleted:issue) ──
  const di = await jira("DELETE", `/rest/api/3/issue/${issue2.key}`);
  if (di.ok || di.status === 204) { fired.add("avi:jira:deleted:issue"); created.issues = created.issues.filter((k) => k !== issue2.key); } else note(`issue delete → ${di.status} (deleted:issue not fired — the API user lacks Delete Issues in ${proj.key})`);

  // ── coverage matrix from the ledger (append-only comments written by the catch-all) ──
  const readLedger = async () => {
    const all = []; let start = 0;
    for (;;) { const page = must(await jira("GET", `/rest/api/3/issue/${ledger.key}/comment?maxResults=100&startAt=${start}`), "ledger comments"); all.push(...(page.comments || [])); if (all.length >= (page.total || 0) || !(page.comments || []).length) break; start += page.comments.length; }
    const seen = new Set();
    for (const c of all) { const m = JSON.stringify(c.body).match(/caught (avi:[a-z0-9:_.-]+)/); if (m) seen.add(m[1]); }
    return seen;
  };
  let seen = new Set(); let stable = 0; let lastSize = -1;
  for (let i = 0; i < 40; i++) { // wait until every fired event is recorded, or the ledger stops growing for 45 s
    seen = await readLedger();
    if ([...fired].every((e) => seen.has(e))) break;
    if (seen.size === lastSize) { if (++stable >= 3) break; } else { stable = 0; lastSize = seen.size; }
    await sleep(15000);
  }
  console.log("\n  EVENT COVERAGE (ledger issue — one comment per event the catch-all caught):");
  let hit = 0; const missed = [];
  for (const e of EVENT_IDS) { const f = fired.has(e); const s = seen.has(e); if (f && s) hit++; if (f && !s) missed.push(e); console.log(`    ${s ? "✓" : f ? "✗" : "·"} ${e}${!f ? "  (not fired by this script)" : ""}`); }
  const extra = [...seen].filter((e) => !fired.has(e));
  if (extra.length) console.log(`    (also caught, fired implicitly by Jira: ${extra.join(", ")})`);
  ok(missed.length === 0, `catch-all caught ${hit}/${fired.size} fired event types${missed.length ? ` — missing: ${missed.join(", ")}` : ""} (+${extra.length} caught implicitly, ${seen.size} distinct total)`);
}

async function cleanup() {
  if (KEEP) { console.log("KEEP=1 — leaving listeners and test data in place"); return; }
  for (const id of created.listeners) await rulesApi.listeners.remove(id).catch(() => {});
  for (const k of created.issues) await jira("DELETE", `/rest/api/3/issue/${k}`).catch(() => {});
  for (const id of created.versions) await jira("POST", `/rest/api/3/version/${id}/removeAndSwap`, {}).catch(() => {});
  for (const id of created.components) await jira("DELETE", `/rest/api/3/component/${id}`).catch(() => {});
  for (const id of created.sprints) await jira("DELETE", `/rest/agile/1.0/sprint/${id}`).catch(() => {});
  for (const id of created.boards) await jira("DELETE", `/rest/agile/1.0/board/${id}`).catch(() => {});
  for (const id of created.filters) await jira("DELETE", `/rest/api/3/filter/${id}`).catch(() => {});
  for (const id of created.issueTypes) await jira("DELETE", `/rest/api/3/issuetype/${id}`).catch(() => {});
  for (const id of created.projects) await jira("DELETE", `/rest/api/3/project/${id}?enableUndo=false`).catch(() => {});
  console.log("  cleaned up listeners + test data");
}

try { await main(); } catch (e) { fail++; console.log("  ✗ E2E threw: " + (e && e.stack || e)); } finally { await cleanup(); }
if (notes.length) console.log("\nNOTES:\n" + notes.map((n) => "  - " + n).join("\n"));
console.log(`\nLISTENERS E2E: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
