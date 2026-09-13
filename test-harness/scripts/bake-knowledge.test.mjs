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

/* ---- the drift probe REFUSES on the exit code (F-435) ----
   `--check` used to print "NOT A PASS — no baked packs exist yet" and exit 0, which is
   the only thing a CI step or a pre-commit hook can read. "No packs" is not "packs are
   current": a negative that authorises action must be proven. */
{
  const indexPath = path.join(repoRoot, "src/shared/knowledge-index.js");
  const fs = await import("node:fs");
  const indexPresent = fs.existsSync(indexPath);
  const r = run(`B.checkIndexCurrent("0000000000000000");`);
  ok(r.status !== 0,
    `checkIndexCurrent refuses with a NON-ZERO exit (${indexPresent ? "index present, hash mismatch" : "index absent"}) — got ${r.status}`);
  ok(/NOT A PASS|has changed since the last bake/.test(r.out), "and the refusal says why");
  if (!indexPresent) ok(/NOT A PASS/.test(r.out), "an absent index is explicitly NOT A PASS");
  else ok(true, "an absent index cannot be asserted here — the index is committed");
}

/* ---- a HAND EDIT of the generated index fails the gate (F-570) ----
   F-558 hand-patched `KNOWLEDGE_PINS` into src/shared/knowledge-index.js and left
   `KNOWLEDGE_PACKS[].pinned` behind. The corpus was untouched, so the content version
   still matched and `npm run bake:check` reported the packs current while the Knowledge
   tab told the admin the VA's pinned core did not exist.

   The trap this test exists to hold shut: comparing a metadata FINGERPRINT STORED IN THE
   FILE against one computed from the corpus does NOT catch it — the hand editor changes
   the `pinned` list and not the constant, so the two still agree. A fingerprint defends
   only what it is recomputed from. The gate therefore re-emits the index and compares the
   bytes on disk. */
{
  const fs = await import("node:fs");
  const indexPath = path.join(repoRoot, "src/shared/knowledge-index.js");
  const current = fs.readFileSync(indexPath, "utf8");
  const contentVersion = (/KNOWLEDGE_CONTENT_VERSION = "([a-f0-9]+)"/.exec(current) || [])[1];
  ok(!!contentVersion, "the committed index pins a content version");
  ok(/KNOWLEDGE_INDEX_META_VERSION = "[a-f0-9]+"/.test(current),
    "and a metadata fingerprint, so a reader can see at a glance that the metadata moved");

  // Identical bytes pass.
  const same = run(`B.checkIndexCurrent(${JSON.stringify(contentVersion)}, ${JSON.stringify(current)});`);
  ok(same.status === 0, `an untouched index passes --check (exit ${same.status})`);

  // A pin moved in KNOWLEDGE_PACKS[].pinned, with the stored fingerprint left alone —
  // EXACTLY the F-570 edit — must refuse.
  const handEdited = current.replace('"administrator-practice#administrator-practice"', '"administrator-practice#not-a-thing"');
  ok(handEdited !== current, "the fixture edit landed (the va pin is in the committed index)");
  const drifted = run(`B.checkIndexCurrent(${JSON.stringify(contentVersion)}, ${JSON.stringify(handEdited)});`);
  ok(drifted.status !== 0, `a hand-edited pin list REFUSES --check (exit ${drifted.status})`);
  ok(/NOT what the bake would write/.test(drifted.out), "and the refusal says the file is not what the bake would write");
  ok(/F-570/.test(drifted.out), "pointing at knowledge/sources.json as the one home");
}

/* ---- the two pin emitters must agree (F-570) ----
   `KNOWLEDGE_PACKS[].pinned` (what the Knowledge tab renders) and `KNOWLEDGE_PINS` (what
   the selector reads) are two views of one list. They disagreed on a shipped build. */
{
  const packs = [
    { id: "administrator-practice", pinned: ["administrator-practice#administrator-practice"] },
    { id: "other", pinned: [] },
  ];
  ok(bake.assertPinsAgree(packs, { va: ["administrator-practice#administrator-practice"] }) === true,
    "agreeing emitters pass");

  const lie = run(`B.assertPinsAgree(${JSON.stringify([{ id: "administrator-practice", pinned: [] }])}, ${JSON.stringify({ va: ["administrator-practice#administrator-practice"] })});`);
  ok(lie.status !== 0, `a pin the pack does not declare REFUSES the bake (exit ${lie.status})`);
  ok(/does not list it/.test(lie.out) && /NOTHING was written/.test(lie.out),
    "and it refuses before the emit, naming the pack");

  const orphan = run(`B.assertPinsAgree(${JSON.stringify(packs)}, {});`);
  ok(orphan.status !== 0, `a declared pin no audience reads REFUSES too (exit ${orphan.status})`);
  ok(/no audience pins it/.test(orphan.out), "naming the missing pinnedFor");

  const unknown = run(`B.assertPinsAgree([], ${JSON.stringify({ va: ["ghost-pack#thing"] })});`);
  ok(unknown.status !== 0, `a pin whose pack was not baked REFUSES (exit ${unknown.status})`);
}

/* ---- the committed index's two pin emitters agree RIGHT NOW ----
   The regression assertion proper: read the shipped artefact, not a fixture. */
{
  const fs = await import("node:fs");
  const indexUrl = pathToFileURL(path.join(repoRoot, "src/shared/knowledge-index.js")).href;
  const idx = await import(indexUrl);
  const declared = new Map((idx.KNOWLEDGE_PACKS || []).map((p) => [p.id, new Set(p.pinned || [])]));
  let agree = true;
  for (const [audience, pins] of Object.entries(idx.KNOWLEDGE_PINS || {})) {
    for (const pin of pins) {
      const pack = String(pin).split("#")[0].split("/")[0];
      if (!declared.get(pack)?.has(pin)) { agree = false; console.log(`  ${audience} pins ${pin}, pack ${pack} does not declare it`); }
    }
  }
  ok(agree, "every KNOWLEDGE_PINS entry appears in its pack's `pinned` list in the committed index");
  ok((idx.KNOWLEDGE_PINS?.va || []).length > 0
    && declared.get("administrator-practice")?.has("administrator-practice#administrator-practice"),
    "the VA's administrator-practice pin is visible to the Knowledge tab (the F-570 symptom)");
  void fs;
}

/* ---- the UI titles module is SMALL, and stays small (F-573) ----
   `knowledge-index.js` is 136 KB of tags, audiences, byte counts and provenance, and
   FieldGuideChip — statically imported by three bundles through CoderPanel — used it for
   `{id, title}`. Measured on the blobs: issue-glance's bundle went 254 713 B -> 355 753 B
   (+40 %) to render a label on a panel that may never show a Coder turn.

   The cap defended here is the RATIO. A titles module that grows into the index is the
   finding undone, and a number nothing asserts is a comment. */
{
  const fs = await import("node:fs");
  const titlesPath = path.join(repoRoot, "src/shared/knowledge-titles.js");
  const indexPath = path.join(repoRoot, "src/shared/knowledge-index.js");
  ok(fs.existsSync(titlesPath), "the bake emits src/shared/knowledge-titles.js");

  const titlesBytes = fs.statSync(titlesPath).size;
  const indexBytes = fs.statSync(indexPath).size;
  ok(titlesBytes <= bake.TITLES_MAX_BYTES,
    `knowledge-titles.js is ${titlesBytes} B, within the ${bake.TITLES_MAX_BYTES} B ceiling`);
  ok(titlesBytes <= indexBytes * bake.TITLES_MAX_INDEX_FRACTION,
    `and ${((titlesBytes / indexBytes) * 100).toFixed(0)} % of the ${indexBytes} B index `
    + `(ceiling ${(bake.TITLES_MAX_INDEX_FRACTION * 100).toFixed(0)} %)`);

  const titles = await import(pathToFileURL(titlesPath).href);
  const idx = await import(pathToFileURL(indexPath).href);
  const ids = Object.keys(titles.KNOWLEDGE_TITLES || {});
  ok(ids.length === idx.KNOWLEDGE_INDEX.length,
    `every baked section has a title (${ids.length} of ${idx.KNOWLEDGE_INDEX.length})`);
  let sameTitles = true;
  for (const s of idx.KNOWLEDGE_INDEX) if (titles.KNOWLEDGE_TITLES[s.id] !== s.title) sameTitles = false;
  ok(sameTitles, "and it is the SAME title the index carries — two emitters, one source");
  ok(titles.KNOWLEDGE_TITLES_VERSION === idx.KNOWLEDGE_CONTENT_VERSION,
    "the two generated modules pin the same content version, so one cannot go stale alone");

  // It must carry ONLY titles: a tag or a provenance block creeping back in is how it
  // grows into the index again.
  const src = fs.readFileSync(titlesPath, "utf8");
  ok(!/"tags"|"provenance"|"audience"|"bytes"/.test(src),
    "it carries no tags, audiences, byte counts or provenance");
  ok(Object.keys(titles.KNOWLEDGE_PACK_TITLES || {}).length === idx.KNOWLEDGE_PACKS.length,
    "pack titles ride along so a chip need not reach back to the index");

  // And the drift probe covers it, or it is a generated file with no gate.
  const stale = run(`B.checkTitlesCurrent("not what the bake would write");`);
  ok(stale.status !== 0, `a stale titles module REFUSES --check (exit ${stale.status})`);
  ok(run(`B.checkTitlesCurrent(${JSON.stringify(src)});`).status === 0,
    "and the committed one passes");
}

/* ---- a pin that outgrows its share REFUSES the bake (F-576) ----
   Forgiving at runtime, strict at bake time. The runtime lets a too-big pin fall through
   to the scorer, which is right; the bake is where the growth happens and the last moment
   a human is looking, so it refuses rather than shipping a guardrail that evaporates on
   the wrong query. */
{
  const ap = await import(pathToFileURL(path.join(repoRoot, "src/shared/knowledge-packs/administrator-practice.js")).href);
  const pins = { va: ["administrator-practice#administrator-practice"] };

  ok(bake.assertPinnedSectionsFitShare(ap.SECTIONS, pins) === true,
    "today's corpus passes: every pinned section fits its audience's share");

  const idx = await import(pathToFileURL(path.join(repoRoot, "src/shared/knowledge-index.js")).href);
  const pinnedId = (idx.KNOWLEDGE_INDEX.find((s) => /administrator-practice-1$/.test(s.id)) || {}).id;
  ok(!!pinnedId, "the va pin resolves to a section in the committed index");
  const grown = ap.SECTIONS.map((s) => (s.id === pinnedId ? { ...s, body: `${s.body}\n${"x".repeat(300)}` } : s));

  const r = run(`import { SECTIONS } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src/shared/knowledge-packs/administrator-practice.js")).href)};\n`
    + `const grown = SECTIONS.map((s) => (s.id === ${JSON.stringify(pinnedId)} ? { ...s, body: s.body + "\\n" + "x".repeat(300) } : s));\n`
    + `B.assertPinnedSectionsFitShare(grown, ${JSON.stringify(pins)});`);
  ok(r.status !== 0, `a pinned section 300 B past the share REFUSES the bake (exit ${r.status})`);
  ok(/does not fit the .* pinned share/.test(r.out), "and the refusal names the share it no longer fits");
  ok(/NOTHING was written/.test(r.out), "refusing before the emit, as everywhere else here");
  ok(new RegExp(pinnedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(r.out), "naming the section by id");
  void grown;
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

/* ---- section ids are UNIQUE ACROSS FILES of one source (F-438) ----
   The id used to carry the source id and the per-DOCUMENT chunk index, which restarts at
   0 for every document — so two files of one source that both open with `## Overview`
   minted the same id, and nothing checked. */
{
  const fileA = "skills/jira-forge/16-resolver-patterns.md";
  const fileB = "skills/jira-forge/24-production-patterns.md";
  const doc = "## Overview\n\nSome prose about resolvers and patterns.\n";

  const idsFor = (docPath) => bake.chunkMarkdown(doc, { title: "Doc" }).map((c, i) =>
    bake.sectionIdFor({ pack: "forge-app-builder", sourceId: "jira-forge", path: docPath, title: c.title, index: i }));

  const a = idsFor(fileA);
  const b = idsFor(fileB);
  ok(a.length === 1 && b.length === 1, "each fixture chunks to one section");
  ok(a[0] !== b[0], `two files sharing a heading mint DIFFERENT ids (${a[0]} vs ${b[0]})`);
  ok(a[0].startsWith("forge-app-builder/jira-forge/") && a[0].endsWith("/overview-1"),
    `the id still reads pack/source/file/heading (${a[0]})`);
  ok(idsFor(fileA)[0] === a[0], "the id is stable for the same file — ids ride into receipts");
  // The file segment hashes the PATH, not the content: an edit must not rename the section.
  const edited = bake.chunkMarkdown("## Overview\n\nDifferent prose entirely.\n", { title: "Doc" })
    .map((c, i) => bake.sectionIdFor({ pack: "forge-app-builder", sourceId: "jira-forge", path: fileA, title: c.title, index: i }));
  ok(edited[0] === a[0], "editing the document does not change its section id");
}
{
  const uniq = [{ id: "p/s/h/a-1" }, { id: "p/s/h/b-1" }];
  ok(bake.assertUniqueSectionIds(uniq) === 2, "unique ids pass the emit assertion");
  const r = run(`B.assertUniqueSectionIds([{id:"p/s/h/a-1",provenance:{path:"one.md"}},{id:"p/s/h/a-1",provenance:{path:"two.md"}}]);`);
  ok(r.status !== 0, `a duplicate id REFUSES the bake (exit ${r.status})`);
  ok(/collision/.test(r.out) && /NOTHING was written/.test(r.out),
    "and it names the collision and refuses before the emit");
  ok(/one\.md/.test(r.out) && /two\.md/.test(r.out), "naming both source documents");
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
