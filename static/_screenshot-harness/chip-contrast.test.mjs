/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * F-966 - EVERY SOLID CHIP, IN ALL FOUR APPS, IN BOTH THEMES.
 *
 * The owner's rule is one sentence: a solid saturated fill carries WHITE text. The sheet
 * had drifted into the opposite convention, written down twice as a comment ("every solid
 * amber fill carries DARK text on the dark shade") and copied into roughly forty rules
 * across four stylesheets. F-957 fixed seven of them and measured those seven by hand;
 * this suite replaces the hand.
 *
 * WHY IT MEASURES INSTEAD OF READING THE SOURCE. A variant rule usually sets only the
 * background (`html[data-color-mode="dark"] .log-src-async { background: #6366f1 }`) and
 * inherits its ink from the base rule three hundred lines earlier. A source scan that
 * looks for rules setting BOTH properties cannot see those at all - and #6366f1 with white
 * is 4.47:1, a real miss that the scan would have called clean. So the CASCADE resolves
 * it: every candidate is mounted as a real element and read with getComputedStyle.
 *
 * WHY IT DOES NOT NEED A BUILD. `injectStyles()` in App.js is the live stylesheet (plus
 * admin-panel's second `injectCopiedComponentStyles()` sheet, plus the pre-mount subset in
 * public/index.html). lib/injected-css.mjs lifts all of them out of the source, so this
 * suite is offline, needs no bundle, and cannot certify a stale build-shot.
 *
 * TWO ASSERTIONS PER CANDIDATE:
 *   1. contrast >= 4.5:1 (WCAG AA; these chips are 9-11px, so the 3:1 large-text
 *      relaxation does not apply). This one covers EVERY opaque fill, chip or not.
 *   2. if the fill sits in the SOLID-CHIP luminance band, the ink is WHITE. The band is
 *      what separates a chip from a surface: a tooltip (#0f172a, 0.009) and a code block
 *      are legitimately light-on-dark, the slate chip (#475569, 0.089) and every hue in
 *      the map are not.
 *
 * It also carries the F-936 assertion on --text-muted, which is the same defect one
 * layer down: a TOKEN under AA in both themes, on .empty-state and .hint everywhere.
 *
 * Run: node static/_screenshot-harness/chip-contrast.test.mjs   (--list prints every
 * measured candidate, which is how you check the enumeration is not silently empty)
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPS, appSheets } from "./lib/injected-css.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const LIST = process.argv.includes("--list");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };

/* The band in which a fill is a CHIP rather than a surface. Measured, not guessed:
   tooltip #0f172a is 0.0088 and #1e293b is 0.0218, the darkest legitimate "ink on dark
   surface" backgrounds on any of the four sheets; the palest chip in the hue map,
   #64748b, is 0.1706. 0.03 sits in that gap with room on both sides. The upper bound
   keeps white cards and #f8fafc buttons out. */
const CHIP_LUM_MIN = 0.03;
const CHIP_LUM_MAX = 0.60;

/* bootstrap <style> blocks in public/index.html + injected sheets, per app. */
const SHEETS = { "config-ui": 2, "config-view": 2, "admin-panel": 3, "issue-glance": 2 };
const FLOOR = { "config-ui": 60, "config-view": 12, "admin-panel": 200, "issue-glance": 20 };

/* WHICH BASE CLASS CARRIES THE INK.
 * A chip is rendered `className={`log-type-badge ${kind}`}` - the variant rule paints the
 * fill and the BASE rule, hundreds of lines earlier, owns `color: #fff`. A probe mounted
 * with only the variant class inherits the document text colour and reports a defect that
 * is not there. Two mechanisms recover the pair: any class that is a `-` prefix of the
 * variant and is really declared (`.log-src` for `.log-src-test`), and this table, for the
 * families whose base is NOT a prefix. Every row was read off the JSX that renders it, and
 * the file:line is named so the next reader can check rather than trust.
 */
const COMPANION = [
  ["code-pipe-", "code-pipe-status"],           // CodeTab.jsx:559
  ["code-run-", "code-run-state"],              // CodeTab.jsx
  ["dib-", "dropdown-item-badge"],              // CustomSelect.jsx `dropdown-item-badge dib-${tone}`
  ["g-", "glance-badge"],                       // issue-glance App.js:751
  ["gmc-", "gen-meta-chip"],                    // FieldGuideChip.jsx "gen-meta-chip gmc-docs"
  ["hc-", "hc-chip"],                           // admin App.js `hc-chip hc-${hue}`
  ["lt-", "log-type-badge"],                    // admin App.js:7542
  ["memories-admin-src-", "memories-admin-source-badge"], // MemoriesAdminTab.jsx:504
  ["memory-src-", "memory-source-badge"],       // MemoriesTab.jsx:444
  ["pf-test-", "pf-test-chip"],                 // FunctionBlock.jsx `pf-test-chip pf-test-${state}`
  ["skill-cat-", "skill-cat-badge"],            // SkillsTab.jsx
  ["va-sample-", "va-sample-flag"],             // AgentsTab.jsx
  ["va-state-", "va-badge"],                    // AgentsTab.jsx:735
  ["va-new", "btn-solid"],                      // AgentsTab.jsx:455 (a button, not a chip)
];

/* FILLS THAT CARRY NO TEXT. A meter bar, a status dot and a toggle knob are solid colour
 * with nothing written on them, so "the ink must be white" is meaningless for them and the
 * contrast question has no reader. They are named here rather than inferred, because there
 * is no property in CSS that says "this box has words in it" and a heuristic would quietly
 * excuse a real chip one day. */
const NO_TEXT = [
  "coder-action-dot", "coder-action-ok", "coder-action-bad",
  "coder-toggle-box", "reg-meter-fill", "runstat-dot",
  "usage-prov-fill", "usage-allow-fill", "usage-engine-fill",
];

const browser = await chromium.launch();
try {
  for (const app of APPS) {
    const sheets = appSheets(STATIC, app);
    /* Exact counts, not "> 0": admin-panel's SECOND sheet is injectCopiedComponentStyles()
       and holds the duplicated components' CSS. A reader that quietly returned one sheet
       for admin-panel would measure the app with half its chips missing and pass. */
    ok(sheets.length === SHEETS[app], `${app}: ${sheets.length} sheets read (expected ${SHEETS[app]})`);
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent("<!doctype html><html><body><div class=\"container\"></div></body></html>");
      const results = await page.evaluate(({ sheets, theme, CHIP_LUM_MIN, CHIP_LUM_MAX, COMPANION, NO_TEXT }) => {
        document.documentElement.setAttribute("data-color-mode", theme);
        for (const css of sheets) {
          const el = document.createElement("style");
          el.textContent = css;
          document.head.appendChild(el);
        }

        const rgbOf = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
        const alphaOf = (c) => { const m = String(c).match(/rgba?\(([^)]*)\)/); if (!m) return 1; const p = m[1].split(","); return p.length > 3 ? parseFloat(p[3]) : 1; };
        const lum = (c) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = (a, b) => { const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b)); return (L1 + 0.05) / (L2 + 0.05); };

        // Every CSSStyleRule on the page, including the ones nested in @media.
        const rules = [];
        const walk = (list) => {
          for (const r of list) {
            if (r.cssRules && (r.media || r.conditionText)) walk(r.cssRules);
            else if (r.selectorText && r.style) rules.push(r);
          }
        };
        for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (e) { /* same-origin only; these are inline */ } }

        /* Does this rule paint a solid fill of its own? `background` shorthand and
           `background-color` both count; gradients, `none`, `transparent`, `inherit` and
           anything translucent do not - a translucent fill has no single contrast answer
           and the owner's rules forbid it as an accent anyway. */
        const solidFill = (r) => {
          const shorthand = r.style.getPropertyValue("background");
          const longhand = r.style.getPropertyValue("background-color");
          const v = (longhand || shorthand || "").trim();
          if (!v) return null;
          if (/gradient|none|transparent|inherit|currentcolor/i.test(v)) return null;
          /* TRANSLUCENT IS NOT A FILL. A rule declaring `rgba(22,163,106,0.06)` has no
             single contrast answer, and skipping it matters for a second reason: the
             bootstrap sheet carries exactly that tint for `.st-update .st-result-header`
             while injectStyles paints the same selector solid at mount. Enumerating on the
             tint and then measuring the solid made the suite report a defect against a
             rule that never paints. */
          const alpha = (v.match(/rgba?\(([^)]*)\)/) || [, ""])[1].split(",");
          if (alpha.length > 3 && parseFloat(alpha[3]) < 1) return null;
          if (/\bvar\(/i.test(v) && !/#|rgb/i.test(v)) return null;
          return v;
        };

        /* A compound selector -> an element we can really mount. Pseudo-classes and
           pseudo-elements are stripped: the element they decorate is mounted instead and
           the rule's OWN declarations are applied on top, which is the same answer the
           browser gives when the state is entered. */
        /* The companion classes of a variant (see COMPANION). A `-` prefix looked like a
           cheap general rule and is NOT one: `.coder-link-kind` is not a `.coder-link`, and
           inheriting that rule's blue link colour invented a defect out of nothing. Only
           pairs read off the JSX are used. */
        const allClasses = new Set();
        for (const r of rules) for (const c of r.selectorText.match(/\.[A-Za-z0-9_-]+/g) || []) allClasses.add(c.slice(1));
        const withFamily = (cls) => {
          const out = [cls];
          const parts = cls.split("-");
          for (let i = 1; i < parts.length; i++) {
            const pref = parts.slice(0, i).join("-");
            if (allClasses.has(pref)) out.push(pref);
          }
          for (const [prefix, base] of COMPANION) if (cls.startsWith(prefix)) out.push(base);
          return out;
        };

        const mountChain = (sel, ownInk) => {
          const cleaned = sel
            .replace(/^\s*html[^\s]*\s+/, "")            // the theme scope lives on <html>
            .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "")   // :hover, :disabled, ::before, :not(...)
            .replace(/\s*>\s*/g, " ")
            .trim();
          if (!cleaned || /[+~]/.test(cleaned)) return null;
          const parts = cleaned.split(/\s+/).filter(Boolean);
          if (!parts.length) return null;
          const host = document.querySelector(".container");
          let parent = host, leaf = null;
          for (const part of parts) {
            const tagM = part.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
            const tag = tagM ? tagM[0] : "span";
            if (/^(html|body|:root)$/i.test(tag)) { leaf = document.documentElement; continue; }
            const el = document.createElement(tag);
            for (const c of part.match(/\.[A-Za-z0-9_-]+/g) || []) for (const f of (ownInk ? [c.slice(1)] : withFamily(c.slice(1)))) el.classList.add(f);
            for (const a of part.match(/\[[^\]]+\]/g) || []) {
              const kv = a.slice(1, -1).split("=");
              el.setAttribute(kv[0].trim(), (kv[1] || "").trim().replace(/^["']|["']$/g, ""));
            }
            el.textContent = "Ag";
            parent.appendChild(el);
            parent = el; leaf = el;
          }
          return leaf;
        };

        const out = [];
        const seen = new Set();
        let tokenFills = 0;
        for (const r of rules) {
          const fill = solidFill(r);
          if (!fill) continue;
          /* A fill that comes from a shared TOKEN (`background: var(--primary-color)`) is
             deliberately out of this suite's scope. Those four tokens are dual-use - the
             same value is read 131 times as `color:` on a dark surface and 43 times as a
             fill under white text, and one value cannot satisfy both. Splitting them is a
             separate finding with its own blast radius; asserting on them here would make
             this suite red for a defect it is not allowed to fix. Counted, so the exclusion
             stays visible. */
          if (/\bvar\(/i.test(fill)) { tokenFills++; continue; }
          const themeScoped = /^\s*html\[data-color-mode="dark"\]/.test(r.selectorText);
          if (themeScoped && theme !== "dark") continue;
          for (const one of r.selectorText.split(",")) {
            const sel = one.trim();
            if (!sel) continue;
            /* STATE RULES ARE OUT OF SCOPE, and deliberately so. Nothing but the cascade
               decides what a chip really looks like - that is why this suite mounts instead
               of reading declarations - and a :hover / :disabled / ::after rule cannot be
               entered from here. Applying its declarations by hand was the first design and
               it produced three false positives in a row: it measured a LIGHT :hover rule
               that the dark theme overrides, and a dead `.review-item-warning` copy in the
               bootstrap sheet that injectStyles replaces at mount. Measuring a rule the
               reader never sees is worse than not measuring it. Counted, not hidden. */
            if (/:/.test(sel)) { out.push({ sel, skipped: true, state: true }); continue; }
            const key = theme + "|" + sel;
            if (seen.has(key)) continue;
            seen.add(key);
            /* A meter bar / status dot / toggle knob has no words on it. */
            if (NO_TEXT.some((c) => sel.includes("." + c))) { out.push({ sel, skipped: true }); continue; }
            /* A rule that declares its own `color` needs no companion, and must not be
               given one: `.coder-link-kind` is self-contained and `.coder-link` is declared
               AFTER it, so adding the "family" class handed the chip a blue link colour it
               never wears. Companions answer one question only - where does the ink come
               from when this rule does not say. */
            const ownInk = !!r.style.getPropertyValue("color");
            const leaf = mountChain(sel, ownInk);
            if (!leaf || leaf === document.documentElement) { out.push({ sel, skipped: true }); continue; }

            const cs = getComputedStyle(leaf);
            const bgRaw = cs.backgroundColor, fgRaw = cs.color;
            const bg = rgbOf(bgRaw), fg = rgbOf(fgRaw);
            if (!bg || !fg || alphaOf(bgRaw) < 1 || alphaOf(fgRaw) < 1) { out.push({ sel, skipped: true }); continue; }
            const L = lum(bg);
            out.push({
              sel, bg: bgRaw, fg: fgRaw,
              ratio: ratio(bg, fg),
              chip: L >= CHIP_LUM_MIN && L <= CHIP_LUM_MAX,
              white: fg[0] === 255 && fg[1] === 255 && fg[2] === 255,
            });
          }
        }
        return { out, tokenFills };
      }, { sheets, theme, CHIP_LUM_MIN, CHIP_LUM_MAX, COMPANION, NO_TEXT });

      const measured = results.out.filter((r) => !r.skipped);
      /* A suite that enumerates nothing passes silently - the failure mode F-125 named for
         the screenshot suites. Every app really does paint dozens of solid fills. */
      /* A floor per app, not one number: config-view is a read-only summary with a
         fraction of admin-panel's chips, and a shared "20" would either be a lie there or
         useless everywhere else. These are the counts measured when the suite landed,
         minus a little slack; they exist to catch an enumeration that SILENTLY empties. */
      ok(measured.length >= FLOOR[app], `${app}/${theme}: enumerated ${measured.length} solid fills (expected >= ${FLOOR[app]})`);
      if (LIST) console.log(`    ${app}/${theme}: ${results.tokenFills} token-derived fills skipped (see the var() note)`);
      for (const r of measured) {
        if (LIST) console.log(`    ${app}/${theme} ${r.sel} ${r.bg} / ${r.fg} ${r.ratio.toFixed(2)}:1${r.chip ? " CHIP" : ""}`);
        ok(r.ratio >= 4.5, `${app}/${theme} ${r.sel}: ${r.ratio.toFixed(2)}:1 (${r.fg} on ${r.bg}) is under AA 4.5:1`);
        if (r.chip) ok(r.white, `${app}/${theme} ${r.sel}: solid fill ${r.bg} must carry WHITE ink, got ${r.fg}`);
      }
      /* ── F-936: the MUTED ink, measured on the surfaces it is really read on ──
         --text-muted is not a fill, so nothing above sees it; it is here because it is the
         same defect in the same sheet - a token under AA in both themes, on .empty-state
         and .hint text all over the four apps. Measured against the card and the sunken
         surface rather than asserted as a hex, so a later theme change to either surface
         fails here instead of quietly re-breaking the text. */
      const muted = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.className = "card";
        probe.style.color = "var(--text-muted)";
        document.querySelector(".container").appendChild(probe);
        const cs = getComputedStyle(probe);
        const root = getComputedStyle(document.documentElement);
        const out = { ink: cs.color, surfaces: [] };
        for (const v of ["--card-bg", "--input-bg", "--bg-color", "--surface", "--surface-sunken", "--surface-raised"]) {
          const raw = root.getPropertyValue(v).trim();
          if (!raw || /transparent|none/i.test(raw)) continue;
          const s2 = document.createElement("div");
          s2.style.background = raw;
          document.querySelector(".container").appendChild(s2);
          out.surfaces.push([v, getComputedStyle(s2).backgroundColor]);
          s2.remove();
        }
        probe.remove();
        return out;
      });
      {
        const rgbOf = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
        const lum = (c) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = (a, b) => { const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b)); return (L1 + 0.05) / (L2 + 0.05); };
        const ink = rgbOf(muted.ink);
        ok(!!ink, `${app}/${theme}: --text-muted resolves (got ${muted.ink})`);
        ok(muted.surfaces.length > 0, `${app}/${theme}: at least one surface token to read muted text on`);
        for (const [name, bg] of muted.surfaces) {
          const r = ratio(ink, rgbOf(bg));
          ok(r >= 4.5, `${app}/${theme} --text-muted on ${name}: ${r.toFixed(2)}:1 (${muted.ink} on ${bg}) is under AA 4.5:1`);
        }
      }
      await ctx.close();
    }
    console.log(`${app} done`);
  }
} finally {
  await browser.close();
}

console.log(`\nchip-contrast: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
