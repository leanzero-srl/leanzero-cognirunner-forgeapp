/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Guards the CSS invariant that a `position: fixed` modal actually lands in the
 * user's viewport.
 *
 * The trap: ANY computed `transform` other than `none` makes an element the
 * containing block for its `position: fixed` descendants. A keyframe that ends at
 * `transform: translateY(0)` (an IDENTITY transform, but not `none`) combined with
 * a persistent fill mode (`both` / `forwards`) leaves that identity transform
 * applied FOREVER after the animation finishes.
 *
 * That is exactly how the admin panel's delete dialog ended up rendering ~3,500px
 * ABOVE the viewport: `.section { animation: sectionFadeIn .3s ease both; }` and
 * `sectionFadeIn` ended at `translateY(0)`, so `.section` — a 76,000px-tall element
 * — became the containing block and the overlay's `inset: 0` resolved to IT rather
 * than to the viewport. Measured live on the deployed app before the fix.
 *
 * The rule (already the MLS motion contract, previously only honoured by the mls*
 * keyframes): a keyframe's FINAL state must be `transform: none`, never an
 * identity-equivalent transform. Load-bearing transforms that are part of the
 * element's resting layout (centering via `translateX(-50%)`) are the documented
 * exception — those elements are never modal ancestors.
 *
 * ⚠ THAT RULE IS HYGIENE, NOT THE GUARANTEE. Measured in Chrome: an element whose
 * finished, `fill-mode: both` animation touches `transform` AT ALL still computes to
 * `matrix(1, 0, 0, 1, 0, 0)` rather than the keyword `none`, because `none` is
 * interpolated as the identity matrix and the forwards fill keeps the animation's
 * computed OUTPUT. So `.section` remains a containing block even with a corrected
 * keyframe. The load-bearing guarantee is section 3 below: every `position: fixed`
 * overlay is rendered through a PORTAL to <body>, so it has no app container as an
 * ancestor and cannot be captured by any transform, present or future.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Files holding LIVE CSS. App.js `injectStyles()` is the real source in each app
// (styles.css is a convention mirror and is not imported anywhere).
const CSS_SOURCES = [
  "static/admin-panel/src/App.js",
  "static/config-ui/src/App.js",
  "static/config-view/src/App.js",
  "static/issue-glance/src/App.js",
  "static/admin-panel/src/confirmDialog.js",
];

// Keyframes whose final transform is deliberately NOT `none` because the transform
// is part of the element's resting position, not an animation artefact. Each of
// these elements positions itself by translating off its own anchor point, and
// none of them is ever an ancestor of a modal overlay.
const LOAD_BEARING = new Set([
  "tooltipFadeIn",    // .tooltip-content — translateX(-50%) centres it on its trigger
  "tooltipFadeInUp",  // ditto, flipped above
  "mlsToastIn",       // .mls-toast — translate(-50%, …) centres it on the viewport
  "mlsToastOut",      // ditto, leaving
]);

// An identity-equivalent transform: visually a no-op, but still not `none`, so it
// still creates a containing block + stacking context.
const IDENTITY = /^(?:translateY\(0(?:px)?\)|translateX\(0(?:px)?\)|scale\(1(?:\.0+)?\)|rotate\(0(?:deg)?\)|translate\(0(?:px)?,\s*0(?:px)?\)|translateZ\(0(?:px)?\)|\s)+$/;

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

function keyframeBlocks(src) {
  const out = [];
  for (const m of src.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (depth > 0 && i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push({ name: m[1], body: src.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

function finalTransform(body) {
  const steps = [...body.matchAll(/([\d.%a-z,\s]+)\{([^}]*)\}/g)];
  if (!steps.length) return null;
  const last = steps[steps.length - 1];
  const tr = /transform\s*:\s*([^;}]+)/.exec(last[2]);
  return tr ? tr[1].trim() : null;
}

/* --- 1. No keyframe may end on an identity-but-not-none transform ------------ */
let checkedKeyframes = 0;
for (const rel of CSS_SOURCES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  for (const { name, body } of keyframeBlocks(src)) {
    const val = finalTransform(body);
    if (val === null) continue;
    checkedKeyframes++;
    if (LOAD_BEARING.has(name)) {
      // Documented exception — assert it still LOOKS load-bearing so a future edit
      // that reduces it to an identity transform is caught rather than excused.
      ok(/-50%|-100%|[1-9]/.test(val),
        `${rel}: keyframe "${name}" is allowlisted as load-bearing but ends at "${val}", which is an identity transform — either drop it from LOAD_BEARING or end at transform: none`);
      continue;
    }
    ok(!IDENTITY.test(val),
      `${rel}: keyframe "${name}" ends at "transform: ${val}" — an identity transform. With a persistent fill mode this stays applied forever and makes the element a containing block for every position:fixed modal inside it (the delete dialog rendered 3,500px above the viewport this way). End the keyframe at "transform: none".`);
  }
}
ok(checkedKeyframes > 0, "found at least one keyframe with a transform to check (parser still works)");

/* --- 2. No STATIC rule may put a transform on a modal ancestor --------------- */
// The overlay classes below are `position: fixed`; these container classes wrap
// them in the React tree, so a resting transform on any of them reintroduces the
// same bug from the other direction.
const MODAL_ANCESTORS = ["\\.section", "\\.tab-panel", "\\.container", "\\.card"];
for (const rel of CSS_SOURCES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  for (const cls of MODAL_ANCESTORS) {
    // Match a rule whose selector is EXACTLY this class (not .card:hover, not a
    // descendant selector) and read its declaration block.
    const re = new RegExp(`(?:^|[},])\\s*${cls}\\s*\\{([^}]*)\\}`, "g");
    for (const m of src.matchAll(re)) {
      const decls = m[1];
      const tr = /(?:^|[;\s])transform\s*:\s*([^;}]+)/.exec(decls);
      ok(!tr || tr[1].trim() === "none",
        `${rel}: rule for "${cls.replace(/\\/g, "")}" sets "transform: ${tr && tr[1].trim()}" at rest — that makes it the containing block for any position:fixed modal nested inside it`);
    }
  }
}

/* --- 3. THE GUARANTEE: every fixed overlay is portalled to <body> ------------ */
// This is the invariant that actually keeps modals on screen. A `position: fixed`
// overlay rendered in place is at the mercy of every ancestor's transform; rendered
// through a portal to <body> it has no app ancestor at all.
const PORTALLED_OVERLAYS = [
  ["static/admin-panel/src/components/DeleteRulesDialog.jsx", "pf-modal-overlay"],
  ["static/admin-panel/src/components/RulePortabilityDialog.jsx", "pf-modal-overlay"],
  ["static/admin-panel/src/components/AddRuleWizard.jsx", "pf-modal-overlay wiz-overlay"],
  ["static/admin-panel/src/components/CustomSelect.jsx", "dropdown-panel"],
  ["static/config-ui/src/components/CustomSelect.jsx", "dropdown-panel"],
];
for (const [rel, cls] of PORTALLED_OVERLAYS) {
  const file = path.join(ROOT, rel);
  ok(fs.existsSync(file), `${rel} exists`);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  ok(src.includes(cls), `${rel}: still renders the "${cls}" overlay`);
  ok(/createPortal/.test(src) && /document\.body/.test(src),
    `${rel}: its overlay must be rendered with createPortal(…, document.body) — a fixed overlay left in the React tree inherits its containing block from whatever ancestor happens to carry a transform, and the delete dialog opened 3,500px off-screen exactly that way`);
}

// The DOM-built confirm dialog and the toast reach <body> directly rather than via
// React — same invariant, different mechanism.
for (const rel of ["static/admin-panel/src/confirmDialog.js", "static/admin-panel/src/components/toast.js"]) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  ok(/document\.body\.append|document\.body\.appendChild/.test(src),
    `${rel}: must attach to document.body, not to the calling component's subtree`);
}

/* --- 4. The overlays are still position: fixed ------------------------------- */
// If someone "fixes" a mispositioned modal by switching it to absolute, the dialog
// silently starts scrolling away with the page again.
const adminApp = fs.readFileSync(path.join(ROOT, "static/admin-panel/src/App.js"), "utf8");
for (const overlay of [".pf-modal-overlay", ".cr-confirm-overlay"]) {
  const re = new RegExp(`\\${overlay}\\s*\\{([\\s\\S]{0,400}?)\\}`);
  const m = re.exec(adminApp);
  ok(m && /position:\s*fixed/.test(m[1]), `${overlay} must stay position: fixed so it tracks the viewport`);
}

console.log(`keyframe-containing-block: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
if (failures.length) process.exit(1);
