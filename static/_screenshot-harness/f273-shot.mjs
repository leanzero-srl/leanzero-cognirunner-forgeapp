/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * F-273 — a two-theme SHOT of the edition note on a knowledge surface.
 *
 * editor-journeys.test.mjs owns the ASSERTIONS (it reads the fill, the text colour and the
 * absent rail straight out of getComputedStyle, which is the check that actually fails a
 * build). This script exists only so a human can look at the thing, because a colour law is
 * the one kind of rule a passing assertion still cannot fully settle — "is that the right
 * orange next to everything else on the panel" is a judgement, not a predicate.
 *
 * Run: node static/_screenshot-harness/f273-shot.mjs   → out/f273-upgrade-<theme>.png
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port }));
  });
}

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const root = ensureFreshBuildShot("config-ui");
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(([th]) => {
    window.__SHOT__ = "cfg-static"; window.__THEME__ = th;
    window.__UPGRADE__ = ["getMemories"]; window.__UPGRADE_FEATURE__ = "coder";
  }, [theme]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  const kp = page.locator(".knowledge-panel").first();
  await kp.waitFor({ timeout: 15000 });
  if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
    await kp.locator(".knowledge-summary").click();
  }
  await kp.locator(".knowledge-tabs").waitFor({ timeout: 8000 });
  await kp.locator(".knowledge-tab-memories").click();
  await kp.locator(".upgrade-note").first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);

  await kp.screenshot({ path: path.join(OUT, `f273-upgrade-${theme}.png`) });
  console.log(`wrote out/f273-upgrade-${theme}.png`);
  await ctx.close();
  await new Promise((r) => s.close(r));
}
await browser.close();
