/* UNTRACKED — capture LIGHT screenshots of Skills, Memories, MCP for the website docs. */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const OUT = path.resolve(STATIC, "submission-material/_marketing/extra");
fs.mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end("x"); }
      r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
    });
    s.listen(0, "127.0.0.1", () => res({ s, port: s.address().port }));
  });
}
const NO_ANIM = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
const TARGETS = [
  { out: "skills", tab: "Skills", el: ".container" },
  { out: "memories", tab: "Memories", el: ".container" },
  { out: "mcp", tab: "Settings", el: '.card:has-text("MCP Integrations")', scrollMcp: true },
];
const browser = await chromium.launch();
const root = path.join(STATIC, "admin-panel", "build-shot");
const { s, port } = await serve(root);
for (const t of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(() => { window.__SHOT__ = "admin"; window.__THEME__ = "light"; document.documentElement.setAttribute("data-color-mode", "light"); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: NO_ANIM });
    await page.evaluate(() => { document.documentElement.style.background = "#f1f2f4"; document.body.style.background = "#f1f2f4"; });
    await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
    await page.locator(".tab-bar button", { hasText: t.tab }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    if (t.scrollMcp) await page.getByText("MCP Integrations").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    const el = (await page.$(t.el)) ? page.locator(t.el).first() : null;
    const file = path.join(OUT, `${t.out}.png`);
    if (el) await el.screenshot({ path: file }); else await page.screenshot({ path: file });
    console.log("OK", t.out, Math.round(fs.statSync(file).size / 1024) + "KB");
  } catch (e) { console.log("ERR", t.out, e.message.split("\n")[0]); }
  finally { await ctx.close(); }
}
await new Promise((r) => s.close(r));
await browser.close();
console.log("extra ->", OUT);
