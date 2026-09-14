/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-689 — THE TWO DRIVERS THAT STILL PASSED A BARE `NV` TO `makeShot`.
//
// F-681 gave `makeShot` a PASS writer and a `shots` ledger so that a capture which
// SUCCEEDED leaves its `{total, masked, readable}` numbers — the F-660 DOM assertion —
// in `evidence.json`, instead of that proof being argued from the absence of a throw.
// That fix reached the library and ONE driver of four. `perm-discriminator-live.mjs` and
// `knowledge-doors-editor-live.mjs` still wrote `makeShot(NV)`, which `makeShot` reads as
// "this driver offered no PASS writer" — so their successful captures were recorded
// nowhere. Worse, neither asserted the verdict `restoreRosterToSnapshot` returns: that
// function runs its repairs under `attempt()`, which converts a throw into a recorded
// sentence and carries on, so a PII refusal during a repair came back as
// `{ok:false, leaked:true}` and was simply dropped. The roster verdict was clean, `fails`
// stayed 0, and the run exited GREEN on a capture that had leaked.
//
// WHY THIS IS A SOURCE SCAN AND NOT AN IMPORT. These are LIVE drivers: they self-execute
// against a deployed tenant the moment the module is evaluated (`await main()` at module
// scope, a Playwright profile, a webtrigger secret). `import()`-ing one to inspect it
// would RUN it. So the four lines are asserted against the file text — the same technique
// `evidence-redaction.test.mjs` uses for the rest of this directory's rules — and each
// assertion is proven by a NEGATIVE CONTROL below, run against a mutated copy of the real
// source, so a regex that can no longer fail cannot pass silently.
//
// Run: node scripts/f689-drivers.test.mjs (auto-discovered by run-offline.mjs)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* The drivers this finding is cut for. `user-search-fault-live.mjs` is the third driver
   named in F-689 and is held by another hand this pass; when it lands, add it here and
   the whole set becomes a directory rule. */
const DRIVERS = ["perm-discriminator-live.mjs", "knowledge-doors-editor-live.mjs"];

/* ── THE FOUR RULES, as predicates over a driver's SOURCE ─────────────────────────────
   Each is written to fail on the exact pre-fix text, which is what the negative controls
   at the bottom re-create. */
const RULES = {
  /* 1. `makeShot` is handed the writer TRIPLE, not a bare function. The `pass:` key is
        the load-bearing half — without it `makeShot` records successes nowhere. */
  makeShotPass: (src) => {
    const calls = [...src.matchAll(/makeShot\s*\(([\s\S]{0,160}?)\)/g)].map((m) => m[1]);
    return calls.length > 0 && calls.every((a) => /^\s*\{/.test(a) && /\bpass\s*:/.test(a));
  },
  /* 2. …and so is `makeRosterUI`'s `record`, because the library takes captures of its
        own inside grantRole/removeAccount that the driver never sees. */
  rosterUiPass: (src) => {
    const m = src.match(/makeRosterUI\s*\(\{[\s\S]{0,400}?\}\)/);
    return !!m && /record\s*:\s*\{[^}]*\bpass\s*:/.test(m[0]);
  },
  /* 3. The capture ledger is WRITTEN into the evidence object on every run. */
  evShots: (src) => /\bev\.shots\s*=/.test(src),
  /* 4. A leak or a failed restore is asserted at RUN level — the driver must read
        `leaked` off something and turn it into a FAIL, not just record it. */
  runLevelLeak: (src) => /\.leaked\b|\bleaked\s*\(\s*\)/.test(src) && /FAIL\s*\(/.test(src),
};

const RULE_WHY = {
  makeShotPass: "`makeShot` must be called as `makeShot({ pass: PASS, nv: NV, fail: FAIL })` — a bare `NV` means a SUCCESSFUL capture is recorded nowhere (F-681/F-689)",
  rosterUiPass: "`makeRosterUI`'s `record` must carry a `pass` writer too — grantRole/removeAccount take captures the driver never holds",
  evShots: "the capture ledger must be written to the evidence object (`ev.shots = …`) or the proof never reaches evidence.json",
  runLevelLeak: "a `leaked:true` restore/capture must be turned into a run-level FAIL — `attempt()` swallows the throw, so nothing else will",
};

/* THE SCAN READS CODE, NOT PROSE. These drivers document their own history in their
   docblocks — "this used to be `makeShot(NV)`" is a sentence several of them now carry,
   including the one this finding added — and a rule that reads the comments would go red
   on a file that is CORRECT. (It did, on the first run of this suite.) Block and line
   comments are stripped first; `://` is spared so a URL in a comment-free line survives. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const sources = {};
for (const d of DRIVERS) {
  const p = path.join(HERE, d);
  ok(fs.existsSync(p), `${d} exists`);
  if (!fs.existsSync(p)) continue;
  const src = code(fs.readFileSync(p, "utf8"));
  sources[d] = src;
  for (const [name, fn] of Object.entries(RULES)) {
    ok(fn(src), `${d}: ${RULE_WHY[name]}`);
  }
}

/* And the run-level assertion must NAME the artefacts, so an operator knows which PNGs to
   destroy rather than being told only that something leaked. */
for (const [d, src] of Object.entries(sources)) {
  ok(/paths\s*:/.test(src), `${d}: the leak FAIL names the PNG path(s) it refused`);
  /* The pre-existing PASS/FAIL/NV counters still gate the exit code — the leak FAIL is
     only worth anything if a FAIL still makes the process non-zero. */
  ok(/process\.exit(Code)?\s*(=|\()\s*/.test(src) && /fails\s*(>|\?)/.test(src),
    `${d}: a FAIL still drives a non-zero exit`);
}

/* ── NEGATIVE CONTROLS ─────────────────────────────────────────────────────────────────
   Every rule above is re-run against the REAL source with the fix stashed back out, one
   rule at a time. A rule that does not go red here cannot detect the regression it is
   written for, and is worthless however green it looks. */
const STASH = {
  makeShotPass: (s) => s.replace(/makeShot\(\{[^}]*\}\)/, "makeShot(NV)"),
  rosterUiPass: (s) => s.replace(/record:\s*\{[^}]*\}/, "record: NV"),
  evShots: (s) => s.replace(/ev\.shots\s*=/, "const unusedShots ="),
  runLevelLeak: (s) => s.replace(/\.leaked\b/g, ".__gone").replace(/\bleaked\s*\(\s*\)/g, "__gone()"),
};

for (const [d, src] of Object.entries(sources)) {
  for (const [name, mutate] of Object.entries(STASH)) {
    const broken = mutate(src);
    ok(broken !== src, `negative control for ${name} actually mutated ${d} (otherwise it proves nothing)`);
    ok(RULES[name](broken) === false, `negative control: ${name} goes RED on a ${d} with the F-689 fix stashed out`);
  }
}

console.log(`\nf689-drivers: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
