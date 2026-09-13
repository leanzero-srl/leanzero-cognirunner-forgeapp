/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// scripts/bake-knowledge.mjs — the parts of the bake that decide what SHIPS and what
// REFUSES, exercised without the (gitignored) raw corpus.
//
//   - collectPins (F-429): the pins have ONE home — knowledge/sources.json — and the bake
//     refuses a pin that is a bare pack id, a pin nobody reads, or a pin that matches no
//     baked section. A pin that matches nothing is exactly the dead config the finding is
//     about, so it must stop the bake rather than be rendered in the MANIFEST.
//
// Refusals are `die()` — process.exit — so they are asserted in a CHILD PROCESS on the
// EXIT CODE. A refusal nobody can read from the exit code is not a refusal (F-435).
//
// Auto-discovered by run-offline.mjs (npm run test:offline). Run alone:
//   node test-harness/scripts/bake-knowledge.test.mjs
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const bakePath = path.join(repoRoot, "scripts/bake-knowledge.mjs");
const bake = await import(pathToFileURL(bakePath).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/** Run a snippet with the bake module imported as `B`. Returns { status, out }. */
const run = (snippet) => {
  const src = `import * as B from ${JSON.stringify(pathToFileURL(bakePath).href)};\n${snippet}\n`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
};

const sections = [
  { id: "forge-app-builder/jira-forge/core-concepts-1", pack: "forge-app-builder", body: "a" },
  { id: "forge-app-builder/jira-forge/core-concepts-2", pack: "forge-app-builder", body: "b" },
  { id: "forge-app-builder/jira-forge/manifest-1", pack: "forge-app-builder", body: "c" },
  { id: "other/x/thing-1", pack: "other", body: "d" },
];

/* ---- collectPins: the happy shape ---- */
{
  const cfg = { packs: { "forge-app-builder": { pinned: ["forge-app-builder#core-concepts"], pinnedFor: ["coder", "codegen"] }, other: { pinned: [] } } };
  const r = bake.collectPins(cfg, sections);
  ok(JSON.stringify(r.byAudience) === JSON.stringify({
    coder: ["forge-app-builder#core-concepts"], codegen: ["forge-app-builder#core-concepts"],
  }), `the pin map is keyed by audience (${JSON.stringify(r.byAudience)})`);
  ok(r.rows.length === 1 && r.rows[0].sections.length === 2,
    "one pin resolves to every chunk of the section it names");
  ok(!("other" in r.byAudience), "a pack with no pins contributes nothing");
}

/* ---- collectPins: a FULL section id is a pin too ---- */
{
  const cfg = { packs: { other: { pinned: ["other/x/thing-1"], pinnedFor: ["va"] } } };
  const r = bake.collectPins(cfg, sections);
  ok(JSON.stringify(r.byAudience.va) === '["other/x/thing-1"]', "a full section id is accepted as a pin");
  ok(r.rows[0].sections.length === 1, "and it matches exactly one section");
}

/* ---- the three refusals, on the EXIT CODE ---- */
const secLit = JSON.stringify(sections);
{
  const r = run(`B.collectPins({ packs: { "forge-app-builder": { pinned: ["forge-app-builder"], pinnedFor: ["coder"] } } }, ${secLit});`);
  ok(r.status !== 0, `a bare PACK id as a pin refuses (exit ${r.status})`);
  ok(/not a section pin/.test(r.out), "and the refusal says what a pin is");
}
{
  const r = run(`B.collectPins({ packs: { "forge-app-builder": { pinned: ["forge-app-builder#core-concepts"] } } }, ${secLit});`);
  ok(r.status !== 0, `a pin with no "pinnedFor" audience refuses (exit ${r.status})`);
  ok(/dead config/.test(r.out), "and the refusal names it as dead config");
}
{
  const r = run(`B.collectPins({ packs: { "forge-app-builder": { pinned: ["forge-app-builder#no-such-section"], pinnedFor: ["coder"] } } }, ${secLit});`);
  ok(r.status !== 0, `a pin matching no baked section refuses (exit ${r.status})`);
  ok(/NOTHING was written/.test(r.out), "and it refuses BEFORE the emit");
}
{
  // A --tier subset legitimately bakes a partial corpus, so a missing pack is a warning.
  const r = run(`const out = B.collectPins({ packs: { "forge-app-builder": { pinned: ["forge-app-builder#no-such-section"], pinnedFor: ["coder"] } } }, ${secLit}, { partial: true });\nconsole.log("PINS", JSON.stringify(out.byAudience));`);
  ok(r.status === 0, "under a tier subset the same pin is a warning, not a refusal");
  ok(/WARNING/.test(r.out), "and it says so loudly");
}

/* ---- what the MANIFEST renders is what the selector reads (F-429) ---- */
{
  const cfg = { packs: { "forge-app-builder": { pinned: ["forge-app-builder#core-concepts"], pinnedFor: ["coder"] } } };
  const pins = bake.collectPins(cfg, sections);
  const md = bake.renderManifest({
    cfg, docs: [], sections: [], packSummaries: [], contentVersion: "deadbeef", findings: [], pins,
  });
  ok(/## Pins/.test(md), "the MANIFEST has a Pins section");
  ok(md.includes("forge-app-builder#core-concepts") && md.includes("| coder |"),
    "and it renders the audience -> pin map the selector reads");
  ok(md.includes("forge-app-builder/jira-forge/core-concepts-1"),
    "naming the sections the pin actually resolves to");
}

/* ---- the shipped allow-list is itself well-formed ---- */
{
  const sourcesPath = path.join(repoRoot, "knowledge/sources.json");
  const cfg = JSON.parse((await import("node:fs")).readFileSync(sourcesPath, "utf8"));
  const selector = await import(pathToFileURL(path.join(repoRoot, "src/shared/knowledge-select.js")).href);
  for (const [pack, meta] of Object.entries(cfg.packs || {})) {
    for (const pin of meta.pinned || []) {
      ok(selector.parsePin(pin) !== null, `sources.json: ${pack} pin "${pin}" is a SECTION pin`);
      ok(Array.isArray(meta.pinnedFor) && meta.pinnedFor.length,
        `sources.json: ${pack} declares the audiences its pins are for`);
    }
  }
  ok(true, "knowledge/sources.json is the one home for pins");
}

console.log(`\nbake-knowledge: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
