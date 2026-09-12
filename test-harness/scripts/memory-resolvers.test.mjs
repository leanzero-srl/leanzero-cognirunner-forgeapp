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
import { MEMORIES_KEY, MEMORY_STORE_FULL_KEY, MAX_MEMORIES } from "../../src/memories.js";
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
await call("updateMemory", { id: "u5", disabled: true });
ok(storage.__raw(MEMORY_STORE_FULL_KEY), "an EDIT at the cap does not clear it (the count did not drop)");
await call("deleteMemory", { id: "u5" });
const stored = await call("addMemory", { content: "a brand new lesson that now fits", source: "test" });
ok(stored.success === true && storage.__raw(MEMORY_STORE_FULL_KEY) === undefined,
  "a successful store clears the marker");

console.log(`\nmemory-resolvers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
