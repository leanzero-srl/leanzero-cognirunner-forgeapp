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
 * THE KNOWLEDGE BAKE (plan §3.15) — SKELETON.
 *
 * Turns the allow-listed corpus in the gitignored `knowledge/raw/` into versioned,
 * dependency-free field-guide packs under `src/shared/knowledge-packs/`, plus
 * `src/shared/knowledge-index.js` and the human-review artefact `knowledge/MANIFEST.md`.
 *
 * It runs on the LAPTOP, never in the app. Nothing here ships to a tenant.
 *
 * THE ORDER OF THE STAGES IS THE SAFETY PROPERTY, and it is why the guard stage is
 * already here while the rest is not: the leak scanner is proven against its own fixtures
 * BEFORE a single real byte is read, and the corpus is scanned BEFORE anything is
 * emitted. A bake that wrote packs first and scanned second would leave a leaked pack on
 * disk for whatever interval it took to notice — the same class of mistake as
 * `commitImportCore` leaving a live rule attached after a refused import. Caps and
 * refusals come before the side effect, always.
 *
 *   0. guards      — the leak scanner's own positive/negative controls must pass
 *   1. sources     — read knowledge/sources.json (allow-list, packs, audiences, scrub)
 *   2. scrub       — named line deletions + regex replacements; `reauthor` sections are
 *                    NOT copied and the build fails until knowledge/authored/ has a
 *                    hand-written replacement
 *   3. leak scan   — the whole scrubbed corpus, with the local denylist; any fatal
 *                    finding stops the bake here, before anything is written
 *   4. chunk       — 2–4 KB sections by heading, with tags/audience/provenance
 *   5. emit        — packs + index + MANIFEST.md
 *
 * Stages 1–5 land in commit 14a(b); this file currently implements stage 0 and refuses
 * with a clear message beyond it, so that the scanner ships already wired to its caller
 * rather than as a script nobody runs.
 *
 * Usage:
 *   node scripts/bake-knowledge.mjs [--check] [--tier A,B] [--dry-run]
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runGuardFixtures, loadDenylist, collectFiles, scanFiles, formatFindings } from "./leak-scan.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = {
  sources: path.join(repoRoot, "knowledge/sources.json"),
  raw: path.join(repoRoot, "knowledge/raw"),
  authored: path.join(repoRoot, "knowledge/authored"),
  fixtures: path.join(repoRoot, "knowledge/fixtures"),
  denylist: path.join(repoRoot, "knowledge/denylist.local"),
  packs: path.join(repoRoot, "src/shared/knowledge-packs"),
  manifest: path.join(repoRoot, "knowledge/MANIFEST.md"),
};

const die = (msg, code = 1) => { console.error(`bake-knowledge: ${msg}`); process.exit(code); };

/** Stage 0 — prove the scanner before trusting it, then prove the denylist exists. */
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

/** Stage 3 — scan the corpus. Returns findings; the caller decides, so tests can reuse it. */
export const scanCorpus = (denylist, roots = [P.raw, P.authored]) => {
  const files = roots.flatMap((r) => collectFiles(r));
  return { files: files.length, findings: scanFiles(files, { denylist, cwd: repoRoot }) };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { denylist } = runPreflight();

  const scan = scanCorpus(denylist);
  for (const line of formatFindings(scan.findings)) console.log(line);
  const fatal = scan.findings.filter((f) => f.severity === "fail");
  console.log(`bake-knowledge: corpus scan — ${scan.files} files · ${scan.findings.length} findings · ${fatal.length} fatal`);
  if (fatal.length) die("the corpus is not clean. Nothing was written.", 1);

  if (!existsSync(P.sources)) {
    die("knowledge/sources.json does not exist yet, so there is nothing to bake.\n"
      + "  Stages 1-5 (sources, scrub, chunk, emit) land in commit 14a(b).", 3);
  }
  die("stages 1-5 are not implemented in this skeleton — see the header.", 3);
}
