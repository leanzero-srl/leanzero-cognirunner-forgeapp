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
import { parsePin, pinMatchesSection } from "../src/shared/knowledge-select.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = {
  sources: path.join(repoRoot, "knowledge/sources.json"),
  raw: path.join(repoRoot, "knowledge/raw"),
  authored: path.join(repoRoot, "knowledge/authored"),
  fixtures: path.join(repoRoot, "knowledge/fixtures"),
  denylist: path.join(repoRoot, "knowledge/denylist.local"),
  packs: path.join(repoRoot, "src/shared/knowledge-packs"),
  index: path.join(repoRoot, "src/shared/knowledge-index.js"),
  manifest: path.join(repoRoot, "knowledge/MANIFEST.md"),
};

/** Sections are chunked to land inside this window. 4 KB is the hard ceiling (tested). */
export const SECTION_TARGET_BYTES = 2048;
export const SECTION_MAX_BYTES = 4096;
/** A pack past this is a design mistake, not a big pack: the whole bundle ships to every tenant. */
export const PACK_MAX_BYTES = 200 * 1024;

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

const emitIndex = (sections, packs, contentVersion, pins = {}) =>
  `${GENERATED_HEADER("The knowledge INDEX: titles, tags, audiences and provenance — no bodies.\n *\n * This is the module the UI bundles import. Bodies live in the packs and are only ever\n * loaded by the backend, so a Knowledge tab costs kilobytes rather than megabytes.")}
/** Content fingerprint of the baked corpus. Changes whenever any section changes. */
export const KNOWLEDGE_CONTENT_VERSION = ${JSON.stringify(contentVersion)};

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

/* ================================================================== *
 * The run
 * ================================================================== */

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
        id: `${d.pack}/${slug(d.sourceId)}/${slug(c.title) || "section"}-${i + 1}`,
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

  const contentVersion = sha(sections.map((s) => `${s.id}:${sha(s.body)}`).join("\n")).slice(0, 16);

  /* ---- --check: the pinned hashes ------------------------------------ */
  if (check) {
    if (!existsSync(P.index)) {
      // Loud on purpose. "No packs" is not "packs are current" — this repo's own lesson
      // about negatives that authorise action. 14a ships the pipeline; 14b commits the
      // packs, and from that commit on this check has something real to compare.
      console.log("bake-knowledge --check: NOT A PASS — no baked packs exist yet (14b commits them).");
      return { sections, packSummaries, contentVersion, pins, checked: false };
    }
    const current = readFileSync(P.index, "utf8");
    const pinned = (/KNOWLEDGE_CONTENT_VERSION = "([a-f0-9]+)"/.exec(current) || [])[1];
    if (pinned !== contentVersion) {
      die(`a pinned source has changed since the last bake (index ${pinned}, corpus ${contentVersion}).\n`
        + "  Run `npm run bake`, review knowledge/MANIFEST.md, and commit the regenerated packs.", 1);
    }
    console.log(`bake-knowledge --check: packs are current (${contentVersion}).`);
    return { sections, packSummaries, contentVersion, pins, checked: true };
  }

  /* ---- stage 5: emit -------------------------------------------------- */
  if (!dryRun) {
    mkdirSync(P.packs, { recursive: true });
    for (const [pack, list] of byPack) {
      writeFileSync(path.join(P.packs, `${pack}.js`), emitPack(pack, list));
    }
    writeFileSync(P.index, emitIndex(sections.slice().sort((a, b) => a.id.localeCompare(b.id)), packSummaries, contentVersion, pins.byAudience));
    writeFileSync(P.manifest, renderManifest({ cfg, docs, sections, packSummaries, contentVersion, findings, pins }));
  }

  console.log(`\nbake-knowledge: ${sections.length} sections across ${packSummaries.length} packs · content ${contentVersion}${dryRun ? " (dry run — nothing written)" : ""}`);
  for (const p of packSummaries) console.log(`  ${p.id.padEnd(30)} ${String(p.sections).padStart(4)} sections  ${(p.bytes / 1024).toFixed(1)} KB`);
  return { sections, packSummaries, contentVersion, pins, findings };
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
