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
 * THE LEAK SCANNER — one home (plan §3.15 step 3).
 *
 * The knowledge bake reads the owner's own corpus, which was written for humans on
 * machines that hold real tenants, real clients and real tokens. Nothing in that corpus
 * is safe by construction: it is safe only because THIS module refuses to let a shape it
 * recognises reach `src/shared/knowledge-packs/`. The bake calls it; the harness calls it;
 * `npm run leak:scan` calls it. There is deliberately no second copy — a scanner that
 * exists twice is a scanner that disagrees with itself about what a secret looks like.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE:
 *
 *  1. A FINDING NEVER PRINTS THE VALUE. The report is `file:line · kind`. A scanner that
 *     echoes the token it found has copied the secret into a build log, a terminal
 *     scrollback and (eventually) a bug report. The `kind` plus the line number is enough
 *     for a human with the file open, and is all anyone else ever needs.
 *
 *  2. GUARD DISCIPLINE. Every `kind` below has a positive control in
 *     `knowledge/fixtures/leak-*.md` that MUST be caught, and the `clean-*.md` fixtures
 *     MUST pass. `test-harness/scripts/leak-scan.test.mjs` runs both sets, and the bake
 *     runs them before it scans anything real. A guard nobody has ever seen fire is an
 *     assumption, not a guard: this project has shipped "the project is empty" gates that
 *     were really "I cannot see this project".
 *
 * SEVERITY. `fail` kinds stop the build. `suspect` kinds (long base64 blobs, URLs with an
 * embedded query token) are printed but do not stop it by default — they are shapes that
 * are usually innocent in prose and would otherwise train everyone to pass `--force`.
 * `--strict` promotes them, and the bake uses `--strict` for tiers that carry no code.
 *
 * Dependency-free apart from node built-ins. Importable:
 *   import { scanText, scanFiles, loadDenylist, formatFindings, KINDS } from "./leak-scan.mjs";
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ *
 * Allow-lists. These are the ONLY way a matching shape is forgiven.
 * ------------------------------------------------------------------ */

/**
 * Host labels that may appear before `.atlassian.net`. Anything else is a real tenant —
 * even ours. A tenant host in a pack tells every reader where the author works, and in
 * the owner's corpus it is usually a CLIENT's.
 */
export const PLACEHOLDER_HOSTS = Object.freeze([
  "your-domain", "example", "my", "your-site", "your-company", "yoursite",
  "your-instance", "site", "test", "mysite", "acme",
]);

/**
 * E-mail domains that are documentation fixtures rather than people. `example.*` are
 * reserved by RFC 2606 and cannot be registered; `your-company.com` is the placeholder
 * the Atlassian docs and our own docs use.
 */
export const PLACEHOLDER_EMAIL_DOMAINS = Object.freeze([
  "example.com", "example.org", "example.net", "your-company.com", "your-domain.com",
  "acme.com", "test.com", "localhost",
]);

/** Every kind this scanner can emit, with its severity. The fixtures index off this list. */
export const KINDS = Object.freeze({
  "credential.atlassian-api-token": "fail",
  "credential.github-pat": "fail",
  "credential.openai-key": "fail",
  "credential.bearer": "fail",
  "identity.atlassian-account-id": "fail",
  "identity.bare-24-hex": "fail",
  "tenant.atlassian-host": "fail",
  "identity.email": "fail",
  "denylist.term": "fail",
  "denylist.ticket-key": "fail",
  "forbidden.env-file": "fail",
  "forbidden.token-assignment": "fail",
  "forbidden.credentials-word": "suspect",
  "suspect.base64-blob": "suspect",
  "suspect.url-token": "suspect",
});

/* ------------------------------------------------------------------ *
 * The shapes.
 * ------------------------------------------------------------------ */

/**
 * `test` is a function, not a RegExp with /g/ — a global regex carries lastIndex between
 * calls and silently skips every other line. (That is not theoretical; it is the classic
 * way a scanner reports half its findings and looks clean.)
 */
const SHAPES = [
  // Atlassian Cloud API token. Real ones are ~190 chars of base64url after ATATT.
  { kind: "credential.atlassian-api-token", re: /ATATT[A-Za-z0-9_\-=]{16,}/ },
  { kind: "credential.github-pat", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/ },
  { kind: "credential.github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  // OpenAI-style. `sk-` then at least 16 of the alphabet; `sk-proj-` included by the class.
  { kind: "credential.openai-key", re: /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_\-]{16,}/ },
  // `Bearer <base64>` — the header shape. Short words after Bearer (a placeholder like
  // `Bearer <token>` or `Bearer YOUR_TOKEN`) are not base64 and are left alone.
  { kind: "credential.bearer", re: /\bBearer\s+[A-Za-z0-9+/=_\-.]{20,}/ },
  // Atlassian account id: the `712020:` (and 5xxxxx: / 6xxxxx: / 70121:) prefix + a uuid.
  { kind: "identity.atlassian-account-id", re: /\b\d{5,6}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/ },
  { kind: "identity.atlassian-account-id", re: /\b712020:[0-9a-fA-F]{24,}\b/ },
  // A bare 24-hex run is the shape of a Mongo-ish id AND of the old Atlassian account id.
  // It has a false-positive rate in prose of essentially zero (24 hex chars in a row),
  // which is why it is allowed to fail the build rather than be a suspect.
  { kind: "identity.bare-24-hex", re: /\b[0-9a-f]{24}\b/ },
];

const HOST_RE = /\b([A-Za-z0-9][A-Za-z0-9-]*)\.atlassian\.net\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
/*
 * The three "a secret is nearby" words from the plan, split into three kinds because the
 * FIRST REAL RUN of the bake over the owner's own (clean, Apache-2.0) corpus proved they
 * are not one rule:
 *
 *   .env reference        — 0 false positives. Fatal.
 *   token=<value>         — the QUERY-STRING / ENV shape, no whitespace. Fatal.
 *                           `const token = randomBytes(32)` is a JS assignment, not this;
 *                           matching it produced 5 findings in tier A, all innocent code.
 *   the word "credentials" — 3 findings in tier A, ALL of them the security guidance we
 *                           most want in the pack ("never cache credentials this way —
 *                           a stale key is binary-wrong"). Reported as SUSPECT so it is
 *                           still printed on every run and lands in MANIFEST.md for the
 *                           human review, but it does not stop a build over a noun.
 *
 * This is a deliberate narrowing of one sentence in the plan, made on evidence and
 * written down here rather than quietly: all three words are still DETECTED, and only the
 * prose noun is non-fatal. If the owner wants the noun fatal too, flip the severity in
 * KINDS — the fixture already exists.
 */
const ENV_FILE_RE = /(?:^|[\s"'(/=])\.env\b/;
const TOKEN_ASSIGN_RE = /\b(?:access_?token|api_?token|auth_?token|token)=[^\s&"'`]/i;
const CREDENTIALS_WORD_RE = /\bcredentials?\b/i;
const BASE64_BLOB_RE = /\b[A-Za-z0-9+/]{64,}={0,2}\b/;
const URL_TOKEN_RE = /https?:\/\/[^\s<>"')]*[?&](?:token|access_token|api_?key|secret|password|sig|signature)=[^\s<>"')&]+/i;

/* ------------------------------------------------------------------ *
 * Denylist (gitignored — `knowledge/denylist.local`).
 * ------------------------------------------------------------------ */

/**
 * Parse the local denylist. Format, one entry per line, `#` comments, blank lines ignored:
 *
 *   acme-industries          → a term; matched case-insensitively on a word boundary
 *   project:ABC              → a project key; matches ABC-123 ticket keys AND the bare key
 *   /regex/i                 → an explicit regex for a name that will not word-boundary
 *
 * The file itself NEVER ships — that is the whole point of keeping it out of git. What
 * ships is `knowledge/denylist.local.example`, which contains placeholders only.
 *
 * A MISSING FILE IS NOT A PASS. Returns `{ terms, keys, regexes, present }`; the CLI and
 * the bake REFUSE when `present` is false, because "no denylist" and "denylist found
 * nothing" are the same green tick and only one of them is safe. (This repo's own lesson:
 * a negative that authorises an action has to be proven, not observed.)
 */
export const loadDenylist = (file) => {
  const out = { terms: [], keys: [], regexes: [], present: false, file };
  if (!file || !existsSync(file)) return out;
  out.present = true;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("project:")) {
      const key = line.slice("project:".length).trim();
      if (key) out.keys.push(key);
      continue;
    }
    const rx = /^\/(.+)\/([a-z]*)$/.exec(line);
    if (rx) {
      try { out.regexes.push(new RegExp(rx[1], rx[2].includes("i") ? rx[2] : `${rx[2]}i`)); } catch { /* a bad line must not break the scan */ }
      continue;
    }
    out.terms.push(line.toLowerCase());
  }
  return out;
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A SYNTHETIC denylist used only by the guard fixtures, so that the two denylist kinds
 * are positively controlled on every machine — including CI and a fresh clone, where
 * `knowledge/denylist.local` does not exist and never will. The names here are invented
 * and appear nowhere else; putting the REAL denylist into a guard would ship it, which is
 * exactly what keeping it gitignored is meant to prevent.
 */
export const FIXTURE_DENYLIST = Object.freeze({
  terms: ["northwind-traders", "jordan quibble"],
  keys: ["NWTX"],
  regexes: [],
  present: true,
  file: "<fixtures>",
});

/* ------------------------------------------------------------------ *
 * The scan.
 * ------------------------------------------------------------------ */

/**
 * Scan one document. Returns an array of `{ file, line, kind, severity }` — NO value,
 * ever. `denylist` is the object from loadDenylist(); omit it and only the built-in
 * shapes run (that is what the fixtures for the built-in kinds use).
 */
export const scanText = (text, file = "<text>", { denylist = null } = {}) => {
  const findings = [];
  const add = (line, kind) => findings.push({ file, line, kind, severity: KINDS[kind] || "fail" });
  const lines = String(text ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;

    for (const shape of SHAPES) {
      if (shape.re.test(line)) add(n, shape.kind);
    }

    // Tenant hosts: the LABEL decides. `your-domain.atlassian.net` is documentation;
    // anything else names somebody's instance.
    HOST_RE.lastIndex = 0;
    let m;
    while ((m = HOST_RE.exec(line))) {
      if (!PLACEHOLDER_HOSTS.includes(m[1].toLowerCase())) { add(n, "tenant.atlassian-host"); break; }
    }

    EMAIL_RE.lastIndex = 0;
    while ((m = EMAIL_RE.exec(line))) {
      const domain = m[1].toLowerCase();
      const ok = PLACEHOLDER_EMAIL_DOMAINS.includes(domain) || domain.endsWith(".example.com");
      if (!ok) { add(n, "identity.email"); break; }
    }

    if (ENV_FILE_RE.test(line)) add(n, "forbidden.env-file");
    if (TOKEN_ASSIGN_RE.test(line)) add(n, "forbidden.token-assignment");
    if (CREDENTIALS_WORD_RE.test(line)) add(n, "forbidden.credentials-word");
    if (BASE64_BLOB_RE.test(line)) add(n, "suspect.base64-blob");
    if (URL_TOKEN_RE.test(line)) add(n, "suspect.url-token");

    if (denylist) {
      const lower = line.toLowerCase();
      for (const term of denylist.terms) {
        if (new RegExp(`(^|[^a-z0-9])${escapeRe(term)}([^a-z0-9]|$)`, "i").test(lower)) { add(n, "denylist.term"); break; }
      }
      for (const key of denylist.keys) {
        if (new RegExp(`\\b${escapeRe(key)}(-\\d+)?\\b`).test(line)) { add(n, "denylist.ticket-key"); break; }
      }
      for (const rx of denylist.regexes) {
        if (rx.test(line)) { add(n, "denylist.term"); break; }
      }
    }
  }

  // De-duplicate: one kind per line is a finding, ten matches of it on that line is still
  // one thing for a human to go and look at.
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.line} ${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Scan a list of files. Paths are reported relative to `cwd` so the report is stable. */
export const scanFiles = (files, { denylist = null, cwd = process.cwd() } = {}) => {
  const findings = [];
  for (const abs of files) {
    let text = "";
    try { text = readFileSync(abs, "utf8"); } catch { continue; }
    findings.push(...scanText(text, path.relative(cwd, abs) || abs, { denylist }));
  }
  return findings;
};

/** Recursively collect files under a root, filtered by extension. */
export const collectFiles = (root, exts = [".md", ".js", ".mjs", ".json", ".yml", ".yaml", ".txt"]) => {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git") continue;
      const abs = path.join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs);
      else if (exts.includes(path.extname(abs))) out.push(abs);
    }
  };
  if (!existsSync(root)) return out;
  if (statSync(root).isFile()) return [root];
  walk(root);
  return out.sort();
};

/** `file:line · kind` — the whole report format. Never a value. */
export const formatFindings = (findings) =>
  findings.map((f) => `${f.file}:${f.line} · ${f.kind}${f.severity === "suspect" ? " (suspect)" : ""}`);

/**
 * The guard the plan demands: every `leak-*.md` fixture must produce at least one finding
 * of the kind its filename names, and every `clean-*.md` must produce none. Returns
 * `{ ok, problems }`. Both the bake and the harness call this; the bake calls it BEFORE
 * it scans anything real, so a scanner that has been broken cannot green-light a bake.
 */
export const runGuardFixtures = (fixturesDir, { denylist = FIXTURE_DENYLIST } = {}) => {
  const problems = [];
  const files = collectFiles(fixturesDir, [".md"]);
  const leaks = files.filter((f) => path.basename(f).startsWith("leak-"));
  const cleans = files.filter((f) => path.basename(f).startsWith("clean-"));
  if (!leaks.length) problems.push("no leak-*.md positive controls found — the scanner is unguarded");
  if (!cleans.length) problems.push("no clean-*.md negative controls found — the scanner is unguarded");

  for (const f of leaks) {
    // `leak-credential-openai-key.md` → expected kind `credential.openai-key`.
    const stem = path.basename(f, ".md").replace(/^leak-/, "");
    const found = scanText(readFileSync(f, "utf8"), path.basename(f), { denylist });
    if (!found.length) { problems.push(`${path.basename(f)} · NOT CAUGHT (expected ${stem})`); continue; }
    const kinds = new Set(found.map((x) => x.kind.replace(/\./g, "-")));
    if (!kinds.has(stem)) problems.push(`${path.basename(f)} · caught, but not as ${stem}`);
  }
  for (const f of cleans) {
    const found = scanText(readFileSync(f, "utf8"), path.basename(f), { denylist }).filter((x) => x.severity === "fail");
    if (found.length) problems.push(`${path.basename(f)} · FALSE POSITIVE (${[...new Set(found.map((x) => x.kind))].join(", ")})`);
  }
  return { ok: problems.length === 0, problems, leaks: leaks.length, cleans: cleans.length };
};

/* ------------------------------------------------------------------ *
 * CLI:  node scripts/leak-scan.mjs [paths...] [--strict] [--no-denylist]
 * ------------------------------------------------------------------ */

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("leak-scan.mjs");
if (isMain) {
  const repoRoot = path.resolve(path.dirname(process.argv[1]), "..");
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const skipDenylist = args.includes("--no-denylist");
  const targets = args.filter((a) => !a.startsWith("--"));

  const fixturesDir = path.join(repoRoot, "knowledge/fixtures");
  const denylistFile = path.join(repoRoot, "knowledge/denylist.local");
  const denylist = skipDenylist ? null : loadDenylist(denylistFile);

  const guard = runGuardFixtures(fixturesDir);
  if (!guard.ok) {
    console.error("leak-scan: GUARD FIXTURES FAILED — the scanner itself is not trustworthy:");
    for (const p of guard.problems) console.error(`  ${p}`);
    process.exit(2);
  }
  console.log(`leak-scan: guards ok (${guard.leaks} positive, ${guard.cleans} negative controls)`);

  if (!skipDenylist && !denylist.present) {
    console.error(`leak-scan: no denylist at ${path.relative(repoRoot, denylistFile)} — refusing.`);
    console.error("  Copy knowledge/denylist.local.example and fill it in. A missing denylist is not a clean scan.");
    process.exit(2);
  }

  const roots = targets.length ? targets : [path.join(repoRoot, "knowledge/raw"), path.join(repoRoot, "knowledge/authored")];
  const files = roots.flatMap((r) => collectFiles(path.resolve(r)));
  if (!files.length) {
    console.log("leak-scan: nothing to scan (no files under the given paths).");
    process.exit(0);
  }
  const findings = scanFiles(files, { denylist, cwd: repoRoot });
  const fatal = findings.filter((f) => f.severity === "fail" || strict);
  for (const line of formatFindings(findings)) console.log(line);
  console.log(`\nleak-scan: ${files.length} files · ${findings.length} findings · ${fatal.length} fatal`);
  process.exit(fatal.length ? 1 : 0);
}
