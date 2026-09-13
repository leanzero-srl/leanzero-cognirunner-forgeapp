/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE KNOWLEDGE BAKE (plan §3.15).
 *
 * Turns the allow-listed corpus in the gitignored `knowledge/raw/` into versioned,
 * dependency-free field-guide packs under `src/shared/knowledge-packs/`, plus
 * `src/shared/knowledge-index.js` (titles/tags/provenance only, for the UIs) and
 * `knowledge/MANIFEST.md` — the artefact a human reads BEFORE any pack is committed.
 *
 * It runs on the LAPTOP, never in the app. Nothing in this file ships to a tenant.
 *
 * THE ORDER OF THE STAGES IS THE SAFETY PROPERTY:
 *
 *   0. guards      — the leak scanner's own positive/negative controls must pass, before
 *                    a single real byte is read. A scanner that has quietly stopped
 *                    matching looks exactly like a clean corpus.
 *   1. sources     — knowledge/sources.json only. No directory sweep: a sweep picks up
 *                    whatever somebody drops into the corpus next month. Every resolved
 *                    path is matched against `never` and the bake dies on a hit.
 *   2. scrub       — named line deletions + regex replacements. A `reauthor: true`
 *                    section is NEVER copied; the bake REFUSES until a hand-written
 *                    replacement exists in knowledge/authored/.
 *   3. leak scan   — the whole SCRUBBED corpus, with the local denylist. Any fatal
 *                    finding stops the bake HERE, before anything is written.
 *   4. chunk       — 2-4 KB sections by heading, with tags, audience and provenance.
 *   5. emit        — packs + index + MANIFEST.md.
 *
 * Stage 3 precedes stage 5 deliberately, and that is not stylistic. This is the
 * `commitImportCore` lesson in another costume: a refused import must not leave a live
 * rule attached, and a refused bake must not leave a leaked pack on disk for however long
 * it takes somebody to notice. The check comes before the side effect, always.
 *
 * Usage:
 *   node scripts/bake-knowledge.mjs            # bake
 *   node scripts/bake-knowledge.mjs --check    # pinned-hash check (npm run bake:check)
 *   node scripts/bake-knowledge.mjs --dry-run  # everything except writing files
 */

import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runGuardFixtures, loadDenylist, scanText, formatFindings } from "./leak-scan.mjs";
// The SELECTOR's own pin parser and matcher (F-429). The bake must decide "does this pin
// match anything?" with the same code the runtime uses, or the MANIFEST goes back to
// describing a selector that does not exist.
import {
  parsePin, pinMatchesSection, selectKnowledge, PINNED_BUDGET_SHARE,
} from "../src/shared/knowledge-select.js";
import { fieldGuideBudget } from "../src/shared/registry-limits.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = {
  sources: path.join(repoRoot, "knowledge/sources.json"),
  raw: path.join(repoRoot, "knowledge/raw"),
  authored: path.join(repoRoot, "knowledge/authored"),
  fixtures: path.join(repoRoot, "knowledge/fixtures"),
  denylist: path.join(repoRoot, "knowledge/denylist.local"),
  packs: path.join(repoRoot, "src/shared/knowledge-packs"),
  index: path.join(repoRoot, "src/shared/knowledge-index.js"),
  titles: path.join(repoRoot, "src/shared/knowledge-titles.js"),
  manifest: path.join(repoRoot, "knowledge/MANIFEST.md"),
};

/** Sections are chunked to land inside this window. 4 KB is the hard ceiling (tested). */
export const SECTION_TARGET_BYTES = 2048;
export const SECTION_MAX_BYTES = 4096;
/** A pack past this is a design mistake, not a big pack: the whole bundle ships to every tenant. */
export const PACK_MAX_BYTES = 200 * 1024;
/**
 * The UI-facing titles module's ceiling (F-573). It exists to be SMALL: the moment it is
 * not, the frontends are back to shipping the index and the finding is undone.
 *
 * THE ARITHMETIC, measured on today's 179-section corpus, because the number is not a
 * preference. A flat `id -> title` map cannot be made much smaller than it is:
 *
 *   section ids          14 855 B  (179 ids, avg 83 B — `pack/source/filehash/slug-N`)
 *   section titles        6 725 B  (175 of 179 are unique, so de-duplicating buys nothing)
 *   JSON punctuation      ~1 100 B
 *   pack titles + header  ~2 400 B
 *   -----------------------------
 *   emitted               25 095 B
 *
 * Two smaller shapes were measured and rejected: nesting by pack and document saves
 * 3.5 KB (15 618 B of body) but makes every chip split an id to look a title up, moving
 * logic into three byte-identical frontend copies to save a fifth of an already small
 * file; interning titles saves nothing, since they are almost all distinct. The ids are
 * the cost, and they are the thing that cannot change — they ride in saved
 * `generationMeta` and in tick receipts.
 *
 * So the ceiling is set just above what the corpus actually costs. The CLAIM being
 * defended is the ratio, not the absolute: 25 KB against the index's 138 KB is an 82 %
 * saving on the three UI bundles, and `knowledge-titles.test` asserts that ratio too.
 * A corpus that outgrows this needs a decision — fetch the titles, or nest them — not a
 * bigger number here.
 */
export const TITLES_MAX_BYTES = 28 * 1024;
/** ...and it must stay a small FRACTION of the index, which is the point of it existing. */
export const TITLES_MAX_INDEX_FRACTION = 0.25;

const die = (msg, code = 1) => { console.error(`bake-knowledge: ${msg}`); process.exit(code); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const utf8 = (s) => Buffer.byteLength(s, "utf8");
const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/* ================================================================== *
 * Stage 0 — preflight
 * ================================================================== */

/** Prove the scanner against its own fixtures, then prove the denylist EXISTS. */
export const runPreflight = () => {
  const guard = runGuardFixtures(P.fixtures);
  if (!guard.ok) {
    console.error("bake-knowledge: leak-scanner guards FAILED — refusing to bake:");
    for (const p of guard.problems) console.error(`  ${p}`);
    process.exit(2);
  }
  console.log(`bake-knowledge: guards ok (${guard.leaks} positive, ${guard.cleans} negative controls)`);

  const denylist = loadDenylist(P.denylist);
  if (!denylist.present) {
    die("knowledge/denylist.local is missing. Copy knowledge/denylist.local.example and fill it in.\n"
      + "  A missing denylist is not a clean scan — it is an unrun check.", 2);
  }
  console.log(`bake-knowledge: denylist ok (${denylist.terms.length} terms, ${denylist.keys.length} project keys, ${denylist.regexes.length} patterns)`);
  return { denylist };
};

/* ================================================================== *
 * Stage 1 — sources and the NEVER list
 * ================================================================== */

export const readSources = () => {
  if (!existsSync(P.sources)) die("knowledge/sources.json does not exist.", 2);
  let cfg;
  try { cfg = JSON.parse(readFileSync(P.sources, "utf8")); } catch (e) { return die(`knowledge/sources.json is not valid JSON: ${e.message}`, 2); }
  if (!Array.isArray(cfg.sources) || !cfg.sources.length) die("knowledge/sources.json lists no sources.", 2);
  return cfg;
};

/**
 * The second lock. The allow-list already decides what is read; this refuses a path that
 * names a client desk, a LeanZero operations skill, an excluded repo or a credentials
 * file even if somebody adds it to `sources`. Matched on WORD boundaries rather than as a
 * bare substring, because a substring match on a short term like `ness` would also refuse
 * `business-rules.md` and teach the next person to delete the check.
 */
export const violatesNever = (candidate, never = []) => {
  const hay = String(candidate);
  for (const term of never) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i");
    if (re.test(hay)) return term;
  }
  return null;
};

/* ================================================================== *
 * Stage 2 — scrub and re-author
 * ================================================================== */

/**
 * Named line deletions first, then regex replacements. A deleted line leaves a marker
 * comment rather than a silent hole, so the MANIFEST can say how much was removed and a
 * reviewer can tell "nothing was there" from "something was taken out".
 */
export const applyScrub = (text, scrub = {}) => {
  let deleted = 0;
  const deleters = (scrub.deleteLinesMatching || []).map((r) => {
    const ci = r.startsWith("(?i)");
    return new RegExp(ci ? r.slice(4) : r, ci ? "i" : "");
  });
  let lines = String(text).split(/\r?\n/);
  if (deleters.length) {
    lines = lines.filter((line) => {
      if (deleters.some((re) => re.test(line))) { deleted++; return false; }
      return true;
    });
  }
  let out = lines.join("\n");
  let replaced = 0;
  for (const [pattern, replacement] of scrub.replace || []) {
    const re = new RegExp(pattern, "gi");
    out = out.replace(re, () => { replaced++; return replacement; });
  }
  return { text: out, deleted, replaced };
};

/**
 * A `reauthor: true` source is NOT copied — not even into knowledge/raw/. Its pack is
 * built from a hand-written file in knowledge/authored/, and the bake REFUSES when that
 * file is missing. Both halves matter: without the refusal the pack ships silently empty,
 * and without the "not copied" half the original prose (tenant hosts, client names,
 * quoted corpus lines) travels into the bundle behind a flag nobody re-reads.
 */
export const resolveAuthored = (source) => {
  const file = path.join(P.authored, source.authored || `${source.id}.md`);
  if (!existsSync(file)) {
    return { ok: false, file, message:
      `source "${source.id}" is marked reauthor:true and has no hand-written replacement at `
      + `knowledge/authored/${path.basename(file)}.\n`
      + `  Tier ${source.tier} content is NEVER copied. Write the replacement in our own words `
      + `(it must cover: ${(source.covers || []).join(", ") || "the facts named in sources.json"}), then re-run.` };
  }
  return { ok: true, file, text: readFileSync(file, "utf8") };
};

/* ================================================================== *
 * Stage 4 — the chunker
 * ================================================================== */

/**
 * Entity tags. A model asking "why is this 429 happening" and a section that mentions
 * `429` should meet without a human having curated that word — so module keys, REST paths
 * and HTTP status codes are lifted out of the body and become tags. Capped, because a
 * section with 90 tags scores against everything and is therefore selected for nothing.
 */
export const extractEntities = (text) => {
  const out = new Set();
  for (const m of text.matchAll(/\b(?:jira|confluence|bitbucket|compass):[A-Za-z]+\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\/rest\/[A-Za-z0-9/_.-]{3,60}/g)) out.add(m[0].replace(/[.,)]+$/, ""));
  for (const m of text.matchAll(/\b(?:HTTP\s*)?(4\d{2}|5\d{2})\b/g)) out.add(`http-${m[1]}`);
  for (const m of text.matchAll(/\b(?:api|storage|kvs|route|invoke|asApp|asUser|requestJira|requestConfluence)\b/g)) out.add(m[0].toLowerCase());
  return [...out].slice(0, 24);
};

const STOP_TITLE_WORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is", "are", "how", "what", "why", "when"]);

const titleTags = (title) => String(title).toLowerCase().split(/[^a-z0-9+#.]+/)
  .filter((w) => w.length > 2 && !STOP_TITLE_WORDS.has(w)).slice(0, 8);

/**
 * Last-resort split of a single oversized paragraph, on line boundaries. If the cut lands
 * inside a ``` fence, the piece is closed and the next one re-opened, so every emitted
 * section is still parseable markdown on its own.
 */
export const splitOversized = (para) => {
  const lines = String(para).split("\n");
  const pieces = [];
  let buf = [];
  let fenceOpen = false;
  let carryFence = false;
  const flush = () => {
    if (!buf.length) return;
    let body = buf.join("\n");
    if (carryFence) body = "```\n" + body;
    if (fenceOpen) body = body + "\n```";
    pieces.push(body);
    carryFence = fenceOpen;
    buf = [];
  };
  for (const line of lines) {
    if (utf8([...buf, line].join("\n")) > SECTION_MAX_BYTES - 16 && buf.length) flush();
    if (/^\s*```/.test(line)) fenceOpen = !fenceOpen;
    buf.push(line);
  }
  flush();
  return pieces;
};

/**
 * Split a markdown document into sections on `##`/`###` headings, then make every section
 * land in the 2-4 KB window:
 *   - oversized  → split on paragraph boundaries (never mid-sentence, never mid-fence),
 *                  each piece keeping the heading and gaining a "(part n)" title;
 *   - undersized → merged with the NEXT sibling while the result still fits 4 KB.
 * A trailing short section is allowed to stay short: padding it would mean merging across
 * a heading that has nothing to do with it.
 */
export const chunkMarkdown = (text, { title: docTitle = "" } = {}) => {
  const lines = String(text).split(/\r?\n/);
  const raw = [];
  let current = { title: docTitle, lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{2,3})\s+(.*\S)\s*$/.exec(line);
    if (h) {
      if (current.lines.join("\n").trim()) raw.push(current);
      current = { title: h[2].replace(/[#*`]/g, "").trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.join("\n").trim()) raw.push(current);

  // Oversized → paragraph split.
  const split = [];
  for (const sec of raw) {
    const body = sec.lines.join("\n").trim();
    if (utf8(body) <= SECTION_MAX_BYTES) { split.push({ title: sec.title, body }); continue; }
    const paras = body.split(/\n{2,}/);
    let buf = [];
    let part = 1;
    const flush = () => {
      const t = buf.join("\n\n").trim();
      if (t) split.push({ title: `${sec.title} (part ${part++})`, body: t });
      buf = [];
    };
    for (const para of paras) {
      const next = [...buf, para].join("\n\n");
      if (buf.length && utf8(next) > SECTION_MAX_BYTES) flush();
      // A single paragraph past the ceiling is almost always one long fenced code block.
      // The 4 KB ceiling is a tested invariant, so it wins — but the cut is made on LINE
      // boundaries and the fence is re-opened on the far side, because handing a model a
      // code block that starts mid-statement AND never closes teaches it broken syntax.
      if (utf8(para) > SECTION_MAX_BYTES) {
        if (buf.length > 1) { buf.pop(); flush(); }
        else buf = [];
        for (const piece of splitOversized(para)) split.push({ title: `${sec.title} (part ${part++})`, body: piece });
        continue;
      }
      buf.push(para);
    }
    flush();
  }

  // Undersized → merge forwards.
  const merged = [];
  for (const sec of split) {
    const prev = merged[merged.length - 1];
    if (prev && utf8(prev.body) < SECTION_TARGET_BYTES
      && utf8(`${prev.body}\n\n## ${sec.title}\n${sec.body}`) <= SECTION_MAX_BYTES) {
      prev.body = `${prev.body}\n\n## ${sec.title}\n${sec.body}`;
      prev.mergedTitles = [...(prev.mergedTitles || [prev.title]), sec.title];
      continue;
    }
    merged.push({ ...sec });
  }
  return merged.filter((s) => s.body.trim().length > 0);
};

/* ================================================================== *
 * Stage 5 — emit
 * ================================================================== */

const GENERATED_HEADER = (what) => `/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * ${what}
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */
`;

const emitPack = (pack, sections) =>
  `${GENERATED_HEADER(`Field-guide pack "${pack}" — ${sections.length} sections.`)}
export const PACK_ID = ${JSON.stringify(pack)};

export const SECTIONS = ${JSON.stringify(sections, null, 2)};

export default SECTIONS;
`;

/**
 * THE INDEX METADATA FINGERPRINT (F-570).
 *
 * `KNOWLEDGE_CONTENT_VERSION` hashes the section BODIES, so it is blind to everything the
 * index says ABOUT them. F-558 hand-patched `KNOWLEDGE_PINS` into this generated file and
 * left `KNOWLEDGE_PACKS[].pinned` behind; the corpus was untouched, the content version
 * still matched, and `--check` reported the packs current while the Knowledge tab told the
 * admin the VA's pinned core did not exist. A generated file that can be hand-edited
 * without failing its own gate is not generated, it is advisory.
 *
 * So this hashes the metadata the gate must also defend: every pack's `pinned` list, the
 * whole pin map, and each section's audiences. Bodies stay in KNOWLEDGE_CONTENT_VERSION —
 * two fingerprints, two questions, and `--check` asks both.
 */
export const indexMetaFingerprint = (sections, packs, pins = {}) => sha(JSON.stringify({
  packs: packs.map((p) => ({ id: p.id, pinned: [...(p.pinned || [])].sort() })),
  pins: Object.keys(pins).sort().map((a) => [a, [...pins[a]].sort()]),
  audiences: sections.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((s) => [s.id, [...(s.audience || [])].sort()]),
})).slice(0, 16);

/**
 * THE TWO PIN EMITTERS MUST AGREE (F-570). `KNOWLEDGE_PACKS[].pinned` and `KNOWLEDGE_PINS`
 * are two views of ONE list in knowledge/sources.json — the tab reads the first, the
 * selector reads the second. They disagreed on a shipped build. Asserted at bake time,
 * before the emit, because the check comes before the side effect.
 */
export const assertPinsAgree = (packs, byAudience = {}) => {
  const declared = new Map(packs.map((p) => [p.id, new Set(p.pinned || [])]));
  const problems = [];
  const seen = new Set();
  for (const [audience, pins] of Object.entries(byAudience)) {
    for (const pin of pins) {
      seen.add(pin);
      const pack = String(pin).split("#")[0].split("/")[0];
      if (!declared.has(pack)) {
        problems.push(`KNOWLEDGE_PINS.${audience} pins "${pin}" whose pack "${pack}" was not baked`);
      } else if (!declared.get(pack).has(pin)) {
        problems.push(`KNOWLEDGE_PINS.${audience} pins "${pin}" but KNOWLEDGE_PACKS["${pack}"].pinned does not list it`);
      }
    }
  }
  for (const p of packs) {
    for (const pin of p.pinned || []) {
      if (!seen.has(pin)) problems.push(`pack "${p.id}" declares pinned "${pin}" but no audience pins it (missing "pinnedFor")`);
    }
  }
  if (problems.length) {
    die(`the two pin emitters disagree — NOTHING was written:\n  ${problems.join("\n  ")}`, 1);
  }
  return true;
};

/**
 * EVERY PINNED SECTION MUST FIT ITS AUDIENCE'S SHARE (F-576).
 *
 * The runtime is deliberately forgiving here: a pin that does not fit `PINNED_BUDGET_SHARE`
 * is not dropped, it falls through to the scorer and competes. That is the right behaviour
 * and it is also what makes the failure silent — on a query that does not favour it, the
 * section the pack exists to pin is just absent.
 *
 * Forgiving at runtime, strict at BAKE time. The bake is where the growth actually happens
 * (somebody adds two sentences to the corpus) and it is the last moment a human is looking,
 * so a pin that no longer fits refuses the bake instead of shipping a guardrail that
 * evaporates on the wrong query. Measured with the SELECTOR's own code — the same
 * `selectKnowledge` the runtime calls, with only the pinned pass's outcome read — because
 * a second implementation of the cost arithmetic here is exactly the defect this repo
 * keeps paying for.
 *
 * The query is empty on purpose: with no query the scorer selects nothing, so `chosen` is
 * the pinned pass and nothing else, which is the question being asked.
 */
export const assertPinnedSectionsFitShare = (sections, byAudience = {}) => {
  const problems = [];
  for (const [audience, pins] of Object.entries(byAudience)) {
    if (!pins.length) continue;
    const picked = selectKnowledge({ audience, text: "", sections, pins });
    const budget = fieldGuideBudget(audience);
    const share = Math.floor(budget * PINNED_BUDGET_SHARE);
    for (const id of picked.pinnedDropped || []) {
      problems.push(`audience "${audience}": pinned section ${id} does not fit the ${share} B pinned share `
        + `(${PINNED_BUDGET_SHARE * 100} % of ${budget} B); ${picked.pinnedBytes} B fit`);
    }
    const headroom = share - (picked.pinnedBytes || 0);
    console.log(`  pinned share · ${audience.padEnd(10)} ${String(picked.pinnedBytes || 0).padStart(5)} B of ${share} B `
      + `(${headroom} B headroom, ${picked.sectionIds.length} section(s))`);
  }
  if (problems.length) {
    die("a pinned section no longer fits its audience's share — it would fall through to the\n"
      + "  scorer and go missing on any query that does not favour it (F-576). NOTHING was written:\n  "
      + problems.join("\n  "), 1);
  }
  return true;
};

const emitIndex = (sections, packs, contentVersion, metaVersion, pins = {}) =>
  `${GENERATED_HEADER("The knowledge INDEX: titles, tags, audiences and provenance — no bodies.\n *\n * This is the module the UI bundles import. Bodies live in the packs and are only ever\n * loaded by the backend, so a Knowledge tab costs kilobytes rather than megabytes.")}
/** Content fingerprint of the baked corpus. Changes whenever any section changes. */
export const KNOWLEDGE_CONTENT_VERSION = ${JSON.stringify(contentVersion)};

/**
 * Fingerprint of this file's METADATA — pack pin lists, the pin map, section audiences.
 * \`KNOWLEDGE_CONTENT_VERSION\` only hashes bodies, so it cannot see a hand edit here;
 * \`npm run bake:check\` compares BOTH and fails on either (F-570).
 */
export const KNOWLEDGE_INDEX_META_VERSION = ${JSON.stringify(metaVersion)};

export const KNOWLEDGE_PACKS = ${JSON.stringify(packs, null, 2)};

/**
 * The PINS the selector reads — audience -> section pins, from knowledge/sources.json
 * (\`packs[].pinned\` + \`packs[].pinnedFor\`). ONE home: the backend registers this map
 * with \`registerKnowledgePins\` and knowledge/MANIFEST.md renders the same object.
 */
export const KNOWLEDGE_PINS = ${JSON.stringify(pins, null, 2)};

export const KNOWLEDGE_INDEX = ${JSON.stringify(sections.map((s) => ({
    id: s.id, pack: s.pack, title: s.title, tags: s.tags, audience: s.audience,
    bytes: s.bytes, provenance: s.provenance,
  })), null, 2)};

export default KNOWLEDGE_INDEX;
`;

/**
 * THE TITLES MODULE (F-573) — the only knowledge artefact a FRONTEND should import.
 *
 * `knowledge-index.js` is 136 KB because it carries tags, audiences, byte counts and
 * provenance for 179 sections. `FieldGuideChip` needs `{id -> title}` and nothing else, and
 * it is statically imported (through CoderPanel) by three bundles — measured on the
 * issue-glance bundle, that one label cost +101 040 B, a 40 % growth on a read-only
 * right-rail panel that may never render a Coder turn. Webpack cannot help: the index is
 * one array literal of object literals, every key reachable.
 *
 * So the bake emits the map directly: 25 KB against the index's 138 KB, an 82 % saving on
 * every bundle that renders a chip. The index KEEPS everything it has and stays the
 * backend's and the Knowledge tab's module — the Knowledge tab really does render tags and
 * provenance, and paying 136 KB on an admin page somebody opened on purpose is a different
 * trade from paying it on every issue view.
 *
 * Pack titles ride along because they are nine rows and a chip that groups by pack should
 * not have to reach back to the index for them.
 */
const emitTitles = (sections, packs, contentVersion) =>
  `${GENERATED_HEADER("Section and pack TITLES only — the module the UI bundles import.\n *\n * id -> title, nothing else. The full index (tags, audiences, byte counts, provenance)\n * is src/shared/knowledge-index.js and belongs to the backend and the Knowledge tab;\n * importing THAT from a frontend ships 136 KB to render a label (F-573).")}
/** Content fingerprint of the baked corpus — the same value src/shared/knowledge-index.js pins. */
export const KNOWLEDGE_TITLES_VERSION = ${JSON.stringify(contentVersion)};

export const KNOWLEDGE_PACK_TITLES = ${JSON.stringify(Object.fromEntries(packs.map((p) => [p.id, p.title])), null, 2)};

export const KNOWLEDGE_TITLES = ${JSON.stringify(Object.fromEntries(sections.map((s) => [s.id, s.title])), null, 2)};

export default KNOWLEDGE_TITLES;
`;

/* ================================================================== *
 * The run
 * ================================================================== */

/**
 * THE SECTION ID (F-438). `pack / source / file / heading-slug - chunk index`.
 *
 * The FILE segment is what the first version was missing: the id carried the source id and
 * the per-DOCUMENT chunk index, and that index restarts at 0 for every document — so two
 * files of one source that both open with `## Overview` minted the SAME id. Nothing
 * de-duplicated at emit, `scoreSections` counted both in the idf denominator, the selector
 * could spend the budget twice on near-duplicates, and a `sectionIds` entry in a
 * generationMeta chip or a tick receipt named a section a reader could not resolve to one
 * body. `KNOWLEDGE_CONTENT_VERSION` still hashed cleanly, so `--check` never noticed.
 *
 * The segment is a hash of the file PATH, not of its contents: an id must survive an edit
 * to the document it names, because ids are recorded in receipts and generationMeta. It is
 * short because it is a disambiguator, not a fingerprint — the content fingerprint is
 * KNOWLEDGE_CONTENT_VERSION, and the provenance hash rides on the section itself.
 */
export const sectionIdFor = ({ pack, sourceId, path: docPath, title, index }) =>
  `${pack}/${slug(sourceId)}/${sha(String(docPath)).slice(0, 8)}/${slug(title) || "section"}-${Number(index) + 1}`;

/**
 * Uniqueness, asserted AT EMIT. A generated id scheme is a claim, and a claim nothing
 * checks is how F-438 shipped. Two sections with one id is a bug in the scheme, so this
 * refuses the whole bake rather than de-duplicating and hiding it.
 */
export const assertUniqueSectionIds = (sections) => {
  const seen = new Map();
  const collisions = [];
  for (const s of sections) {
    const id = String(s.id);
    if (seen.has(id)) collisions.push(`${id}  ←  ${seen.get(id)}  +  ${s.provenance?.path || "?"}`);
    else seen.set(id, s.provenance?.path || "?");
  }
  if (collisions.length) {
    die(`${collisions.length} section id collision(s) — the id scheme is broken. NOTHING was written:\n  `
      + collisions.join("\n  "), 1);
  }
  return sections.length;
};

/**
 * THE PIN MAP, from the allow-list (F-429). `packs[].pinned` lists SECTION pins
 * (`pack#section-slug`, or a full section id) and `packs[].pinnedFor` lists the audiences
 * they are pinned for. One home: this is emitted into the index the runtime registers AND
 * rendered in the MANIFEST, so the review artefact and the selector cannot disagree.
 *
 * Every pin is checked against the sections that were actually baked. A pin that matches
 * nothing is dead config — exactly the shape this finding is about — so the bake REFUSES,
 * unless a `--tier` subset is in play, where a missing pack is expected and it is a warning.
 */
export const collectPins = (cfg, sections, { partial = false } = {}) => {
  const byAudience = {};
  const rows = [];
  for (const [pack, meta] of Object.entries((cfg && cfg.packs) || {})) {
    const pins = Array.isArray(meta && meta.pinned) ? meta.pinned : [];
    if (!pins.length) continue;
    const audiences = Array.isArray(meta.pinnedFor) ? meta.pinnedFor.filter(Boolean) : [];
    if (!audiences.length) {
      die(`pack "${pack}" declares pinned sections but no "pinnedFor" audiences. A pin nobody reads is dead config.`, 1);
    }
    for (const pin of pins) {
      const matcher = parsePin(pin);
      if (!matcher) {
        die(`pack "${pack}": "${pin}" is not a section pin. A pin is "pack#section-slug" or a full section id; a bare pack id pins nothing (F-428).`, 1);
      }
      const hits = sections.filter((s) => pinMatchesSection(matcher, s));
      if (!hits.length) {
        const msg = `pack "${pack}": pin "${pin}" matches no baked section.`;
        if (partial) console.log(`  WARNING — ${msg} (tier subset in play)`);
        else die(`${msg} Fix knowledge/sources.json or the corpus. NOTHING was written.`, 1);
      }
      rows.push({ pack, pin, audiences, sections: hits.map((h) => h.id) });
      for (const a of audiences) {
        if (!byAudience[a]) byAudience[a] = [];
        if (!byAudience[a].includes(pin)) byAudience[a].push(pin);
      }
    }
  }
  for (const a of Object.keys(byAudience)) byAudience[a].sort();
  return { byAudience, rows };
};

/**
 * THE DRIFT PROBE. Compares the corpus fingerprint against the one pinned in the generated
 * index, and REFUSES — with a non-zero exit code — on either failure.
 *
 * F-435: the absent-index arm used to print "NOT A PASS" and then fall out of `bake()`,
 * ending the process with status 0. The only thing `npm run bake:check` in a CI step or a
 * pre-commit hook can read is the exit code, so the gate was told the packs were current
 * precisely when there were none. A negative that authorises action must be PROVEN: "no
 * packs" is not "packs are current".
 *
 * Extracted so the harness can assert the exit code of each arm without a raw corpus.
 *
 * F-570: it compared the CONTENT version only, so a hand edit to the generated index —
 * the pin map, a pack's `pinned` list, a section's audiences — passed the gate silently.
 *
 * The fix is NOT to compare the corpus's metadata fingerprint against the constant stored
 * in the file: the hand editor changes the `pinned` list and leaves the constant alone, so
 * the two still agree and the gate still passes (measured — the first version of this fix
 * did exactly that). A fingerprint only defends what it is recomputed FROM. So the check
 * re-emits the index from the corpus and compares the bytes actually on disk: whatever was
 * hand-edited, the file is no longer what the bake would write, which is the whole claim
 * "GENERATED — DO NOT EDIT" makes. The metadata arm reports separately from the content
 * arm so the message can name the likely culprit.
 */
export const checkIndexCurrent = (contentVersion, expectedIndexText = null) => {
  if (!existsSync(P.index)) {
    die("--check: NOT A PASS — no baked packs exist (src/shared/knowledge-index.js is missing).\n"
      + "  Run `npm run bake`, review knowledge/MANIFEST.md, and commit the generated packs.", 1);
    return { checked: false };
  }
  const current = readFileSync(P.index, "utf8");
  const pinned = (/KNOWLEDGE_CONTENT_VERSION = "([a-f0-9]+)"/.exec(current) || [])[1];
  if (pinned !== contentVersion) {
    die(`a pinned source has changed since the last bake (index ${pinned}, corpus ${contentVersion}).\n`
      + "  Run `npm run bake`, review knowledge/MANIFEST.md, and commit the regenerated packs.", 1);
    return { checked: false };
  }
  let metaVersion = null;
  if (expectedIndexText) {
    metaVersion = (/KNOWLEDGE_INDEX_META_VERSION = "([a-f0-9]+)"/.exec(expectedIndexText) || [])[1] || null;
    if (current !== expectedIndexText) {
      const onDisk = (/KNOWLEDGE_INDEX_META_VERSION = "([a-f0-9]+)"/.exec(current) || [])[1];
      die("src/shared/knowledge-index.js is NOT what the bake would write, though every section body is current.\n"
        + `  metadata fingerprint: on disk ${onDisk || "absent"}, corpus ${metaVersion}\n`
        + "  Something was hand-edited in the generated file — the pin map, a pack's `pinned`\n"
        + "  list, a section's audiences or a title. Edit knowledge/sources.json and re-bake;\n"
        + "  never the generated file (F-570).", 1);
      return { checked: false };
    }
  }
  console.log(`bake-knowledge --check: packs are current (content ${contentVersion}${metaVersion ? `, meta ${metaVersion}` : ""}).`);
  return { checked: true };
};

/**
 * The same drift probe for the UI titles module (F-573). It is generated from the same
 * sections, so it can go stale the same way and it is hand-editable the same way — and it
 * is the one knowledge artefact that reaches every issue view, so a stale title there is
 * seen by more people than a stale anything else.
 */
export const checkTitlesCurrent = (expectedText) => {
  if (!existsSync(P.titles)) {
    die("--check: NOT A PASS — src/shared/knowledge-titles.js is missing.\n"
      + "  Run `npm run bake` and commit it: the UI bundles import it instead of the full index.", 1);
    return { checked: false };
  }
  if (readFileSync(P.titles, "utf8") !== expectedText) {
    die("src/shared/knowledge-titles.js is not what the bake would write.\n"
      + "  Re-bake rather than editing it; it is generated from the same sections as the index.", 1);
    return { checked: false };
  }
  console.log(`bake-knowledge --check: UI titles module current (${utf8(expectedText)} B of ${TITLES_MAX_BYTES} B).`);
  return { checked: true };
};

export const bake = ({ dryRun = false, check = false, tiers = null } = {}) => {
  const { denylist } = runPreflight();
  const cfg = readSources();
  const never = cfg.never || [];

  /* ---- stages 1-2: read, refuse, scrub, re-author -------------------- */
  const docs = [];
  const problems = [];
  let scrubDeleted = 0, scrubReplaced = 0;

  // `--tier A,B` bakes a SUBSET. It exists so the tier A+B pipeline can be proven end to
  // end while the re-authored tiers are still being written; it is not a way to ship a
  // partial corpus (the MANIFEST records which tiers were included, and --check compares
  // the whole thing).
  const selected = tiers ? cfg.sources.filter((s) => tiers.includes(s.tier)) : cfg.sources;
  if (tiers) console.log(`bake-knowledge: tier filter ${tiers.join(",")} — ${selected.length}/${cfg.sources.length} sources`);

  for (const source of selected) {
    const hit = violatesNever(source.root || source.id, never);
    if (hit) die(`source "${source.id}" resolves to a path matching the NEVER list ("${hit}"). Refusing.`, 2);

    if (source.reauthor) {
      const authored = resolveAuthored(source);
      if (!authored.ok) { problems.push(authored.message); continue; }
      docs.push({
        sourceId: source.id, tier: source.tier, pack: source.pack,
        audience: source.audience || ["codegen", "coder", "agent", "va", "review"],
        tags: source.tags || [], licence: source.licence || "ours (re-authored)",
        path: `knowledge/authored/${path.basename(authored.file)}`,
        text: authored.text, hash: sha(authored.text), reauthored: true,
      });
      continue;
    }

    for (const f of source.files || []) {
      const rel = path.join(source.raw, f.path);
      const hitPath = violatesNever(rel, never) || violatesNever(f.path, never);
      if (hitPath) die(`"${rel}" matches the NEVER list ("${hitPath}"). Refusing.`, 2);
      const abs = path.join(P.raw, rel);
      if (!existsSync(abs)) {
        problems.push(`missing raw file: knowledge/raw/${rel} — run scripts/sync-knowledge-sources.sh`);
        continue;
      }
      const original = readFileSync(abs, "utf8");
      const scrubbed = applyScrub(original, source.scrub || {});
      scrubDeleted += scrubbed.deleted;
      scrubReplaced += scrubbed.replaced;
      docs.push({
        sourceId: source.id, tier: source.tier, pack: f.pack,
        audience: f.audience || ["codegen"], tags: f.tags || [],
        licence: source.licence || "unstated",
        path: `${source.root}/${f.path}`, rawPath: rel,
        text: scrubbed.text, hash: sha(original),
        scrub: { deleted: scrubbed.deleted, replaced: scrubbed.replaced },
      });
    }
  }

  if (problems.length) {
    console.error("bake-knowledge: refusing —");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(2);
  }
  console.log(`bake-knowledge: ${docs.length} documents · scrub removed ${scrubDeleted} lines, rewrote ${scrubReplaced} spans`);

  /* ---- stage 3: leak scan the SCRUBBED text, before anything is written ---- */
  const findings = [];
  for (const d of docs) findings.push(...scanText(d.text, d.rawPath ? `knowledge/raw/${d.rawPath}` : d.path, { denylist }));
  for (const line of formatFindings(findings)) console.log(line);
  const fatal = findings.filter((f) => f.severity === "fail");
  console.log(`bake-knowledge: leak scan — ${docs.length} documents · ${findings.length} findings · ${fatal.length} fatal`);
  if (fatal.length) die("the corpus is not clean. NOTHING was written.", 1);

  /* ---- stage 4: chunk ------------------------------------------------ */
  const sections = [];
  for (const d of docs) {
    const docTitle = (/^#\s+(.*\S)/m.exec(d.text) || [])[1] || path.basename(d.path, ".md");
    const chunks = chunkMarkdown(d.text, { title: docTitle });
    chunks.forEach((c, i) => {
      const body = c.body.trim();
      const tags = [...new Set([...d.tags, ...titleTags(c.title), ...extractEntities(body)])];
      sections.push({
        id: sectionIdFor({ pack: d.pack, sourceId: d.sourceId, path: d.path, title: c.title, index: i }),
        pack: d.pack,
        title: c.title || docTitle,
        tags,
        audience: d.audience,
        provenance: { source: d.sourceId, path: d.path, hash: d.hash.slice(0, 16), licence: d.licence },
        bytes: utf8(body),
        body,
      });
    });
  }

  // Ids are unique or the bake stops. Before the packs, before the index, before the
  // MANIFEST — the check comes before the side effect (F-438).
  assertUniqueSectionIds(sections);

  const oversized = sections.filter((s) => s.bytes > SECTION_MAX_BYTES);
  for (const s of oversized) console.log(`  oversized section (kept whole, single code block): ${s.id} · ${s.bytes} B`);

  const byPack = new Map();
  for (const s of sections) {
    if (!byPack.has(s.pack)) byPack.set(s.pack, []);
    byPack.get(s.pack).push(s);
  }
  // Deterministic ordering — the emitted files must be byte-identical between two bakes
  // of the same corpus, or every re-bake produces a diff nobody can review.
  for (const [, list] of byPack) list.sort((a, b) => a.id.localeCompare(b.id));

  const packSummaries = [...byPack.entries()].map(([pack, list]) => ({
    id: pack,
    title: (cfg.packs?.[pack]?.title) || pack,
    sections: list.length,
    bytes: list.reduce((n, s) => n + s.bytes, 0),
    pinned: cfg.packs?.[pack]?.pinned || [],
  })).sort((a, b) => a.id.localeCompare(b.id));

  for (const p of packSummaries) {
    if (p.bytes > PACK_MAX_BYTES) die(`pack "${p.id}" is ${p.bytes} B, past the ${PACK_MAX_BYTES} B ceiling. Narrow the allow-list. NOTHING was written.`, 1);
  }

  // The pin map, validated against what was actually baked. Before the emit, because a pin
  // that matches nothing must stop the bake rather than ship.
  const pins = collectPins(cfg, sections, { partial: !!tiers });

  // The tab's view and the selector's view of the SAME pinned list must agree, or the
  // Knowledge tab lies about what a pack pins (F-570). Before the emit, as ever.
  if (!tiers) assertPinsAgree(packSummaries, pins.byAudience);
  // ...and every pin must actually fit the share it is meant to be paid out of (F-576).
  // `sections` here are the freshly chunked ones, so this measures what is about to ship.
  if (!tiers) assertPinnedSectionsFitShare(sections, pins.byAudience);

  const contentVersion = sha(sections.map((s) => `${s.id}:${sha(s.body)}`).join("\n")).slice(0, 16);
  const metaVersion = indexMetaFingerprint(sections, packSummaries, pins.byAudience);
  const sortedSections = sections.slice().sort((a, b) => a.id.localeCompare(b.id));
  const indexText = emitIndex(sortedSections, packSummaries, contentVersion, metaVersion, pins.byAudience);
  const titlesText = emitTitles(sortedSections, packSummaries, contentVersion);
  const titlesBytes = utf8(titlesText);
  const indexBytes = utf8(indexText);
  if (titlesBytes > TITLES_MAX_BYTES) {
    die(`src/shared/knowledge-titles.js would be ${titlesBytes} B, past the ${TITLES_MAX_BYTES} B ceiling.\n`
      + "  It exists to keep the UI bundles small (F-573); a titles module that is not small is\n"
      + "  the index again under another name. NOTHING was written.", 1);
  }
  if (titlesBytes > indexBytes * TITLES_MAX_INDEX_FRACTION) {
    die(`src/shared/knowledge-titles.js would be ${titlesBytes} B against an index of ${indexBytes} B `
      + `(${((titlesBytes / indexBytes) * 100).toFixed(0)} %, ceiling ${(TITLES_MAX_INDEX_FRACTION * 100).toFixed(0)} %).\n`
      + "  The saving is the whole reason the module exists. NOTHING was written.", 1);
  }

  /* ---- --check: the pinned hashes ------------------------------------ */
  if (check) {
    checkIndexCurrent(contentVersion, indexText);
    checkTitlesCurrent(titlesText);
    return { sections, packSummaries, contentVersion, metaVersion, titlesBytes, pins, checked: true };
  }

  /* ---- stage 5: emit -------------------------------------------------- */
  if (!dryRun) {
    mkdirSync(P.packs, { recursive: true });
    for (const [pack, list] of byPack) {
      writeFileSync(path.join(P.packs, `${pack}.js`), emitPack(pack, list));
    }
    writeFileSync(P.index, indexText);
    writeFileSync(P.titles, titlesText);
    writeFileSync(P.manifest, renderManifest({ cfg, docs, sections, packSummaries, contentVersion, findings, pins }));
  }

  console.log(`\nbake-knowledge: ${sections.length} sections across ${packSummaries.length} packs · content ${contentVersion}${dryRun ? " (dry run — nothing written)" : ""}`);
  for (const p of packSummaries) console.log(`  ${p.id.padEnd(30)} ${String(p.sections).padStart(4)} sections  ${(p.bytes / 1024).toFixed(1)} KB`);
  console.log(`  ${"(UI titles module)".padEnd(30)} ${String(sections.length).padStart(4)} titles    ${(titlesBytes / 1024).toFixed(1)} KB`
    + `  — ${((titlesBytes / indexBytes) * 100).toFixed(0)} % of the ${(indexBytes / 1024).toFixed(1)} KB index, which stays backend-only`);
  return { sections, packSummaries, contentVersion, metaVersion, titlesBytes, pins, findings };
};

/** knowledge/MANIFEST.md — the artefact the owner reads BEFORE any pack is committed. */
export const renderManifest = ({ cfg, docs, sections, packSummaries, contentVersion, findings, pins = { byAudience: {}, rows: [] } }) => {
  const lines = [];
  lines.push("<!-- GENERATED by scripts/bake-knowledge.mjs — the human review artefact. -->");
  lines.push("");
  lines.push("# Knowledge bake manifest");
  lines.push("");
  lines.push(`Content version \`${contentVersion}\` · ${sections.length} sections · ${packSummaries.length} packs · ${docs.length} source documents.`);
  lines.push("");
  lines.push("Every section below is bundled with the app and reaches a model. Read this file");
  lines.push("before the packs are committed: the leak scanner proves no shape it recognises got");
  lines.push("through, and this list is how a human proves nothing it does NOT recognise did.");
  lines.push("");
  lines.push("## Packs");
  lines.push("");
  lines.push("| pack | sections | bytes | pinned |");
  lines.push("|---|---:|---:|---|");
  for (const p of packSummaries) lines.push(`| \`${p.id}\` | ${p.sections} | ${(p.bytes / 1024).toFixed(1)} KB | ${p.pinned.length ? p.pinned.map((x) => `\`${x}\``).join(", ") : "—"} |`);
  lines.push("");
  lines.push("## Pins");
  lines.push("");
  lines.push("What the SELECTOR reads (`KNOWLEDGE_PINS` in the generated index, registered by");
  lines.push("the backend). A pin is a SECTION, never a pack, and pins may spend at most 40 % of");
  lines.push("an audience's byte budget between them — the rest always answers the request.");
  lines.push("");
  const audiences = Object.keys(pins.byAudience || {}).sort();
  if (!audiences.length) {
    lines.push("No pins. Every audience's field guide is chosen entirely by the scorer.");
  } else {
    lines.push("| audience | pin | pack | matched sections |");
    lines.push("|---|---|---|---|");
    for (const a of audiences) {
      for (const pin of pins.byAudience[a]) {
        const row = (pins.rows || []).find((r) => r.pin === pin) || { pack: "—", sections: [] };
        const hit = row.sections.length ? row.sections.map((x) => `\`${x}\``).join("<br>") : "**none — dead pin**";
        lines.push(`| ${a} | \`${pin}\` | \`${row.pack}\` | ${hit} |`);
      }
    }
  }
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  lines.push("| source | tier | document | licence | lines removed | spans rewritten |");
  lines.push("|---|---|---|---|---:|---:|");
  for (const d of docs) {
    lines.push(`| ${d.sourceId} | ${d.tier} | \`${d.path}\` | ${d.licence} | ${d.scrub?.deleted ?? "—"} | ${d.scrub?.replaced ?? "—"} |`);
  }
  const skipped = cfg.notBaked || [];
  if (skipped.length) {
    lines.push("");
    lines.push("Deliberately NOT baked: " + skipped.map((s) => `\`${s.id}\` (${s.use})`).join(", ") + ".");
  }
  lines.push("");
  lines.push("## Leak scan");
  lines.push("");
  const suspects = findings.filter((f) => f.severity === "suspect");
  lines.push(`0 fatal findings. ${suspects.length} suspect finding(s)${suspects.length ? ":" : "."}`);
  for (const f of suspects) lines.push(`- \`${f.file}:${f.line}\` · ${f.kind}`);
  lines.push("");
  lines.push("## Sections");
  lines.push("");
  lines.push("| id | title | bytes | audience | provenance |");
  lines.push("|---|---|---:|---|---|");
  for (const s of sections.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`| \`${s.id}\` | ${s.title.replace(/\|/g, "\\|")} | ${s.bytes} | ${s.audience.join(", ")} | ${s.provenance.source} \`${s.provenance.hash}\` |`);
  }
  lines.push("");
  return lines.join("\n");
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const tierArg = args.find((a) => a.startsWith("--tier"));
  const tiers = tierArg ? (tierArg.includes("=") ? tierArg.split("=")[1] : args[args.indexOf(tierArg) + 1] || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean) : null;
  bake({ dryRun: args.includes("--dry-run"), check: args.includes("--check"), tiers: tiers && tiers.length ? tiers : null });
}
