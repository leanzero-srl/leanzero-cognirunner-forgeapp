/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-590 (the skill index has ONE writer) and F-570 (the administrator-practice pack), driven
 * through the ADMIN PANEL in a real browser on DEVELOPMENT.
 *
 * F-590 — THE TWO OUTCOMES ARE DIFFERENT AND BOTH ARE CHECKED.
 *   · a CUSTOM skill deleted from the Skills tab is HARD-deleted: gone from `getSkills`'s
 *     index AND its `skill_repo:{id}` record is gone (second read through `?what=kvs`, the
 *     same query that saw the record while the skill existed).
 *   · a BUILTIN "deleted" from the same button FLIPS to `enabled:false` and STAYS in the
 *     index with `builtin:true` — the invariant that used to live in three writers. The tab
 *     stops rendering it, which is the tab's own documented rule, and that is asserted too.
 *   · it is then RE-ENABLED and the tab renders it again, so the fixture is restored. There
 *     is no re-enable button (by design), so the restore goes through the hook's `seedSkill`
 *     action, whose writer is `saveSkillInternal` — the same one home — and which preserves
 *     `builtin` from the existing row.
 *
 * F-570 — the Knowledge tab must list `administrator-practice` with a PINNED count ≥ 1. The
 * resolver's answer is read first, so a UI assertion that fails can be told apart from a
 * pack that is not deployed.
 *
 * Usage (from test-harness/):  node scripts/skills-knowledge-ui-live.mjs
 * Env: TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 */
import { forgeEnvId, declareMutations } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { runProvenance } from "../lib/driver-report.mjs";

/* F-733 — THIS DRIVER IS DEV-ONLY BY CONSTRUCTION (no `--env`), AND THE SHARED TENANT IS
   THE ONLY TENANT IT HAS. So it declares what it CHANGES and leaves changed, in the guard's
   closed vocabulary, and a non-empty set asks for `--i-know-dev-is-shared` before anything is
   written. No environment is resolved and no `.env` is demanded: this is the DECLARATION half
   of `requireEnvAck` on its own, which is what keeps a Playwright script that never opens a
   web trigger out of the mapping it has no use for (F-699's reasoning). */
declareMutations(["skills"]);

const env = loadEnv();
const HOOK_URL = env.TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const ADMIN_PAGE = `https://wolfaenpak.atlassian.net/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/${forgeEnvId("dev")}`;
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const TAG = `F590probe ${Date.now().toString(36)}`;
const OUT = new URL("../results/skills-knowledge-ui", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { tag: TAG, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const hook = async (body, method = "POST", qs = "") => {
  const r = await fetch(HOOK_URL + qs, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: method === "POST" ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* non-JSON */ }
  return { status: r.status, json: j, raw: j ? null : t.slice(0, 300) };
};
const invoke = async (fk, payload = {}) => (await hook({ action: "invokeResolver", functionKey: fk, payload, accountId: ADMIN })).json;
const kvs = async (key) => { const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`); return r.status === 200 && r.json ? (r.json.value === undefined ? null : r.json.value) : null; };
const skillsIndex = async () => ((await invoke("getSkills")) || {}).skills || [];

const restore = { builtin: null };

async function main() {
  console.log("\nF-590 / F-570 — THE SKILLS AND KNOWLEDGE TABS, on DEVELOPMENT\n");
  if ((await hook(null, "GET")).status !== 200) throw new Error("the dev hook is not reachable");
  PASS("hook reachable on development");

  const packs = ((await invoke("getKnowledgePacks")) || {}).packs || [];
  const ap = packs.find((p) => p.id === "administrator-practice");
  ev.adminPracticePack = ap || null;
  if (ap && (ap.pinned || []).length >= 1) PASS("F-570: getKnowledgePacks answers administrator-practice with a pinned section", { sections: ap.sections, pinned: ap.pinned.length });
  else { FAIL("F-570: the administrator-practice pack is missing or has no pinned section", { ap }); }

  const before = await skillsIndex();
  ev.skillCountBefore = before.length;
  const builtin = before.find((s) => s.builtin === true && s.enabled !== false);
  if (!builtin) { FAIL("no ENABLED builtin skill to exercise the flip on"); return; }
  const content = await invoke("getSkillContent", { id: builtin.id });
  if (!(content && content.success && content.skill)) { FAIL("could not read the builtin's content, so it could not be restored afterwards"); return; }
  restore.builtin = { row: builtin, skill: content.skill };
  info(`builtin under test: ${builtin.id} "${builtin.name}"`);

  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1300 } });
  try {
    const p = ctx.pages()[0] || await ctx.newPage();
    await p.goto(ADMIN_PAGE, { waitUntil: "domcontentloaded" });
    let f = null;
    for (let i = 0; i < 90; i++) { f = p.frames().find((x) => x.url().includes("cdn.prod.atlassian-dev.net")); if (f && await f.locator(".tab-btn").count() > 0) break; await sleep(1000); }
    if (!f) throw new Error("the admin panel iframe never rendered");

    /* ── F-570 — the Knowledge tab ──────────────────────────────────────── */
    await f.locator(".tab-btn", { hasText: /^\s*Knowledge\s*$/ }).click();
    const card = f.locator(".kn-pack").filter({ has: f.locator(".kn-pack-title", { hasText: "Administrator practice" }) }).first();
    await card.waitFor({ state: "visible", timeout: 60000 });
    const facts = await card.innerText();
    ev.knowledgeCardText = facts;
    info(`Knowledge card:\n${facts.split("\n").map((l) => "          " + l).join("\n")}`);
    const pinnedTxt = await card.locator(".kn-pack-pinned").innerText().catch(() => "");
    const m = /(\d+)\s+pinned section/.exec(pinnedTxt);
    if (m && Number(m[1]) >= 1) PASS("F-570: the Knowledge tab lists the pack with a pinned count ≥ 1", { pinned: pinnedTxt.trim() });
    else FAIL("F-570: the pack card shows no pinned-section count", { pinnedTxt, facts: facts.slice(0, 200) });
    await card.screenshot({ path: OUT + "/knowledge-administrator-practice.png" });

    /* ── F-590 — the Skills tab (SkillsAdminTab: a real table with Disable/Enable
       and Delete, and the app's own confirm dialog — never a native confirm) ── */
    await f.locator(".tab-btn", { hasText: /^\s*Skills\s*$/ }).click();
    await f.locator(".skills-admin-tab .table tbody tr").first().waitFor({ timeout: 60000 });
    PASS("the Skills tab rendered its table");
    const rowFor = (text) => f.locator(".skills-admin-tab .table tbody tr").filter({ hasText: text }).first();
    const confirmDelete = async () => {
      const ok = f.locator(".cr-confirm-actions .btn-danger", { hasText: /^Delete$/ });
      await ok.waitFor({ timeout: 15000 });
      await ok.click();
    };

    // 1. A CUSTOM skill, seeded through the one writer so the UI DELETE is what is tested.
    const seed = await hook({ action: "seedSkill", name: TAG, category: "Other", description: "F-590 live probe", instructions: "Probe skill for the F-590 live proof. Delete me.", examples: "" });
    const customId = seed.json && (seed.json.id || (seed.json.skill && seed.json.skill.id));
    if (!customId) { FAIL("could not seed a custom skill", { body: JSON.stringify(seed.json).slice(0, 200) }); }
    else {
      PASS(`custom skill ${customId} seeded`);
      const recBefore = await kvs(`skill_repo:${customId}`);
      if (recBefore) PASS("the positive control: skill_repo:{id} IS readable while the skill exists");
      else FAIL("the skill record could not be read even while the skill exists - no absence below is evidence");

      await f.locator(".tab-btn", { hasText: /^\s*Documentation\s*$/ }).click();
      await f.locator(".tab-btn", { hasText: /^\s*Skills\s*$/ }).click();
      const row = rowFor(TAG);
      await row.waitFor({ state: "visible", timeout: 60000 });
      PASS("the custom skill is on the Skills tab");
      await row.locator("button", { hasText: /^Delete$/ }).click();
      await confirmDelete();
      let gone = false;
      for (let i = 0; i < 30; i++) { gone = await f.locator(".skills-admin-tab .table tbody tr").filter({ hasText: TAG }).count() === 0; if (gone) break; await sleep(1000); }
      if (gone) PASS("the Skills tab no longer lists the deleted custom skill");
      else FAIL("the custom skill is still on the tab after the delete");
      const idx = await skillsIndex();
      if (!idx.some((s) => s.id === customId)) PASS("getSkills no longer carries the custom skill (hard delete)");
      else FAIL("the custom skill is still in the index", { row: idx.find((s) => s.id === customId) });
      const recAfter = await kvs(`skill_repo:${customId}`);
      if (recAfter === null) PASS("skill_repo:{id} is GONE - the same read that saw it above");
      else FAIL("the skill record survived the delete", { recAfter: JSON.stringify(recAfter).slice(0, 160) });
    }

    // 2. A BUILTIN - Disable is a FLIP, not a delete.
    const brow = rowFor(builtin.name);
    await brow.waitFor({ state: "visible", timeout: 60000 });
    PASS(`the builtin "${builtin.name}" is on the Skills tab before the flip`);
    await brow.locator("button", { hasText: /^Disable$/ }).click();
    for (let i = 0; i < 30; i++) { const idx = await skillsIndex(); if ((idx.find((s) => s.id === builtin.id) || {}).enabled === false) break; await sleep(1000); }
    const idx2 = await skillsIndex();
    const brow2 = idx2.find((s) => s.id === builtin.id);
    ev.builtinAfterFlip = brow2;
    if (brow2 && brow2.enabled === false) PASS("the builtin FLIPPED to enabled:false", { updatedAt: brow2.updatedAt });
    else FAIL("the builtin did not flip to enabled:false", { brow2 });
    if (brow2 && brow2.builtin === true) PASS("the builtin is STILL LISTED in getSkills' index, still builtin:true");
    else FAIL("the builtin row did not survive the flip", { brow2 });
    const brec = await kvs(`skill_repo:${builtin.id}`);
    if (brec && brec.enabled === false) PASS("skill_repo:{id} for the builtin also reads enabled:false - both rows moved together");
    else FAIL("the builtin's record did not flip", { enabled: brec && brec.enabled });
    const stillListed = await f.locator(".skills-admin-tab .table tbody tr").filter({ hasText: builtin.name }).count();
    if (stillListed > 0) PASS("the admin table STILL LISTS the disabled builtin (it moves under the Disabled divider)", { rows: stillListed });
    else FAIL("the disabled builtin vanished from the admin table");
    await f.locator(".skills-admin-tab").screenshot({ path: OUT + "/skills-tab-disabled.png" }).catch(() => {});

    // 3. RE-ENABLE through the same tab.
    const brow3loc = rowFor(builtin.name);
    await brow3loc.locator("button", { hasText: /^Enable$/ }).click();
    for (let i = 0; i < 30; i++) { const idx = await skillsIndex(); if ((idx.find((s) => s.id === builtin.id) || {}).enabled !== false) break; await sleep(1000); }
    const idx3 = await skillsIndex();
    const brow3 = idx3.find((s) => s.id === builtin.id);
    if (brow3 && brow3.enabled !== false && brow3.builtin === true) { restore.builtin = null; PASS("the builtin is RE-ENABLED from the tab and is still builtin:true"); }
    else FAIL("the builtin could not be re-enabled from the tab", { brow3 });
    const brec3 = await kvs(`skill_repo:${builtin.id}`);
    if (brec3 && brec3.enabled !== false) PASS("skill_repo:{id} reads enabled again");
    else FAIL("the record did not come back on", { enabled: brec3 && brec3.enabled });
    await f.locator(".skills-admin-tab").screenshot({ path: OUT + "/skills-tab-after.png" }).catch(() => {});
  } finally { await ctx.close(); }

  const after = await skillsIndex();
  ev.skillCountAfter = after.length;
  if (after.length === ev.skillCountBefore) PASS("the skill index is back to its starting size", { n: after.length });
  else FAIL("the skill index changed size", { before: ev.skillCountBefore, after: after.length });
}

try { await main(); } catch (e) { console.error("THREW", e.stack); fails += 1; }
finally {
  if (restore.builtin) {
    try {
      const b = restore.builtin;
      await hook({ action: "seedSkill", id: b.row.id, name: b.row.name, category: b.row.category, description: b.row.description, tags: b.row.tags, operationTypes: b.row.operationTypes, enabled: true, instructions: b.skill.instructions || "", examples: b.skill.examples || "" });
      info(`emergency restore of builtin ${b.row.id} attempted`);
    } catch (e) { console.error("BUILTIN RESTORE FAILED", e.message); fails += 1; }
  }
  /* F-787 — WHICH COMMIT PRODUCED THIS FILE. Evidence is read weeks later beside a findings row; `dirty` is reported because evidence made from uncommitted edits is not reproducible from the commit it names. */
  ev.provenance = runProvenance();
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
  console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/`);
  process.exit(fails ? 1 : 0);
}
