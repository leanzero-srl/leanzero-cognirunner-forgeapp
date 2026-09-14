/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the KNOWLEDGE TAB RESOLVERS in src/index.js — `getKnowledgePacks`
// (viewer floor) and `saveKnowledgeSettings` (admin) — driven through the real resolver
// handler with the mock KVS. 1.4 commit 14b.
//
// This file is also the CONTRACT the UI surgeon codes the Knowledge tab against, so the
// shapes are asserted key by key rather than "the call returned success".
//
// What it proves:
//   · the gates, BLOCK and ALLOW, on both resolvers and at every role — a permission
//     asserted only in the negative is a permission nobody has checked;
//   · no BODIES ever leave the backend: the tab is built from the generated index;
//   · the clamp runs BEFORE the write, so storage can only hold real pack ids;
//   · the response reports what was STORED, not what was asked for;
//   · turning a pack off is visible to the very next selection.
//
// Run: node --import ../lib/register-mocks-index.mjs scripts/knowledge-resolvers.test.mjs
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";

const {
  KNOWLEDGE_SETTINGS_KEY, KNOWN_PACK_IDS, invalidateKnowledgeSettingsCache, resolveFieldGuideBlock,
} = await import("../../src/knowledge-packs.js");
const { KNOWLEDGE_PACKS } = await import("../../src/shared/knowledge-index.js");
const { FIELD_GUIDE_BUDGET_BYTES } = await import("../../src/shared/registry-limits.js");
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const EDITOR = "acct-editor";
const VIEWER = "acct-viewer";
const STRANGER = "acct-nobody";

const reset = () => {
  storage.__reset();
  storage.__seed("app_admins", [
    { accountId: ADMIN, displayName: "Admin", role: "admin", scope: "all" },
    { accountId: EDITOR, displayName: "Editor", role: "editor", scope: "all" },
    { accountId: VIEWER, displayName: "Viewer", role: "viewer", scope: "all" },
  ]);
  invalidateKnowledgeSettingsCache();
};
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload } }, { principal: { accountId } });

/* =====================================================================================
 * G — the gates. BLOCK and ALLOW, both proven.
 * ===================================================================================*/
reset();
{
  // getKnowledgePacks — VIEWER FLOOR: which packs are off is configuration, and the
  // payload also names the byte budget every surface spends. Neither is public state.
  for (const [who, id] of [["admin", ADMIN], ["editor", EDITOR], ["viewer", VIEWER]]) {
    const r = await call("getKnowledgePacks", {}, id);
    ok(r && r.success === true, `getKnowledgePacks ALLOWS ${who}`);
  }
  const denied = await call("getKnowledgePacks", {}, STRANGER);
  ok(denied && denied.success === false, "getKnowledgePacks BLOCKS an account with no role");
  ok(typeof denied.error === "string" && denied.error.length > 0, "…with a message the tab can render");
  // NOT through `call`: its `accountId = ADMIN` default would silently turn "no account"
  // into "the admin" and the assertion would pass for the wrong reason. The anonymous
  // context is built by hand so the negative is proven on the thing it names.
  const anon = await handler({ call: { functionKey: "getKnowledgePacks", payload: {} } }, { principal: {} });
  ok(anon && anon.success === false, "getKnowledgePacks BLOCKS a call with no accountId at all");
  const anonSave = await handler({ call: { functionKey: "saveKnowledgeSettings", payload: { disabled: [KNOWN_PACK_IDS[0]] } } }, { principal: {} });
  ok(anonSave && anonSave.success === false, "saveKnowledgeSettings BLOCKS a call with no accountId at all");
}

reset();
{
  // saveKnowledgeSettings — ADMIN. This changes what every validator, agent and Coder
  // turn on the instance is shown; same class of decision as the memory toggles.
  const okAdmin = await call("saveKnowledgeSettings", { disabled: [] }, ADMIN);
  ok(okAdmin && okAdmin.success === true, "saveKnowledgeSettings ALLOWS an admin");
  for (const [who, id] of [["editor", EDITOR], ["viewer", VIEWER], ["a stranger", STRANGER]]) {
    const r = await call("saveKnowledgeSettings", { disabled: [KNOWN_PACK_IDS[0]] }, id);
    ok(r && r.success === false, `saveKnowledgeSettings BLOCKS ${who}`);
  }
  // and the block is a REFUSAL, not a silent no-op: nothing was written
  ok(!storage.__raw(KNOWLEDGE_SETTINGS_KEY) || (storage.__raw(KNOWLEDGE_SETTINGS_KEY).disabled || []).length === 0,
    "a refused save wrote NOTHING — the refusal is not cosmetic");
}

/* =====================================================================================
 * S — the shape the Knowledge tab reads (the UI contract)
 * ===================================================================================*/
reset();
{
  const r = await call("getKnowledgePacks", {}, VIEWER);
  ok(Array.isArray(r.packs), "response.packs is an array");
  ok(r.packs.length === KNOWLEDGE_PACKS.length, `…with one row per baked pack (${r.packs.length})`);

  for (const p of r.packs) {
    ok(typeof p.id === "string" && p.id.length > 0, `${p.id}: id`);
    ok(typeof p.title === "string" && p.title.length > 0, `${p.id}: human title`);
    ok(Number.isFinite(p.sections) && p.sections > 0, `${p.id}: section count`);
    ok(Number.isFinite(p.bytes) && p.bytes > 0, `${p.id}: bytes (for the size line)`);
    ok(Array.isArray(p.provenance) && p.provenance.length > 0, `${p.id}: at least one provenance line`);
    /* F-956 - provenance is FIELDS now, not a pre-joined slug line. The tab shows the name
       and the licence and keeps the ids in a title attribute, so all three must arrive. */
    ok(p.provenance.every((row) => row && typeof row.name === "string" && row.name.length > 0),
      `${p.id}: every provenance row names its source in words`);
    ok(p.provenance.every((row) => typeof row.licence === "string"), `${p.id}: …and carries a licence`);
    ok(p.provenance.every((row) => Array.isArray(row.ids) && row.ids.length > 0), `${p.id}: …and keeps the source ids`);
    ok(Array.isArray(p.pinned), `${p.id}: pinned array`);
    // F-956 - and WHO the pins are for, which is what the tab names when a pack goes off.
    ok(Array.isArray(p.pinnedFor), `${p.id}: pinnedFor array`);
    ok(p.pinned.length === 0 || p.pinnedFor.length > 0, `${p.id}: a pinned pack says which surfaces its pins serve`);
    ok(p.enabled === true, `${p.id}: enabled by default`);
  }

  // NO BODIES. This is the whole reason the tab reads the index and not the packs.
  const json = JSON.stringify(r);
  ok(!json.includes("\"body\""), "no section bodies in the response");
  ok(json.length < 20000, `the whole payload is small (${json.length} bytes) — a tab costs kilobytes, not megabytes`);

  // the settings and the budgets travel with it, so the tab needs one call
  ok(r.settings && Array.isArray(r.settings.disabled), "response.settings.disabled is an array");
  ok(r.budgets && typeof r.budgets === "object", "response.budgets is present");
  ok(Object.keys(r.budgets).length === Object.keys(FIELD_GUIDE_BUDGET_BYTES).length,
    "…covering every audience");
  ok(r.budgets.coder === FIELD_GUIDE_BUDGET_BYTES.coder && r.budgets.validator === FIELD_GUIDE_BUDGET_BYTES.validator,
    "…with registry-limits' numbers, not a copy");
  ok(typeof r.knowledgeVersion === "string" && /^\d+\.\d+\.\d+$/.test(r.knowledgeVersion),
    `response.knowledgeVersion is the selection contract (${r.knowledgeVersion})`);
  ok(typeof r.contentVersion === "string" && r.contentVersion.length >= 8,
    `response.contentVersion is the corpus fingerprint (${r.contentVersion})`);
  ok(r.knowledgeVersion !== r.contentVersion, "the two versions are genuinely different numbers");
}

/* =====================================================================================
 * W — writing the switches
 * ===================================================================================*/
reset();
{
  const victim = "voice-rules";
  const saved = await call("saveKnowledgeSettings", { disabled: [victim] }, ADMIN);
  ok(saved.success === true, "an admin switches a pack off");
  ok(saved.settings.disabled.length === 1 && saved.settings.disabled[0] === victim, "the response names the disabled pack");
  ok(Array.isArray(saved.packs), "the response returns the refreshed pack rows, so the tab needs no second call");
  ok(saved.packs.find((p) => p.id === victim).enabled === false, "…and that row reads enabled:false");
  ok(saved.packs.filter((p) => p.enabled).length === KNOWLEDGE_PACKS.length - 1, "…every other row is still on");

  const raw = storage.__raw(KNOWLEDGE_SETTINGS_KEY);
  ok(raw && raw.disabled.length === 1 && raw.disabled[0] === victim, "the STORED value matches");

  // a fresh read agrees
  const readBack = await call("getKnowledgePacks", {}, VIEWER);
  ok(readBack.settings.disabled[0] === victim, "getKnowledgePacks reports it");
  ok(readBack.packs.find((p) => p.id === victim).enabled === false, "…on the row too");
}

// --- W2: the clamp runs BEFORE the write, and the response reports what was STORED ---
reset();
{
  const r = await call("saveKnowledgeSettings", {
    disabled: ["not-a-pack", "voice-rules", "voice-rules", 42, null, "  jsm-correctness  "],
  }, ADMIN);
  ok(r.success === true, "a payload with junk in it is accepted, not thrown back");
  ok(r.settings.disabled.length === 2, `…and clamped to the two real ids (${JSON.stringify(r.settings.disabled)})`);
  ok(r.settings.disabled.includes("voice-rules") && r.settings.disabled.includes("jsm-correctness"),
    "…the real ids survive, trimmed and de-duplicated");
  ok(!r.settings.disabled.includes("not-a-pack"), "the id naming no pack is gone from the RESPONSE");
  const raw = storage.__raw(KNOWLEDGE_SETTINGS_KEY);
  ok(raw.disabled.length === 2 && !raw.disabled.includes("not-a-pack"),
    "…and gone from STORAGE — the clamp is before the side effect, not on the way out");
  ok(r.packs.filter((p) => !p.enabled).length === 2, "exactly two rows read as off");
}

// --- W3: an empty payload is "nothing disabled", never a crash and never a wildcard ---
reset();
{
  await call("saveKnowledgeSettings", { disabled: KNOWN_PACK_IDS }, ADMIN);
  ok((storage.__raw(KNOWLEDGE_SETTINGS_KEY).disabled || []).length === KNOWN_PACK_IDS.length, "primed: everything off");
  for (const payload of [{}, { disabled: [] }, { disabled: null }, { disabled: "all" }, undefined]) {
    await call("saveKnowledgeSettings", { disabled: KNOWN_PACK_IDS }, ADMIN);
    const r = await call("saveKnowledgeSettings", payload, ADMIN);
    ok(r.success === true && r.settings.disabled.length === 0,
      `saveKnowledgeSettings(${JSON.stringify(payload)}) turns everything back on rather than failing`);
  }
}

/* =====================================================================================
 * E — the switch actually reaches the prompts (the tab is not decorative)
 * ===================================================================================*/
reset();
{
  const query = "confluence page storage format CQL space";
  const before = await resolveFieldGuideBlock({ audience: "coder", text: query });
  ok(before.sectionIds.some((id) => id.startsWith("confluence-rest-correctness/")),
    "control: the Confluence pack does reach a Coder prompt for this query");

  await call("saveKnowledgeSettings", { disabled: ["confluence-rest-correctness"] }, ADMIN);
  const after = await resolveFieldGuideBlock({ audience: "coder", text: query });
  ok(!after.sectionIds.some((id) => id.startsWith("confluence-rest-correctness/")),
    "after the admin's save, not one of its sections reaches the prompt");
  ok(after.sectionIds.length > 0, "…and the budget refills from the packs still on");

  await call("saveKnowledgeSettings", { disabled: [] }, ADMIN);
  const restored = await resolveFieldGuideBlock({ audience: "coder", text: query });
  ok(restored.sectionIds.some((id) => id.startsWith("confluence-rest-correctness/")), "switching it back on restores it");
}

// --- E2: a REFUSED save changes nothing a prompt can see ---
reset();
{
  const query = "confluence page storage format CQL space";
  const before = await resolveFieldGuideBlock({ audience: "coder", text: query });
  const denied = await call("saveKnowledgeSettings", { disabled: ["confluence-rest-correctness"] }, EDITOR);
  ok(denied.success === false, "an editor is refused");
  const after = await resolveFieldGuideBlock({ audience: "coder", text: query });
  ok(JSON.stringify(before.sectionIds) === JSON.stringify(after.sectionIds),
    "…and the very next prompt is byte-identical — the refusal reached the cache too");
}

console.log(`\nknowledge-resolvers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
