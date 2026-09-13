/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE CSS SOURCE GUARDS (F-561). Offline, no browser, no build: this suite reads the live
 * CSS out of every `static/*\/src/App.js` and asserts the things that break SILENTLY.
 *
 * WHY A SOURCE TEST AND NOT A BROWSER ONE. Both defects below shipped a CLEAN BUILD. Webpack
 * has nothing to say about a class defined twice, and nothing to say about a template literal
 * that ends earlier than its author meant it to. The failure surfaces as a component that
 * renders as the wrong thing, or as a white screen - i.e. only in the one place nobody runs
 * before committing. A source assertion is the cheapest place to catch either one.
 *
 * What it proves:
 *   N1 no class is defined in BOTH of admin-panel's style injectors with DIFFERENT
 *      declarations, beyond the shared primitives named in ALLOW below (F-561).
 *   N2 no component PREFIX is newly shared between the two injectors (F-561). This is the
 *      one that would have caught the defect as it actually happened: `.knowledge-tab` was
 *      a NEW name in injectStyles() that collided with KnowledgePanel's existing pill row in
 *      injectCopiedComponentStyles(), and since that block is appended LATER it won the tie
 *      at equal specificity. The Knowledge tab's root container rendered as a small pill
 *      button. Nothing warned.
 *   N3 no style-injecting template literal in ANY of the four apps contains a backtick
 *      (F-562), and the block is a plain literal with no interpolation.
 *
 * Run: node static/_screenshot-harness/css-namespace.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(__dirname, "..");

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log(`  ✗ ${msg}`); } };

/* ── Reading a live CSS block out of an App.js ────────────────────────────────
   Each injector is the same shape: a function, then `style.textContent = ` and a TEMPLATE
   LITERAL holding the whole stylesheet. The body runs from the opening backtick to the
   closing one. F-562's guard is what makes "the next backtick closes it" a safe assumption
   here as well as at runtime. */
export function cssBlock(src, fnDecl) {
  const at = src.indexOf(fnDecl);
  if (at < 0) return null;
  const open = src.indexOf("style.textContent = `", at);
  if (open < 0) return null;
  const start = open + "style.textContent = `".length;
  const end = src.indexOf("`", start);
  if (end < 0) return null;
  return { body: src.slice(start, end), start, end };
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* Selector text -> its declarations, for every rule that names at least one class. An
   at-rule's own line is skipped; the rules INSIDE it are still matched by the same sweep,
   which is what we want - a media-query override of a colliding class is still a collision. */
export function ruleMap(css) {
  const out = new Map();
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const decls = m[2].replace(/\s+/g, " ").trim();
    for (const part of selector.split(",")) {
      const one = part.trim();
      if (!/\./.test(one)) continue;
      if (!out.has(one)) out.set(one, []);
      out.get(one).push(decls);
    }
  }
  return out;
}

export const classNames = (css) => {
  const out = new Set();
  for (const sel of ruleMap(css).keys()) for (const c of sel.match(/\.[A-Za-z][A-Za-z0-9_-]*/g) || []) out.add(c.slice(1));
  return out;
};
/* The component NAMESPACE of a class: everything before the first hyphen. `kn-pack-title`
   is the `kn` namespace, `va-badge-live` is `va`. That is the unit a new surface claims. */
export const prefixOf = (cls) => cls.split("-")[0];

/* ── The two pre-existing, DELIBERATE overlaps ────────────────────────────────
   admin-panel's second injector carries config-ui's component CSS verbatim (the byte-copy
   convention), and config-ui's own App.js styles the same primitives. So `.card`, `.alert`,
   the dropdown family and friends are genuinely declared twice with different numbers, and
   have been since long before F-561. They are listed here EXACTLY, not matched by a pattern,
   for two reasons: a new collision must fail, and a collision that is CLEANED UP must also
   fail, so this list cannot rot into a blanket permission. */
const ALLOW_SELECTORS = [
  ".alert",
  ".card",
  ".container",
  ".dropdown-chevron",
  ".dropdown-group-label",
  ".dropdown-item",
  ".dropdown-item-name",
  ".dropdown-item-type",
  ".dropdown-item.dropdown-highlighted",
  ".dropdown-item.dropdown-selected",
  ".dropdown-item.dropdown-selected .dropdown-item-name",
  ".dropdown-item.dropdown-selected .dropdown-item-type",
  ".dropdown-item:hover",
  ".dropdown-list",
  ".dropdown-panel",
  ".dropdown-panel-up",
  ".dropdown-trigger",
  ".dropdown-trigger.dropdown-error",
  ".dropdown-trigger.dropdown-open",
  ".dropdown-trigger:hover",
  ".header",
  ".icon-wrapper",
  /* Disjoint properties rather than a tie: the app's own block adds the MLS transition to
     the chip the copied block paints. It is still a name declared twice, so it is named. */
  ".mcp-tool-chip",
  ".sk",
  ".spinner",
  ".title",
  'html[data-color-mode="dark"] .dropdown-panel',
];
/* The namespaces those overlaps live in, plus the state/utility prefixes the MLS contract
   deliberately shares across every surface (`is-busy`, `loading-*`, `spin`). A prefix that
   is not on this list may be declared in ONE injector only. */
const ALLOW_PREFIXES = [
  "ai", "alert", "api", "btn", "card", "code", "container", "dropdown", "form", "header",
  "icon", "is", "label", "loading", "mcp", "open", "pf", "sk", "spin", "spinner",
  "subtitle", "title", "tooltip",
];

const appSrc = (app) => fs.readFileSync(path.join(STATIC, app, "src/App.js"), "utf8");

/* ---------- N1 / N2 admin-panel's two injectors share one global namespace ---------- */
{
  console.log("N1/N2 the two admin-panel style injectors do not collide");
  const src = appSrc("admin-panel");
  const own = cssBlock(src, "const injectStyles = () => {");
  const copied = cssBlock(src, "const injectCopiedComponentStyles = () => {");
  ok(!!own && own.body.length > 50000, "N1 injectStyles' CSS body was located");
  ok(!!copied && copied.body.length > 20000, "N1 injectCopiedComponentStyles' CSS body was located");
  ok(!!own && !!copied && copied.start > own.start, "N1 the copied block is still declared AFTER the app's own, which is why it wins ties");

  if (own && copied) {
    const a = ruleMap(own.body);
    const b = ruleMap(copied.body);
    const collided = [];
    for (const [sel, declsA] of a) {
      if (!b.has(sel)) continue;
      if (declsA.join(" | ") === b.get(sel).join(" | ")) continue;
      collided.push(sel);
    }
    const unexpected = collided.filter((s) => !ALLOW_SELECTORS.includes(s)).sort();
    const gone = ALLOW_SELECTORS.filter((s) => !collided.includes(s));
    ok(unexpected.length === 0, `N1 no NEW selector is declared in both injectors with different rules (new: ${unexpected.join(", ")})`);
    ok(gone.length === 0, `N1 the allow-list holds no collision that has since been cleaned up (stale: ${gone.join(", ")})`);

    const pa = new Set([...classNames(own.body)].map(prefixOf));
    const pb = new Set([...classNames(copied.body)].map(prefixOf));
    const sharedPrefixes = [...pa].filter((p) => pb.has(p)).sort();
    const newPrefixes = sharedPrefixes.filter((p) => !ALLOW_PREFIXES.includes(p));
    const stalePrefixes = ALLOW_PREFIXES.filter((p) => !sharedPrefixes.includes(p));
    ok(newPrefixes.length === 0, `N2 no NEW component prefix is declared in both injectors (new: ${newPrefixes.join(", ")}) - pick a prefix the other block does not own, the later block wins the tie`);
    ok(stalePrefixes.length === 0, `N2 the prefix allow-list holds nothing that has since been separated (stale: ${stalePrefixes.join(", ")})`);
  }
}


/* ---------- N3 a backtick inside the CSS closes the stylesheet (F-562) ---------- */
{
  console.log("N3 no backtick inside any app's CSS template literal");
  /* WHAT THIS COSTS WHEN IT IS MISSED. All four apps keep their live CSS in a JS template
     literal, and the house comment style quotes class names in backticks. Writing
     /* the `.gen-meta-chip` base ... *\/ INSIDE that literal terminates the string. The file
     still PARSES, webpack still builds it with zero warnings, and the app dies at render
     with a ReferenceError naming whatever identifier happened to follow. issue-glance
     white-screened that way and took four editor-journeys blocks down with it; it took a
     stash bisect to find, because every signal upstream of the browser was green.

     The assertion is the strongest one available and it cannot false-positive: CSS has no
     use for a backtick, ever. So between a `<var>.textContent = ` + backtick and the
     `document.head.appendChild(<var>)` that closes the injector, there must be EXACTLY ONE
     backtick and it must be the terminator - the character right after it is the `;`.
     `${` is refused in the same span for the same reason: these blocks are constants, and
     an interpolation would make "no backtick" un-assertable.

     Every app, not just the one that bled: the trap is the house comment style, which is
     shared. issue-glance names its element `el` rather than `style`, so the injector is
     found by its SHAPE - any `<identifier>.textContent = <backtick>` - and not by a name. */
  const APPS = ["config-ui", "config-view", "admin-panel", "issue-glance"];
  let blocks = 0;
  for (const app of APPS) {
    const src = appSrc(app);
    const opens = [...src.matchAll(/([A-Za-z_$][\w$]*)\.textContent = `/g)];
    ok(opens.length > 0, `N3 ${app} has a style-injecting template literal at all`);
    for (const m of opens) {
      blocks++;
      const varName = m[1];
      const start = m.index + m[0].length;
      const close = src.indexOf(`document.head.appendChild(${varName})`, start);
      ok(close > start, `N3 ${app} the ${varName} injector still ends in document.head.appendChild(${varName})`);
      if (close <= start) continue;
      const span = src.slice(start, close);
      const ticks = (span.match(/`/g) || []).length;
      ok(ticks === 1, `N3 ${app} the ${varName} CSS literal holds ${ticks} backticks, want exactly 1 (the terminator) - a backtick in a CSS COMMENT closes the stylesheet and white-screens the app with a clean build`);
      if (ticks === 1) {
        const at = span.indexOf("`");
        ok(span.slice(at + 1).trim().startsWith(";"), `N3 ${app} the ${varName} CSS literal's single backtick is its terminator`);
        ok(!span.slice(0, at).includes("${"), `N3 ${app} the ${varName} CSS literal interpolates nothing`);
      }
    }
  }
  ok(blocks >= 4, `N3 every app's injector was located (found ${blocks})`);
}

console.log(`\ncss-namespace: ${failed === 0 ? "all checks passed" : `${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);
