/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * EDITION CHIP (1.3) across the OTHER three Custom UI apps — config-ui, config-view
 * and issue-glance. Asserts the chip renders once, reads the right label, and carries
 * the SOLID per-theme hue (never a faded tint), in light AND dark.
 *
 * ALSO (F-294): the CODER PANEL block at the bottom. manifest 176dd13 pointed
 * `jira:issuePanel coder-panel` at the SAME issue-glance-resource as the issueContext
 * glance, so every issue rendered the full glance twice — a duplicate activity list and a
 * duplicate getIssueActivity round-trip. That block mounts the bundle with
 * window.__MODULE_KEY__ = "coder-panel" and asserts the placeholder card, the ABSENCE of
 * the activity list, and the ABSENCE of the getIssueActivity invoke, in both themes.
 *
 * No prereq build: each app's build-shot is rebuilt here when missing or stale
 * (lib/build-shot.mjs, F-125) — a missing bundle is never a skip.
 * Run: node static/_screenshot-harness/edition-chip.test.mjs   (--shots saves header PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const SHOTS = process.argv.includes("--shots");
const OUT = path.join(__dirname, "out"); if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port }));
  });
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };

// app → { shot key, the selector whose presence means "mounted", the header to capture }
const APPS = [
  { app: "config-ui", shot: "cfg-validator", ready: ".container .card", head: ".header" },
  { app: "config-view", shot: "view-active", ready: ".config-item", head: ".license-banner" },
  { app: "issue-glance", shot: "issue-glance", ready: ".glance-list", head: ".glance-head" },
];

const HUE = {
  advanced: { light: "rgb(194, 65, 12)", dark: "rgb(249, 115, 22)" },
  standard: { light: "rgb(71, 85, 105)", dark: "rgb(100, 116, 139)" },
};

const browser = await chromium.launch();
try {
  for (const { app, shot, ready, head } of APPS) {
    for (const theme of ["light", "dark"]) {
      /* Three tenants, not two (F-106). "unlicensed" is a live install with NO
         license object: checkLicense answers { isActive: null, source: "none" } and
         edition "standard". It used to render NO chip at all, because every app
         gated the chip on `licenseActive !== null`. The chip must gate on the
         EDITION — which is always a real string — so this tenant reads STANDARD. */
      for (const tenant of ["advanced", "standard", "unlicensed"]) {
        const standard = tenant === "standard";
        const unlicensed = tenant === "unlicensed";
        // An unlicensed tenant IS Standard capability-wise, so it wears the slate chip.
        const ed = tenant === "advanced" ? "advanced" : "standard";
        const label = ed === "advanced" ? "coder" : "standard";
        // F-125: a missing build-shot used to SKIP here, so this suite could report 0/0
        // and read as a pass. It now BUILDS, and a stale bundle is rebuilt.
        const root = ensureFreshBuildShot(app);
        const { s, port } = await serve(root);
        const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
        await ctx.addInitScript(([sh, th, std, unl]) => {
          // NOTE: no documentElement.setAttribute here — an init script runs before
          // the document exists and the throw would abort the rest of this function
          // (that is how __STANDARD__ silently never got set the first time round).
          window.__SHOT__ = sh; window.__THEME__ = th;
          if (std) window.__STANDARD__ = true;
          if (unl) window.__UNLICENSED__ = true;
        }, [shot, theme, standard, unlicensed]);
        const page = await ctx.newPage();
        const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message)));
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
        try {
          await page.locator(ready).first().waitFor({ timeout: 15000 });
          const chip = page.locator(".edition-chip");
          await chip.first().waitFor({ timeout: 10000 });
          ok(await chip.count() === 1, `${app}/${theme}/${tenant} exactly one chip`);
          ok((await chip.first().innerText()).trim().toLowerCase() === label, `${app}/${theme}/${tenant} chip label`);
          const bg = await chip.first().evaluate((el) => getComputedStyle(el).backgroundColor);
          ok(bg === HUE[ed][theme], `${app}/${theme}/${tenant} solid hue (got ${bg})`);
          ok(await chip.first().evaluate((el) => getComputedStyle(el).opacity) === "1", `${app}/${theme}/${tenant} chip not faded`);
          ok(errors.length === 0, `${app}/${theme}/${tenant} no page errors: ${errors.join(" | ")}`);
          if (SHOTS && tenant === "advanced") {
            await page.locator(head).first().screenshot({ path: path.join(OUT, `chip-${app}-${theme}.png`) });
          }
        } catch (e) {
          fail++; console.log(`  ✗ ${app}/${theme}/${tenant} threw: ${e.message.split("\n")[0]}`);
        }
        await ctx.close(); await new Promise((r) => s.close(r));
      }
    }
    console.log(`${app} done`);
  }

  /* ------------------------------------------------------------------ F-294
     THE CODER PANEL (jira:issuePanel coder-panel), same bundle, different module.

     FAIL-BEFORE: with the module unread, App.js took the glance path regardless, so
     `.glance-list` rendered (4 canned activity items) and getIssueActivity was invoked —
     both of the assertions below flip. PASS-AFTER: a `.coder-soon` card, no list, no call.

     Three tenants, because the upgrade sentence has three distinct answers:
       advanced + Forge LLM  -> no sentence (they already have Coder)
       standard + Forge LLM  -> the sentence (the one case that earns it)
       standard + BYOK       -> no sentence (agentCapability enables BYOK outright, so
                                upgrading buys them nothing — offering it would be a lie) */
  const PANEL = [
    { tenant: "advanced", standard: false, provider: "atlassian", upgrade: false, ed: "advanced" },
    { tenant: "standard-forge", standard: true, provider: "atlassian", upgrade: true, ed: "standard" },
    { tenant: "standard-byok", standard: true, provider: "anthropic", upgrade: false, ed: "standard" },
  ];
  // The "1.4" badge deliberately reuses the Coder burnt orange, so its solid per-theme
  // value is the SAME pair the chip is checked against — one hue, one dark override.
  const BADGE_HUE = HUE.advanced;

  for (const theme of ["light", "dark"]) {
    for (const t of PANEL) {
      const root = ensureFreshBuildShot("issue-glance");
      const { s, port } = await serve(root);
      const ctx = await browser.newContext({ viewport: { width: 420, height: 500 } });
      await ctx.addInitScript(([th, std, prov]) => {
        window.__SHOT__ = "issue-glance"; window.__THEME__ = th;
        window.__MODULE_KEY__ = "coder-panel";   // <- mount as the issuePanel, not the glance
        window.__PROVIDER__ = prov;
        if (std) window.__STANDARD__ = true;
      }, [theme, t.standard, t.provider]);
      const page = await ctx.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message)));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      const id = `coder-panel/${theme}/${t.tenant}`;
      try {
        /* Wait on `.glance` (the ROOT, which mounts on BOTH paths), never on
           `.coder-soon`. Waiting on the card would make the fail-before a single
           15s timeout that says only "no card" — the duplicate list and the stray
           getIssueActivity, which ARE the defect, would never get asserted. Waiting
           on the root lets every assertion below run and name what is actually wrong. */
        await page.locator(".glance").waitFor({ timeout: 15000 });
        await page.waitForTimeout(600); // let either path finish its invokes + render

        ok(await page.locator(".coder-soon").count() === 1, `${id} placeholder card rendered`);

        // --- the duplicate this finding is about ---------------------------------
        ok(await page.locator(".glance-list").count() === 0, `${id} NO duplicate activity list`);
        ok(await page.locator(".glance-item").count() === 0, `${id} NO activity items`);
        const calls = await page.evaluate(() => (window.__CALLS__ || []).map((c) => c.name));
        ok(!calls.includes("getIssueActivity"), `${id} getIssueActivity NOT invoked (saw: ${calls.join(",") || "none"})`);
        // Positive control: __CALLS__ is genuinely recording, so the negative above means
        // something. Without this, a broken recorder would read as a pass (LAW: prove the
        // negative, never merely observe it).
        ok(calls.includes("checkLicense"), `${id} __CALLS__ is recording (checkLicense seen)`);

        // --- the placeholder content ---------------------------------------------
        /* .glance-head is `text-transform: uppercase`, and innerText reports the
           TRANSFORMED text ("CR COGNIRUNNER CODER"), so compare case-insensitively —
           the source casing is asserted by the lead sentence below, which is not
           transformed. Also assert it is NOT the glance header, so a header that
           somehow contained both strings could not pass. */
        const headTxt = (await page.locator(".glance-head").innerText()).toUpperCase();
        ok(headTxt.includes("COGNIRUNNER CODER"), `${id} header reads CogniRunner Coder (got "${headTxt}")`);
        ok(!headTxt.includes("ON THIS ISSUE"), `${id} header is NOT the glance header`);
        const lead = (await page.locator(".coder-soon-lead").innerText()).trim();
        ok(/^CogniRunner Coder arrives in 1\.4 . in-issue coding chat, GitHub & Bitbucket, PR review\.$/.test(lead), `${id} lead sentence (got "${lead}")`);
        ok(await page.locator(".coder-soon-upgrade").count() === (t.upgrade ? 1 : 0), `${id} upgrade sentence ${t.upgrade ? "shown" : "hidden"}`);
        if (t.upgrade) {
          ok((await page.locator(".coder-soon-upgrade").innerText()).includes("upgrade in Jira's Manage apps"), `${id} upgrade sentence copy`);
        }

        // --- the owner's UI rules, on the new card --------------------------------
        const badgeBg = await page.locator(".coder-soon-badge").evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(badgeBg === BADGE_HUE[theme], `${id} badge solid hue (got ${badgeBg})`);
        ok(await page.locator(".coder-soon-badge").evaluate((el) => getComputedStyle(el).opacity) === "1", `${id} badge not faded`);
        // No left accent rail, anywhere on the card (the owner's hardest rule).
        const rails = await page.locator(".coder-soon").evaluate((el) => {
          const bad = [];
          for (const n of [el, ...el.querySelectorAll("*")]) {
            const cs = getComputedStyle(n);
            const lw = parseFloat(cs.borderLeftWidth) || 0;
            const others = ["borderTopWidth", "borderRightWidth", "borderBottomWidth"].map((k) => parseFloat(cs[k]) || 0);
            if (lw > 0 && others.some((w) => w !== lw)) bad.push(n.className + ":" + cs.borderLeftWidth);
          }
          return bad;
        });
        ok(rails.length === 0, `${id} no left accent rail (${rails.join(" | ")})`);

        // The chip still renders exactly once, with its solid per-theme hue.
        const chip = page.locator(".edition-chip");
        ok(await chip.count() === 1, `${id} exactly one chip`);
        ok((await chip.innerText()).trim().toLowerCase() === (t.ed === "advanced" ? "coder" : "standard"), `${id} chip label`);
        ok(await chip.evaluate((el) => getComputedStyle(el).backgroundColor) === HUE[t.ed][theme], `${id} chip solid hue`);

        ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
        if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-panel-${theme}-${t.tenant}.png`) });
      } catch (e) {
        fail++; console.log(`  ✗ ${id} threw: ${e.message.split("\n")[0]}`);
      }
      await ctx.close(); await new Promise((r) => s.close(r));
    }
  }
  console.log("coder-panel done");
} finally {
  await browser.close();
}
console.log(`EDITION CHIP (config-ui / config-view / issue-glance) + CODER PANEL (F-294): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
