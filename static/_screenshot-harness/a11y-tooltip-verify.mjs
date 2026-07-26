/*
 * CogniRunner — one-off a11y verification for the Tooltip keyboard fix.
 * Functionally asserts (not just screenshots) that the tooltip trigger is focusable,
 * shows the bubble on FOCUS (keyboard), wires aria-describedby, and dismisses on Escape.
 * Also captures a focused screenshot (light+dark) showing the focus ring + bubble.
 * Local harness tooling — untracked, safe to delete. Run from this dir: node a11y-tooltip-verify.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const serve = (root) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
});

const root = path.join(process.cwd(), "..", "config-ui", "build-shot");
if (!fs.existsSync(path.join(root, "index.html"))) { console.error("no config-ui build-shot — build it first"); process.exit(2); }
const { server, port } = await serve(root);
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  FAIL:", m); } };

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((th) => { window.__SHOT__ = "cfg-static"; window.__THEME__ = th; document.documentElement.setAttribute("data-color-mode", th); }, theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
  const tip = page.locator(".tooltip-wrap").first();
  const count = await page.locator(".tooltip-wrap").count();
  ok(count > 0, `found tooltip-wrap (${count})`);

  // 1. focusable + shows on FOCUS (keyboard path)
  await tip.focus();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.activeElement?.classList?.contains("tooltip-wrap")), "trigger is focusable (activeElement is .tooltip-wrap)");
  ok(await page.locator('[role="tooltip"]').count() > 0, "tooltip bubble appears ON FOCUS (keyboard)");

  // 2. aria-describedby wired to the visible bubble id
  const described = await tip.getAttribute("aria-describedby");
  const bubbleId = await page.locator('[role="tooltip"]').first().getAttribute("id");
  ok(described && described === bubbleId, `aria-describedby (${described}) === bubble id (${bubbleId})`);

  // capture the focus ring + bubble (full page so the portalled bubble is included)
  await page.screenshot({ path: path.join(process.cwd(), "out", theme, "a11y-tooltip-focus.png") });

  // 3. Escape dismisses (WCAG 1.4.13)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  ok(await page.locator('[role="tooltip"]').count() === 0, "Escape dismisses the tooltip");

  // 4. aria-describedby cleared when hidden
  ok(!(await tip.getAttribute("aria-describedby")), "aria-describedby removed when hidden");
  console.log(`${theme}: checked`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
