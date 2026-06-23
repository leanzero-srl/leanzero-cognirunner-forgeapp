/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Throwaway smoke: confirm the active AI provider still yields real verdicts
// after removing the factory key. Fires a hardened validator on a control-good
// and control-bad issue; expects ALLOWED vs BLOCKED with an "AI Validation
// failed:" reason — proving the provider is configured (no "key not configured").
import { loadState } from "../lib/state.mjs";
import { doTransition, getTransitions } from "../lib/jira.mjs";

const s = loadState();
const rt = s.ruleTransitions || {};
// Find a validator transition (hardened/quality).
const vKey = Object.keys(rt).find((k) => rt[k].type === "validator");
if (!vKey) { console.log("no validator transition in testbed"); process.exit(0); }
const tid = rt[vKey].transitionId;
console.log(`validator rule="${vKey}" transition=${tid}`);

const byCls = {};
for (const [id, info] of Object.entries(s.issues || {})) (byCls[info.cls] ||= []).push({ id, ...info });
const good = (byCls["control-good"] || [])[0];
const bad = (byCls["control-bad"] || byCls["injection"] || [])[0];

for (const [label, issue] of [["control-good", good], ["bad/injection", bad]]) {
  if (!issue) { console.log(`(no ${label} issue)`); continue; }
  const tr = await getTransitions(issue.key);
  const has = (tr.transitions || []).some((x) => String(x.id) === String(tid));
  if (!has) { console.log(`${label} ${issue.key}: transition ${tid} not available (off-hub?)`); continue; }
  const r = await doTransition(issue.key, tid);
  const verdict = r.status < 400 ? "ALLOWED" : "BLOCKED";
  const reason = (r.text || "").replace(/\s+/g, " ").slice(0, 220);
  console.log(`${label} ${issue.key}: HTTP ${r.status} -> ${verdict}\n    reason: ${reason}`);
}
