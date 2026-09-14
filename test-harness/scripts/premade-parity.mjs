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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  PREMADE_VALIDATORS, PREMADE_CONDITIONS, PREMADE_LISTENERS, getPremadeListener,
  PREMADE_POSTFUNCTIONS, getPremadePostFunction, CODER_PF_MODES, CODER_PF_MODE_IDS, getCoderPfMode,
} from "../../src/shared/premade-rules-catalog.js";
import { isKnownEvent, requiresRepoFilter, isGitEvent } from "../../src/shared/jira-events.js";
import {
  AGENT_ACTIONS, AGENT_ACTION_NAMESPACES, agentActionNamespace,
  buildAgentGateContext, normalizeAllowedActions, DEFAULT_AGENT_ACTIONS,
} from "../../src/shared/agent-actions.js";
import { EDITION_IDS, FORGE_LLM_DEFAULT } from "../../src/shared/edition.js";
import { normalizeListener } from "../../src/listeners.js";

/*
 * F-879 — THE GATE CONTEXTS A REAL INSTANCE ACTUALLY BUILDS.
 *
 * This lint used to hand `normalizeListener` a hand-built `{ capability: true,
 * savedByRole: "admin" }`, which NO save path can produce: every production caller goes
 * through `buildAgentGateContext`, and that builder refuses a null provider by design
 * ("no provider, no capability") and emits a capability MAP whose absent keys are
 * refused (F-281). Proving a seed savable under a context the app cannot assemble is
 * F-480's shape wearing a lint's hat — it is the same class of hole the agentless arm
 * below was added for, only on the main arm.
 *
 * So the main arm now builds its context the way the app does, on two fact sets that
 * bracket the real fleet:
 *
 *   BYOK      — any customer key. `agentCapability` answers `byok`, so EVERY capability
 *               is on and an admin-saved seed must survive whole. This is the "can this
 *               starter ever be saved at all" arm.
 *   FORGE-LLM — Atlassian Forge LLM on the Standard edition with the default Haiku model,
 *   STANDARD    which is what a fresh install runs. `git` is off here
 *               ("needs-coder-edition"), so a seed holding a gated action must be
 *               REFUSED BY NAME rather than saved with fewer actions than the catalogue
 *               advertises — a silent strip is how an operator comes to believe in a gate
 *               that is not there (F-277).
 *
 * `surface: "listener"` is passed because every premade IS a listener; `normalizeListener`
 * stamps the same value on top, so this only makes the direct `normalizeAllowedActions`
 * probe below agree with the save path (F-865).
 */
const GATE_FACTS = {
  byok: { provider: "openai", edition: EDITION_IDS.STANDARD, agentModel: "gpt-5.4-mini", savedByRole: "admin", surface: "listener" },
  forgeStandard: { provider: "atlassian", edition: EDITION_IDS.STANDARD, agentModel: FORGE_LLM_DEFAULT, savedByRole: "admin", surface: "listener" },
};
const BYOK_GATE = buildAgentGateContext(GATE_FACTS.byok);
const FORGE_STANDARD_GATE = buildAgentGateContext(GATE_FACTS.forgeStandard);

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
  // F-486 — CAPABILITY PARITY, both directions. The premade button is the FIRST thing a
  // new instance clicks, and `assertAllowedActions` fails CLOSED at save time, so a seed
  // that holds a capability-gated action is unsaveable on every instance that lacks the
  // capability. An AGENTLESS row is served by a deterministic engine that never calls an
  // agent action, so it must hold none of them — otherwise the starter is refused on
  // exactly the instance its agentless engine exists for. And a row that DOES hold one
  // must say so on the catalogue row, because that is the only field a UI can read to
  // explain the refusal before it happens.
  {
    const gated = [];
    for (const id of (seed.agent || {}).allowedActions || []) {
      const a = AGENT_ACTIONS.find((x) => x.id === id);
      if (!a) continue; // already reported above as not-in-catalogue
      const ns = AGENT_ACTION_NAMESPACES[agentActionNamespace(a)] || {};
      const cap = a.requiresCapability || ns.requiresCapability || null;
      if (cap) gated.push(`${id} (${cap})`);
      // F-865 — SURFACE PARITY. Every premade is a LISTENER, so a seed holding an action
      // bound to another surface (the ledger namespace is bound to "va") is unsaveable on
      // EVERY instance, not merely an incapable one. `normalizeListener` below would
      // report it as a bare refusal message; naming it here says which flag did it.
      const surf = a.requiresSurface || ns.requiresSurface || null;
      if (surf && surf !== "listener") {
        problems.push(`${where} holds "${id}", which requires the "${surf}" surface — a premade is a LISTENER, so this seed is refused at save on every instance`);
      }
    }
    if (seed.agentlessTaskType && gated.length) {
      problems.push(`${where} is AGENTLESS (agentlessTaskType "${seed.agentlessTaskType}") but its seed holds capability-gated action(s) ${gated.join(", ")} — assertAllowedActions refuses the save on exactly the instance the agentless engine serves`);
    }
    if (!seed.agentlessTaskType && gated.length && !row.requiresCapability) {
      problems.push(`${where} holds capability-gated action(s) ${gated.join(", ")} but declares no requiresCapability on the catalogue row — nothing can warn before the save is refused`);
    }
    // …and the same claim in the shape the live failure took: an agentless starter must
    // normalise on a CAPABILITY-OFF gate (Standard + Forge LLM), which is the gate the
    // save path builds on such an instance.
    if (seed.agentlessTaskType) {
      const filled = { ...seed, events: row.events, filters: { ...(seed.filters || {}), ...(needsRepos ? { repos: ["owner/name"] } : {}) } };
      try {
        normalizeListener(filled, { gate: { capability: { git: { enabled: false, reason: "capability-off:git" } }, savedByRole: "admin" } });
      } catch (e) {
        problems.push(`${where} is AGENTLESS but its seed is REFUSED on an instance with no agent capability: ${e.message}`);
      }
    }
  }
  // The seed must survive the SAME validation the REST API and the admin UI use —
  // minus the repos the picker supplies, which we stand in for here — under a context
  // built by the REAL builder (F-879), on both fact sets.
  {
    const filled = { ...seed, events: row.events, filters: { ...(seed.filters || {}), ...(needsRepos ? { repos: ["owner/name"] } : {}) } };
    const seedActions = (seed.agent || {}).allowedActions == null ? DEFAULT_AGENT_ACTIONS : (seed.agent || {}).allowedActions;

    // ARM 1 — BYOK admin. Every capability is on, so the seed must save WHOLE.
    let byokSaved = false;
    try {
      const norm = normalizeListener(filled, { gate: BYOK_GATE, savedByRole: "admin" });
      byokSaved = true;
      if (norm.mode !== (seed.mode || "script")) problems.push(`${where} seed did not normalise to its declared mode`);
      const want = ((seed.agent || {}).allowedActions || []).slice().sort().join();
      if (seed.mode === "agent" && norm.agent.allowedActions.slice().sort().join() !== want) {
        problems.push(`${where} seed actions did not survive normalizeListener on a BYOK admin gate (got ${norm.agent.allowedActions.join(", ") || "none"})`);
      }
    } catch (e) {
      problems.push(`${where} seed is REFUSED by normalizeListener under the gate a real BYOK instance builds (provider openai, ${EDITION_IDS.STANDARD} edition, admin-saved): ${e.message}`);
    }

    // ARM 2 — Atlassian Forge LLM, Standard edition, Haiku: what a fresh install runs.
    // Ask the gate itself which ids die there, then require the save path to agree.
    const forgeRefused = normalizeAllowedActions(seedActions, FORGE_STANDARD_GATE).refused;
    let forgeError = null;
    try { normalizeListener(filled, { gate: FORGE_STANDARD_GATE, savedByRole: "admin" }); } catch (e) { forgeError = e; }
    if (forgeRefused.length) {
      // (a) a gated starter must still be savable SOMEWHERE, and that somewhere is an
      //     admin-saved BYOK instance — otherwise the button exists for nobody.
      if (!byokSaved) {
        problems.push(`${where} holds action(s) the Forge-LLM Standard gate refuses (${forgeRefused.map((r) => `${r.id}: ${r.reason}`).join("; ")}) AND is not savable on a BYOK admin instance either — the starter is unsaveable everywhere`);
      }
      // (b) …and on Forge-LLM Standard it must be refused BY NAME, never silently
      //     stripped down to the actions that happen to survive.
      if (!forgeError) {
        problems.push(`${where} was SAVED on a Forge-LLM Standard gate although the gate refuses ${forgeRefused.map((r) => r.id).join(", ")} — the save path dropped a gated action silently instead of refusing`);
      } else {
        if (forgeError.reason !== "action-not-allowed") {
          problems.push(`${where} is refused on Forge-LLM Standard for the WRONG reason (${forgeError.reason || "none"}): ${forgeError.message}`);
        }
        for (const r of forgeRefused) {
          if (!String(forgeError.message).includes(r.id)) {
            problems.push(`${where} is refused on Forge-LLM Standard but the refusal does not NAME "${r.id}" (${r.reason}), so nothing can tell the admin which action to drop: ${forgeError.message}`);
          }
        }
      }
    } else if (forgeError) {
      // No gated action, so the humblest real instance must be able to save it.
      problems.push(`${where} holds no capability-gated action yet is REFUSED on a Forge-LLM Standard instance (provider atlassian, ${EDITION_IDS.STANDARD} edition, ${FORGE_LLM_DEFAULT}): ${forgeError.message}`);
    }
  }
  // …and without the picker's repos it must be refused, loudly.
  if (needsRepos) {
    let refused = false;
    try { normalizeListener({ ...seed, events: row.events }, { gate: BYOK_GATE, savedByRole: "admin" }); } catch { refused = true; }
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
    // EVERY premade PF key must be a NAMED CONSTANT in src/index.js — a grep, not an
    // inference. This used to assert the ONE string `const CODER_PF_TYPE = "<key>"`
    // against every row, so the second premade post-function ever added would have
    // failed it no matter how correctly it was wired. What the rule actually is: the
    // key is spelled out once, in a constant, so routing can never be a substring guess.
    if (!new RegExp(`const [A-Z0-9_]+ = "${row.key}";`).test(indexSrc)) {
      problems.push(`${where} is not declared as a named constant in src/index.js — routing on it would be a substring guess`);
    }
    // EXECUTION IS A CATALOGUE FACT, and it must match the wiring. `queued` means the
    // 25 s transition cannot hold it, so `isHeavyPf` has to name it; `inline` means it
    // must NOT, or a deterministic one-call rule pays the platform's event-queue delay.
    if (row.execution !== "queued" && row.execution !== "inline") {
      problems.push(`${where} does not declare execution:"queued" or execution:"inline" — which side of the 25 s budget it runs on is not a guess`);
    }
    const heavyBlock = (indexSrc.match(/const isHeavyPf = [\s\S]{0,1600}?;\n/) || [""])[0];
    const predicate = `is${row.key.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("").replace(/^Postfunction/, "")}PfType(pfType)`;
    const namedInHeavy = heavyBlock.includes(predicate);
    if (row.execution === "queued" && !namedInHeavy) {
      problems.push(`${where} is execution:"queued" but isHeavyPf does not name it (${predicate}) — it would run INLINE inside the 25 s transition budget`);
    }
    if (row.execution === "inline" && namedInHeavy) {
      problems.push(`${where} is execution:"inline" but isHeavyPf names it — it would be queued and pay the event-queue delay for no reason`);
    }
    // …and it must have an EXPLICIT dispatch branch, never the substring chain.
    if (!new RegExp(`is${row.key.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("").replace(/^Postfunction/, "")}PfType\\(type\\)`).test(indexSrc)) {
      problems.push(`${where} has no explicit branch in dispatchPostFunction — it would fall through to a type-guess executor`);
    }
  }
  // resolvePfType must DERIVE the premade arm from the catalogue, not name one rule.
  if (!/PREMADE_PF_TYPES\.has\(config\.ruleType\)/.test(indexSrc)) {
    problems.push("resolvePfType does not derive its premade arm from the catalogue — a new premade post-function would resolve to postfunction-static and run inline");
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

// 5. F-489 — NO FRONTEND MAY COMPARE `requiresCapability` TO A LITERAL.
// The catalogue declares which rows need an instance capability; the ONE reader of that
// declaration is `premadeRequiresCapability` (src/shared/premade-rules-catalog.js). Two UI
// sites used to ask the question as `requiresCapability === "git"`, which answers "needs
// nothing" for any SECOND value the catalogue grows — the row is then offered on an
// instance that cannot run it and the refusal arrives at Save, after all of the work.
// This is a SOURCE grep, not an inference: the predicate cannot be exercised by running
// the app until such a second value exists, which is exactly too late.
{
  const uiRoot = resolve(here, "../../static");
  const skipDirs = new Set(["build", "node_modules", "dist", ".cache"]);
  const files = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) walk(resolve(dir, ent.name));
      } else if (/\.(js|jsx|mjs)$/.test(ent.name)) {
        files.push(resolve(dir, ent.name));
      }
    }
  };
  walk(uiRoot);
  // `requiresCapability` on either side of ===/!==/==/!= a quoted string, allowing for the
  // property being read off any expression (row.requiresCapability, p?.requiresCapability,
  // r["requiresCapability"]) and for the comparison written in either order.
  const LITERAL_CMP = /(?:requiresCapability["\]]*\s*[!=]==?\s*["'`]|["'`][a-z-]*["'`]\s*[!=]==?\s*[A-Za-z_$][\w.$?[\]"']*requiresCapability)/;
  let scanned = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("requiresCapability")) continue;
    scanned++;
    for (const [i, line] of src.split("\n").entries()) {
      // A comment may quote the old predicate to explain why it is gone.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (LITERAL_CMP.test(code)) {
        problems.push(
          `${f.slice(uiRoot.length - 6)}:${i + 1} compares requiresCapability to a LITERAL — ` +
          "import premadeRequiresCapability from src/shared/premade-rules-catalog.js instead (F-489)",
        );
      }
    }
  }
  if (!scanned) {
    problems.push("no static/ file reads requiresCapability at all — the F-489 guard is scanning nothing, so it can never fail");
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
