/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Programmatic attachment of CogniRunner workflow rules via the Jira Cloud
// workflow REST API. Generalizes the app's own injectWorkflowRule
// (src/index.js:1946). Rule + transition shapes were captured live from the
// instance (real attached rules + a generated workflow) and are confirmed:
//   validator  -> ruleKey forge:expression-validator   module ai-text-field-validator
//   condition  -> ruleKey forge:expression-condition   module ai-text-field-condition
//   semantic   -> ruleKey forge:workflow-post-function module ai-semantic-post-function
//   static     -> ruleKey forge:workflow-post-function module ai-static-post-function
// Routing for post-functions is by config.type, not the module ARI.

import crypto from "node:crypto";
import { get, post } from "./jira.mjs";

export const APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";
// Environment id of the install that exposes all four modules (confirmed live).
export const ENV_ID = "989ecaa0-261b-406e-b444-78c01c0d7772";
export const WORKFLOW_CONFIG_MAX_BYTES = 32768;

// All post-function flavors share one ruleKey (forge:workflow-post-function)
// and are routed at runtime by config.type — so any PF module ARI works; we use
// the static module's ARI for static and the semantic module's ARI otherwise.
export const MODULE = {
  validator: "ai-text-field-validator",
  condition: "ai-text-field-condition",
  static: "ai-static-post-function",
  // every other PF flavor -> semantic module ARI (routing is by config.type)
  semantic: "ai-semantic-post-function",
  comment: "ai-semantic-post-function",
  subtask: "ai-semantic-post-function",
  "generate-doc": "ai-semantic-post-function",
  link: "ai-semantic-post-function",
  research: "ai-semantic-post-function",
  "research-doc": "ai-semantic-post-function",
};
export const RULE_KEY = {
  validator: "forge:expression-validator",
  condition: "forge:expression-condition",
  static: "forge:workflow-post-function",
  semantic: "forge:workflow-post-function",
  comment: "forge:workflow-post-function",
  subtask: "forge:workflow-post-function",
  "generate-doc": "forge:workflow-post-function",
  link: "forge:workflow-post-function",
  research: "forge:workflow-post-function",
  "research-doc": "forge:workflow-post-function",
};

const ari = (moduleKey) =>
  `ari:cloud:ecosystem::extension/${APP_ID}/${ENV_ID}/static/${moduleKey}`;

/** Build a workflow rule object (the {ruleKey, parameters, id} shape). */
export function buildRule(type, configObj) {
  const moduleKey = MODULE[type];
  const ruleKey = RULE_KEY[type];
  if (!moduleKey || !ruleKey) throw new Error(`unknown rule type: ${type}`);
  const configStr =
    typeof configObj === "string" ? configObj : JSON.stringify(configObj);
  const bytes = Buffer.byteLength(configStr, "utf8");
  if (bytes > WORKFLOW_CONFIG_MAX_BYTES) {
    throw new Error(`config too large: ${bytes} bytes (max ${WORKFLOW_CONFIG_MAX_BYTES})`);
  }
  return {
    ruleKey,
    parameters: {
      key: ari(moduleKey),
      config: configStr,
      id: crypto.randomUUID(),
      disabled: "false",
    },
    id: crypto.randomUUID(),
  };
}

/** Place a rule into the correct transition slot (validators / conditions tree / actions). */
export function attachRuleToTransition(transition, type, rule) {
  if (type === "validator") {
    (transition.validators ||= []).push(rule);
  } else if (type === "condition") {
    let tree = transition.conditions;
    if (!tree || Array.isArray(tree)) {
      tree = {
        operation: "ALL",
        conditions: Array.isArray(tree) ? tree : [],
        conditionGroups: [],
      };
      transition.conditions = tree;
    }
    if (!tree.operation) tree.operation = "ALL";
    (tree.conditions ||= []).push(rule);
  } else {
    // semantic | static post-functions live in actions[]
    (transition.actions ||= []).push(rule);
  }
}

/** A DIRECTED self-loop transition (from == to == hub). Confirmed shape. */
export function makeSelfLoop(hubStatusRef, name, idNum) {
  return {
    id: String(idNum),
    type: "DIRECTED",
    toStatusReference: String(hubStatusRef),
    links: [{ fromStatusReference: String(hubStatusRef), fromPort: 0, toPort: 1 }],
    name,
    description: "",
    actions: [],
    validators: [],
    triggers: [],
    properties: {},
  };
}

/** Read a workflow by exact name via the search endpoint. Returns { top, wf }. */
export async function readWorkflow(name) {
  const d = await get(
    `/rest/api/3/workflows/search?queryString=${encodeURIComponent(name)}&expand=values.transitions`
  );
  const wf = (d.values || []).find((w) => w.name === name);
  if (!wf) throw new Error(`workflow not found: ${name}`);
  if (!wf.version?.id || wf.version?.versionNumber === undefined) {
    throw new Error(`workflow ${name} has no version info (read-only?)`);
  }
  return { top: d, wf };
}

function buildUpdatePayload(top, wf) {
  const fullStatuses = (top.statuses || []).map((s) => {
    const o = { statusReference: s.statusReference };
    if (s.id !== undefined) o.id = s.id;
    if (s.name !== undefined) o.name = s.name;
    if (s.statusCategory !== undefined) o.statusCategory = s.statusCategory;
    return o;
  });
  return {
    statuses: fullStatuses,
    workflows: [
      {
        id: wf.id,
        version: { id: wf.version.id, versionNumber: wf.version.versionNumber },
        statuses: (wf.statuses || []).map((s) => ({ statusReference: s.statusReference })),
        transitions: wf.transitions,
      },
    ],
  };
}

/** POST /workflows/update for the (already mutated) wf. Returns HTTP status. */
export async function updateWorkflow(top, wf) {
  const payload = buildUpdatePayload(top, wf);
  const res = await post("/rest/api/3/workflows/update", payload, { raw: true });
  if (res.status >= 400) {
    throw new Error(`workflows/update failed ${res.status}: ${res.text.slice(0, 1000)}`);
  }
  return res.status;
}

/** The status new issues are born into (initial transition target). */
export function initialStatusRef(wf) {
  const init = (wf.transitions || []).find((t) => t.type === "INITIAL");
  return init?.toStatusReference || wf.statuses?.[0]?.statusReference;
}

/**
 * High-level: read workflow, add a batch of self-loop transitions on the hub
 * status (each carrying one rule), and apply in a single update with one
 * version-conflict retry. `specs` = [{ name, type, config }].
 * Returns [{ name, type, transitionId, ruleId }].
 */
export async function attachSelfLoopRules(workflowName, hubStatusRef, specs, startId = 9001) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(workflowName);
    const existingIds = new Set((wf.transitions || []).map((t) => String(t.id)));
    let idNum = startId;
    const result = [];
    for (const spec of specs) {
      while (existingIds.has(String(idNum))) idNum++;
      existingIds.add(String(idNum));
      const t = makeSelfLoop(hubStatusRef, spec.name, idNum);
      const rule = buildRule(spec.type, spec.config);
      attachRuleToTransition(t, spec.type, rule);
      wf.transitions.push(t);
      result.push({ name: spec.name, type: spec.type, transitionId: String(idNum), ruleId: rule.parameters.id });
      idNum++;
    }
    try {
      await updateWorkflow(top, wf);
      return result;
    } catch (e) {
      if (attempt === 0 && /409|version/i.test(e.message)) continue; // re-read & retry
      throw e;
    }
  }
  throw new Error("attachSelfLoopRules: exhausted retries");
}
