/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// PROVIDER BARRAGE wrapper — chains barrage steps 0–2 for whatever provider is CURRENTLY
// active (the owner switches it in admin first; there is no programmatic switch). Streams
// each step live, then prints a consolidated summary. See PROVIDER-BARRAGE.md for the full
// runbook (and the per-provider risk watch + recording step that stay agent-driven).
//
//   node scripts/barrage.mjs
//
// Env:
//   BARRAGE_WAIT=35        seconds to wait up front for the 30s provider cache to clear
//   BARRAGE_SKIP_MCP=1     skip the live-MCP steps (2a/2b) — use if MCPs aren't configured
//   BARRAGE_SMOKE=1        run the comprehensive suite in SMOKE mode (one case/rule — fast,
//                          for a quick health check, NOT a scoring run)
//   RUN_CONCURRENCY=3      passed through to run-transitions.mjs
//
// It does NOT switch providers, record the FINDINGS row, or commit — those stay with the
// agent/owner (the matrix row must be tagged with the owner-stated provider+model).

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = dirname(SCRIPTS_DIR);
const RESULTS_DIR = join(HARNESS_ROOT, "results");

const WAIT = parseInt(process.env.BARRAGE_WAIT || "35", 10);
const SKIP_MCP = process.env.BARRAGE_SKIP_MCP === "1";
const SMOKE = process.env.BARRAGE_SMOKE === "1";
// Deep mode: graded run-deep + the every-real-rule discovery sweep + coverage
// report, instead of the binary run-transitions suite. Built for the weak-model
// forcing-function loop. Default OFF — the classic barrage is unchanged.
const DEEP = process.env.BARRAGE_DEEP === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function run(label, script, extraEnv = {}) {
  console.log(`\n${bold("=== " + label + " ===")}  (node scripts/${script})`);
  const r = spawnSync("node", [join(SCRIPTS_DIR, script)], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  const code = r.status == null ? -1 : r.status;
  if (code !== 0) console.log(`  ⚠ ${script} exited ${code}`);
  return { label, script, code };
}

async function main() {
  console.log(bold("=== PROVIDER BARRAGE — steps 0–2 for the ACTIVE provider ==="));
  console.log("Confirm you switched the active provider in admin → Settings BEFORE running this.");
  console.log("This wrapper does NOT switch providers and does NOT record/commit the matrix row.");
  if (WAIT > 0) {
    console.log(`Waiting ${WAIT}s for the 30s provider config cache to clear…`);
    await sleep(WAIT * 1000);
  }

  const steps = [];
  steps.push(run("STEP 0a — reset to hub", "reset-to-hub.mjs"));
  steps.push(run("STEP 0b — provider smoke (live + real verdicts?)", "_smoke-provider.mjs"));
  if (DEEP) {
    steps.push(run(`STEP 1 — DEEP graded suite${SMOKE ? " (SMOKE — one case/rule)" : ""}`,
      "run-deep.mjs", SMOKE ? { SMOKE: "1" } : {}));
    steps.push(run("STEP 1b — exercise EVERY deployed rule (discovery sweep)", "exercise-discovered.mjs"));
  } else {
    steps.push(run(`STEP 1 — comprehensive suite${SMOKE ? " (SMOKE — one case/rule)" : " (~782 cases)"}`,
      "run-transitions.mjs", SMOKE ? { SMOKE: "1" } : {}));
  }
  if (!SKIP_MCP) {
    steps.push(run("STEP 2a — live MCP e2e (gendoc must attach)", "mcp-live-e2e.mjs"));
    steps.push(run("STEP 2b — Research & Document flavor", "research-doc-test.mjs", { CLEAN: "1" }));
  } else {
    console.log("\n(BARRAGE_SKIP_MCP=1 — skipping the live-MCP steps 2a/2b.)");
  }
  if (DEEP) {
    steps.push(run("STEP 3 — coverage report (PASS/SOFT/HARD + A/B/C + worklist)", "coverage-report.mjs"));
  }

  console.log(`\n${bold("=== BARRAGE SUMMARY ===")}`);
  for (const s of steps) console.log(`  ${s.code === 0 ? "✓" : "✗(" + s.code + ")"}  ${s.label}`);

  // Suite score by study (from run-results.json).
  const runPath = join(RESULTS_DIR, "run-results.json");
  if (existsSync(runPath)) {
    try {
      const res = JSON.parse(readFileSync(runPath, "utf8"));
      const byStudy = {};
      for (const r of res.results || []) { const b = (byStudy[r.study] ||= { c: 0, t: 0 }); b.t++; if (r.correct) b.c++; }
      console.log(`\n  ${bold("Suite by study:")}`);
      for (const [k, v] of Object.entries(byStudy)) console.log(`    ${k.padEnd(12)} ${v.c}/${v.t}`);
      const total = (res.results || []).filter((r) => r.correct).length;
      console.log(`  ${bold("TOTAL:")} ${total}/${(res.results || []).length}` +
        (SMOKE ? "  (SMOKE — not a scoring run)" : "  (baseline to beat: ~766–770/782, no regression)"));
    } catch { console.log("  (run-results.json present but unparseable)"); }
  }

  // MCP / research-doc verdicts.
  for (const [name, file] of [["live MCP", "mcp-live-e2e.json"], ["research-doc", "research-doc-test.json"]]) {
    const p = join(RESULTS_DIR, file);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const verdicts = Array.isArray(j.results)
        ? j.results.filter((r) => r.verdict).map((r) => `${r.scenario}:${r.verdict}`).join(", ")
        : (j.verdict || "?");
      console.log(`  ${bold(name + ":")} ${verdicts}`);
    } catch { /* ignore */ }
  }

  console.log("\nNEXT (agent): assert the provider-specific risk watch (Step 4), then add this provider's");
  console.log("row to FINDINGS.md tagged with the owner-stated provider+model, and commit as leanzero.srl.");
  console.log("Then the owner switches to the next provider and re-runs. See PROVIDER-BARRAGE.md.");
}

main().catch((e) => { console.error("BARRAGE wrapper failed:", e.message); process.exit(1); });
