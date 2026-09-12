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
import { MEMORIES_KEY } from "../../src/memories.js";
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

console.log(`\nmemory-resolvers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
