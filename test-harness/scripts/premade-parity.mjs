/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Premade-rule parity lint. Keeps the premade catalog and the executor in lockstep:
 *   - every `available` catalog rule MUST have an executor branch in premade-rules.js
 *   - every executor branch MUST correspond to an `available` catalog rule (no orphans)
 *
 * Because the catalog also drives the config-ui/admin-panel forms, this single lint
 * keeps form ⇄ executor aligned (form drift = a rule that can't run; executor drift =
 * an orphan branch). Run manually / pre-deploy:  node test-harness/scripts/premade-parity.mjs
 * Exits 1 on any mismatch.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  PREMADE_VALIDATORS, PREMADE_CONDITIONS, PREMADE_LISTENERS, getPremadeListener,
  PREMADE_POSTFUNCTIONS, getPremadePostFunction, CODER_PF_MODES, CODER_PF_MODE_IDS, getCoderPfMode,
} from "../../src/shared/premade-rules-catalog.js";
import { isKnownEvent, requiresRepoFilter, isGitEvent } from "../../src/shared/jira-events.js";
import { AGENT_ACTIONS } from "../../src/shared/agent-actions.js";
import { normalizeListener } from "../../src/listeners.js";

const here = dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(resolve(here, "../../src/premade-rules.js"), "utf8");

// Executor branch keys: `case "x":` (the switches) + `cfg.ruleType === "x"` (issue-level guards).
const executorKeys = new Set();
for (const m of executorSrc.matchAll(/(?:case\s+|cfg\.ruleType\s*===\s*)"([a-z][a-z-]+)"/g)) {
  executorKeys.add(m[1]);
}

const allCatalog = [...PREMADE_VALIDATORS, ...PREMADE_CONDITIONS];
const availableKeys = new Set(allCatalog.filter((r) => r.availability !== "unavailable").map((r) => r.key));
const catalogKeys = new Set(allCatalog.map((r) => r.key));

const problems = [];

// 1. Every available catalog rule has an executor branch.
for (const key of availableKeys) {
  if (!executorKeys.has(key)) {
    problems.push(`Catalog rule "${key}" is available but has NO executor branch in premade-rules.js`);
  }
}

// 2. No orphan executor branch — every executor key must be an available catalog rule.
for (const key of executorKeys) {
  if (!catalogKeys.has(key)) {
    problems.push(`Executor branch "${key}" has no catalog entry`);
  } else if (!availableKeys.has(key)) {
    problems.push(`Executor branch "${key}" exists for a rule marked UNAVAILABLE in the catalog`);
  }
}

// 3. Premade LISTENERS ⇄ the ONE event catalogue + the ONE action catalogue.
// A starter that names an event nobody delivers, an action the agent cannot call,
// or that cannot survive saveListener's own validation is a broken button.
const actionIds = new Set(AGENT_ACTIONS.map((a) => a.id));
const seenListenerKeys = new Set();
for (const row of PREMADE_LISTENERS) {
  const where = `Premade listener "${row.key}"`;
  if (seenListenerKeys.has(row.key)) problems.push(`${where} is declared twice`);
  seenListenerKeys.add(row.key);
  if (catalogKeys.has(row.key)) problems.push(`${where} collides with a workflow premade rule key`);
  if (getPremadeListener(row.key) !== row) problems.push(`${where} is not findable by key`);
  if (!row.label || !row.help) problems.push(`${where} has no label/help`);
  if (!Array.isArray(row.events) || !row.events.length) problems.push(`${where} names no events`);
  for (const id of row.events || []) {
    if (!isKnownEvent(id)) problems.push(`${where} names "${id}", which is not in the event catalogue`);
  }
  const needsRepos = (row.events || []).some(requiresRepoFilter);
  const seed = row.seed || {};
  const seedRepos = (seed.filters || {}).repos;
  if (needsRepos && !Array.isArray(seedRepos)) {
    problems.push(`${where} listens to a repo-scoped event but its seed has no filters.repos array for the picker to fill`);
  }
  if ((row.events || []).some(isGitEvent) && row.requiresCapability !== "git") {
    problems.push(`${where} uses git events but does not declare requiresCapability "git"`);
  }
  for (const a of (seed.agent || {}).allowedActions || []) {
    if (!actionIds.has(a)) problems.push(`${where} allows "${a}", which is not in the agent-action catalogue`);
  }
  if (seed.mode === "agent" && !String((seed.agent || {}).instructions || "").trim()) {
    problems.push(`${where} is an agent starter with no instructions`);
  }
  if (row.agentlessTaskType && row.agentlessTaskType !== "gitreview") {
    problems.push(`${where} names an unknown agent-less task type "${row.agentlessTaskType}"`);
  }
  // F-329 — the field must ride on the SEED, or it is metadata nothing acts on: the
  // seed is what normalizeListener sees and what the saved rule keeps, and the
  // dispatcher routes on the saved row.
  if (row.agentlessTaskType && seed.agentlessTaskType !== row.agentlessTaskType) {
    problems.push(`${where} names agentlessTaskType "${row.agentlessTaskType}" on the catalogue row but its SEED does not carry it — the saved rule would run an agent turn instead of the engine`);
  }
  // …and an agentless review row must not also arm an agent-mode PR WRITE: the engine
  // owns the claim, the write brake and the rate ledger, an agent turn owns none of
  // them (F-320).
  if (row.agentlessTaskType === "gitreview") {
    for (const a of (seed.agent || {}).allowedActions || []) {
      if (a === "add_pr_comment" || a === "approve_pull_request" || a === "request_changes") {
        problems.push(`${where} runs the review ENGINE but its seed also allows the agent action "${a}" — that write would bypass the engine's brakes`);
      }
    }
  }
  // The seed must survive the SAME validation the REST API and the admin UI use —
  // minus the repos the picker supplies, which we stand in for here.
  try {
    const filled = { ...seed, events: row.events, filters: { ...(seed.filters || {}), ...(needsRepos ? { repos: ["owner/name"] } : {}) } };
    const norm = normalizeListener(filled, { gate: { capability: true, savedByRole: "admin" } });
    if (norm.mode !== (seed.mode || "script")) problems.push(`${where} seed did not normalise to its declared mode`);
    const want = ((seed.agent || {}).allowedActions || []).slice().sort().join();
    if (seed.mode === "agent" && norm.agent.allowedActions.slice().sort().join() !== want) {
      problems.push(`${where} seed actions did not survive normalizeListener (got ${norm.agent.allowedActions.join(", ") || "none"})`);
    }
  } catch (e) {
    problems.push(`${where} seed is REFUSED by normalizeListener: ${e.message}`);
  }
  // …and without the picker's repos it must be refused, loudly.
  if (needsRepos) {
    let refused = false;
    try { normalizeListener({ ...seed, events: row.events }, { gate: { capability: true, savedByRole: "admin" } }); } catch { refused = true; }
    if (!refused) problems.push(`${where} can be saved with NO repos allow-list — a git listener must never match every repository`);
  }
}

// 4. Premade POST-FUNCTIONS ⇄ the action catalogue + the wiring in src/index.js (1.4/12).
// A post-function type that isHeavyPf does not name would run INSIDE the 25 s transition
// budget; a mode that names a `dangerous` action promises something the gate refuses on
// an external trigger. Both are silent at save time and only show up on a live workflow.
{
  const indexSrc = readFileSync(resolve(here, "../../src/index.js"), "utf8");
  const engineSrc = readFileSync(resolve(here, "../../src/coder-engine.js"), "utf8");
  const byId = new Map(AGENT_ACTIONS.map((a) => [a.id, a]));
  const pfKeys = new Set();
  for (const row of PREMADE_POSTFUNCTIONS) {
    const where = `Premade post-function "${row.key}"`;
    if (pfKeys.has(row.key)) problems.push(`${where} is declared twice`);
    pfKeys.add(row.key);
    if (catalogKeys.has(row.key)) problems.push(`${where} collides with a workflow premade rule key`);
    if (getPremadePostFunction(row.key) !== row) problems.push(`${where} is not findable by key`);
    if (!row.label || !row.help) problems.push(`${where} has no label/help`);
    // It must be named by name in all three homes §3.9 lists. A grep, not an inference.
    if (!indexSrc.includes(`const CODER_PF_TYPE = "${row.key}"`)) {
      problems.push(`${where} is not the constant src/index.js routes on (CODER_PF_TYPE)`);
    }
  }
  if (!/const isHeavyPf = [\s\S]{0,600}isCoderPfType\(pfType\)/.test(indexSrc)) {
    problems.push("isHeavyPf does not name the coder post-function — it would run INLINE inside the 25 s transition budget");
  }
  if (!/if \(isCoderPfType\(pfType\)\) \{\s*\n\s*await enqueueCoderPostFunction/.test(indexSrc)) {
    problems.push("executePostFunction has no explicit coder enqueue before the generic heavy path");
  }
  if (!/if \(isCoderPfType\(type\)\) \{/.test(indexSrc)) {
    problems.push("dispatchPostFunction has no explicit coder branch — it would fall through to a type-guess executor");
  }
  if (!/key: "long-queue"[\s\S]{0,400}taskType: "coder"[\s\S]{0,400}concurrency: \{ key: `coder:\$\{issueKey\}`, limit: 1 \}/.test(indexSrc)) {
    problems.push("the coder post-function does not push to long-queue with concurrency coder:<issueKey> limit 1");
  }
  if (!/triggerSource: headless \? "external" : null/.test(engineSrc)) {
    problems.push("src/coder-engine.js no longer makes a headless turn an EXTERNAL trigger — a post-function could hold a dangerous action");
  }
  // The mode table.
  const seenModes = new Set();
  for (const m of CODER_PF_MODES) {
    const where = `Coder PF mode "${m.id}"`;
    if (seenModes.has(m.id)) problems.push(`${where} is declared twice`);
    seenModes.add(m.id);
    if (getCoderPfMode(m.id) !== m) problems.push(`${where} is not findable by id`);
    if (!m.label || !m.help) problems.push(`${where} has no label/help`);
    if (!m.template || !m.template.includes("{{issueKey}}") || !m.template.includes("{{repo}}")) {
      problems.push(`${where} template must use both {{issueKey}} and {{repo}}`);
    }
    for (const ph of m.template.match(/\{\{[^}]*\}\}/g) || []) {
      if (ph !== "{{issueKey}}" && ph !== "{{repo}}") {
        problems.push(`${where} template uses ${ph}, which renderCoderPfMessage does not substitute — it would reach the model verbatim`);
      }
    }
    if (!Array.isArray(m.actions) || !m.actions.length) problems.push(`${where} names no actions`);
    let git = 0;
    for (const id of m.actions || []) {
      const a = byId.get(id);
      if (!a) { problems.push(`${where} names "${id}", which is not in the agent-action catalogue`); continue; }
      if (a.kind === "control") problems.push(`${where} names the control action "${id}" — finish is implicit`);
      if (a.dangerous) problems.push(`${where} names the DANGEROUS action "${id}" — a post-function is an external trigger and the gate always refuses it`);
      if ((a.namespace || "jira") === "git") git++;
    }
    if (!git) problems.push(`${where} has no git action at all, so the rule cannot do anything in a repository`);
  }
  if (CODER_PF_MODE_IDS.join() !== CODER_PF_MODES.map((m) => m.id).join()) {
    problems.push("CODER_PF_MODE_IDS is out of step with CODER_PF_MODES");
  }
}

const validatorCount = PREMADE_VALIDATORS.filter((r) => r.availability !== "unavailable").length;
const conditionCount = PREMADE_CONDITIONS.filter((r) => r.availability !== "unavailable").length;
// Count ROWS, not key-set arithmetic: one key may legitimately appear in BOTH lists
// (the git rules ship as a validator that verifies live AND a condition Jira
// evaluates itself as an expression), and length-minus-set-size counted those
// duplicates as "unavailable".
const unavailableCount = allCatalog.filter((r) => r.availability === "unavailable").length;

if (problems.length) {
  console.error("✗ Premade-rule parity FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(
  `✓ Premade-rule parity OK — ${validatorCount} validators + ${conditionCount} conditions wired ` +
  `(${executorKeys.size} executor branches; ${unavailableCount} catalog rules marked unavailable) ` +
  `+ ${PREMADE_LISTENERS.length} premade listener(s) checked against the event + action catalogues ` +
  `+ ${PREMADE_POSTFUNCTIONS.length} premade post-function(s) / ${CODER_PF_MODES.length} coder mode(s) checked against the action catalogue and the index.js wiring.`,
);
