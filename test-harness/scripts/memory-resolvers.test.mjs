/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the MEMORY RESOLVERS in src/index.js (addMemory / updateMemory /
// deleteMemory / getMemorySettings / getKnowledgeCounts), driven through the real resolver
// handler with the mock KVS.
// Covers F-165 (an unknown `source` is refused, never coerced into the protected "user" tier)
// and F-164/F-166 (a user add at an all-user cap is refused with a message the tab can render).
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { readFileSync } from "node:fs";
// src/memories.js must be loaded DYNAMICALLY, like `handler` below. A STATIC import
// is part of this module's graph and is instantiated BEFORE any top-level code runs,
// so the register-mocks-index hook above has not been installed yet and memories.js
// binds the REAL @forge/kvs — every storage call then throws "__forge_fetch__ is not
// a function". run-offline.mjs hides this by spawning with `--import <loader>`, so
// the file passed in the suite and failed the moment anyone ran it directly.
const { MEMORIES_KEY, MEMORY_STORE_FULL_KEY, MEMORY_CONTENT_MAX, MAX_MEMORIES, memoryCapRefusalMessage, memoryWriteFaultMessage } = await import("../../src/memories.js");
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const reset = (seed = []) => {
  storage.__reset();
  storage.__seed("app_admins", [{ accountId: ADMIN, displayName: "Admin", role: "admin", scope: "all" }]);
  storage.__seed(MEMORIES_KEY, seed);
};
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload } }, { principal: { accountId } });
const load = () => storage.__raw(MEMORIES_KEY) || [];

// === F-165: `source` comes from the PAYLOAD and must never be coerced ===
reset([]);
const bad = await call("addMemory", { content: "a lesson filed by a future client", source: "runtime" });
ok(bad.success === false && bad.error === "Unknown memory source",
  `an unknown source is REFUSED (got ${JSON.stringify(bad)})`);
ok(load().length === 0, "the refused add wrote nothing");
for (const src of ["admin", "USER", "", 0, 1, true, {}, ["user"]]) {
  const r = await call("addMemory", { content: `a lesson with source ${JSON.stringify(src)}`, source: src });
  if (src === "") ok(r.success === true && load().find((m) => m.id === r.id).source === "user", "an EMPTY source falls back to user");
  else ok(r.success === false && r.error === "Unknown memory source", `source ${JSON.stringify(src)} is refused`);
}

reset([]);
const absent = await call("addMemory", { content: "a lesson with no source at all" });
ok(absent.success === true && load()[0].source === "user" && load()[0].confidence === 1.0,
  "an ABSENT source defaults to user (confidence 1.0) — the only default");
const fixSrc = await call("addMemory", { content: "a distinct lesson learned while fixing code", source: "fix" });
ok(fixSrc.success === true && load().find((m) => m.id === fixSrc.id).source === "fix" && load().find((m) => m.id === fixSrc.id).confidence === 0.8,
  "a real source is honoured with its own confidence tier");

// === F-164/F-166: a user add at an all-user cap is refused, with a renderable message ===
const allUser = [];
for (let i = 0; i < 200; i++) allUser.push({ id: `u${i}`, content: `a user lesson number ${i} distinct`, source: "user", confidence: i === 0 ? 0.05 : 1.0, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
reset(allUser);
const before = JSON.stringify(load());
const full = await call("addMemory", { content: "one more curated lesson about release trains", source: "user" });
ok(full.success === false && full.stored === false && full.reason === "cap",
  `a user add at the cap answers success:false / reason "cap" (got ${JSON.stringify({ success: full.success, reason: full.reason })})`);
ok(typeof full.error === "string" && /Memories tab/.test(full.error), `the refusal names the tab to prune in: "${full.error}"`);
// F-172/F-174: ONE home for the sentence and for the cap inside it
ok(full.error === memoryCapRefusalMessage("cap"), "the refusal is the shared memoryCapRefusalMessage('cap')");
ok(full.error.includes(`(${MAX_MEMORIES} max)`), `the cap is interpolated from MAX_MEMORIES (${MAX_MEMORIES})`);
ok(JSON.stringify(load()) === before, "the store is byte-identical after the refusal (no hand-authored row destroyed)");

// === F-167: a refused lesson raises a DURABLE marker the admin surfaces can read ===
reset(allUser);
ok(storage.__raw(MEMORY_STORE_FULL_KEY) === undefined, "no marker while the instance is learning");
const settingsClean = await call("getMemorySettings");
ok(settingsClean.storeFull === null, "getMemorySettings reports storeFull:null when learning normally");
const countsClean = await call("getKnowledgeCounts");
ok(countsClean.storeFull === null, "getKnowledgeCounts reports storeFull:null when learning normally");

await call("addMemory", { content: "a novel lesson that cannot be stored at the cap", source: "test" });
const marker = storage.__raw(MEMORY_STORE_FULL_KEY);
ok(marker && marker.reason === "cap" && marker.source === "test" && !Number.isNaN(Date.parse(marker.at)),
  `a refused lesson writes { at, reason, source } (got ${JSON.stringify(marker)})`);
const settingsFull = await call("getMemorySettings");
ok(settingsFull.storeFull && settingsFull.storeFull.reason === "cap" && settingsFull.storeFull.at === marker.at,
  "getMemorySettings surfaces the marker so the tab can show a banner");
const countsFull = await call("getKnowledgeCounts");
ok(countsFull.storeFull && countsFull.storeFull.reason === "cap" && countsFull.memories === MAX_MEMORIES,
  `getKnowledgeCounts surfaces the marker alongside the healthy-looking count (${countsFull.memories})`);

// a second refusal overwrites the one key — never a pile of rows
const firstAt = marker.at;
await new Promise((r) => setTimeout(r, 5));
await call("addMemory", { content: "another novel lesson refused at the same cap", source: "fix" });
const marker2 = storage.__raw(MEMORY_STORE_FULL_KEY);
ok(marker2.source === "fix" && marker2.at >= firstAt, "a second refusal OVERWRITES the single marker key");

// deleting a memory drops the count below the cap → the marker clears
const del = await call("deleteMemory", { id: "u0" });
ok(del.success === true && storage.__raw(MEMORY_STORE_FULL_KEY) === undefined,
  "deleteMemory drops below the cap and CLEARS the marker — the instance is learning again");
ok((await call("getMemorySettings")).storeFull === null, "and getMemorySettings says so");

// a successful store also clears it
reset(allUser);
await call("addMemory", { content: "a novel lesson that cannot be stored at the cap", source: "test" });
ok(storage.__raw(MEMORY_STORE_FULL_KEY), "marker raised again");
await call("updateMemory", { id: "u5", content: "a user lesson number 5 distinct, reworded" });
ok(storage.__raw(MEMORY_STORE_FULL_KEY), "an EDIT that frees no capacity does not clear it");
// F-176/F-177 (reversing F-173): ARCHIVING frees NO slot — an archived row keeps its slot,
// counts toward the cap, and is never evicted — so the marker must SURVIVE an archive.
// Only DELETE makes room, which is what memoryCapRefusalMessage("cap") now tells the admin.
await call("updateMemory", { id: "u5", disabled: true });
ok(storage.__raw(MEMORY_STORE_FULL_KEY),
  "F-176/F-177: ARCHIVING a row at the cap does NOT clear the marker (archived rows still count)");
await call("deleteMemory", { id: "u5" });
ok(storage.__raw(MEMORY_STORE_FULL_KEY) === undefined, "…and DELETING it does clear it");
const stored = await call("addMemory", { content: "a brand new lesson that now fits", source: "test" });
ok(stored.success === true && storage.__raw(MEMORY_STORE_FULL_KEY) === undefined,
  "a successful store clears the marker");

// === F-170/F-171: the marker is cleared by the ADMISSION RULE, never by a proxy ===

// --- cap arm: a REINFORCE writes no new row, so it must NOT clear the marker (F-171) ---
reset(allUser);
await call("addMemory", { content: "a novel lesson that cannot be stored at the cap", source: "test" });
ok(storage.__raw(MEMORY_STORE_FULL_KEY), "cap-arm marker raised");
const reinforce = await call("addMemory", { content: "a user lesson number 7 distinct", source: "user" });
ok(reinforce.success === true && reinforce.merged === true, "the add MERGED into an existing row (a reinforce)");
ok(storage.__raw(MEMORY_STORE_FULL_KEY), "a REINFORCE at a full store does NOT clear the marker (no row was freed)");
// a delete that frees an evictable slot does clear it
const delUser = await call("deleteMemory", { id: "u3" });
ok(delUser.success === true && storage.__raw(MEMORY_STORE_FULL_KEY) === undefined,
  "a DELETE that frees a slot clears the cap-arm marker");

// --- bytes arm: the old count proxy could never see this (count stayed under the cap) ---
const big = (id, n) => ({ id, content: "b".repeat(n), source: "user", confidence: 1.0, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
// 20 hand-authored rows (nothing evictable) whose serialized size sits over the byte guard
const heavy = [];
for (let i = 0; i < 20; i++) heavy.push(big(`b${i}`, 12000));
reset(heavy);
const refusedBytes = await call("addMemory", { content: "a novel lesson refused by the SIZE guard", source: "test" });
const bytesMarker = storage.__raw(MEMORY_STORE_FULL_KEY);
ok(refusedBytes.success === false && refusedBytes.reason === "bytes" && bytesMarker && bytesMarker.reason === "bytes",
  `the byte guard refuses and raises a "bytes" marker (got ${JSON.stringify({ r: refusedBytes.reason, m: bytesMarker && bytesMarker.reason })})`);
ok(load().length < MAX_MEMORIES, "…while the row COUNT is far under the cap (the old proxy cleared here)");
// shorten ONE row, still over the guard → the marker must SURVIVE
await call("updateMemory", { id: "b0", content: "b".repeat(MEMORY_CONTENT_MAX) });
ok(storage.__raw(MEMORY_STORE_FULL_KEY), "shortening one row while still over the byte guard does NOT clear the marker");
// shorten the rest → now a lesson fits → cleared
for (let i = 1; i < 18; i++) await call("updateMemory", { id: `b${i}`, content: `shortened row ${i}` });
ok(storage.__raw(MEMORY_STORE_FULL_KEY) === undefined,
  "once the store is back under the byte guard the marker CLEARS");

// === F-178: an edit/delete save has NO newcomer, so it must NEVER evict ===
// The breaker's fixture: 20 hand-authored rows of 12000 chars (one of them ARCHIVED),
// serialized well over the byte guard. Before the fix, editing an unrelated row evicted a
// row (the archived one, under F-173) FUTILELY — still over the guard, oversized value
// written anyway, `{success:true}` returned and `evicted` dropped on the floor.
{
  const heavy178 = [];
  for (let i = 0; i < 20; i++) heavy178.push({ ...big(`b${i}`, 12000), disabled: i === 7 });
  reset(heavy178);
  const beforeBytes = new TextEncoder().encode(JSON.stringify(load())).length;
  ok(beforeBytes >= 230000, `fixture is over the byte guard (${beforeBytes} B)`);
  const beforeJson = JSON.stringify(load());
  // F-184 AMENDS the old expectation here. A METADATA edit (scope, archive, restore) cannot
  // materially grow the store — archiving a row is -1 B ("false" → "true"), restoring is +1 B,
  // and the updatedAt re-stamp measures ZERO (a fixed-length ISO stamp; the old docblock's
  // "+4 bytes" was wrong). Refusing them built a ONE-WAY DOOR: Archive succeeded and Restore
  // was refused, so an admin could archive a memory on an over-guard store and never get it
  // back. Metadata edits now always proceed — and, per F-178, still evict nothing.
  const edit = await call("updateMemory", { id: "b3", projectKey: "PROJA" });
  ok(edit.success === true && load().find((m) => m.id === "b3").projectKey === "PROJA",
    `a METADATA edit on an over-guard store proceeds (got ${JSON.stringify({ success: edit.success, reason: edit.reason })})`);
  ok(JSON.stringify(edit.evicted) === "[]" && load().length === 20,
    `…and evicts nothing (${JSON.stringify(edit.evicted)}, ${load().length} rows)`);
  ok(load().some((m) => m.id === "b7" && m.disabled === true), "the ARCHIVED hand-authored row is still there");

  const arch178 = await call("updateMemory", { id: "b5", disabled: true });
  ok(arch178.success === true && load().find((m) => m.id === "b5").disabled === true,
    "ARCHIVE on an already-over-guard store proceeds");
  const rest178 = await call("updateMemory", { id: "b5", disabled: false });
  ok(rest178.success === true && load().find((m) => m.id === "b5").disabled === false,
    "RESTORE proceeds too — the one-way door F-184 filed is closed");
  ok(load().length === 20, "…still 20 rows");

  // CONTENT growth is what the byte guard refuses. (These fixture rows are 12000 chars, which
  // updateMemory clamps to MEMORY_CONTENT_MAX, so any content edit here SHRINKS — the refusal
  // is proved on a store of maximum-length rows instead.)
  {
    const cjk = (id, n) => ({ id, content: "漢".repeat(n), source: "user", confidence: 1.0, reinforcements: 0, disabled: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    const maxed = [];
    for (let i = 0; i < 198; i++) maxed.push(cjk(`c${i}`, 350));
    reset(maxed);
    const bytesNow = new TextEncoder().encode(JSON.stringify(load())).length;
    ok(bytesNow >= 230000, `CJK fixture is over the byte guard (${bytesNow} B)`);
    const beforeJson2 = JSON.stringify(load());
    const grow = await call("updateMemory", { id: "c3", content: "漢".repeat(MEMORY_CONTENT_MAX) });
    ok(grow.success === false && grow.reason === "bytes",
      `a CONTENT-GROWING edit is refused with reason "bytes" (got ${JSON.stringify({ success: grow.success, reason: grow.reason })})`);
    ok(JSON.stringify(grow.evicted) === "[]" && JSON.stringify(load()) === beforeJson2,
      "the refused content edit left the store BYTE-IDENTICAL and evicted nothing");
    ok(typeof grow.error === "string" && /Memories tab/.test(grow.error), `the refusal names the tab: "${grow.error}"`);
    reset(heavy178);
  }

  // …and a SHRINKING edit still proceeds — shortening rows is the recovery path out of an
  // over-size store, so it must never be refused.
  const shrink = await call("updateMemory", { id: "b3", content: "short" });
  ok(shrink.success === true && load().find((m) => m.id === "b3").content === "short",
    "a SHRINKING edit on an over-size store proceeds (recovery is not trapped)");
  ok(load().length === 20, "…and it evicted nothing (still 20 rows)");

  // a DELETE always proceeds (it only shrinks) and evicts nothing
  const delHeavy = await call("deleteMemory", { id: "b1" });
  ok(delHeavy.success === true && JSON.stringify(delHeavy.evicted) === "[]" && load().length === 19,
    "a DELETE on an over-size store proceeds, reports evicted: [], and removes exactly one row");
  ok(load().some((m) => m.id === "b7"), "the archived row survives the delete of a different row");
}

// === F-168: ONE memory-content clamp, imported — no retyped literal in index.js ===
const indexSrc = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
const memoryClamps = indexSrc.match(/String\(content \|\| ""\)\.trim\(\)\.substring\(0, ([A-Za-z0-9_]+)\)/g) || [];
ok(memoryClamps.length === 2 && memoryClamps.every((m) => m.includes("MEMORY_CONTENT_MAX")),
  `both memory-content clamps in index.js use MEMORY_CONTENT_MAX (${JSON.stringify(memoryClamps)})`);
ok(/import \{[\s\S]*?MEMORY_CONTENT_MAX[\s\S]*?\} from "\.\/memories\.js";/.test(indexSrc),
  "index.js imports the constant rather than retyping the number");
reset([]);
const longAdd = await call("addMemory", { content: "x".repeat(MEMORY_CONTENT_MAX + 50) });
ok(load().find((m) => m.id === longAdd.id).content.length === MEMORY_CONTENT_MAX,
  `addMemory clamps at MEMORY_CONTENT_MAX (${MEMORY_CONTENT_MAX})`);
await call("updateMemory", { id: longAdd.id, content: "y".repeat(MEMORY_CONTENT_MAX + 50) });
ok(load().find((m) => m.id === longAdd.id).content.length === MEMORY_CONTENT_MAX, "updateMemory clamps at the same constant");
const asyncSrc = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
ok(!/substring\(0, 350\)/.test(asyncSrc) && /MEMORY_DISTILL_CONTENT_MAX = 350/.test(asyncSrc),
  "the distill task's deliberately tighter clamp is NAMED, not a bare literal");

// === F-174: the store-full MARKER key is restorable by the harness, by constant ===
{
  const hookSrc = readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8");
  ok(/MEMORY_STORE_FULL_KEY[\s\S]*?from "\.\/memories\.js"/.test(hookSrc), "test-hook imports MEMORY_STORE_FULL_KEY rather than retyping it");
  ok(/const KEYS = new Set\(\[[\s\S]*?MEMORY_STORE_FULL_KEY[\s\S]*?\]\);/.test(hookSrc), "the kvSet allowlist includes the store-full marker");
  ok(!/"COGNIRUNNER_MEMORY_STORE_FULL"/.test(hookSrc), "…and never as a retyped string literal");
  const idxSrc = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
  ok(!/\(200 max\)/.test(idxSrc) && !/full of your own memories/.test(idxSrc),
    "index.js no longer carries a copy of the cap sentence or a retyped 200");
}

// === F-196/F-197: a FAULTED write is not a saved memory, and not a size problem ===
// addMemory used to be handed `stored: true` for a write that threw, so the tab said
// "Memory saved" for an id that exists nowhere; and when the refusal did surface, every
// throw wore reason "platform-cap" with a fabricated 1-byte deficit, telling the admin to
// bulk-delete memories because of a transient fault on a 1.4 KB write.
reset([]);
const filler = "the release checklist needs a signed-off rollback plan ".repeat(25); // ~1.4 KB
ok(new TextEncoder().encode(JSON.stringify([{ content: filler }])).length > 1300, "the faulting write really is ~1.4 KB — nowhere near any limit");
storage.__failNextSet();
const faulted = await call("addMemory", { content: filler.substring(0, MEMORY_CONTENT_MAX), source: "user" });
ok(faulted.success === false && faulted.stored === false,
  `a faulted write is NOT reported as saved (got ${JSON.stringify({ success: faulted.success, stored: faulted.stored, id: faulted.id })})`);
ok(faulted.id === undefined, "and carries no id for a row that does not exist");
ok(faulted.reason === "write-fault", `the reason is "write-fault" (got ${JSON.stringify(faulted.reason)})`);
ok(faulted.error === memoryWriteFaultMessage(), `the sentence is the shared write-fault one: "${faulted.error}"`);
ok(!/\d/.test(faulted.error), `and contains NO byte number (got "${faulted.error}")`);
ok(load().length === 0, "the store is untouched");
// the very next add, with no fault armed, succeeds — "try again" is honest advice
const retried = await call("addMemory", { content: filler.substring(0, MEMORY_CONTENT_MAX), source: "user" });
ok(retried.success === true && load().length === 1, "the retry the sentence recommends actually works");

// === F-228: the three memory READ resolvers had no gate at all ===
// Every write path was gated; getMemories / getMemoryStoreStats / getMemorySettings
// were not, so anyone who could reach a resolver could read this instance's learned
// facts (which quote its field names, endpoints and failure text).
const VIEWER = "acct-viewer";
const STRANGER = "acct-stranger";
reset([{ id: "m1", content: "a secret-ish learned fact", source: "user", createdAt: new Date().toISOString() }]);
storage.__seed("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: VIEWER, role: "viewer", scope: "own" },
]);
{
  const quiet = console.warn; console.warn = () => {};
  try {
    for (const fn of ["getMemories", "getMemoryStoreStats", "getMemorySettings"]) {
      const denied = await call(fn, {}, STRANGER);
      ok(denied.success === false && /permission/.test(denied.error || ""),
        `${fn} refuses a caller with no role (got ${JSON.stringify(denied).slice(0, 120)})`);
      ok(!Array.isArray(denied.memories) || denied.memories.length === 0,
        `${fn} leaks no memories in its refusal`);
      const allowed = await call(fn, {}, VIEWER);
      ok(allowed.success === true, `${fn} still serves a VIEWER (the floor, not admin)`);
    }
    ok((await call("getMemories", {}, VIEWER)).memories.length === 1, "a viewer reads the store normally");
  } finally { console.warn = quiet; }
}

console.log(`\nmemory-resolvers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
