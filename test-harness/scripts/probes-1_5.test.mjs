/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit suite for the FRAME-1.5 §5 probe levers (P1–P4): the JSM audience probe
// in src/test-hook.js and the consumer reach probe in src/async-handler.js.
//
// What is asserted, and why each one is load-bearing:
//   P1  the internal arm sends `sd.public.comment = {internal:true}` and the public arm
//       sends NO property at all (the contradiction the probe exists to settle);
//   P1  THE COMMENT IS DELETED ON EVERY PATH — happy, non-2xx read, mid-probe throw —
//       and the "nothing to delete" answer is explicit when no id came back;
//   P1  the result carries status codes / keys / booleans and NEVER body text;
//   P3/P4 the probe task refuses when HARNESS_SECRET is absent (production), writes
//       nothing, and does not even build a key;
//   P3/P4 the key shape is `harness_probe:<kind>:<id>` with both parts sanitised;
//   P3/P4 the task type is classified NON-AI (it calls no model) and is registered.
//
// Run: node --import ../lib/register-mocks-index.mjs scripts/probes-1_5.test.mjs
import "../lib/register-mocks-index.mjs";
import { readFileSync } from "node:fs";

const { default: storage } = await import("@forge/kvs");
const { runJsmCommentProbe, createJsmProbeCalls, JSM_INTERNAL_PROPERTY_KEY, JSM_PROBE_COMMENT_TEXT } =
  await import("../../src/test-hook.js");
const { HARNESS_PROBE_TASK, HARNESS_PROBE_KINDS, harnessProbeKey, runHarnessProbe, executeHarnessProbe } =
  await import("../../src/async-handler.js");
const { NON_AI_TASK_TYPES, TOKEN_SPENDING_TASK_TYPES, MODE_DECIDED_TASK_TYPES } =
  await import("../../src/shared/ai-budget.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body ?? {})),
});

// A recording stand-in for the four Jira calls. `script` decides each answer.
const fakeCalls = (script = {}) => {
  const seen = [];
  return {
    seen,
    postComment: async (issueKey, payload) => { seen.push({ op: "post", issueKey, payload }); return script.post ? script.post() : res(201, { id: "10101", self: "x" }); },
    readJsdComment: async (issueKey, id) => { seen.push({ op: "readJsd", issueKey, id }); return script.read ? script.read() : res(200, { id: "10101", public: false, author: { displayName: "App" }, body: "…" }); },
    readCommentProperty: async (id) => { seen.push({ op: "readProp", id }); return script.prop ? script.prop() : res(200, { key: JSM_INTERNAL_PROPERTY_KEY, value: { internal: true } }); },
    deleteComment: async (issueKey, id) => { seen.push({ op: "delete", issueKey, id }); return script.del ? script.del() : res(204, ""); },
  };
};

// ===================== P1 — the property shape both ways =====================
{
  const calls = fakeCalls();
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  const posted = calls.seen[0].payload;
  ok(Array.isArray(posted.properties) && posted.properties.length === 1, "internal arm sends exactly one comment property");
  ok(posted.properties[0].key === "sd.public.comment", "the property key is sd.public.comment");
  ok(posted.properties[0].value && posted.properties[0].value.internal === true, "the value is {internal:true} — the app's own spec, not the plan text");
  ok(posted.body && posted.body.type === "doc", "the comment body is ADF");
  ok(JSON.stringify(posted.body).includes(JSM_PROBE_COMMENT_TEXT), "the body is the short fixed probe text");
  ok(out.mode === "internal" && out.postStatus === 201 && out.readStatus === 200, "statuses are reported");
  ok(out.jsdPublic === false, "jsdPublic is the portal's own boolean");
  ok(out.propertyEcho && out.propertyEcho.internal === true, "the property echo reports internal:true");
  ok(out.keys.includes("public") && out.keys.includes("author"), "response KEYS are reported");
  const flat = JSON.stringify(out);
  ok(!flat.includes("App") && !flat.includes("10101") && !flat.includes(JSM_PROBE_COMMENT_TEXT),
    "the result carries no body text, no display name and no comment id");
}
{
  const calls = fakeCalls();
  await runJsmCommentProbe({ issueKey: "JT-1", mode: "public", calls });
  ok(calls.seen[0].payload.properties === undefined, "the public arm sends NO property at all");
}

// ===================== P1 — the delete happens on EVERY path =====================
const deletes = (calls) => calls.seen.filter((c) => c.op === "delete");
{
  const calls = fakeCalls();
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(deletes(calls).length === 1 && out.deleteStatus === 204, "happy path deletes the comment");
}
{
  const calls = fakeCalls({ read: () => res(404, { errorMessage: "not a request" }) });
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(out.readStatus === 404, "a non-JSM issue reports 404 rather than throwing");
  ok(deletes(calls).length === 1, "a 404 read-back still deletes the comment");
}
{
  const calls = fakeCalls({ read: () => { throw Object.assign(new Error("boom https://site/secret"), { name: "TypeError" }); } });
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(out.errorClass === "TypeError", "a throw is reported as its CLASS only");
  ok(!JSON.stringify(out).includes("secret"), "the error message never reaches the result");
  ok(deletes(calls).length === 1, "a throw mid-probe STILL deletes the comment");
}
{
  const calls = fakeCalls({ prop: () => { throw new Error("x"); } });
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(deletes(calls).length === 1 && out.errorClass === "Error", "a throw on the property read still deletes");
}
{
  const calls = fakeCalls({ post: () => res(403, { errorMessages: ["no"] }) });
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(deletes(calls).length === 0 && out.hasId === false, "nothing was created, so nothing is deleted");
  ok(out.deleteStatus === "nothing-to-delete", "and the result says so explicitly");
}
{
  // A non-numeric id is never interpolated into a path — and therefore never deleted.
  const calls = fakeCalls({ post: () => res(201, { id: "10101; DROP" }) });
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(out.hasId === false && deletes(calls).length === 0, "a non-digit comment id is refused, not interpolated");
}
{
  const calls = fakeCalls({ del: () => { throw Object.assign(new Error("nope"), { code: "ECONNRESET" }); } });
  const out = await runJsmCommentProbe({ issueKey: "JT-1", mode: "internal", calls });
  ok(deletes(calls).length === 1 && out.deleteErrorClass === "ECONNRESET", "a failed delete is reported by class, never swallowed");
}

// P1 route templates: the live calls interpolate the values the probe validated.
{
  const api = (await import("@forge/api")).default;
  const { route } = await import("@forge/api");
  api.__reset();
  api.__respond(() => res(204, ""));
  const live = createJsmProbeCalls(api, route);
  await live.readJsdComment("JT-9", "555");
  await live.readCommentProperty("555");
  await live.deleteComment("JT-9", "555");
  const paths = api.__calls.map((c) => c.path);
  ok(paths[0] === "/rest/servicedeskapi/request/JT-9/comment/555", "the read-back is the JSM request-comment API");
  ok(paths[1] === "/rest/api/3/comment/555/properties/sd.public.comment", "the property echo is read off the comment");
  ok(paths[2] === "/rest/api/3/issue/JT-9/comment/555" && api.__calls[2].opts.method === "DELETE", "the delete is a DELETE on the Jira comment");
}

// ===================== P3/P4 — the consumer probe =====================
{
  const before = process.env.HARNESS_SECRET;
  delete process.env.HARNESS_SECRET;
  storage.__reset();
  const out = await executeHarnessProbe({ kind: "confluence", probeId: "abc" }, "t1");
  ok(out.success === false && out.refused === true, "the probe task REFUSES when HARNESS_SECRET is absent (production)");
  ok(!out.key, "the refusal does not even name a key");
  ok((await storage.get("harness_probe:confluence:abc")) == null, "nothing is written on the refusal path");
  if (before === undefined) delete process.env.HARNESS_SECRET; else process.env.HARNESS_SECRET = before;
}
{
  process.env.HARNESS_SECRET = "probe-suite";
  storage.__reset();
  const out = await executeHarnessProbe({ kind: "confluence", probeId: "abc", queue: "standard" }, "t2");
  ok(out.success === true && out.key === "harness_probe:confluence:abc", "with the secret present the probe records its row");
  const row = await storage.get("harness_probe:confluence:abc");
  ok(row && row.kind === "confluence" && typeof row.at === "string" && row.queue === "standard", "the row names the kind, the time and the queue");
  ok(Object.keys(row).every((k) => ["kind", "at", "queue", "status", "code", "installed", "errorClass", "until"].includes(k)),
    "the recorded row carries only status/code/install-state and its own `until` (F-824) — no body");
  ok(typeof row.until === "string" && Date.parse(row.until) > Date.now(), "F-824: the row stamps its OWN deadline, because the KVS TTL is lazy and a stale probe read as live");
  delete process.env.HARNESS_SECRET;
}
ok(harnessProbeKey("servicedesk", "p1x") === "harness_probe:servicedesk:p1x", "the servicedesk key shape");
ok(!/[^A-Za-z0-9_.:-]/.test(harnessProbeKey("confluence", "a b/c:d*")), "both key parts go through safeKeyPart");
ok(harnessProbeKey(null, "z") === "harness_probe:confluence:z", "confluence is the default kind");
ok(HARNESS_PROBE_KINDS.length === 2 && HARNESS_PROBE_KINDS.includes("servicedesk"), "two probe kinds");

// runHarnessProbe with both transports injected — no network, every branch.
{
  const row = await runHarnessProbe({
    kind: "confluence", queue: "long",
    confluenceClient: { probeInstalled: async () => ({ installed: false, code: "confluence_unavailable", message: "site says no", status: 404 }) },
  });
  ok(row.installed === false && row.code === "confluence_unavailable" && row.status === 404, "the not-installed answer is a status plus a closed-set code");
  ok(!JSON.stringify(row).includes("site says no"), "the client's message is never recorded");
  ok(row.queue === "long", "the row says which queue ran it");
}
{
  const row = await runHarnessProbe({
    kind: "confluence",
    confluenceClient: { probeInstalled: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } },
  });
  ok(row.errorClass === "AbortError" && row.installed === null, "a throwing client is reported by class");
}
{
  const seen = [];
  const row = await runHarnessProbe({
    kind: "servicedesk", queue: "long",
    servicedeskCalls: {
      listDesks: async () => { seen.push("desks"); return res(200, { size: 1, values: [{ id: "7", projectKey: "JT" }] }); },
      listQueues: async (id) => { seen.push("queues:" + id); return res(200, { size: 2, values: [{ id: "11", name: "All open" }] }); },
    },
  });
  ok(row.statusDesk === 200 && row.statusQueue === 200, "both servicedesk calls report a status");
  ok(seen[1] === "queues:7", "the first desk id drives the queue call");
  ok(row.keys.includes("values") && row.keys.includes("queue.values"), "response KEYS from both calls, prefixed");
  ok(!JSON.stringify(row).includes("All open") && !JSON.stringify(row).includes("JT"), "no queue name and no project key is recorded");
}
{
  const row = await runHarnessProbe({
    kind: "servicedesk",
    servicedeskCalls: { listDesks: async () => res(403, { errorMessage: "no jsm" }), listQueues: async () => res(200, {}) },
  });
  ok(row.statusDesk === 403 && row.statusQueue === null, "a refused desk list never reaches the queue call");
}

// Registration + classification (source-parsed: TASK_HANDLERS is module-private).
{
  const src = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
  const handlers = (src.match(/const TASK_HANDLERS = \{[\s\S]*?\n\};/) || [""])[0];
  ok(handlers.includes("[HARNESS_PROBE_TASK]: executeHarnessProbe"), "the probe task is registered through its own constant, not a retyped literal");
  ok(new RegExp(`UNPOLLED_TASKS = new Set\\(\\[[^\\]]*HARNESS_PROBE_TASK`).test(src), "the probe is UNPOLLED — the hook reads the KVS row, nothing polls a task status");
  ok(/if \(!process\.env\.HARNESS_SECRET\) \{/.test(src.slice(src.indexOf("export const executeHarnessProbe"))), "the refusal is the handler's first statement");
}
ok(NON_AI_TASK_TYPES.includes(HARNESS_PROBE_TASK), "the probe task is classified NON-AI — it calls no model");
ok(!TOKEN_SPENDING_TASK_TYPES.includes(HARNESS_PROBE_TASK) && !MODE_DECIDED_TASK_TYPES.includes(HARNESS_PROBE_TASK),
  "and it is in exactly one of the three partition lists");

// The hook's own actions exist and are inside the HARNESS_SECRET-gated POST block.
{
  const hook = readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8");
  const gate = hook.indexOf('if (!secret) return notFound();');
  for (const action of ["probeJsmComment", "probeConfluenceInstalled", "probeConfluenceFromConsumer", "probeServicedeskFromConsumer", "readHarnessProbe"]) {
    const at = hook.indexOf(`body.action === "${action}"`);
    ok(at > gate, `${action} is behind the HARNESS_SECRET gate`);
  }
  ok(/probeServicedeskFromConsumer[\s\S]*?long !== false/.test(hook), "the servicedesk probe defaults to the long queue");
  ok(hook.includes('new Queue({ key: long ? "long-queue" : "async-ai-queue" })'), "the long queue key is the manifest's own (long-queue)");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
