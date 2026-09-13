/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Guard discipline for the leak scanner (plan §3.15 step 3).
//
// The knowledge bake's only defence against a client name, a tenant host or a live token
// reaching src/shared/knowledge-packs/ is scripts/leak-scan.mjs. A scanner that has
// quietly stopped matching looks exactly like a clean corpus, so this suite makes the
// scanner fire on demand: every knowledge/fixtures/leak-*.md positive control MUST be
// caught AS THE KIND ITS FILENAME NAMES, and every clean-*.md MUST pass with no fatal
// finding. It also asserts the two properties the report itself must have — a finding
// carries file:line and a kind and NEVER the matched value, and a missing denylist is
// reported as absent rather than as an empty pass.
//
// Auto-discovered by run-offline.mjs (npm run test:offline). Run alone:
//   node test-harness/scripts/leak-scan.test.mjs
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const fixturesDir = path.join(repoRoot, "knowledge/fixtures");

const scanner = await import(pathToFileURL(path.join(repoRoot, "scripts/leak-scan.mjs")).href);
const { scanText, scanFiles, loadDenylist, formatFindings, runGuardFixtures, KINDS, FIXTURE_DENYLIST, PLACEHOLDER_HOSTS } = scanner;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* 1. The guard runner itself — this is what the bake calls before it scans anything. */
const guard = runGuardFixtures(fixturesDir);
ok(guard.ok, `runGuardFixtures passes (${guard.problems.join(" | ")})`);
ok(guard.leaks >= 10, `at least 10 positive controls present (found ${guard.leaks})`);
ok(guard.cleans >= 2, `at least 2 negative controls present (found ${guard.cleans})`);

/* 2. EVERY kind the scanner can emit has a positive control. A kind with no fixture is a
      regex nobody has ever seen fire, and the first time it matters is the wrong time. */
const fixtureNames = readdirSync(fixturesDir).filter((f) => f.startsWith("leak-") && f.endsWith(".md"));
const covered = new Set(fixtureNames.map((f) => path.basename(f, ".md").replace(/^leak-/, "")));
for (const kind of Object.keys(KINDS)) {
  ok(covered.has(kind.replace(/\./g, "-")), `kind ${kind} has a leak-*.md positive control`);
}

/* 3. Each positive control is caught as its own kind, with the denylist ones resolved
      against the scanner's synthetic FIXTURE_DENYLIST (never the real, gitignored one). */
for (const name of fixtureNames.sort()) {
  const stem = path.basename(name, ".md").replace(/^leak-/, "");
  const text = readFileSync(path.join(fixturesDir, name), "utf8");
  const found = scanText(text, name, { denylist: FIXTURE_DENYLIST });
  const kinds = new Set(found.map((f) => f.kind.replace(/\./g, "-")));
  ok(kinds.has(stem), `${name} is caught as ${stem} (got: ${[...kinds].join(", ") || "nothing"})`);
  // Severity is part of the contract, and it is read from KINDS rather than guessed from
  // the filename: a credential fixture must never be silently downgraded to suspect, and
  // a suspect fixture must never start failing builds because somebody "tightened" it.
  const hit = found.find((f) => f.kind.replace(/\./g, "-") === stem);
  if (hit) {
    const declared = Object.entries(KINDS).find(([k]) => k.replace(/\./g, "-") === stem);
    ok(declared && hit.severity === declared[1], `${name} carries the severity KINDS declares (${declared ? declared[1] : "unknown kind"})`);
  } else ok(false, `${name} produced no finding of its own kind`);
}

/* 4. The negative controls stay clean. This is the half that keeps the scanner usable —
      a scanner tightened until ordinary prose fails is a scanner everyone bypasses. */
for (const name of readdirSync(fixturesDir).filter((f) => f.startsWith("clean-") && f.endsWith(".md"))) {
  const found = scanText(readFileSync(path.join(fixturesDir, name), "utf8"), name, { denylist: FIXTURE_DENYLIST })
    .filter((f) => f.severity === "fail");
  ok(found.length === 0, `${name} is clean (offending kinds: ${[...new Set(found.map((f) => f.kind))].join(", ")})`);
}

/* 5. THE REPORT NEVER CARRIES THE VALUE. The whole reason a leak report is safe to paste
      into a build log. Assert on the finding objects AND on the formatted lines. */
const secretLine = "the value ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 was pasted here";
const findings = scanText(secretLine, "x.md", { denylist: FIXTURE_DENYLIST });
ok(findings.length > 0, "the value-leak probe produces a finding at all");
for (const f of findings) {
  ok(Object.keys(f).sort().join(",") === "file,kind,line,severity", "a finding has exactly file/line/kind/severity");
}
const formatted = formatFindings(findings).join("\n");
ok(!formatted.includes("ghp_ABCDEF"), "the formatted report does not echo the matched value");
ok(/x\.md:1 · /.test(formatted), "the formatted report is file:line · kind");

/* 6. Placeholder hosts are forgiven; anything else is a tenant. */
for (const label of PLACEHOLDER_HOSTS) {
  ok(scanText(`see https://${label}.atlassian.net/browse/ABC-1`).every((f) => f.kind !== "tenant.atlassian-host"),
    `${label}.atlassian.net is treated as a placeholder`);
}
ok(scanText("see https://realcustomer.atlassian.net/").some((f) => f.kind === "tenant.atlassian-host"),
  "a non-placeholder atlassian.net host is caught");

/* 7. A global regex must not carry lastIndex between lines — the classic way a scanner
      reports every OTHER finding and looks half clean. Two identical lines, two findings. */
const twice = scanText("https://realcustomer.atlassian.net/a\nhttps://realcustomer.atlassian.net/b");
ok(twice.filter((f) => f.kind === "tenant.atlassian-host").length === 2,
  "the host scan fires on consecutive lines (no lastIndex carry-over)");

/* 8. A MISSING denylist is reported as absent, not as a pass. The CLI turns this into a
      refusal; the property tested here is that the two states are distinguishable. */
const missing = loadDenylist(path.join(tmpdir(), "definitely-not-a-denylist-file-xyz"));
ok(missing.present === false, "a missing denylist reports present:false");
const dir = mkdtempSync(path.join(tmpdir(), "cr-denylist-"));
const dlFile = path.join(dir, "denylist.local");
writeFileSync(dlFile, "# comment\n\nzarquon-systems\nproject:ZQN\n/quux\\s*&\\s*co/i\n");
const dl = loadDenylist(dlFile);
ok(dl.present && dl.terms.length === 1 && dl.keys.length === 1 && dl.regexes.length === 1,
  "the denylist parser reads terms, project keys and regexes and skips comments");
ok(scanText("written during the Zarquon-Systems rollout", "a.md", { denylist: dl }).some((f) => f.kind === "denylist.term"),
  "a denylist term matches case-insensitively");
ok(scanText("see ZQN-99 for the approval", "a.md", { denylist: dl }).some((f) => f.kind === "denylist.ticket-key"),
  "a denylisted project key matches its ticket keys");
ok(scanText("agreed with Quux & Co last week", "a.md", { denylist: dl }).some((f) => f.kind === "denylist.term"),
  "a denylist regex entry matches");
ok(!scanText("the zarquonsystems word is not the term", "a.md", { denylist: dl }).some((f) => f.kind === "denylist.term"),
  "a denylist term does not match inside a longer word");

/* 9. scanFiles reports paths relative to the given cwd, so reports are machine-stable. */
const fileFindings = scanFiles([path.join(fixturesDir, "leak-identity-email.md")], { cwd: repoRoot });
ok(fileFindings.length > 0 && fileFindings[0].file === "knowledge/fixtures/leak-identity-email.md",
  "scanFiles reports repo-relative paths");

/* 10. The committed fixtures are the ONLY place a leak shape may live in this repo, and
       even there the values are synthetic. Assert nobody has parked a real-looking
       Atlassian token in the example denylist template. */
const example = readFileSync(path.join(repoRoot, "knowledge/denylist.local.example"), "utf8");
ok(scanText(example, "denylist.local.example").filter((f) => f.severity === "fail").length === 0,
  "knowledge/denylist.local.example carries placeholders only");

/* 11. THE EMITTED PACKS (1.4 commit 14b).
       Everything above proves the scanner works. This proves it WORKED — it scans the
       generated modules that actually ship, which is the only artefact a customer ever
       receives. The bake scans its inputs; this scans its output, because a scrub rule
       that silently stopped matching would leave the bake green and the packs dirty.

       The denylist is gitignored on purpose (knowledge/denylist.local names the people
       and clients we are protecting, so committing it leaks exactly what it exists to
       keep out). When it is absent the denylist KINDS cannot fire and the test says so
       out loud rather than passing quietly — an unrun guard must never read as a pass. */
{
  const packsDir = path.join(repoRoot, "src/shared/knowledge-packs");
  let packFiles = [];
  try {
    packFiles = readdirSync(packsDir).filter((f) => f.endsWith(".js")).map((f) => path.join(packsDir, f));
  } catch { packFiles = []; }

  if (!packFiles.length) {
    console.log("leak-scan: NOTE — no baked packs on disk; the emitted-pack scan did not run.");
  } else {
    const denylistPath = path.join(repoRoot, "knowledge/denylist.local");
    const denylist = loadDenylist(denylistPath);
    const haveDenylist = Boolean(denylist && (denylist.terms?.length || denylist.projectKeys?.length || denylist.patterns?.length));

    const findings = scanFiles(packFiles, { cwd: repoRoot, denylist: haveDenylist ? denylist : undefined });
    const fatal = findings.filter((f) => f.severity === "fail");
    ok(fatal.length === 0,
      `the ${packFiles.length} emitted packs carry no fail-severity leak (${formatFindings(fatal.slice(0, 5))})`);

    // Kind-by-kind, so a regression names the shape that got through rather than a count.
    for (const kind of Object.keys(KINDS)) {
      if (KINDS[kind] !== "fail") continue;
      if (kind.startsWith("denylist.") && !haveDenylist) continue;
      ok(!findings.some((f) => f.kind === kind), `no ${kind} in the emitted packs`);
    }

    if (haveDenylist) {
      ok(!findings.some((f) => f.kind.startsWith("denylist.")),
        "no denylisted client, person or project key survived the scrub into the shipped packs");
    } else {
      console.log(`leak-scan: NOTE — knowledge/denylist.local is absent, so the denylist kinds did NOT run over the emitted packs. This is a SKIP, not a pass. Copy knowledge/denylist.local.example and fill it in before a release.`);
    }
  }
}

console.log(`\nleak-scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
