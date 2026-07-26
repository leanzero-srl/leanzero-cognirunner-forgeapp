/* UNTRACKED — render the v2 marketplace highlights (crisp, flat, annotated). */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const MK = "/Users/mihaiperdum/Projects/CogniRunner/static/submission-material/_marketing";
const OUT = `${MK}/out`;
fs.mkdirSync(OUT, { recursive: true });
const tpl = "file://" + path.join(MK, "highlight-v2.html");
const img = (n) => "file://" + path.join(MK, "focus", n);

const HL = [
  { out: "hl1", accent: "#3B82F6", accent2: "#7DA9FF", eyebrow: "Agentic validation",
    title: "Catch what regex can't", img: "validate.png",
    sub: "CogniRunner reads the meaning of your fields, attachments, and issues — then blocks the transition and shows the user exactly why.",
    feats: "Plain-English rules, no scripting|Autonomous JQL duplicate search|Full reasoning and audit trace",
    note: "Duplicate of PROJ-118 — blocked", noteSub: "agentic validation · 3 rounds" },
  { out: "hl2", accent: "#8B5CF6", accent2: "#B79CFF", eyebrow: "Bring your own AI",
    title: "Your AI. Your key.", img: "byok.png",
    sub: "Connect OpenAI, Anthropic, Azure, OpenRouter, or AWS Bedrock — or use the zero-key Atlassian Forge LLM. Each key stored separately.",
    feats: "Six providers supported|Per-provider key storage|No embedded keys, ever",
    note: "Anthropic connected", noteSub: "switch providers anytime" },
  { out: "hl3", accent: "#10B981", accent2: "#5EEAD4", eyebrow: "AI post-functions",
    title: "Automate after the transition", img: "automate-code.png",
    sub: "Semantic and static post-functions let AI update fields, draft comments, or run generated code — chained, tested, and sandboxed.",
    feats: "The AI writes the code once|Runs at zero AI cost|Up to 50 chained steps",
    note: "AI-generated — runs free", noteSub: "static post-function" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.setViewportSize({ width: 1840, height: 900 });
for (const h of HL) {
  const q = new URLSearchParams({ accent: h.accent, accent2: h.accent2, eyebrow: h.eyebrow, title: h.title, sub: h.sub, feats: h.feats, note: h.note, noteSub: h.noteSub, img: img(h.img) }).toString();
  await page.goto(`${tpl}?${q}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
  await page.waitForFunction(() => { const i = document.getElementById("shot"); return i && i.complete && i.naturalWidth > 0; }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const f = path.join(OUT, `${h.out}_2x.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1840, height: 900 } });
  console.log("OK", h.out);
}
await browser.close();
console.log("done ->", OUT);
