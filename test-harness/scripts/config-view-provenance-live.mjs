/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-572 — THE READ-ONLY RULE VIEW COUNTS THE FIELD GUIDE AS PROVENANCE, LIVE.
 *
 * The defect F-572 fixed is invisible from any REST read: `hasProvenance` is a predicate
 * inside config-view, and the only way to know it fires is to LOOK at the read-only view of
 * a saved rule. So this driver builds the exact shape the defect is about and opens it.
 *
 *   1. A REAL generation, today, on the deployed build: the hook's `runCodegen` action calls
 *      `runCodegenCore`, and its `meta.fieldGuide` is the list of baked sections the model was
 *      actually shown. The step config is then built with `compactMeta`'s shape
 *      (FunctionBlock.jsx) — field guide present, docs/skills EMPTY and memories ZEROED, so
 *      the field guide is the ONLY thing that can open the GENERATED WITH row. A renderer that
 *      reads the other three wrongly cannot pass this.
 *   2. The rule is attached to a NEW self-loop transition on the COGTEST workflow through the
 *      harness's own attach engine, and REMOVED again in the finally.
 *   3. The transition's post-function list is opened in a real browser under the admin profile
 *      and the Forge VIEW iframe is read: the GENERATED WITH row, the field-guide chip's count,
 *      and — after a click — the expanded TITLE list, which must name titles and never a raw
 *      section id.
 *
 * Every failure to reach the view is reported NOT VERIFIED with the URL and a screenshot, never
 * as a pass and never as an app defect: a harness that cannot open a screen has proven nothing
 * about what is on it.
 *
 * Usage (from test-harness/):  node scripts/config-view-provenance-live.mjs [--keep]
 * Env: TESTSTATE_URL + HARNESS_SECRET + the JIRA_* trio.
 */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { readWorkflow, updateWorkflow, removeTransitionsByName, attachSelfLoopRules } from "../lib/workflow.mjs";

/* F-733 — THIS DRIVER IS DEV-ONLY BY CONSTRUCTION (no `--env`), AND THE SHARED TENANT IS
   THE ONLY TENANT IT HAS. So it declares what it CHANGES and leaves changed, in the guard's
   closed vocabulary, and a non-empty set asks for `--i-know-dev-is-shared` before anything is
   written. No environment is resolved and no `.env` is demanded: this is the DECLARATION half
   of `requireEnvAck` on its own, which is what keeps a Playwright script that never opens a
   web trigger out of the mapping it has no use for (F-699's reasoning). */
import { declareMutations } from "../lib/shared-env-guard.mjs";
declareMutations(["rules"]);

const env = loadEnv();
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const KEEP = flag("keep");
const HOOK_URL = env.TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const BASE = requireEnv("JIRA_BASE_URL");
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const TRANSITION_NAME = "CT-F572-Provenance";
const OUT = new URL("../results/config-view-provenance", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const bed = JSON.parse(fs.readFileSync(new URL("../results/testbed.json", import.meta.url).pathname, "utf8"));
const WORKFLOW = bed.workflowName;
const HUB = bed.hubStatusRef;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { workflow: WORKFLOW, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const hook = async (body) => {
  const r = await fetch(HOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* non-JSON */ }
  return { status: r.status, json: j, raw: j ? null : t.slice(0, 300) };
};
const sliceTitle = (t) => (t || "").slice(0, 40);
const compactMeta = (meta) => ({
  appliedDocs: (meta.appliedDocs || []).map((d) => ({ id: d.id, title: sliceTitle(d.title) })),
  appliedSkills: (meta.appliedSkills || []).map((s) => ({ id: s.id, name: sliceTitle(s.name), auto: !!s.auto })),
  appliedMemories: meta.appliedMemories || 0,
  truncatedDocs: (meta.truncatedDocs || []).map((d) => ({ title: sliceTitle(d.title) })),
  ...(Array.isArray(meta.fieldGuide) && meta.fieldGuide.length ? { fieldGuide: meta.fieldGuide.slice(0, 12).map(String) } : {}),
});

let attached = false;

async function main() {
  console.log(`\nF-572 — THE GENERATED WITH ROW IN THE READ-ONLY VIEW, on DEVELOPMENT (${WORKFLOW})\n`);

  /* ── 1. a real generation, today ─────────────────────────────────────────── */
  const gen = await hook({ action: "runCodegen", prompt: "Add a label called triaged to the current issue and log what happened.", operationType: "update", projectKey: bed.projectKey });
  const g = gen.json || {};
  if (!(g.success && g.code && g.meta)) { FAIL("runCodegen did not produce code + meta", { error: g.error, status: gen.status }); return; }
  const meta = compactMeta(g.meta);
  ev.meta = meta;
  info(`generationMeta: ${JSON.stringify(meta)}`);
  if (Array.isArray(meta.fieldGuide) && meta.fieldGuide.length) PASS("today's generation carries a field guide", { sections: meta.fieldGuide.length });
  else { FAIL("this generation carried NO field guide, so the row under test cannot be driven", { meta }); return; }
  if (!meta.appliedDocs.length && !meta.appliedSkills.length) PASS("docs and skills are EMPTY, so only the field guide can open the row", { memories: meta.appliedMemories });
  else NV("this generation also applied docs/skills — the row would open for those too", { docs: meta.appliedDocs.length, skills: meta.appliedSkills.length });
  // THE FIELD GUIDE MUST BE THE ONLY PROVENANCE. Memories are zeroed deliberately: the
  // predicate under test is an OR, so any other truthy member makes the assertion vacuous.
  meta.appliedMemories = 0;

  /* ── 2. attach ──────────────────────────────────────────────────────────── */
  const config = {
    type: "postfunction-static",
    functions: [{
      id: "fn_f572", name: "Tag triaged", variableName: "step1", operationType: "update",
      code: g.code, generationMeta: meta, selectedDocIds: [], selectedSkillIds: [],
    }],
  };
  const res = await attachSelfLoopRules(WORKFLOW, HUB, [{ name: TRANSITION_NAME, type: "static", config }], 9600);
  attached = true;
  const t = res[0];
  ev.attached = t;
  PASS(`attached ${TRANSITION_NAME} as transition ${t.transitionId} (ruleId ${t.ruleId})`);

  /* ── 3. the reviewer's own eyes ─────────────────────────────────────────── */
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1600, height: 1200 } });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    const url = `${BASE}/secure/admin/workflows/ViewWorkflowTransition.jspa?workflowMode=live&workflowName=${encodeURIComponent(WORKFLOW)}&descriptorTab=postfunctions&workflowTransition=${t.transitionId}`;
    info(`opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(4000);
    await page.screenshot({ path: OUT + "/transition-postfunctions.png", fullPage: true });
    // The Forge VIEW module renders in a cdn.prod.atlassian-dev.net iframe on this page.
    let f = null;
    for (let i = 0; i < 60; i++) {
      f = page.frames().find((x) => x.url().includes("cdn.prod.atlassian-dev.net"));
      if (f && await f.locator("body").count() > 0 && (await f.locator("body").innerText().catch(() => "")).trim().length > 0) break;
      await sleep(1000);
    }
    if (!f) {
      ev.pageText = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
      NV("no Forge view iframe rendered on the post-functions page — the read-only view could not be opened", { url, pageHead: ev.pageText.slice(0, 300) });
      return;
    }
    const text = await f.locator("body").innerText();
    ev.viewText = text;
    info(`view text (first 800):\n${text.slice(0, 800).split("\n").map((l) => "          " + l).join("\n")}`);
    await f.locator("body").screenshot({ path: OUT + "/config-view.png" }).catch(() => {});

    if (text.includes("GENERATED WITH")) PASS("the read-only view renders the GENERATED WITH row");
    else { FAIL("no GENERATED WITH row — F-572's predicate did not fire on a field-guide-only step", { head: text.slice(0, 300) }); return; }

    const chip = f.locator(".gmc-fieldguide").first();
    if (await chip.count() === 0) { FAIL("the GENERATED WITH row carries no field-guide chip"); return; }
    const label = (await chip.innerText()).replace(/\s+/g, " ").trim();
    const m = /Field guide:\s*(\d+)\s*section/.exec(label);
    if (m && Number(m[1]) >= 1) PASS("the field-guide chip names a resolved section count", { label });
    else FAIL("the chip does not name a section count", { label });

    await chip.click();
    await f.locator(".fg-chip-item").first().waitFor({ timeout: 15000 });
    const titles = await f.locator(".fg-chip-item").allInnerTexts();
    ev.titles = titles;
    if (titles.length && Number(m[1]) === titles.length) PASS("the chip EXPANDS to exactly the titles it counted", { titles });
    else FAIL("the expanded list does not agree with the count", { counted: m && m[1], titles });
    const rawIds = titles.filter((x) => /\//.test(x) || /#/.test(x));
    if (!rawIds.length) PASS("every expanded entry is a TITLE, never a raw section id");
    else FAIL("a raw section id reached the screen", { rawIds });
    await f.locator(".fg-chip-wrap").first().screenshot({ path: OUT + "/fieldguide-chip-expanded.png" }).catch(() => {});
  } finally { await ctx.close(); }
}

try { await main(); } catch (e) { console.error("THREW", e.stack); fails += 1; }
finally {
  if (attached && !KEEP) {
    try {
      const { top, wf } = await readWorkflow(WORKFLOW);
      removeTransitionsByName(wf, [TRANSITION_NAME]);
      await updateWorkflow(top, wf);
      const { wf: after } = await readWorkflow(WORKFLOW);
      const left = (after.transitions || []).filter((x) => x.name === TRANSITION_NAME).length;
      if (left === 0) PASS(`cleanup: ${TRANSITION_NAME} is gone from ${WORKFLOW} (second read)`);
      else FAIL(`cleanup: ${left} copy of ${TRANSITION_NAME} remains`);
    } catch (e) { console.error("CLEANUP FAILED", e.message); fails += 1; }
  }
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
  console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/`);
  process.exit(fails ? 1 : 0);
}
