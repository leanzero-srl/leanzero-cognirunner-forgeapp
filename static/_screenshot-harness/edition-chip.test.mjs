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
 * Prereq (each app): npx webpack --config webpack.screenshot.js --mode production
 * Run: node static/_screenshot-harness/edition-chip.test.mjs   (--shots saves header PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      for (const standard of [false, true]) {
        const ed = standard ? "standard" : "advanced";
        const label = standard ? "standard" : "coder";
        const root = path.join(STATIC, app, "build-shot");
        if (!fs.existsSync(path.join(root, "index.html"))) { console.log(`SKIP ${app}: no build-shot`); break; }
        const { s, port } = await serve(root);
        const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
        await ctx.addInitScript(([sh, th, std]) => {
          // NOTE: no documentElement.setAttribute here — an init script runs before
          // the document exists and the throw would abort the rest of this function
          // (that is how __STANDARD__ silently never got set the first time round).
          window.__SHOT__ = sh; window.__THEME__ = th;
          if (std) window.__STANDARD__ = true;
        }, [shot, theme, standard]);
        const page = await ctx.newPage();
        const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message)));
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
        try {
          await page.locator(ready).first().waitFor({ timeout: 15000 });
          const chip = page.locator(".edition-chip");
          await chip.first().waitFor({ timeout: 10000 });
          ok(await chip.count() === 1, `${app}/${theme}/${ed} exactly one chip`);
          ok((await chip.first().innerText()).trim().toLowerCase() === label, `${app}/${theme}/${ed} chip label`);
          const bg = await chip.first().evaluate((el) => getComputedStyle(el).backgroundColor);
          ok(bg === HUE[ed][theme], `${app}/${theme}/${ed} solid hue (got ${bg})`);
          ok(await chip.first().evaluate((el) => getComputedStyle(el).opacity) === "1", `${app}/${theme}/${ed} chip not faded`);
          ok(errors.length === 0, `${app}/${theme}/${ed} no page errors: ${errors.join(" | ")}`);
          if (SHOTS && !standard) {
            await page.locator(head).first().screenshot({ path: path.join(OUT, `chip-${app}-${theme}.png`) });
          }
        } catch (e) {
          fail++; console.log(`  ✗ ${app}/${theme}/${ed} threw: ${e.message.split("\n")[0]}`);
        }
        await ctx.close(); await new Promise((r) => s.close(r));
      }
    }
    console.log(`${app} done`);
  }
} finally {
  await browser.close();
}
console.log(`EDITION CHIP (config-ui / config-view / issue-glance): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
