/*
 * UNTRACKED — renders branded marketplace highlights + banner from HTML templates,
 * compositing the dark UI screenshots. Outputs 2x PNGs to _marketing/out/ for
 * post-processing (resize/crop) into final marketplace assets.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const SM = "/Users/mihaiperdum/Projects/CogniRunner/static/submission-material";
const MK = `${SM}/_marketing`;
const SHOTS = `${SM}/new-screenshots/dark`;
const OUT = `${MK}/out`;
fs.mkdirSync(OUT, { recursive: true });

const imgUrl = (name) => "file://" + path.join(SHOTS, name);
const tpl = (file) => "file://" + path.join(MK, file);

const HIGHLIGHTS = [
  {
    out: "highlight-1",
    accent: "#2684FF", accent2: "#4C9AFF",
    eyebrow: "Agentic AI validation",
    title: "Validate meaning, not just structure",
    sub: "CogniRunner reads your fields, attachments, and issues — then blocks a transition when something's wrong, and shows the user why.",
    feats: "Plain-English rules, no scripting|Agentic duplicate detection|Reads PDFs, images & Office docs",
    img: "view-agentic-log.png",
  },
  {
    out: "highlight-2",
    accent: "#8B5CF6", accent2: "#A78BFA",
    eyebrow: "Bring your own AI",
    title: "Your AI, your key",
    sub: "Connect OpenAI, Anthropic, Azure, OpenRouter, or AWS Bedrock with your own key — or use the zero-key Atlassian Forge LLM.",
    feats: "Six providers supported|Per-provider key storage|No embedded keys, ever",
    img: "admin-settings.png",
  },
  {
    out: "highlight-3",
    accent: "#22C55E", accent2: "#4ADE80",
    eyebrow: "Automate after the transition",
    title: "Post-functions that think",
    sub: "Let AI update fields, draft comments, create sub-tasks, or run generated code — chained, tested, and sandboxed. All in plain English.",
    feats: "Semantic & static post-functions|Zero AI cost after setup|Up to 50 chained steps",
    img: "config-static-pf.png",
  },
];

async function shoot(page, url, w, h, outFile) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
  await page.waitForFunction(() => { const i = document.getElementById("shot"); return i && i.complete && i.naturalWidth > 0; }, { timeout: 15000 }).catch(() => console.log("  (shot img not confirmed loaded)"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: outFile, clip: { x: 0, y: 0, width: w, height: h } });
  console.log("OK", path.basename(outFile));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();

for (const h of HIGHLIGHTS) {
  const q = new URLSearchParams({ accent: h.accent, accent2: h.accent2, eyebrow: h.eyebrow, title: h.title, sub: h.sub, feats: h.feats, img: imgUrl(h.img) }).toString();
  await shoot(page, `${tpl("highlight-template.html")}?${q}`, 1840, 900, path.join(OUT, `${h.out}_2x.png`));
}

const bq = new URLSearchParams({ img: imgUrl("admin-rules.png") }).toString();
await shoot(page, `${tpl("banner-template.html")}?${bq}`, 1120, 548, path.join(OUT, "banner_2x.png"));

await browser.close();
console.log("\nRendered to", OUT);
