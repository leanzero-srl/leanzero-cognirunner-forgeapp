/* UNTRACKED — render the v3 brand compositions (thumbnail language) from _marketing/brand-v3.html at DSF 2.
   Outputs the 2x PNGs to _marketing/out/; finalize (Lanczos downscale + exact px check) with PIL afterwards.
   node render-brand-v3.mjs            (from static/_screenshot-harness) */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const MK = "/Users/mihaiperdum/Projects/CogniRunner/static/submission-material/_marketing";
const OUT = path.join(MK, "out"); fs.mkdirSync(OUT, { recursive: true });
const tpl = "file://" + path.join(MK, "brand-v3.html");
const img = (n) => "file://" + path.join(MK, "focus", n);

const JOBS = [
  { out: "banner3", w: 1120, h: 548, mode: "banner", s: 1, pill: "AI workflow agent for Jira",
    title: "Validate React |Schedule|", img: img("listeners-light.png"), ww: 540, right: 44, fs: 100 },
  { out: "og3", w: 1200, h: 630, mode: "og", s: 1.07, pill: "AI workflow agent for Jira",
    title: "Validate React |Schedule|", img: img("listeners-light.png"), ww: 580, right: 46, fs: 108 },
  { out: "hero3", w: 1920, h: 640, mode: "hero", s: 1.12, pill: "Validators · Listeners · Scheduled jobs",
    title: "Your~AI |workflow| agent", img1: img("hero-listener.png"), img2: img("hero-report.png"), img3: img("hero-toast.png"),
    x1: 800, y1: 64, w1: 540, x2: 1170, y2: 330, w2: 470, x3: 1520, y3: 130, w3: 320, fs: 124 },
];

const browser = await chromium.launch();
for (const j of JOBS) {
  const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const q = new URLSearchParams(Object.fromEntries(Object.entries(j).filter(([k]) => k !== "out").map(([k, v]) => [k, String(v)])));
  await page.goto(`${tpl}?${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1" && document.fonts.status === "loaded", { timeout: 20000 });
  const fontOk = await page.evaluate(() => document.fonts.check("900 40px Inter"));
  const fs2 = await page.evaluate(() => document.body.dataset.fs);
  const clipped = await page.evaluate(() => +document.body.dataset.clipped);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `${j.out}_2x.png`), clip: { x: 0, y: 0, width: j.w, height: j.h } });
  console.log(clipped ? "CLIPPED!" : "OK", j.out, `${j.w}x${j.h}`, "Inter900:", fontOk, "fitted fs:", fs2, "windows clipped:", clipped);
  await ctx.close();
}
await browser.close();
