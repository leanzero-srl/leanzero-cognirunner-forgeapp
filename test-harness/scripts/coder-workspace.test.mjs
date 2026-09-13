/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE CODER WORKSPACE (src/coder-workspace.js), 1.4 commit 9a — the ONE writer that puts a
// coder turn's effects onto the issue.
//
// What is proven here, and why each one is a GUARANTEE and not a habit:
//   · the plan section is replaced IN PLACE and every node outside the markers survives
//     byte-for-byte — the "description race / two threads clobber" finding;
//   · a first write APPENDS the section, and a second write does not add a second one;
//   · the Coder log is ONE comment, EDITED (PUT), never a second POST — and it is recreated
//     when the user deleted it (404 on the edit is a normal outcome);
//   · a remote link's `globalId` is a pure function of issue+kind+url, so a re-run updates
//     the link rather than duplicating it;
//   · a `.json` artifact is refused BEFORE any Jira call, and the extension allow-list is
//     the app's ONE list (src/index.js), not a second copy;
//   · the per-issue lock SERIALISES: the second writer is told `busy` and performs no write;
//   · simulation performs ZERO Jira calls and answers `{simulated:true, would}`;
//   · every failure is `{ok:false, error, errorClass}` with the class named, and NOTHING
//     throws at the engine — including a fault in the writer's own lazy import.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const store = (await import("../lib/mock-kvs.mjs")).default;
const jiraMock = (await import("../lib/mock-forge-api.mjs")).default;
const ws = await import("../../src/coder-workspace.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "../../src");

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); } };

/* ───────── plumbing ───────── */

const ISSUE = "LZPT-9";
const reset = () => { store.__reset(); jiraMock.__reset(); };
const calls = () => jiraMock.__calls;
const callsTo = (fragment, method = null) => calls().filter((c) => c.path.includes(fragment) && (!method || (c.opts && c.opts.method) === method));
const bodyOf = (call) => JSON.parse(call.opts.body);

/** A Jira responder built from a small route table; anything unrouted is a loud 500. */
const respond = (table) => jiraMock.__respond((p, opts) => {
  const method = (opts && opts.method) || "GET";
  for (const [test, fn] of table) if (test(p, method)) return fn(p, opts);
  return jiraMock.__response(500, { errorMessages: [`unrouted ${method} ${p}`] });
});

const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content) => ({ type: "doc", version: 1, content });

/** The index.js seam: the REAL allow-list is asserted separately, below. */
const indexStub = { loadIndex: async () => ({ UPLOAD_ALLOWED_EXTENSIONS: new Set([".md", ".txt", ".pdf"]), UPLOAD_MAX_BYTES: 1024 }) };

const okJson = (body, status = 200) => jiraMock.__response(status, body);

/* ───────── 1. the plan section ───────── */

await check("the plan section is replaced IN PLACE and the surrounding description survives", async () => {
  reset();
  const before = para("A human wrote this first and it must never move.");
  const after = para("A human wrote this last, below the app's section.");
  const existing = doc(before, para(ws.PLAN_MARKER_START), para("stale plan"), para(ws.PLAN_MARKER_END), after);
  let written = null;
  respond([
    [(p, m) => m === "GET" && p.includes("fields=description"), () => okJson({ fields: { description: existing } })],
    [(p, m) => m === "PUT" && p.endsWith(ISSUE), (p, o) => { written = JSON.parse(o.body); return okJson({}, 204); }],
  ]);

  const r = await ws.writeCoderPlan({ issueKey: ISSUE, plan: "step one\nstep two" });
  assert.equal(r.ok, true);
  assert.equal(r.replaced, true, "the existing section must be REPLACED, not appended to");

  const content = written.fields.description.content;
  assert.deepEqual(content[0], before, "the paragraph above the markers is byte-identical");
  assert.deepEqual(content[content.length - 1], after, "the paragraph below the markers is byte-identical");
  const text = content.map(ws.adfNodeText).join("\n");
  assert.ok(text.includes("step one") && text.includes("step two"), "the new plan is in the section");
  assert.ok(!text.includes("stale plan"), "the old plan is gone");
  assert.equal(content.filter((n) => ws.adfNodeText(n).trim() === ws.PLAN_MARKER_START).length, 1, "exactly one section");
});

await check("a first plan write APPENDS the section, and the second replaces it", async () => {
  reset();
  let current = doc(para("Only the user's text so far."));
  respond([
    [(p, m) => m === "GET" && p.includes("fields=description"), () => okJson({ fields: { description: current } })],
    [(p, m) => m === "PUT" && p.endsWith(ISSUE), (p, o) => { current = JSON.parse(o.body).fields.description; return okJson({}, 204); }],
  ]);

  const first = await ws.writeCoderPlan({ issueKey: ISSUE, plan: "plan A" });
  assert.equal(first.replaced, false, "no markers yet ⇒ appended");
  const second = await ws.writeCoderPlan({ issueKey: ISSUE, plan: "plan B" });
  assert.equal(second.replaced, true);
  assert.equal(current.content.filter((n) => ws.adfNodeText(n).trim() === ws.PLAN_MARKER_START).length, 1);
  assert.equal(ws.adfNodeText(current).includes("plan A"), false);
  assert.equal(ws.adfNodeText(current.content[0]), "Only the user's text so far.");
});

await check("a plan that IS an ADF document lands as literal text, never as nodes", async () => {
  reset();
  let written = null;
  respond([
    [(p, m) => m === "GET", () => okJson({ fields: { description: null } })],
    [(p, m) => m === "PUT", (p, o) => { written = JSON.parse(o.body); return okJson({}, 204); }],
  ]);
  const hostile = JSON.stringify({ type: "doc", version: 1, content: [{ type: "mention", attrs: { id: "admin" } }] });
  const r = await ws.writeCoderPlan({ issueKey: ISSUE, plan: hostile });
  assert.equal(r.ok, true);
  const nodes = written.fields.description.content;
  assert.equal(nodes.some((n) => n.type === "mention"), false, "no node type the model chose");
  for (const n of nodes) assert.ok(["paragraph", "heading"].includes(n.type), `unexpected node ${n.type}`);
  assert.ok(ws.adfNodeText(written.fields.description).includes('"type":"mention"'), "it is there, as text");
});

await check("the plan section is clamped", async () => {
  reset();
  respond([
    [(p, m) => m === "GET", () => okJson({ fields: { description: null } })],
    [(p, m) => m === "PUT", () => okJson({}, 204)],
  ]);
  const huge = Array.from({ length: 500 }, (_, i) => `line ${i} ${"x".repeat(200)}`).join("\n");
  const section = ws.buildPlanSection(huge);
  assert.ok(section.length <= ws.PLAN_MAX_LINES + 4, `sections are line-capped (${section.length})`);
  assert.ok(Buffer.byteLength(JSON.stringify(section), "utf8") <= ws.PLAN_MAX_BYTES + 2048, "and byte-capped");
  const r = await ws.writeCoderPlan({ issueKey: ISSUE, plan: huge });
  assert.equal(r.ok, true);
});

/* ───────── 2. step comments and remote links ───────── */

await check("a step posts ONE comment and upserts its links by globalId", async () => {
  reset();
  respond([
    [(p, m) => m === "POST" && p.endsWith("/comment"), () => okJson({ id: "10101" }, 201)],
    [(p, m) => m === "POST" && p.endsWith("/remotelink"), () => okJson({ id: 7 }, 201)],
  ]);
  const links = [
    { kind: "pr", url: "https://github.com/leanzero/app/pull/4", title: "PR #4" },
    { kind: "branch", url: "https://github.com/leanzero/app/tree/LZPT-9", title: "LZPT-9" },
    { kind: "pr", url: "javascript:alert(1)", title: "not a link" },
  ];
  const r = await ws.appendStepComment({ issueKey: ISSUE, step: { title: "opened a pull request" }, links });
  assert.equal(r.ok, true);
  assert.equal(r.commentId, "10101");
  assert.equal(callsTo("/comment", "POST").length, 1, "exactly one comment");
  assert.equal(callsTo("/remotelink", "POST").length, 2, "the non-http link is dropped, not posted");
  for (const call of callsTo("/remotelink", "POST")) assert.ok(bodyOf(call).globalId, "every remote link carries a globalId");
});

await check("globalId is a pure function of issue+kind+url, so a re-run UPDATES the link", async () => {
  const url = "https://github.com/leanzero/app/pull/4";
  const a = ws.remoteLinkGlobalId(ISSUE, "pr", url);
  const b = ws.remoteLinkGlobalId(ISSUE, "pr", url);
  assert.equal(a, b, "same inputs ⇒ same id (this is what makes the POST an upsert)");
  assert.notEqual(a, ws.remoteLinkGlobalId(ISSUE, "pr", url + "2"), "a different PR is a different link");
  assert.notEqual(a, ws.remoteLinkGlobalId("LZPT-10", "pr", url), "a different issue is a different link");
  assert.notEqual(a, ws.remoteLinkGlobalId(ISSUE, "branch", url), "a different kind is a different link");
  assert.ok(!/[^a-zA-Z0-9:._#-]/.test(a), "and it is safe to carry in a key or a URL");

  reset();
  respond([
    [(p, m) => m === "POST" && p.endsWith("/comment"), () => okJson({ id: "1" }, 201)],
    [(p, m) => m === "POST" && p.endsWith("/remotelink"), () => okJson({ id: 7 }, 200)],
  ]);
  const links = [{ kind: "pr", url, title: "PR #4" }];
  const one = await ws.appendStepComment({ issueKey: ISSUE, step: "again", links });
  const two = await ws.appendStepComment({ issueKey: ISSUE, step: "again", links });
  assert.equal(one.links[0].globalId, two.links[0].globalId, "two runs, one link identity");
});

await check("a failed remote link does not fail the step comment", async () => {
  reset();
  respond([
    [(p, m) => m === "POST" && p.endsWith("/comment"), () => okJson({ id: "55" }, 201)],
    [(p, m) => m === "POST" && p.endsWith("/remotelink"), () => okJson({ errorMessages: ["nope"] }, 403)],
  ]);
  const r = await ws.appendStepComment({ issueKey: ISSUE, step: "x", links: [{ kind: "pr", url: "https://x.test/1" }] });
  assert.equal(r.ok, true, "the step record survives");
  assert.equal(r.links[0].ok, false);
  assert.equal(r.links[0].errorClass, "permission");
});

/* ───────── 3. the running log ───────── */

await check("the Coder log is ONE comment, EDITED in place", async () => {
  reset();
  respond([
    [(p, m) => m === "POST" && p.endsWith("/comment"), () => okJson({ id: "900" }, 201)],
    [(p, m) => m === "PUT" && p.includes("/comment/900"), () => okJson({ id: "900" })],
  ]);
  const first = await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["round 1 started"] });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  const second = await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["round 2 started"] });
  assert.equal(second.created, false, "the second round EDITS");
  assert.equal(second.commentId, "900");
  assert.equal(callsTo("/comment", "POST").length, 1, "exactly one comment was ever created");
  assert.equal(callsTo("/comment/900", "PUT").length, 1);

  const edited = ws.adfNodeText(bodyOf(callsTo("/comment/900", "PUT")[0]).body);
  assert.ok(edited.includes("round 1 started") && edited.includes("round 2 started"), "the log accumulates");
  assert.ok(edited.includes(ws.CODER_LOG_TITLE));
});

await check("a new thread starts a new log comment", async () => {
  reset();
  let n = 0;
  respond([
    [(p, m) => m === "POST" && p.endsWith("/comment"), () => okJson({ id: String(++n) }, 201)],
    [(p, m) => m === "PUT", () => okJson({})],
  ]);
  await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["ONLY-IN-THREAD-ONE"] });
  const other = await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t2", lines: ["ONLY-IN-THREAD-TWO"] });
  assert.equal(other.created, true, "thread t2 does not write into t1's record");
  assert.equal(callsTo("/comment", "POST").length, 2);
  const secondBody = ws.adfNodeText(bodyOf(callsTo("/comment", "POST")[1]).body);
  assert.ok(secondBody.includes("ONLY-IN-THREAD-TWO"));
  assert.ok(!secondBody.includes("ONLY-IN-THREAD-ONE"), "t1's lines never leak into t2's log");
});

await check("a log comment the user deleted is RECREATED, not reported as a failure", async () => {
  reset();
  let created = 0;
  respond([
    [(p, m) => m === "POST" && p.endsWith("/comment"), () => okJson({ id: String(++created === 1 ? 900 : 901) }, 201)],
    [(p, m) => m === "PUT" && p.includes("/comment/900"), () => okJson({ errorMessages: ["gone"] }, 404)],
    [(p, m) => m === "PUT" && p.includes("/comment/901"), () => okJson({})],
  ]);
  await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["a"] });
  const r = await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["b"] });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.commentId, "901");
  assert.equal((await store.get(ws.coderLogKey(ISSUE))).commentId, "901", "the pointer moved");
});

await check("the log is bounded: last N lines, under the byte cap", async () => {
  const many = Array.from({ length: 500 }, (_, i) => `line ${i}`);
  const kept = ws.clampLogLines(many);
  assert.equal(kept.length, ws.CODER_LOG_MAX_LINES);
  assert.equal(kept[kept.length - 1], "line 499", "the RECENT lines are the ones kept");
  const fat = Array.from({ length: 40 }, () => "y".repeat(1000));
  assert.ok(Buffer.byteLength(ws.clampLogLines(fat).join("\n"), "utf8") <= ws.CODER_LOG_MAX_BYTES);
});

/* ───────── 4. the session artifact ───────── */

await check("a .json artifact is REFUSED before any Jira call", async () => {
  reset();
  respond([[() => true, () => okJson([{ id: "1" }], 201)]]);
  for (const name of ["coder-session-1.json", "session.md", "coder-session-1.md.json", "../coder-session-1.md"]) {
    const r = await ws.attachSessionArtifact({ issueKey: ISSUE, name, content: "# hi", deps: indexStub });
    assert.equal(r.ok, false, `"${name}" must be refused`);
    assert.equal(r.errorClass, "invalid");
  }
  assert.equal(calls().length, 0, "and nothing was sent to Jira");
});

await check("a .md artifact is uploaded and answers its attachment id", async () => {
  reset();
  respond([[(p, m) => m === "POST" && p.endsWith("/attachments"), () => okJson([{ id: "42", filename: "coder-session-1.md" }], 200)]]);
  const r = await ws.attachSessionArtifact({ issueKey: ISSUE, name: "coder-session-1.md", content: "# session\n\nnotes", deps: indexStub });
  assert.equal(r.ok, true);
  assert.equal(r.attachmentId, "42");
  const call = callsTo("/attachments", "POST")[0];
  assert.ok(String(call.opts.headers["X-Atlassian-Token"]) === "no-check", "the XSRF header the endpoint requires");
  assert.ok(/multipart\/form-data; boundary=/.test(call.opts.headers["content-type"] || call.opts.headers["Content-Type"] || ""), "the boundary-bearing content type");
});

await check("an artifact over the upload cap is refused, with no Jira call", async () => {
  reset();
  respond([[() => true, () => okJson([{ id: "1" }], 201)]]);
  const r = await ws.attachSessionArtifact({ issueKey: ISSUE, name: "coder-session-2.md", content: "z".repeat(2048), deps: indexStub });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "invalid");
  assert.match(r.error, /upload cap/);
  assert.equal(calls().length, 0);
});

await check("the allow-list has ONE home — src/index.js exports it and the writer imports it", async () => {
  const index = readFileSync(path.join(srcDir, "index.js"), "utf8");
  assert.match(index, /export const UPLOAD_ALLOWED_EXTENSIONS = new Set\(/, "index.js exports the list");
  assert.match(index, /export const UPLOAD_MAX_BYTES =/, "index.js exports the cap");
  const writer = readFileSync(path.join(srcDir, "coder-workspace.js"), "utf8");
  assert.ok(!/new Set\(\[".(pdf|md|txt)"/.test(writer), "the writer must not carry a second copy of the list");
  assert.match(writer, /m\.UPLOAD_ALLOWED_EXTENSIONS/, "it reads the app's list");
  assert.match(writer, /m\.UPLOAD_MAX_BYTES/);
});

await check("a fault in the writer's own lazy import is an answer, not a throw", async () => {
  reset();
  const r = await ws.attachSessionArtifact({
    issueKey: ISSUE, name: "coder-session-3.md", content: "x",
    deps: { loadIndex: async () => { throw new Error("module load blew up"); } },
  });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "unknown");
  assert.equal(calls().length, 0);
});

/* ───────── 5. the per-issue lock ───────── */

await check("the lock SERIALISES: the second writer is told busy and writes nothing", async () => {
  reset();
  let release;
  const gate = new Promise((r) => { release = r; });
  respond([
    [(p, m) => m === "GET", async () => { await gate; return okJson({ fields: { description: null } }); }],
    [(p, m) => m === "PUT", () => okJson({}, 204)],
  ]);
  const first = ws.writeCoderPlan({ issueKey: ISSUE, plan: "thread one" });
  await new Promise((r) => setImmediate(r));
  const second = await ws.writeCoderPlan({ issueKey: ISSUE, plan: "thread two" });
  assert.equal(second.ok, false, "two threads on one issue do not both write");
  assert.equal(second.errorClass, "busy");
  release();
  assert.equal((await first).ok, true, "the holder still finishes");
  assert.equal(callsTo(ISSUE, "PUT").length, 1, "exactly ONE description write");
});

await check("the lock is released on success, on failure and on a throw", async () => {
  reset();
  respond([
    [(p, m) => m === "GET", () => okJson({ fields: { description: null } })],
    [(p, m) => m === "PUT", () => okJson({}, 204)],
  ]);
  await ws.writeCoderPlan({ issueKey: ISSUE, plan: "one" });
  assert.equal(await store.get(ws.coderWorkspaceLockKey(ISSUE)), undefined, "released after success");

  respond([[(p, m) => m === "GET", () => okJson({ errorMessages: ["nope"] }, 403)]]);
  const bad = await ws.writeCoderPlan({ issueKey: ISSUE, plan: "two" });
  assert.equal(bad.ok, false);
  assert.equal(await store.get(ws.coderWorkspaceLockKey(ISSUE)), undefined, "released after a failed write");

  const thrown = await ws.withWorkspaceLock(ISSUE, "A test", async () => { throw new Error("boom"); });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.errorClass, "network");
  assert.equal(await store.get(ws.coderWorkspaceLockKey(ISSUE)), undefined, "released after a throw");
});

await check("the lock key is a legal KVS key even for a hostile issue key", async () => {
  const key = ws.coderWorkspaceLockKey("LZPT/9 ../../etc");
  assert.ok(!key.includes("/"), `"/" is not in the platform's key grammar: ${key}`);
  assert.equal(ws.coderLogKey("LZPT-9"), "coder_log:LZPT-9");
});

/* ───────── 6. simulation ───────── */

await check("simulation writes NOTHING and says what it would have done", async () => {
  reset();
  respond([[() => true, () => okJson({ id: "1" }, 201)]]);
  const results = [
    await ws.writeCoderPlan({ issueKey: ISSUE, plan: "would plan", simulation: true }),
    await ws.appendStepComment({ issueKey: ISSUE, step: "would step", links: [{ kind: "pr", url: "https://x.test/1" }], simulation: true }),
    await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["would log"], simulation: true }),
    await ws.attachSessionArtifact({ issueKey: ISSUE, name: "coder-session-1.md", content: "x", simulation: true, deps: indexStub }),
  ];
  for (const r of results) {
    assert.equal(r.ok, true);
    assert.equal(r.simulated, true);
    assert.ok(r.would && r.would.action, "every simulated answer names the action it would have taken");
  }
  assert.equal(calls().length, 0, "not one Jira call");
  assert.equal(await store.get(ws.coderLogKey(ISSUE)), undefined, "and not one KVS row");
  assert.equal(results[1].would.links[0].globalId, ws.remoteLinkGlobalId(ISSUE, "pr", "https://x.test/1"));
});

/* ───────── 7. the error shape ───────── */

await check("every failure names its class, and nothing throws", async () => {
  const cases = [[401, "permission"], [403, "permission"], [404, "not-found"], [400, "invalid"], [413, "invalid"], [429, "network"], [500, "network"], [503, "network"], [418, "unknown"]];
  for (const [status, expected] of cases) assert.equal(ws.classifyStatus(status), expected, `HTTP ${status}`);

  for (const [status, expected] of [[403, "permission"], [404, "not-found"], [500, "network"]]) {
    reset();
    respond([[() => true, () => okJson({ errorMessages: ["x"] }, status)]]);
    const r = await ws.writeCoderPlan({ issueKey: ISSUE, plan: "p" });
    assert.equal(r.ok, false);
    assert.equal(r.errorClass, expected);
    assert.ok(typeof r.error === "string" && r.error.length, "and carries a sentence");
  }

  reset();
  jiraMock.__respond(() => { throw new Error("socket hang up"); });
  const thrown = await ws.updateCoderLog({ issueKey: ISSUE, threadId: "t1", lines: ["x"] });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.errorClass, "network");

  reset();
  for (const r of [
    await ws.writeCoderPlan({ plan: "p" }),
    await ws.appendStepComment({ step: "s" }),
    await ws.updateCoderLog({ threadId: "t", lines: ["x"] }),
    await ws.attachSessionArtifact({ name: "coder-session-1.md", content: "x" }),
  ]) {
    assert.equal(r.ok, false, "a missing issue key is refused");
    assert.equal(r.errorClass, "invalid");
  }
  assert.equal(calls().length, 0);
});

/* ───────── 8. the pure section rule ───────── */

await check("replacePlanSection leaves an unmarked description untouched apart from the append", async () => {
  const original = doc(para("one"), para("two"));
  const frozen = JSON.parse(JSON.stringify(original));
  const { doc: out, replaced } = ws.replacePlanSection(original, [para("NEW")]);
  assert.equal(replaced, false);
  assert.deepEqual(original, frozen, "the input document is never mutated");
  assert.deepEqual(out.content.slice(0, 2), frozen.content);
  assert.equal(ws.adfNodeText(out.content[2]), "NEW");
});

await check("markers in the wrong order are treated as absent (a user deleted one)", async () => {
  const broken = doc(para(ws.PLAN_MARKER_END), para("user text"), para("x"));
  const { replaced, doc: out } = ws.replacePlanSection(broken, [para(ws.PLAN_MARKER_START), para("NEW"), para(ws.PLAN_MARKER_END)]);
  assert.equal(replaced, false, "we append rather than guess a range");
  assert.equal(ws.adfNodeText(out.content[1]), "user text", "the user's text is untouched");
});

console.log(`CODER WORKSPACE: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
