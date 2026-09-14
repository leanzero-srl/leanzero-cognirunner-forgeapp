/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * F-693 — THE HARNESS'S SELECTORS AND THE COMPONENT'S MARKUP, HELD TOGETHER OFFLINE.
 *
 * `lib/roster-ui.mjs` drives the Permissions tab entirely through CSS class names, and every
 * one of them is a silent dependency on `static/admin-panel/src/components/PermissionsTab.jsx`
 * that nothing verified. The costliest is `.perm-ident-email`: it is what the email mask
 * selects, and the mask's own assertion is "no span still renders a readable address" — which
 * a selector matching ZERO elements satisfies unconditionally. Rename that class in a CSS
 * refactor and the live drivers report MORE passes than before while every PNG on disk
 * renders real addresses. `perm-namesake-ui-live.mjs:168` mentioned the coupling in a COMMENT;
 * a comment is not a gate.
 *
 * The others fail louder but no more honestly. F-671 is the same shape one layer in: a
 * `.perm-admin-role` the driver could not read counted as a card that AGREED, so moving the
 * class disarmed the F-666 UI-agreement assertion silently.
 *
 * THE RULE: every `perm-*` class name and every role/scope LABEL that `lib/roster-ui.mjs`
 * hunts for must appear VERBATIM in `PermissionsTab.jsx`. Both directions are checked — a
 * selector the component no longer renders, and a selector the harness quietly stopped
 * using — because the run-level positive control in the drivers only fires when a live run
 * happens, and this fires on every offline gate.
 *
 * WHY VERBATIM STRING MATCHING AND NOT A DOM PARSE: the component composes some of these into
 * template literals (`perm-search-item ${already ? ...}`), so any structural parse would have
 * to evaluate JSX to see them. The substring is the honest, cheap check, and it is exactly
 * what breaks when someone renames the class.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROSTER_UI = path.join(HERE, "..", "lib", "roster-ui.mjs");
const COMPONENT = path.join(HERE, "..", "..", "static", "admin-panel", "src", "components", "PermissionsTab.jsx");

const rosterSrc = fs.readFileSync(ROSTER_UI, "utf8");
const componentSrc = fs.readFileSync(COMPONENT, "utf8");

/* POSITIVE CONTROL FOR THIS TEST'S OWN READS. An empty file would make every "not found"
   assertion below pass or fail for the wrong reason, so prove both reads saw real content
   before any of them is allowed to mean anything. */
assert.ok(rosterSrc.length > 5000, "lib/roster-ui.mjs read back empty or truncated");
assert.ok(componentSrc.length > 5000, "PermissionsTab.jsx read back empty or truncated");
assert.match(componentSrc, /PermissionsTab/, "PermissionsTab.jsx does not look like the component");

let checks = 0;
const must = (needle, why) => {
  checks++;
  assert.ok(componentSrc.includes(needle),
    `PermissionsTab.jsx no longer contains ${JSON.stringify(needle)} — ${why}. lib/roster-ui.mjs selects on it, and a selector that matches nothing does not fail loudly: it makes every "nothing was found" assertion pass forever.`);
};
const usedByHarness = (needle, why) => {
  checks++;
  assert.ok(rosterSrc.includes(needle),
    `lib/roster-ui.mjs no longer mentions ${JSON.stringify(needle)} — ${why}. If the harness genuinely stopped using it, drop it from this contract in the same commit; silently losing a selector is how a guarantee gets disarmed at zero call sites (F-668).`);
};

/* ── 1 · THE NAMED CONTRACT — the selectors this parity exists to pin ─────────────────── */
const SELECTORS = [
  [".perm-ident-email", "the email MASK selects it; losing it turns the PII guarantee into an unconditional pass (F-693)"],
  [".perm-ident-id", "every roster and search row is picked by its discriminator chip"],
  [".perm-admin-role", "the F-666 card-agreement assertion reads the rendered scope from it (F-671)"],
  [".perm-search-item", "the user-search dropdown rows the drivers click"],
  [".perm-admin-card", "the roster cards the drivers read back and repair"],
  [".perm-search-wrap", "the role/scope dropdowns beside the search box are located through it"],
];
for (const [sel, why] of SELECTORS) {
  must(sel.slice(1), why);           // the class as the component writes it, without the dot
  usedByHarness(sel, why);           // and as the harness writes it, with the dot
}

/* ── 2 · THE ROLE / SCOPE LABELS — the sentences the card must READ ───────────────────── */
/* `scopeLabel(role, scope)` is the one sentence the product shows for a roster row, and
   `roster-ui.mjs` compares the card's text against these three literals. A copy edit in the
   component turns a real UI regression into a "the card reads X but the store says Y"
   mismatch that looks like a bug in the app and is not. */
const LABELS = [
  ["All rules (always)", "the label an admin row must render"],
  ["All rules", "the label an editor/viewer row with scope:all must render"],
  ["Own rules only", "the label an editor/viewer row with scope:own must render"],
];
for (const [label, why] of LABELS) {
  must(label, why);
  usedByHarness(label, why);
}

/* ── 3 · NO SELECTOR DRIFTS IN UNSEEN — every `perm-` class the harness uses is covered ── */
/* The named list above is the contract; this is the sweep that stops a NEW selector being
   added to the harness without being pinned. It reads `roster-ui.mjs` for anything shaped
   like a `perm-` class and requires each one to be either in the contract or in the
   component — so the answer is never "we forgot to add it here".

   It matches only the DOTTED form. `perm-` without a dot is prose in this file: the driver
   NAMES `perm-discriminator-live.mjs` and `perm-namesake-ui-live.mjs` in its docblocks, and
   those are file names, not classes. Scanning the bare prefix made this test fail on a
   comment, which is a test bug and not an app bug — exactly the confusion a parity gate must
   not introduce. */
const found = new Set((rosterSrc.match(/\.perm-[a-z0-9-]+/g) || []).map((s) => s.slice(1)));
assert.ok(found.size >= SELECTORS.length, `expected at least ${SELECTORS.length} perm- tokens in roster-ui.mjs, found ${found.size} — the scan itself is not seeing the file`);
for (const token of found) {
  checks++;
  assert.ok(componentSrc.includes(token),
    `lib/roster-ui.mjs uses the class ${JSON.stringify(token)} but PermissionsTab.jsx does not render it — either the component was refactored or the harness is selecting on a class that never existed. Both make a live driver assert over an empty match.`);
}

/* ── 4 · THE MASK SOURCE ITSELF, not merely a class named somewhere in the file ───────── */
/* The one selector that matters most is embedded in a browser-side source STRING, and the
   checks above would still pass if the mask's own copy of it drifted from the rest. */
assert.match(rosterSrc, /querySelectorAll\("\.perm-ident-email"\)/,
  "MASK_EMAILS_SRC no longer selects `.perm-ident-email` — the email mask and this parity contract have come apart");

console.log(`perm selector parity: ${checks} checks — ${SELECTORS.length} selectors, ${LABELS.length} labels and ${found.size} perm- token(s) agree between lib/roster-ui.mjs and PermissionsTab.jsx`);
