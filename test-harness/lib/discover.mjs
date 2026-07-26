/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Universal rule discovery. Sweeps EVERY workflow on the instance and returns a
// structured record for every attached CogniRunner rule (validators, conditions,
// post-functions) across all workflows — not just the harness's own COGTEST set.
// Generalizes scan-existing-rules.mjs: paginates (the old script capped at 100
// with no loop → silent truncation) and resolves from/to status names + the
// workflow→project mapping used to drive a rule in-place.

import { get } from "./jira.mjs";

export const APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";

// A rule is definitively CogniRunner's when its parameters.key ARI embeds our
// APP_ID. ruleKey prefixes (forge:expression-*, forge:workflow-post-function)
// are shared by other Forge apps, so they are only a weak hint — recorded
// separately so we can SEE foreign forge rules without counting them as ours.
export function ruleAppId(rule) {
  const k = rule?.parameters?.key || rule?.parameters?.appKey || "";
  return String(k);
}
export function isCogniRule(rule) {
  return ruleAppId(rule).includes(APP_ID);
}
export function isForgeRule(rule) {
  return /^forge:/.test(String(rule?.ruleKey || ""));
}

// Walk a transition's three rule-bearing slots (validators[], actions[], and the
// recursive conditions/conditionGroups tree). Returns [{ slot, rule }].
export function collectRules(transition) {
  const out = [];
  for (const r of transition.validators || []) out.push({ slot: "validator", rule: r });
  for (const r of transition.actions || []) out.push({ slot: "action", rule: r });
  const conds = transition.conditions;
  if (Array.isArray(conds)) {
    for (const r of conds) out.push({ slot: "condition", rule: r });
  } else if (conds && typeof conds === "object") {
    const walk = (node) => {
      if (!node) return;
      for (const c of node.conditions || []) {
        if (c && (c.conditions || c.conditionGroups)) walk(c);
        else if (c) out.push({ slot: "condition", rule: c });
      }
      for (const g of node.conditionGroups || []) walk(g);
    };
    walk(conds);
  }
  return out;
}

function statusRefMap(topStatuses) {
  const m = {};
  for (const s of topStatuses || []) {
    if (s?.statusReference) m[s.statusReference] = s.name || s.statusReference;
  }
  return m;
}

function transitionFromRefs(t) {
  // New workflow API expresses edges as links[].fromStatusReference; older shapes
  // sometimes carry a flat from/to. Normalize to an array of from-refs.
  const refs = [];
  for (const l of t.links || []) if (l?.fromStatusReference) refs.push(String(l.fromStatusReference));
  if (!refs.length && t.fromStatusReference) refs.push(String(t.fromStatusReference));
  return [...new Set(refs)];
}

/**
 * Page through GET /workflows/search (new API) collecting every workflow with its
 * transitions, and a global status-ref → name map merged across pages. Falls back
 * gracefully when a page lacks pagination markers.
 * Returns { workflows: [...], statusRef: { ref: name } }.
 */
async function fetchAllWorkflows() {
  const workflows = [];
  let statusRef = {};
  let startAt = 0;
  const pageSize = 50;
  for (let guard = 0; guard < 200; guard++) {
    let page;
    try {
      page = await get(
        `/rest/api/3/workflows/search?expand=values.transitions&maxResults=${pageSize}&startAt=${startAt}`
      );
    } catch (e) {
      // First-page failure is fatal; later-page failure ends the sweep.
      if (startAt === 0) throw e;
      break;
    }
    const values = page?.values || [];
    statusRef = { ...statusRef, ...statusRefMap(page?.statuses) };
    workflows.push(...values);
    const total = typeof page?.total === "number" ? page.total : undefined;
    startAt += values.length;
    if (page?.isLast === true) break;
    if (values.length === 0) break;
    if (total !== undefined && startAt >= total) break;
    if (values.length < pageSize && page?.isLast === undefined && total === undefined) break;
  }
  return { workflows, statusRef };
}

/**
 * Discover every CogniRunner rule attached anywhere on the instance.
 * Returns { rules: [record...], foreignForgeRules: [...], workflowCount, statusRef }.
 * Each record:
 *   { workflowName, workflowId, workflowVersion, transitionName, transitionId,
 *     transitionType, fromStatusRefs, fromStatusNames, toStatusRef, toStatusName,
 *     slot, ruleKey, parametersKey, parametersId, topLevelId, configRaw, config,
 *     configError, rawRule }
 */
export async function discoverAllRules() {
  const { workflows, statusRef } = await fetchAllWorkflows();
  const rules = [];
  const foreignForgeRules = [];

  for (const wf of workflows) {
    const wfName = wf.name;
    const wfId = wf.id;
    const wfVersion = wf.version;
    for (const t of wf.transitions || []) {
      const fromRefs = transitionFromRefs(t);
      const toRef = t.toStatusReference ? String(t.toStatusReference) : null;
      for (const { slot, rule } of collectRules(t)) {
        const cogni = isCogniRule(rule);
        const forge = isForgeRule(rule);
        if (!cogni) {
          if (forge) foreignForgeRules.push({ workflowName: wfName, transitionName: t.name, ruleKey: rule.ruleKey, parametersKey: ruleAppId(rule) });
          continue;
        }
        const configRaw = rule?.parameters?.config ?? "";
        let config = null;
        let configError = null;
        try {
          config = configRaw ? JSON.parse(configRaw) : {};
        } catch (e) {
          configError = e.message;
        }
        rules.push({
          workflowName: wfName,
          workflowId: wfId,
          workflowVersion: wfVersion,
          transitionName: t.name,
          transitionId: String(t.id),
          transitionType: t.type || null,
          fromStatusRefs: fromRefs,
          fromStatusNames: fromRefs.map((r) => statusRef[r] || r),
          toStatusRef: toRef,
          toStatusName: toRef ? statusRef[toRef] || toRef : null,
          slot,
          ruleKey: rule.ruleKey || null,
          parametersKey: ruleAppId(rule),
          parametersId: rule?.parameters?.id || null,
          topLevelId: rule?.id || null,
          configRaw,
          config,
          configError,
          rawRule: rule,
        });
      }
    }
  }
  return { rules, foreignForgeRules, workflowCount: workflows.length, statusRef };
}

/**
 * Map every workflow NAME to the classic projects that use it (and which issue
 * types route to it). Needed to drive a discovered rule in-place: we must create
 * or find an issue in a project whose workflow scheme binds that workflow.
 * Team-managed (next-gen) projects don't expose classic schemes and are skipped.
 * Returns Map<workflowName, [{ projectKey, projectId, projectName, issueTypeIds, isDefault }]>.
 */
export async function buildWorkflowProjectIndex() {
  const index = new Map();
  const add = (wfName, entry) => {
    if (!wfName) return;
    if (!index.has(wfName)) index.set(wfName, []);
    index.get(wfName).push(entry);
  };

  // 1) enumerate projects (paginated)
  const projects = [];
  let startAt = 0;
  for (let guard = 0; guard < 200; guard++) {
    let page;
    try {
      page = await get(`/rest/api/3/project/search?maxResults=50&startAt=${startAt}`);
    } catch (e) {
      if (startAt === 0) throw e;
      break;
    }
    const values = page?.values || [];
    projects.push(...values);
    startAt += values.length;
    if (page?.isLast === true || values.length === 0) break;
    if (typeof page?.total === "number" && startAt >= page.total) break;
  }

  // 2) project → scheme → workflow names (tolerate per-project failures)
  const schemeCache = new Map();
  for (const p of projects) {
    let schemeId;
    try {
      const r = await get(`/rest/api/3/workflowscheme/project?projectId=${p.id}`);
      schemeId = r?.values?.[0]?.workflowScheme?.id;
    } catch {
      continue; // team-managed / no classic scheme
    }
    if (!schemeId) continue;

    let scheme = schemeCache.get(schemeId);
    if (!scheme) {
      try {
        scheme = await get(`/rest/api/3/workflowscheme/${schemeId}`);
      } catch {
        continue;
      }
      schemeCache.set(schemeId, scheme);
    }

    const mappings = scheme?.issueTypeMappings || {};
    const byWorkflow = {}; // workflowName -> [issueTypeIds]
    for (const [issueTypeId, wfName] of Object.entries(mappings)) {
      (byWorkflow[wfName] ||= []).push(issueTypeId);
    }
    const def = scheme?.defaultWorkflow;
    for (const [wfName, issueTypeIds] of Object.entries(byWorkflow)) {
      add(wfName, { projectKey: p.key, projectId: p.id, projectName: p.name, issueTypeIds, isDefault: false });
    }
    if (def) {
      // default workflow handles any issue type not explicitly mapped
      add(def, { projectKey: p.key, projectId: p.id, projectName: p.name, issueTypeIds: [], isDefault: true });
    }
  }
  return index;
}

/** Convenience: summarize discovered rules by type/slot for a quick console view. */
export function summarizeRules(rules) {
  const byType = {};
  const byWorkflow = {};
  let malformed = 0;
  for (const r of rules) {
    const t = `${r.slot}:${r.ruleKey}`;
    byType[t] = (byType[t] || 0) + 1;
    byWorkflow[r.workflowName] = (byWorkflow[r.workflowName] || 0) + 1;
    if (r.configError) malformed++;
  }
  return { total: rules.length, byType, byWorkflow, malformed };
}
