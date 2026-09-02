/* UNTRACKED — records real interaction clips of the CogniRunner UIs (mocked bridge)
 * with a visible cursor, for the demo video. Each segment -> its own .webm in clips/. */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const CLIPS = path.resolve(STATIC, "submission-material/video-src/clips");
const ONLY = process.argv[2]; // optional: only (re)record segments whose name contains this
if (!ONLY) fs.rmSync(CLIPS, { recursive: true, force: true });
fs.mkdirSync(CLIPS, { recursive: true });

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = () => {
  const add = () => {
    if (document.getElementById("__cur")) return;
    const c = document.createElement("div"); c.id = "__cur";
    Object.assign(c.style, { position: "fixed", width: "24px", height: "24px", borderRadius: "50%", left: "0", top: "0", transform: "translate(-50%,-50%)", zIndex: "2147483647", pointerEvents: "none", background: "rgba(59,130,246,0.30)", border: "2.5px solid #3B82F6", boxShadow: "0 0 14px rgba(59,130,246,0.7)", transition: "width .1s,height .1s,background .1s" });
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { c.style.width = "38px"; c.style.height = "38px"; c.style.background = "rgba(59,130,246,0.55)"; }, true);
    addEventListener("mouseup", () => { c.style.width = "24px"; c.style.height = "24px"; c.style.background = "rgba(59,130,246,0.30)"; }, true);
  };
  if (document.body) add(); else addEventListener("DOMContentLoaded", add);
};

const VW = { width: 1920, height: 1080 };
let cur = { x: 960, y: 540 };

async function glide(page, x, y, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 16));
  const sx = cur.x, sy = cur.y;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await page.mouse.move(sx + (x - sx) * t, sy + (y - sy) * t);
    await sleep(14);
  }
  cur = { x, y };
}
async function center(page, sel, timeout = 10000) {
  const el = page.locator(sel).first();
  await el.waitFor({ state: "visible", timeout });
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
// scroll a target to the vertical center of the frame so the action is front-and-center
async function centerOn(page, sel) {
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" })).catch(() => {});
  await sleep(450);
}
async function glideClick(page, sel, { ms = 600, pre = 250, post = 600, centerFirst = false } = {}) {
  if (centerFirst) await centerOn(page, sel);
  const { x, y } = await center(page, sel);
  await glide(page, x, y, ms); await sleep(pre);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await sleep(post);
}
async function glideClickText(page, sel, text, opts) {
  return glideClick(page, `${sel}:has-text("${text}")`, opts);
}
async function typeInto(page, sel, text, { perChar = 42, centerFirst = false } = {}) {
  await glideClick(page, sel, { post: 200, centerFirst });
  for (const ch of text) { await page.keyboard.type(ch); await sleep(perChar + Math.random() * 30); }
  await sleep(500);
}
async function settleApp(page) {
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
  await sleep(700);
}

async function runSeg(browser, app, shot, name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const root = path.join(STATIC, app, "build-shot");
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: VW, recordVideo: { dir: CLIPS, size: VW }, reducedMotion: "reduce" });
  await ctx.addInitScript(CURSOR);
  await ctx.addInitScript(([sh]) => { window.__SHOT__ = sh; window.__THEME__ = "dark"; document.documentElement.setAttribute("data-color-mode", "dark"); }, [shot]);
  const page = await ctx.newPage();
  cur = { x: 960, y: 600 };
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => { document.documentElement.style.background = "#0b0e16"; document.body.style.background = "#0b0e16"; });
    await page.addStyleTag({ content: ".logs-list,.log-trace-content{max-height:none!important;overflow:visible!important}" });
    await settleApp(page);
    await page.mouse.move(cur.x, cur.y);
    await fn(page);
    await sleep(900);
  } catch (e) { console.log(`  ! ${name}: ${e.message.split("\n")[0]}`); }
  const video = page.video();
  await ctx.close();
  if (video) { const vp = await video.path(); fs.renameSync(vp, path.join(CLIPS, `${name}.webm`)); }
  await new Promise((r) => s.close(r));
  console.log("clip:", name);
}

const tab = (page, label) => glideClick(page, `.tab-bar button:has-text("${label}")`, { post: 1100 });

const browser = await chromium.launch();

// S1 — Rules dashboard
await runSeg(browser, "admin-panel", "admin", "01-dashboard", async (page) => {
  await sleep(1400);
  await glide(page, 700, 760, 700); await sleep(900);   // hover a rule row
  await glide(page, 700, 900, 700); await sleep(1400);
});

// S2 — Create a rule via the wizard
await runSeg(browser, "admin-panel", "admin", "02-create-rule", async (page) => {
  await glideClickText(page, ".btn-small", "Add Rule", { post: 1100, centerFirst: true });
  await glideClickText(page, "button", "Demo Project", { post: 1100, centerFirst: true }).catch(() => {});
  await glideClickText(page, "button", "Software Simplified Workflow", { post: 1100, centerFirst: true }).catch(() => {});
  await glideClickText(page, "button", "Submit for Review", { post: 1100, centerFirst: true }).catch(() => {});
  await glideClickText(page, "button", "Validator", { post: 1200, centerFirst: true }).catch(() => {});
  // field dropdown (first CustomSelect in wizard) — center it so the picker opens mid-frame
  await glideClick(page, ".wizard .dropdown-trigger", { post: 500, centerFirst: true }).catch(() => {});
  await glideClick(page, '.dropdown-panel .dropdown-item:has-text("Summary")', { post: 800 }).catch(() => {});
  await typeInto(page, ".wizard textarea", "Require a clear, complete explanation before this transition is allowed.", { centerFirst: true });
  await glideClick(page, '.btn-small:has-text("Create Rule")', { post: 1800, centerFirst: true }).catch(() => {});
  await page.waitForSelector(".wiz-success-title", { timeout: 6000 }).catch(() => {});
  await page.locator(".wiz-success-title").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  await sleep(2200);
});

// S3 — Multi-provider BYOK + local LM Studio
await runSeg(browser, "admin-panel", "admin", "03-providers", async (page) => {
  await tab(page, "Settings");
  await page.waitForSelector(".openai-status", { timeout: 8000 }).catch(() => {});
  await sleep(1000);
  await glideClick(page, ".card.veil-host .dropdown-trigger", { post: 800, centerFirst: true }).catch(() => {});
  await sleep(2000); // full provider list (LM Studio + Atlassian Forge LLM visible)
  await glideClickText(page, ".dropdown-panel .dropdown-item", "LM Studio", { post: 1200 }).catch(() => {});
  await sleep(900);
  await glideClickText(page, "button", "Test", { post: 1500, centerFirst: true }).catch(() => {}); // -> "Connected — N model(s)"
  await sleep(1100);
  await glideClick(page, '.dropdown-trigger:has-text("qwen")', { post: 900, centerFirst: true }).catch(() => {}); // open the local model list, centered
  await sleep(2500); // show the local models (loaded/cold · vision · tools · ctx)
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(500);
  await page.locator("div:has-text('Device dispatch weight')").last().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => { });
  await sleep(2600);                                    // dwell briefly on the weights explainer (centered)
});

// S4 — Active jobs draining + execution logs
await runSeg(browser, "admin-panel", "admin", "04-jobs", async (page) => {
  await tab(page, "Execution Logs");
  await page.waitForSelector(".job-entry, .logs-empty", { timeout: 8000 }).catch(() => {});
  await sleep(16000); // watch the queue drain across ~4-5 polls (3.5s each)
  await page.mouse.wheel(0, 700); await sleep(2600); // scroll to execution logs
});

// S8 — Agentic validation (autonomous JQL tool-use)
await runSeg(browser, "config-view", "view-active", "08-agentic", async (page) => {
  await sleep(800);
  await glideClickText(page, "button", "Show Logs", { post: 1200 }).catch(() => {});
  await page.waitForSelector(".log-entry", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.querySelectorAll("details.log-trace").forEach((d) => { d.open = true; }));
  await sleep(700);
  await centerOn(page, ".log-entry");
  await sleep(3600);  // JQL rounds + execution trace
});

// S9 — Permissions (roles & scopes)
await runSeg(browser, "admin-panel", "admin", "09-permissions", async (page) => {
  await tab(page, "Permissions");
  await sleep(800);
  await glide(page, 640, 430, 700); await sleep(3200);  // Viewer / Editor / Admin × own / all
});

// S10 — MCP integrations (real tools the AI can call)
await runSeg(browser, "admin-panel", "admin", "10-mcp", async (page) => {
  await tab(page, "Settings");
  await page.waitForSelector(".openai-status", { timeout: 8000 }).catch(() => {});
  await sleep(900);
  await page.getByText("MCP Integrations").first().evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => {});
  await sleep(2800);                                   // context7 · web-search · doc-reader + their tools
  await glide(page, 640, 560, 700); await sleep(2400); // glance over the tool chips
});

// S7 — Skills & Memories (the AI's grounding)
await runSeg(browser, "admin-panel", "admin", "07-knowledge", async (page) => {
  await tab(page, "Skills");
  await sleep(700);
  await glide(page, 620, 430, 700); await sleep(2600);   // reusable skill packs
  await tab(page, "Memories");
  await sleep(700);
  await glide(page, 620, 430, 700); await sleep(2800);   // learned memories about this instance
});

// S5 — AI writes the automation code (expanded focus)
await runSeg(browser, "config-ui", "cfg-static", "05-codegen", async (page) => {
  await sleep(900);
  await centerOn(page, ".function-block .textarea");     // plain-English step description, centered
  await sleep(1000);
  await glideClickText(page, ".btn-generate", "Regenerate Code", { post: 700, centerFirst: true }).catch(async () => {
    await glideClickText(page, ".btn-generate", "Generate Code", { post: 700, centerFirst: true }).catch(() => {});
  });
  await page.waitForSelector(".cm-content", { timeout: 8000 }).catch(() => {});
  await centerOn(page, ".cm-content");                    // bring the AI-written code front-and-center
  await sleep(2800);                                      // dwell on the generated code
  await page.mouse.wheel(0, 200); await sleep(2200);
  await page.mouse.wheel(0, 200); await sleep(2000);
});

// S11 — Deterministic conditions (zero AI): pick a field check, no prompt anywhere
await runSeg(browser, "config-ui", "cfg-premade", "11-conditions", async (page) => {
  await sleep(1200);                                      // NO-AI-COST chip + "Conditions run without AI" callout
  await glideClick(page, '.dropdown-trigger:has-text("Issue type is")', { post: 700, centerFirst: true });
  await glideClickText(page, ".dropdown-item", "Field equals a value", { post: 1000 });
  await glideClick(page, '.dropdown-trigger:has-text("Choose a field")', { post: 600, centerFirst: true });
  await sleep(1400);                                      // field picker: per-field support annotations visible
  await glideClickText(page, ".dropdown-item", "Team", { post: 900 });
  await typeInto(page, "input.input", "Platform", { centerFirst: true });
  await sleep(1600);                                      // dwell: field-equals configured, footer promise visible
});

// S12 — Rule management: meter, owners, delete-that-detaches, REST provisioning
await runSeg(browser, "admin-panel", "admin", "12-rulesmanage", async (page) => {
  await centerOn(page, ".usage-meter, .usage-foot, table.table");
  await sleep(1600);                                      // registry meter + Owner column
  await glideClick(page, "table.table tbody input[type=checkbox]", { post: 700, centerFirst: true });
  await glideClickText(page, "button", "Delete", { post: 1600 }).catch(() => {});
  await sleep(2400);                                      // outcome-predicting dialog: everywhere vs list-only
  await glideClickText(page, "button", "Cancel", { post: 900 }).catch(() => {});
  await glideClickText(page, "button", "Show REST API details", { post: 1200, centerFirst: true }).catch(() => {});
  await centerOn(page, ".api-info-warn");
  await sleep(2600);                                      // ARIs + the two gotchas
});

await browser.close();
console.log("\nclips ->", CLIPS);
