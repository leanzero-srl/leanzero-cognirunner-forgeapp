/* UNTRACKED — captures tightly-framed, high-res DARK crops of the "work" regions
 * for the marketplace highlights (element screenshots = crisp + no cut-off). */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const OUT = path.resolve(STATIC, "submission-material/_marketing/focus");
fs.mkdirSync(OUT, { recursive: true });
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
const NO_ANIM = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.logs-list,.log-trace-content{max-height:none!important;overflow:visible!important}`;

const TARGETS = [
  { app: "config-view", shot: "view-active", out: "validate", showLogs: true, openTrace: true, wait: ".log-entry", el: ".log-entry" },
  { app: "admin-panel", shot: "admin", out: "byok", tab: "Settings", wait: ".card.veil-host", el: ".card.veil-host" },
  { app: "config-ui", shot: "cfg-static", out: "automate", wait: ".function-block", el: ".function-block" },
];

const browser = await chromium.launch();
for (const t of TARGETS) {
  const root = path.join(STATIC, t.app, "build-shot");
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(([shot]) => { window.__SHOT__ = shot; window.__THEME__ = "dark"; document.documentElement.setAttribute("data-color-mode", "dark"); }, [t.shot]);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: NO_ANIM });
    await page.evaluate(() => { document.documentElement.style.background = "#0b0b12"; document.body.style.background = "#0b0b12"; });
    await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
    if (t.tab) await page.locator(".tab-bar button", { hasText: t.tab }).first().click({ timeout: 8000 }).catch(() => {});
    if (t.showLogs) await page.getByRole("button", { name: /show logs/i }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForSelector(t.wait, { timeout: 12000 });
    if (t.openTrace) await page.evaluate(() => document.querySelectorAll("details.log-trace").forEach((d) => { d.open = true; }));
    await page.waitForTimeout(500);
    const el = page.locator(t.el).first();
    const file = path.join(OUT, `${t.out}.png`);
    await el.screenshot({ path: file });
    console.log("OK", t.out, "->", fs.statSync(file).size, "bytes");
  } catch (e) { console.log("ERR", t.out, e.message.split("\n")[0]); }
  finally { await ctx.close(); await new Promise((r) => s.close(r)); }
}
await browser.close();
console.log("focus crops ->", OUT);
