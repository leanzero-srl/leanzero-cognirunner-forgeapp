/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";
import CodeEditor from "./CodeEditor";
import KnowledgePanel from "./KnowledgePanel";
import SkillEditor from "./SkillEditor";
import ApiReferencePanel from "./editor/ApiReferencePanel";
import IssuePicker from "./IssuePicker";
import AILoadingState from "./AILoadingState";
import { showToast } from "./toast";
import JIRA_ENDPOINTS_DATA from "../data/jira-endpoints";
// Premade post-function recipes — ready-made, no-AI code templates.
import { BUILTIN_RECIPES, getRecipeByKey } from "../../../../src/shared/builtin-recipes.js";
import { KNOWN_API_MEMBERS } from "../../../../src/shared/sandbox-api-spec.js";
import { buildDryRunFacts, countChangeVerbs, CHANGE_VERB_LABEL } from "../../../../src/shared/narrate-utils.js";
import { codeFingerprint } from "../../../../src/shared/code-fingerprint.js";

// ONE literal for the "another writer holds this step" tooltip — it sits on every
// writer affordance (recipe bar toggle, Insert recipe, Undo fix) and must name the
// same set of writers `stepBusy` actually covers. F-150 added the memory-save tail.
const BUSY_TITLE = "Finish the step's current generate, fix, test run or memory save first";
// F-152 — the memory tail is the one busy source with no visible operation of its own
// (fixing and testRunning are already false when it runs), so it gets a reason variant.
// Same ONE predicate (`stepBusy`) decides WHETHER a control is disabled; only the words
// change. Both literals live here so the copy cannot drift from the predicate.
const MEMORY_BUSY_TITLE = "Saving what was learned…";
// F-153 — the addMemory tail is a component-wide lock, so it must be bounded. 8s is well
// past a warm Forge resolver round-trip (0.5-3s) and short enough that a wedged bridge
// call does not strand every writer on the step for the life of the dialog.
const MEMORY_SAVE_TIMEOUT_MS = 8000;

// Maps a step's operation type to the closest skill category for
// the "Save as Skill" pre-fill.
const SKILL_CATEGORY_BY_OPTYPE = {
  work_item_query: "Jira API",
  rest_api_internal: "Jira API",
  rest_api_external: "External / Webhooks",
  confluence_api: "Other",
  log_function: "Workflow Patterns",
};

// Compacts the codegen/fix meta for persisting on the step config — titles
// sliced so the rule config stays small.
const sliceTitle = (t) => (t || "").slice(0, 40);
const compactMeta = (meta) => {
  if (!meta) return null;
  return {
    appliedDocs: (meta.appliedDocs || []).map((d) => ({ id: d.id, title: sliceTitle(d.title) })),
    appliedSkills: (meta.appliedSkills || []).map((s) => ({ id: s.id, name: sliceTitle(s.name), auto: !!s.auto })),
    appliedMemories: meta.appliedMemories || 0,
    truncatedDocs: (meta.truncatedDocs || []).map((d) => ({ title: sliceTitle(d.title) })),
  };
};

// Polls getAsyncTaskResult for slow providers (LM Studio) that return
// { async: true, taskId } instead of an inline result. 40 tries * 3s = 120s.
const pollAsyncResult = (taskId) => new Promise((resolve) => {
  let attempts = 0;
  const maxAttempts = 40;
  const poll = async () => {
    attempts++;
    try {
      const res = await invoke("getAsyncTaskResult", { taskId });
      if (res.success) {
        // F-129 — A CANCEL IS NOT A FAILURE. A tenant Stop-all epoch cancels the queued
        // task and the poll answers { status: "error", error: "Cancelled", cancelled: true }
        // — it NEVER answers status "cancelled" (same contract JobsTab documents at F-122).
        // Must be checked BEFORE the status === "error" arm, which would otherwise render a
        // red "generation failed" and let the caller clobber the editor with a template.
        if (res.cancelled === true) { resolve({ success: false, cancelled: true, error: res.error || "Cancelled" }); return; }
        if (res.status === "done") { resolve(res.result); return; }
        if (res.status === "error") { resolve({ success: false, error: res.error }); return; }
        if (attempts < maxAttempts) { setTimeout(poll, 3000); return; }
        resolve({ success: false, error: "AI task timed out. Try again." });
      } else {
        resolve({ success: false, error: res.error || "Failed to poll task status" });
      }
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  };
  poll();
});

const OPERATION_TYPES = [
  {
    value: "work_item_query",
    label: "JQL Search",
    meta: "Search Jira issues using JQL queries",
  },
  {
    value: "rest_api_internal",
    label: "Jira REST API",
    meta: "Call any Jira REST endpoint",
  },
  {
    value: "rest_api_external",
    label: "External API",
    meta: "Call an external HTTP endpoint",
  },
  {
    value: "confluence_api",
    label: "Confluence API",
    meta: "Read or write Confluence pages",
  },
  {
    value: "log_function",
    label: "Debug Log",
    meta: "Log a message for troubleshooting",
  },
];

const HTTP_METHODS = [
  { value: "GET", label: "GET", meta: "Read data" },
  { value: "POST", label: "POST", meta: "Create data" },
  { value: "PUT", label: "PUT", meta: "Update data" },
  { value: "DELETE", label: "DELETE", meta: "Delete data" },
  { value: "PATCH", label: "PATCH", meta: "Partial update" },
];

const CONFLUENCE_OPS = [
  { value: "GET_PAGE", label: "Get Page" },
  { value: "UPDATE_PAGE", label: "Update Page" },
  { value: "CREATE_PAGE", label: "Create Page" },
  { value: "DELETE_PAGE", label: "Delete Page" },
  { value: "ADD_COMMENT", label: "Add Comment" },
];

/**
 * Generate a code template based on operation type and description.
 */
function generateCode(operationType, prompt, endpoint, method, includeBackoff) {
  const header = `// ${(prompt || "").substring(0, 100)}`;
  const backoffPre = includeBackoff
    ? `\n// Retry wrapper with exponential backoff + jitter
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      const jitter = Math.random() * delay * 0.3;
      await new Promise(r => setTimeout(r, delay + jitter));
      api.log("Retry " + (attempt + 1) + "/" + maxRetries + ": " + err.message);
    }
  }
}\n`
    : "";

  const wrap = (code) => includeBackoff
    ? `return await withRetry(async () => {\n  ${code.split("\n").join("\n  ")}\n});`
    : code;

  switch (operationType) {
    case "work_item_query":
      return `${header}${backoffPre}
${wrap(`const results = await api.searchJql("project = " + api.context.issueKey.split("-")[0] + " AND summary ~ \\"keyword\\"");
api.log("Found " + (results.issues?.length || 0) + " matching issues");
return results.issues || [];`)}`;

    case "rest_api_internal":
      if ((method || "GET") === "GET") {
        return `${header}${backoffPre}
${wrap(`const issue = await api.getIssue(api.context.issueKey);
api.log("Fetched issue: " + issue.key);
return issue;`)}`;
      }
      return `${header}${backoffPre}
// ${method} ${endpoint || "/rest/api/3/issue/{key}"}
${wrap(`await api.updateIssue(api.context.issueKey, {
  // fields to update
});
api.log("Updated issue " + api.context.issueKey);
return { success: true };`)}`;

    case "rest_api_external":
      return `${header}${backoffPre}
// External API: ${endpoint || "https://api.example.com/..."}
// Note: The domain must be whitelisted in manifest.yml > permissions.external.fetch
${wrap(`api.log("External call to: ${(endpoint || "").replace(/"/g, '\\"')}");
// Use fetch() for external calls — configure in manifest.yml
return null;`)}`;

    case "confluence_api":
      return `${header}${backoffPre}
// Confluence: ${method || "GET_PAGE"}
${wrap(`api.log("Confluence operation: ${method || "GET_PAGE"}");
return null;`)}`;

    case "log_function":
      return `${header}
const issue = await api.getIssue(api.context.issueKey);
api.log("Issue: " + issue.key + " | Status: " + issue.fields.status.name + " | ${(prompt || "debug").replace(/"/g, '\\"')}");`;

    default:
      return `${header}${backoffPre}
${wrap(`const issue = await api.getIssue(api.context.issueKey);
api.log("Processing: " + issue.key);
return { success: true };`)}`;
  }
}

export default function FunctionBlock({ index, functionData, priorSteps, fields = [], onUpdate, onRemove, isOnly, codegenContext = null, testContext = null }) {
  const runtime = codegenContext?.runtime || testContext?.runtime;
  const executionWhen = runtime === "listener" ? "when the listener runs" : runtime === "job" ? "when the job runs" : "on every transition";
  const [isGenerating, setIsGenerating] = useState(false);
  const [showApiRef, setShowApiRef] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState(functionData.selectedDocIds || []);
  const [selectedSkills, setSelectedSkills] = useState(functionData.selectedSkillIds || []);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testTarget, setTestTarget] = useState("");
  // "Explain these changes" narrate assist: idle | loading | done | degraded | error.
  const [narrateState, setNarrateState] = useState("idle");
  const [narration, setNarration] = useState(null);
  const [narrateReason, setNarrateReason] = useState("");
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [opSuggested, setOpSuggested] = useState(false);
  const [endpointQuery, setEndpointQuery] = useState("");
  const [suggestingEndpoint, setSuggestingEndpoint] = useState(false);
  const [endpointSuggestion, setEndpointSuggestion] = useState(null);
  // Non-blocking notice surfaced when AI code-gen failed and we fell back to a generic template.
  // Cleared by the user on the next Generate click or when they edit the code.
  const [generationFallback, setGenerationFallback] = useState(null);
  // F-129 — set when a queued AI task was cancelled by a tenant Stop-all. Neutral slate
  // note, NOT an error: nothing ran, nothing was written, the step is exactly as it was.
  const [cancelledNote, setCancelledNote] = useState(null);
  // F-133 — set when a generate FAILED while the step already had code. The existing code,
  // its provenance and its dry-run verdict are all kept; this is the (solid red) note that
  // says so, and it carries the Retry affordance. Distinct from `generationFallback`, which
  // means "there was no code, so a generic template WAS inserted".
  const [generationKept, setGenerationKept] = useState(null);
  // Fix-with-AI loop state
  const [fixing, setFixing] = useState(false);
  const [fixAttempts, setFixAttempts] = useState(0);
  // { explanation, verified, preFixCode, preFixMeta, token } — `token` is the genToken the
  // fix ran under. F-158 uses it to answer "did THIS card's fix produce that memory?".
  const [fixResult, setFixResult] = useState(null);
  // { id, content, learnedFrom, merged, fixToken } — `merged` is the resolver's answer to
  // "was this candidate deduped INTO an existing memory?" (F-155). It decides what the badge
  // may claim and whether a veto may be offered at all; see `renderMemoryBadge`.
  // F-158 — `fixToken` records WHICH fix produced it. The fix card may only show a memory
  // its own fix produced; an older one is disclosed outside the card instead.
  const [memorySaved, setMemorySaved] = useState(null);
  // F-158 — the backend can accept the call and keep nothing (`{ success:true, stored:false,
  // reason }` — the store is at its cap). That is not a memory, so it gets no badge and no
  // veto: just a neutral note inside the card of the fix that tried. Reset per fix.
  const [memoryNotKept, setMemoryNotKept] = useState(null);
  // F-150 — true while the verified fix's addMemory tail is in flight. It is part of
  // `stepBusy` (below) because that tail still belongs to the fix: it is the step's
  // `token` that decides whether the saved memory gets a badge and a veto, and a writer
  // that bumps the token during the tail persists a memory the author can neither see
  // nor undo. The busy window therefore covers the fix from click to badge.
  const [memorySaving, setMemorySaving] = useState(false);
  // Bumped after flows OUTSIDE the knowledge panel persist/delete a memory
  // (fix-derived save, veto) so the panel's counts and list refresh.
  const [knowledgeRefresh, setKnowledgeRefresh] = useState(0);
  const [vetoingMemory, setVetoingMemory] = useState(false);
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  // Recipe picker state — "Start from a recipe" inserts ready-made, no-AI code.
  const [showRecipes, setShowRecipes] = useState(false);
  const [recipeKey, setRecipeKey] = useState("");
  const [recipeParams, setRecipeParams] = useState({});
  const suggestTimer = useRef(null);
  // Timer for the transient "auto-detected" badge — cleared before re-arming
  // (rapid re-suggestions must not race) and on unmount.
  const opBadgeTimer = useRef(null);
  useEffect(() => () => { if (opBadgeTimer.current) clearTimeout(opBadgeTimer.current); }, []);

  // Generation token — invalidates in-flight generate/fix polls. Bumped at the
  // start of every generate and fix, on manual code edits, and on unmount, so
  // a stale resolution can never clobber newer state with old AI output.
  const genTokenRef = useRef(0);
  // Separate cancellation token for the narrate call. A plain "Run test" re-run
  // does NOT bump genTokenRef, so narrate needs its own — bumped in resetNarrate
  // (which runTest, the fix-loop re-run, and handleCodeChange all call) so a slow
  // narration for a superseded dry-run can never overwrite a newer result.
  const narrateTokenRef = useRef(0);
  useEffect(() => () => { genTokenRef.current += 1; }, []);

  // ── ONE RULE: a step has at most ONE writer of `code` in flight ──────────────────────
  // Generate, Fix with AI, Insert recipe, Undo fix and the dry-run all resolve into the
  // same step (its `code`, its provenance meta and its verdict), and each spends something
  // real — a provider attempt, a sandbox run, or the author's explicit intent. So they are
  // mutually exclusive, and `stepBusy` is the SINGLE predicate behind every writer's guard
  // and every writer button's disabled/hidden state. The two ASYNC writers (generate, fix)
  // additionally refuse re-entry at the top of their handler, because a second one would
  // abandon the first with its attempt already charged. The two INSTANT writers (Insert
  // recipe, Undo fix) instead bump `genTokenRef`, so that if one ever does land it takes
  // ownership of the code and any in-flight AI result is discarded — exactly like a manual
  // edit (handleCodeChange). F-141 / F-143 / F-145 / F-146.
  //
  // F-150 — `memorySaving` is in the predicate because the fix flow does not end when the
  // fixed code lands: the verified re-run is followed by an addMemory tail that decides
  // the badge and its veto. Left outside the window, an Undo or an Insert during the tail
  // bumped the token and the persisted memory became invisible and un-vetoable. ONE
  // predicate, still — every writer guard and every writer button reads `stepBusy` only.
  //
  // F-151 — the token does NOT belong in this window. `stepBusy` owns who may WRITE THE
  // CODE; the memory badge is not about the current code at all, it is the disclosure of
  // a write the backend has already made about the code version the fix repaired. The
  // keyboard is a writer `stepBusy` cannot close (F-141's manual-edit escape hatch must
  // stay open, and locking CodeMirror during the tail would add a second predicate next to
  // this one), so instead the disclosure is taken OUT of the token guard entirely: a
  // persisted memory always gets its badge and its veto, and the badge carries the
  // fingerprint of the code it was learned from so it can say so when the code has moved
  // on. One rule each: the token guards code ownership, nothing else.
  //
  // F-152 — `stepBusy` is also the ONE visible state: the step header shows a spinner and
  // a reason whenever it is true, and every control it disables carries `busyTitle`.
  const stepBusy = isGenerating || fixing || testRunning || memorySaving;
  // The reason shown on every disabled writer control. Same predicate, different words.
  const busyTitle = memorySaving ? MEMORY_BUSY_TITLE : BUSY_TITLE;
  // What the step header says while it is busy — one label per busy source.
  const busyLabel = isGenerating
    ? "Generating code…"
    : fixing
    ? "Fixing the code…"
    : testRunning
    ? "Running the test…"
    : "Saving what was learned…";

  const update = (field, value) => onUpdate({ [field]: value });

  // F-149 — every writer that TAKES OWNERSHIP of `code` must also drop the state that
  // describes the code it replaced, or that state keeps acting on the new code: a live
  // Undo whose `preFixCode` would overwrite the new code with the old, a PASS/FAIL verdict
  // (and its narration) earned by code no longer on screen, a "your code was kept" note
  // about code that is gone, and an auto-fix budget spent on a different program.
  // Callers bump `genTokenRef` themselves — ownership of the code and ownership of the
  // state describing it are one act, but the token bump is per-writer (an AI writer bumps
  // at the START of its call, an instant writer at the moment it lands).
  // NOT used by handleFixWithAI, which replaces the code and immediately installs the
  // fix card that describes the replacement; nor by handleUndoFix, which deliberately
  // keeps `memorySaved` and its own attempt budget.
  const clearStaleCodeState = () => {
    setFixResult(null); // carries preFixCode/preFixMeta — the live Undo
    setFixAttempts(0);
    setGenerationFallback(null);
    setGenerationKept(null);
    setTestResult(null);
    resetNarrate();
  };

  // Prior-step variable names for editor completions/lint. Keyed by a joined
  // string so the editor extensions only rebuild when names actually change.
  const priorVarsKey = (priorSteps || [])
    .filter((s) => s.variableName)
    .map((s) => s.variableName)
    .join(",");
  const priorVariables = useMemo(
    () => (priorVarsKey ? priorVarsKey.split(",") : []),
    [priorVarsKey],
  );

  // Project key derived from the test target issue (PROJ-123 -> PROJ);
  // scopes auto-matched memories/skills on the backend.
  const deriveProjectKey = () => {
    const target = testTarget.trim();
    return /^[A-Z]+-\d+$/i.test(target) ? target.split("-")[0].toUpperCase() : null;
  };

  // Prior steps payload shared by generate + fix calls.
  const buildPriorStepsPayload = () => (priorSteps || [])
    .filter((s) => s.variableName)
    .map((s, i) => ({
      step: i + 1,
      name: s.name || `Step ${i + 1}`,
      variable: s.variableName,
      description: s.operationPrompt || "",
    }));

  const handleEndpointSuggest = async () => {
    if (!endpointQuery.trim()) return;
    setSuggestingEndpoint(true);
    setEndpointSuggestion(null);
    try {
      const result = await invoke("suggestEndpoint", { prompt: endpointQuery.trim() });
      if (result.success && result.suggestion) {
        setEndpointSuggestion(result.suggestion);
      } else {
        setEndpointSuggestion({ explanation: result.error || "Could not find a suggestion" });
      }
    } catch (e) {
      setEndpointSuggestion({ explanation: "Error: " + e.message });
    }
    setSuggestingEndpoint(false);
  };

  // Auto-suggest operation type from prompt text (client-side heuristic, instant)
  const suggestOperationType = useCallback((text) => {
    if (!text || text.length < 10) return;
    const t = text.toLowerCase();

    let suggested = null;
    if (/\b(search|find|query|jql|duplicate|look\s*up|fetch\s+issues|list\s+issues)\b/.test(t)) {
      suggested = "work_item_query";
    } else if (/\b(log|debug|print|trace|monitor)\b/.test(t)) {
      suggested = "log_function";
    } else if (/\b(confluence|wiki|page|space\s+key)\b/.test(t)) {
      suggested = "confluence_api";
    } else if (/\b(external|webhook|http|third.party|slack|teams|api\.example|outside\s+jira)\b/.test(t)) {
      suggested = "rest_api_external";
    } else if (/\b(update|modify|set|change|assign|transition|move|create|delete|comment|link|field|summary|description|priority|label|component|version)\b/.test(t)) {
      suggested = "rest_api_internal";
    }

    if (suggested && suggested !== functionData.operationType) {
      onUpdate({ operationType: suggested });
      setOpSuggested(true);
      // Clear the "suggested" badge after 4 seconds
      if (opBadgeTimer.current) clearTimeout(opBadgeTimer.current);
      opBadgeTimer.current = setTimeout(() => setOpSuggested(false), 4000);
    }
  }, [functionData.operationType, onUpdate]);

  const handlePromptChange = (e) => {
    const val = e.target.value;
    update("operationPrompt", val);

    // Debounce suggestion — wait 800ms after user stops typing
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => suggestOperationType(val), 800);
  };

  // F-133 — a generate that FAILED (provider error, poll exhaustion, timeout, network).
  // A failed regenerate must NEVER replace code the author already has: their code may be
  // tested, hand-edited and hours old, and the fix-undo bar is fix-only, so a clobber here
  // is unrecoverable. The local template fallback exists for its ORIGINAL purpose only —
  // a FIRST generate on a step with no code at all, so the user is not left empty-handed.
  const handleGenerateFailure = (reason) => {
    const message = reason || "AI generation failed";
    if (functionData.code?.trim()) {
      // Keep code, generationMeta AND the dry-run verdict exactly as they were.
      setGenerationKept(message);
      console.warn("AI generation failed, kept existing code:", message);
      return;
    }
    const code = generateCode(
      functionData.operationType,
      functionData.operationPrompt,
      functionData.endpoint,
      functionData.method,
      functionData.includeBackoff,
    );
    onUpdate({ code, generationMeta: null });
    // F-154 — this branch TAKES OWNERSHIP of `code`, so it drops the state describing the
    // code it replaced through the one home (it used to hand-roll a subset: testResult
    // only, leaving a live Undo and a spent auto-fix budget pointing at a program that is
    // gone). Called BEFORE setGenerationFallback because it clears that note too.
    clearStaleCodeState();
    setGenerationFallback(message);
    console.warn("AI generation failed, used template:", message);
  };

  const handleGenerate = async () => {
    // F-141 / F-143 — the ONE RULE (see `stepBusy` above): a generate may not start while
    // a fix, another generate, or a dry-run is running. A dry-run counts because a landing
    // generate replaces the very code the run is judging, leaving a verdict that describes
    // code no longer on screen. The mirror guard lives at the top of handleFixWithAI.
    if (stepBusy) return;
    genTokenRef.current += 1;
    const token = genTokenRef.current;
    setIsGenerating(true);
    setGenerationFallback(null);
    setGenerationKept(null);
    setCancelledNote(null);
    // NOTE (F-133): the old verdict is cleared where the code is actually REPLACED, not
    // here. Clearing it up-front threw away a PASS that still belonged to code we may end
    // up keeping (a failed generate leaves the tested code in place).
    try {
      // The backend resolves selected docs/skills/memories itself; the inline
      // "Additional Context" textarea is the only client-supplied text.
      let result = await invoke("generatePostFunctionCode", {
        prompt: functionData.operationPrompt,
        operationType: functionData.operationType || "work_item_query",
        endpoint: functionData.endpoint || "",
        method: functionData.method || "GET",
        includeBackoff: functionData.includeBackoff || false,
        contextDocs: functionData.contextDocs || "",
        priorSteps: buildPriorStepsPayload(),
        selectedDocIds: selectedDocs,
        selectedSkillIds: selectedSkills,
        autoMatch: true,
        projectKey: deriveProjectKey(),
        ...(codegenContext || {}),
      });
      // Slow self-hosted providers (LM Studio) queue the task instead.
      if (result.async && result.taskId) {
        result = await pollAsyncResult(result.taskId);
      }
      // Stale resolution (user edited code / started another op / unmounted):
      // discard the result — never clobber the newer state.
      if (genTokenRef.current !== token) return;
      // F-129 — cancelled by a tenant Stop-all: no AI ran, so there is nothing to show and
      // nothing to fall back FROM. Falling through to the template branch below would
      // overwrite the user's existing code with a generic stub over an operator's stop.
      if (result && result.cancelled) { setCancelledNote("generate"); return; }
      if (result && result.success && result.code) {
        onUpdate({ code: result.code, generationMeta: compactMeta(result.meta) });
        // F-149 — a landed generate OWNS the code, so everything describing the code it
        // replaced goes with it: the verdict earned by the old code, and (the defect) the
        // fix card, whose Undo would have written the pre-fix code straight over the
        // freshly generated program. The token was already bumped at the top of this call.
        clearStaleCodeState();
      } else {
        handleGenerateFailure(result?.error);
      }
    } catch (e) {
      if (genTokenRef.current !== token) return;
      handleGenerateFailure(e.message || "Network error");
    } finally {
      // Always clear the busy flag — a stale token here can only mean a manual
      // edit or unmount (the Generate/Fix buttons are mutually excluded), so
      // resetting never stomps another op's spinner.
      setIsGenerating(false);
    }
  };

  // Run the dry-run test. Accepts a code override so the fix loop can re-run
  // immediately after applying new code (the functionData prop is still stale
  // inside that closure). Returns the result for callers that need it.
  const resetNarrate = () => {
    narrateTokenRef.current += 1; // invalidate any in-flight narrate
    setNarrateState("idle");
    setNarration(null);
    setNarrateReason("");
  };

  // Plain-English summary of what the last dry-run WOULD change. One AI call per
  // explicit click; the backend bounds cost (sig-cache + short negative cache).
  const runNarrate = async () => {
    if (narrateState === "loading" || !(testResult && testResult.changes && testResult.changes.length)) return;
    const token = narrateTokenRef.current;
    setNarrateState("loading");
    try {
      const result = await invoke("narrateDryRun", {
        changesText: buildDryRunFacts(testResult.changes),
        total: testResult.changes.length,
        mode: testResult.mode || "simulation",
      });
      // A newer run/edit/fix superseded this narration while it was in flight — drop it.
      if (narrateTokenRef.current !== token) return;
      if (result && result.degraded) {
        setNarrateReason(result.reason || "error");
        setNarrateState("degraded");
      } else if (result && result.success && result.summary) {
        setNarration({ summary: result.summary, verify: result.verify || [] });
        setNarrateState("done");
      } else {
        setNarrateReason((result && result.error) || "");
        setNarrateState("error");
      }
    } catch (e) {
      console.error("Narrate dry-run failed:", e);
      if (narrateTokenRef.current === token) setNarrateState("error");
    }
  };

  const runTest = async (codeOverride) => {
    const codeToRun = codeOverride !== undefined ? codeOverride : functionData.code;
    // A verdict belongs to the exact code it ran against: if the user edits
    // the code while this run is in flight (handleCodeChange bumps the token),
    // the result must not be displayed as if it applied to the edited code.
    const token = genTokenRef.current;
    setTestRunning(true);
    setTestResult(null);
    resetNarrate(); // a new run (incl. the fix-loop auto re-run, which calls runTest) invalidates any prior narration
    let result;
    try {
      const target = testTarget.trim();
      const isKey = /^[A-Z]+-\d+$/i.test(target);
      result = await invoke("testPostFunction", {
        code: codeToRun,
        issueKey: isKey ? target : undefined,
        jql: target && !isKey ? target : undefined,
        contextExtras: testContext || undefined,
      });
    } catch (e) {
      result = { success: false, logs: ["Test error: " + e.message] };
    }
    setTestRunning(false);
    if (genTokenRef.current !== token) return result; // stale — caller still gets it
    setTestResult(result);
    if (result && result.success) {
      setFixAttempts(0); // successful run resets the fix guard
      // Stamp the tested-state: this exact code now passed a dry-run (covers the fix-loop re-run too,
      // which calls runTest with the fixed code). A later edit changes the fingerprint → chip goes stale.
      onUpdate({ testedFingerprint: codeFingerprint(codeToRun) });
    }
    return result;
  };

  // One-click AI repair: send the failing code + logs, apply the fixed code,
  // auto re-run the test, and persist what the AI learned as a memory when
  // the re-run passes.
  const handleFixWithAI = async () => {
    // F-141 / F-143 — mirror of the guard in handleGenerate: the ONE RULE (see `stepBusy`).
    if (stepBusy || fixAttempts >= 2) return;
    genTokenRef.current += 1;
    const token = genTokenRef.current;
    const failedResult = testResult;
    setFixAttempts((n) => n + 1);
    setFixing(true);
    // F-156 — `memorySaved` is NOT cleared here. It describes a fact already persisted
    // server-side, and the badge is the only place this screen offers to forget it. A
    // second fix whose re-run FAILS saves no new memory, so clearing here left the first
    // fix's memory live in the instance store with nothing on screen naming it. It is
    // cleared by the veto, or overwritten by a NEW successful save below — nothing else.
    // (Same rule as handleUndoFix and the fix card's dismiss.)
    setCancelledNote(null);
    try {
      const logs = failedResult?.logs || [];
      const firstError = logs.find((l) => /error|fail|exception|denied|invalid|timeout/i.test(l));
      const error = firstError || logs.slice(-5).join("\n") || "Test failed with no logs";

      let result = await invoke("fixPostFunctionCode", {
        code: functionData.code,
        error,
        logs: logs.slice(-20),
        prompt: functionData.operationPrompt,
        operationType: functionData.operationType || "work_item_query",
        selectedSkillIds: selectedSkills,
        selectedDocIds: selectedDocs,
        projectKey: deriveProjectKey(),
        priorSteps: buildPriorStepsPayload(),
        ...(codegenContext || {}),
      });
      if (result.async && result.taskId) {
        result = await pollAsyncResult(result.taskId);
      }
      // Stale resolution (user edited code / started another op / unmounted):
      // discard the fix — only clear the busy flag.
      if (genTokenRef.current !== token) {
        setFixing(false);
        return;
      }

      // F-129 — cancelled by a tenant Stop-all. Leave the failing dry-run exactly as it
      // was (no `fixError` stamped onto it, no fix-result card, no code replaced) so the
      // user can simply press Fix with AI again once the stop is lifted.
      // The cancelled attempt never reached the model, so it must not be charged against
      // the 2-attempt auto-fix cap — refund it, or a Stop-all silently burns the budget.
      if (result && result.cancelled) { setFixing(false); setFixAttempts((n) => Math.max(0, n - 1)); setCancelledNote("fix"); return; }

      if (result && result.success && result.code) {
        const preFixCode = functionData.code;
        const preFixMeta = functionData.generationMeta || null;
        onUpdate({ code: result.code, generationMeta: compactMeta(result.meta) });
        setTestResult(null);
        // F-144 — the red "generation failed, your existing code was kept" note describes
        // code this fix has just replaced. Leaving it up puts a failure banner above a
        // green fix result. (A successful generate clears it too — it is reset at the top
        // of handleGenerate, before the request goes out.)
        setGenerationKept(null);
        // F-158 — a fresh fix card owns a fresh "nothing was kept" note; the previous
        // fix's note must not be read as this fix's outcome.
        setMemoryNotKept(null);
        setFixResult({
          explanation: result.explanation || "",
          verified: false,
          preFixCode,
          preFixMeta,
          token,
        });
        setFixing(false);

        // Auto re-run against the fixed code
        const rerun = await runTest(result.code);
        if (genTokenRef.current !== token) return;
        if (rerun && rerun.success) {
          setFixResult((prev) => (prev ? { ...prev, verified: true } : prev));
          // Persist the fix-derived memory only once the fix is verified
          if (result.memoryCandidate && result.memoryCandidate.content) {
            // F-150 — the step stays BUSY across this tail. The re-run has already cleared
            // `testRunning`, so without `memorySaving` the step looked idle while a write
            // was still outstanding: an Undo or an Insert recipe pressed here bumped the
            // token, the guard below then dropped the result, and the memory ended up
            // persisted on the backend with no badge and no veto — learned, invisible,
            // and impossible to take back. Set BEFORE the await, cleared in `finally`.
            setMemorySaving(true);
            // F-151 — the memory outcome is deliberately NOT behind `genTokenRef`. The
            // token answers "does this result still own the code on screen?", and the
            // answer for a memory is always no: it was learned from the code version this
            // fix repaired, which a later keystroke has already superseded. What must not
            // be superseded is the DISCLOSURE — the backend has written the memory before
            // this promise resolves, so dropping the badge leaves a fix-derived memory in
            // the instance store that the author can neither see nor forget from here.
            // The fingerprint travels with the badge so it can name the version it came
            // from once the code has moved on.
            const learnedFrom = codeFingerprint(result.code);
            try {
              // F-153 — bounded. `invoke` has no timeout of its own, and since F-150 put
              // this tail inside `stepBusy` a call that never settles disables every
              // writer on the step for the life of the mounted component, with no cancel
              // and no route out. A losing race still leaves `memorySaving` cleared by
              // `finally`, so the step always unlocks within MEMORY_SAVE_TIMEOUT_MS.
              const memRes = await Promise.race([
                invoke("addMemory", {
                  content: result.memoryCandidate.content,
                  projectKey: result.memoryCandidate.projectScoped ? deriveProjectKey() : null,
                  source: "fix",
                }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("memory-save-timeout")), MEMORY_SAVE_TIMEOUT_MS),
                ),
              ]);
              // F-158 — "the store kept nothing" is its own outcome, not a failure and not
              // a memory. The resolver answers `{ success: false, reason: "cap", stored: false }`
              // when the store is at its cap, and `{ success: true, id, merged, stored: true }`
              // otherwise. `stored === false` is the single tell, checked BEFORE `success`, so
              // a full store never falls through to the generic error path (which would say
              // "couldn't save" — wrong: the call worked, the store is simply full) and never
              // produces a badge claiming a memory that does not exist, with a veto that has
              // no id behind it.
              if (memRes && (memRes.stored === false || memRes.reason === "cap")) {
                setMemoryNotKept(
                  memRes.reason === "cap"
                    ? "Nothing was kept — the memory store is full; prune it in the Memories tab."
                    : "Nothing was kept — this fix's lesson was not stored.",
                );
                showToast(memRes.reason === "cap" ? "Fix verified. Nothing was learned — the memory store is full." : "Fix verified. Nothing was learned from it.");
              } else if (memRes && memRes.success && memRes.id) {
                // F-155 — carry `merged` with the badge. On a dedup hit the resolver
                // returns the id of the PRE-EXISTING memory it reinforced, which may be a
                // user-authored row with many reinforcements; deleting it is not an undo.
                // F-158 — a NEW successful save REPLACES the previous `memorySaved`, and
                // stamps the fix that produced it so only that fix's card may show it.
                setMemorySaved({
                  id: memRes.id,
                  content: result.memoryCandidate.content,
                  learnedFrom,
                  merged: !!memRes.merged,
                  fixToken: token,
                });
                setKnowledgeRefresh((n) => n + 1);
                showToast("Fix verified — memory saved");
              }
            } catch (e) {
              // On a timeout the memory MAY still land server-side, but we have no id, so
              // a badge here would carry a veto button that cannot delete anything — a
              // worse lie than no badge. We drop the badge and send the author to the one
              // place that reads the real store, and refresh it so the row shows up there.
              const timedOut = e && e.message === "memory-save-timeout";
              console.warn("Memory save failed:", e && e.message);
              if (timedOut) {
                setKnowledgeRefresh((n) => n + 1);
                showToast("Fix verified. The memory is still saving — check the Memories tab.", "error");
              }
            } finally {
              setMemorySaving(false);
            }
          }
        }
      } else {
        setFixing(false);
        setTestResult(failedResult ? { ...failedResult, fixError: result?.error || "AI fix failed" } : null);
      }
    } catch (e) {
      setFixing(false);
      if (genTokenRef.current !== token) return;
      setTestResult((prev) => (prev ? { ...prev, fixError: e.message } : { success: false, logs: ["Fix error: " + e.message] }));
    }
  };

  const handleUndoFix = () => {
    if (!fixResult) return;
    // F-146 — Undo is an INSTANT writer of `code` (the ONE RULE, see `stepBusy`): its
    // button is disabled while anything else is writing, and it takes ownership of the
    // code by bumping the token, so a fix that lands afterwards can never silently revert
    // the author's explicit restore.
    genTokenRef.current += 1;
    onUpdate({ code: fixResult.preFixCode, generationMeta: fixResult.preFixMeta });
    setFixResult(null);
    // Clear the (now stale) PASS from the fixed code's auto re-run — the
    // restored code was never verified by that run.
    setTestResult(null);
    // Keep memorySaved: the learned memory is already persisted, so the badge
    // (and its veto button) must stay available after the undo.
  };

  const handleVetoMemory = async () => {
    if (!memorySaved || vetoingMemory) return;
    // F-155 — a merged save has no veto affordance (see `renderMemoryBadge`); this is the
    // matching code guarantee, so no future caller can point the delete at a row this fix
    // only reinforced. `deleteMemory` removes the WHOLE row and there is no un-reinforce.
    if (memorySaved.merged) return;
    setVetoingMemory(true);
    try {
      const res = await invoke("deleteMemory", { id: memorySaved.id });
      if (res && res.success) {
        // Only clear the badge once the delete is confirmed — a failed delete
        // must never look like a successful veto.
        setMemorySaved(null);
        setKnowledgeRefresh((n) => n + 1);
      } else {
        showToast(res?.error || "Couldn't forget the memory", "error");
      }
    } catch (e) {
      console.warn("Memory delete failed:", e.message);
      showToast("Couldn't forget the memory: " + e.message, "error");
    }
    setVetoingMemory(false);
  };

  // F-155 — ONE home for the learned-memory disclosure; both cards below render it.
  // `addMemory` answers `merged: true` when `saveMemoryCandidate` deduped this candidate
  // INTO an existing memory instead of adding a row. That id belongs to the pre-existing
  // memory — often user-authored and reinforced many times — and `deleteMemory` removes
  // the whole row, so a "forget" there would destroy someone else's fact rather than undo
  // this fix's contribution. There is no un-reinforce API, so the merged badge states what
  // actually happened and sends the author to the store that owns the row.
  const renderMemoryBadge = () => {
    if (!memorySaved) return null;
    if (memorySaved.merged) {
      return (
        <div className="memory-saved-wrap">
          <span className="memory-saved-badge">🧠 Reinforced an existing memory</span>
          <span className="memory-saved-note">
            What this fix learned already existed as a memory, so it was reinforced rather than
            added. Manage it in the Memories tab of the CogniRunner admin panel.
          </span>
        </div>
      );
    }
    return (
      <span className="memory-saved-badge">
        🧠 Learned: {memorySaved.content.slice(0, 80)}
        <button
          className={vetoingMemory ? "is-busy busy-solid" : ""}
          onClick={handleVetoMemory}
          disabled={vetoingMemory}
          title="Forget this memory"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#ffffff", fontSize: "14px", lineHeight: 1, padding: 0, marginLeft: "6px" }}
        >
          &times;
        </button>
      </span>
    );
  };

  // Manual edits dismiss the fix card and reset the fix-attempt guard.
  // (External value updates don't trigger CodeMirror's onChange, so applying
  // an AI fix doesn't immediately dismiss its own card.)
  const handleCodeChange = (v) => {
    // A manual edit takes ownership of the code — invalidate any in-flight
    // generate/fix so its eventual result is discarded.
    genTokenRef.current += 1;
    update("code", v);
    // F-149 — one home for "this code is not the code that state describes".
    clearStaleCodeState();
  };

  const hasPrompt = functionData.operationPrompt?.trim();
  const hasCode = functionData.code?.trim();
  // Tested-state chip (INFORMATIONAL, never a save-gate — Formality≠Gate). Derived from the fingerprint of
  // the code that last passed a dry-run vs the current code: untested (never passed) / pass (current code is
  // the tested code) / stale (edited or undone since the last pass). Airtight — no flag to get out of sync.
  const testState = !hasCode
    ? null
    : (functionData.testedFingerprint == null
        ? "untested"
        : (functionData.testedFingerprint === codeFingerprint(functionData.code) ? "pass" : "stale"));
  const opType = functionData.operationType || "work_item_query";

  return (
    <div className="function-block">
      {/* Header */}
      <div className="function-header">
        <span className="function-number">#{index + 1}</span>
        {/* F-152 — ONE visible busy state for the whole step, driven by the same
            `stepBusy` predicate that disables the six writer controls. Before this, the
            memory tail disabled everything while the step looked completely idle (its two
            spinners key on `testRunning`/`isGenerating`, both false by then). Solid slate
            chip + the MLS `.spin-ring`; no per-control spinner is added, so there is still
            only one place that says "this step is working". */}
        {stepBusy && (
          <span className="step-busy-note" title={busyTitle}>
            <span className="spin-ring spin-ring-sm" />
            {busyLabel}
          </span>
        )}
        <input
          type="text"
          className="input function-name-input"
          value={functionData.name || ""}
          onChange={(e) => update("name", e.target.value)}
          placeholder={`Step ${index + 1} name (optional)`}
        />
        {testState && (
          <span
            className={`pf-test-chip pf-test-${testState}`}
            title={testState === "pass"
              ? "This step's current code passed a dry-run test"
              : testState === "stale"
              ? "The code was edited (or a fix undone) after its last passing test — run Test again to verify"
              : "This step hasn't passed a dry-run test yet"}
          >
            {testState === "pass" ? "Tested ✓" : testState === "stale" ? "Edited since tested" : "Untested"}
          </span>
        )}
        {!isOnly && (
          <button
            className="btn-remove"
            onClick={() => onRemove(functionData.id)}
            title="Remove this step"
          >
            &times;
          </button>
        )}
      </div>

      {/* Start from a recipe — a ready-made, no-AI step. Alternative to describe → Generate. */}
      <div className="recipe-bar">
        <button
          type="button"
          className="recipe-bar-toggle"
          onClick={() => setShowRecipes((v) => !v)}
          disabled={stepBusy}
          title={stepBusy ? busyTitle : undefined}
        >
          <span className="recipe-bar-icon">{showRecipes ? "▾" : "▸"}</span>
          <span>Start from a recipe</span>
          <span className="recipe-bar-sub">ready-made · no AI</span>
        </button>
        {showRecipes && (
          <div className="recipe-bar-body anim-rise">
            <CustomSelect
              value={recipeKey}
              onChange={(k) => { setRecipeKey(k); setRecipeParams({}); }}
              searchable
              placeholder="Choose a recipe…"
              options={BUILTIN_RECIPES.map((r) => {
                const supported = (r.apiMembers || []).every((m) => KNOWN_API_MEMBERS.includes(m));
                return { value: r.key, label: r.label, meta: supported ? r.category : "needs newer sandbox", type: r.category };
              })}
            />
            {recipeKey && (() => {
              const recipe = getRecipeByKey(recipeKey);
              if (!recipe) return null;
              const supported = (recipe.apiMembers || []).every((m) => KNOWN_API_MEMBERS.includes(m));
              const missing = recipe.params.filter((pp) => pp.required && !String(recipeParams[pp.name] ?? "").trim());
              return (
                <>
                  <p className="recipe-desc">{recipe.description}</p>
                  {recipe.params.map((pp) => (
                    <div className="form-group" key={pp.name}>
                      <label className="label">{pp.label}{pp.required && <span className="required"> *</span>}</label>
                      {pp.type === "field" ? (
                        <CustomSelect
                          value={recipeParams[pp.name] || ""}
                          onChange={(v) => setRecipeParams((s) => ({ ...s, [pp.name]: v }))}
                          searchable
                          placeholder="Choose a field…"
                          options={fields.map((f) => ({ value: f.id, label: f.name, meta: f.id }))}
                        />
                      ) : pp.type === "select" || pp.type === "operator" ? (
                        <CustomSelect
                          value={recipeParams[pp.name] ?? pp.default ?? ""}
                          onChange={(v) => setRecipeParams((s) => ({ ...s, [pp.name]: v }))}
                          options={pp.options || []}
                        />
                      ) : pp.type === "number" ? (
                        <input
                          className="input"
                          type="number"
                          value={recipeParams[pp.name] ?? pp.default ?? ""}
                          onChange={(e) => setRecipeParams((s) => ({ ...s, [pp.name]: e.target.value }))}
                        />
                      ) : (
                        <input
                          className="input"
                          value={recipeParams[pp.name] || ""}
                          onChange={(e) => setRecipeParams((s) => ({ ...s, [pp.name]: e.target.value }))}
                          placeholder={pp.hint || ""}
                        />
                      )}
                      {pp.hint && <p className="hint">{pp.hint}</p>}
                    </div>
                  ))}
                  {!supported && (
                    <div className="recipe-note">This recipe needs sandbox methods not yet enabled in this build.</div>
                  )}
                  <button
                    type="button"
                    className="btn-generate"
                    disabled={!supported || missing.length > 0 || stepBusy}
                    title={stepBusy ? busyTitle : undefined}
                    onClick={() => {
                      const params = {};
                      for (const pp of recipe.params) params[pp.name] = recipeParams[pp.name] ?? pp.default ?? "";
                      // F-145 — Insert recipe is an INSTANT writer of `code` (the ONE RULE,
                      // see `stepBusy`): the button is disabled while anything else writes,
                      // and the insert takes ownership by bumping the token, so an in-flight
                      // generate/fix can never land on top of the deterministic recipe and
                      // stamp AI provenance onto code the user never generated.
                      genTokenRef.current += 1;
                      onUpdate({
                        code: recipe.build(params),
                        operationType: recipe.operationType || functionData.operationType,
                        generationMeta: { source: "recipe", recipeKey: recipe.key, recipeLabel: recipe.label, recipeParams: params },
                      });
                      // F-149 — taking ownership of the code means taking ownership of the
                      // state that described it. Without this the fix card survived the
                      // insert with a LIVE Undo, and one click wrote `preFixCode` over the
                      // deterministic recipe; the old dry-run verdict stood over it too.
                      clearStaleCodeState();
                      setShowRecipes(false);
                    }}
                  >
                    Insert recipe
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Available variables from prior steps */}
      {priorSteps && priorSteps.filter((s) => s.variableName).length > 0 && (
        <div className="prior-vars-bar">
          <div className="prior-vars-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span className="prior-vars-label">Variables from previous steps</span>
          </div>
          <div className="prior-vars-list">
            {priorSteps.filter((s) => s.variableName).map((s, i) => (
              <div key={i} className="prior-var-item">
                <code className="prior-var-tag">{s.variableName}</code>
                <span className="prior-var-desc">
                  Step {i + 1}{s.name ? `: ${s.name}` : ""}{s.operationPrompt ? ` — ${s.operationPrompt.substring(0, 60)}` : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="prior-vars-hint">
            Use these in your description or code. The AI knows about them and will reference them automatically.
          </p>
        </div>
      )}

      {/* Description — what this step does */}
      <div className="form-group">
        <label className="label">
          What should this step do?
          <Tooltip text={`Describe the action in plain language. AI generates JavaScript that runs ${executionWhen}. Running the code itself uses no AI.`} />
        </label>
        <textarea
          className="textarea"
          rows={3}
          value={functionData.operationPrompt || ""}
          onChange={handlePromptChange}
          placeholder={'Example: "Find all issues in this project with the same summary and add a comment linking to them"'}
        />
      </div>

      {/* Operation type */}
      <div className="form-group">
        <label className="label">
          Operation Type
          {opSuggested && <span className="op-suggested-badge">auto-detected</span>}
          <Tooltip text="Auto-detected from your description. You can override it. This tells the AI code generator what APIs and patterns to use." />
        </label>
        <CustomSelect
          value={opType}
          onChange={(v) => {
            // A manual pick wins: cancel any pending debounced auto-detect (armed by
            // the last keystroke, closed over a now-stale operationType) so it can't
            // fire 800ms later and revert the user's choice. Also drop the badge.
            if (suggestTimer.current) { clearTimeout(suggestTimer.current); suggestTimer.current = null; }
            setOpSuggested(false);
            update("operationType", v);
          }}
          options={OPERATION_TYPES}
        />
      </div>

      {/* Operation-specific fields */}
      {opType === "rest_api_internal" && (
        <div className="rest-api-section">
          {/* AI Endpoint Assistant */}
          <div className="form-group">
            <label className="label">
              Find endpoint
              <Tooltip text="Describe what you want to do and the AI will suggest the right endpoint, method, and request body." />
            </label>
            <div className="endpoint-assist-row">
              <input
                type="text"
                className="input"
                value={endpointQuery}
                onChange={(e) => setEndpointQuery(e.target.value)}
                placeholder='e.g., "Add a comment to the issue" or "Link two issues together"'
                onKeyDown={(e) => { if (e.key === "Enter") handleEndpointSuggest(); }}
              />
              <button
                className={`btn-generate${suggestingEndpoint ? " is-busy busy-solid" : ""}`}
                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={handleEndpointSuggest}
                disabled={suggestingEndpoint || !endpointQuery.trim()}
              >
                Suggest
              </button>
            </div>
            {endpointSuggestion?.explanation && (
              <div className="endpoint-suggestion anim-rise">
                <p className="endpoint-suggestion-text">{endpointSuggestion.explanation}</p>
                {endpointSuggestion.unparsed && !endpointSuggestion.path && (
                  <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    The AI's response wasn't structured — copy the path/method manually, or rephrase your description and try again.
                  </p>
                )}
                {endpointSuggestion.path && (
                  <button
                    className="btn-generate-secondary"
                    style={{ marginTop: "6px", fontSize: "11px", padding: "4px 10px" }}
                    onClick={() => {
                      if (endpointSuggestion.method) update("method", endpointSuggestion.method);
                      if (endpointSuggestion.path) update("endpoint", endpointSuggestion.path);
                      if (endpointSuggestion.body) update("requestBody", endpointSuggestion.body);
                      setEndpointSuggestion(null);
                    }}
                  >
                    Apply suggestion
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Endpoint picker */}
          <div className="form-group">
            <label className="label">
              Endpoint
              <Tooltip text="Select a Jira REST API endpoint from the catalog, or type a custom path. Use {issueIdOrKey} as placeholder." />
            </label>
            <CustomSelect
              value={functionData.endpoint || ""}
              onChange={(v) => {
                update("endpoint", v);
                const ep = JIRA_ENDPOINTS_DATA.find((e) => e.path === v);
                if (ep) {
                  update("method", ep.method);
                  if (ep.body) update("requestBody", ep.body);
                }
              }}
              searchable
              searchPlaceholder="Search endpoints..."
              placeholder="Select or type an endpoint..."
              options={JIRA_ENDPOINTS_DATA.map((e) => ({
                value: e.path,
                label: `${e.method} ${e.path.replace("/rest/api/3/", "")}`,
                meta: e.description,
                type: e.category,
              }))}
            />
          </div>

          <div className="op-fields">
            <div className="form-group">
              <label className="label">HTTP Method</label>
              <CustomSelect
                value={functionData.method || "GET"}
                onChange={(v) => update("method", v)}
                options={HTTP_METHODS}
              />
            </div>
            <div className="form-group">
              <label className="label">Custom Path (override)</label>
              <input
                type="text"
                className="input"
                value={functionData.endpoint || ""}
                onChange={(e) => update("endpoint", e.target.value)}
                placeholder="/rest/api/3/issue/{issueIdOrKey}"
                style={{ fontFamily: "SFMono-Regular, Consolas, monospace", fontSize: "12px" }}
              />
            </div>
          </div>

          {/* Request Body */}
          {(functionData.method || "GET") !== "GET" && (
            <div className="form-group">
              <label className="label">
                Request Body (JSON)
                <Tooltip text="The JSON body to send with the request. Required for POST and PUT. Use ADF format for description and comment fields." />
              </label>
              <textarea
                className="textarea context-textarea"
                rows={8}
                value={functionData.requestBody || ""}
                onChange={(e) => update("requestBody", e.target.value)}
                placeholder='{\n  "fields": {\n    "summary": "Updated value"\n  }\n}'
              />
            </div>
          )}
        </div>
      )}

      {opType === "rest_api_external" && (
        <div className="form-group">
          <label className="label">
            External URL
            <Tooltip text="The full URL of the external API. The domain must be whitelisted in manifest.yml under permissions.external.fetch. Use ${variableName} to reference results from previous steps." />
          </label>
          <input
            type="text"
            className="input"
            value={functionData.endpoint || ""}
            onChange={(e) => update("endpoint", e.target.value)}
            placeholder="https://api.example.com/webhook"
          />
        </div>
      )}

      {opType === "confluence_api" && (
        <div className="op-fields">
          <div className="form-group">
            <label className="label">
              Confluence Operation
              <Tooltip text="The type of Confluence operation. Get, create, update, or delete pages, or add comments." />
            </label>
            <CustomSelect
              value={functionData.method || "GET_PAGE"}
              onChange={(v) => update("method", v)}
              options={CONFLUENCE_OPS}
            />
          </div>
          <div className="form-group">
            <label className="label">
              Space Key
              <Tooltip text="The Confluence space key to operate in (e.g., ENG, DOCS). Leave empty to let the code determine it." />
            </label>
            <input
              type="text"
              className="input"
              value={functionData.endpoint || ""}
              onChange={(e) => update("endpoint", e.target.value)}
              placeholder="e.g., ENG"
            />
          </div>
        </div>
      )}

      {/* Knowledge panel — docs, skills, and memories the AI uses as context.
          Hidden for recipe-sourced steps (deterministic code; no AI input). */}
      {functionData.generationMeta?.source !== "recipe" && (
        <KnowledgePanel
          selectedDocIds={selectedDocs}
          onDocSelectionChange={(ids) => { setSelectedDocs(ids); onUpdate({ selectedDocIds: ids }); }}
          selectedSkillIds={selectedSkills}
          onSkillSelectionChange={(ids) => { setSelectedSkills(ids); onUpdate({ selectedSkillIds: ids }); }}
          autoAppliedSkills={(functionData.generationMeta?.appliedSkills || []).filter((s) => s.auto)}
          refreshKey={knowledgeRefresh}
        />
      )}

      {/* Inline context — for one-off notes not worth saving to the library */}
      <div className="form-group">
        <label className="label" style={{ fontSize: "11px" }}>
          Additional Context (optional)
          <Tooltip text="One-off notes for this specific step. For reusable documentation, add it to the library above instead." />
        </label>
        <textarea
          className="textarea context-textarea"
          rows={3}
          value={functionData.contextDocs || ""}
          onChange={(e) => update("contextDocs", e.target.value)}
          placeholder="Any extra context for this step (field IDs, specific requirements...)"
        />
      </div>

      {/* Reliability options — always visible */}
      <div className="reliability-section">
        <div className="reliability-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="reliability-title">Reliability</span>
        </div>
        <div className="reliability-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={functionData.includeBackoff || false}
              onChange={(e) => update("includeBackoff", e.target.checked)}
            />
            <span>
              Exponential backoff with jitter
              <Tooltip text="Retries failed API calls up to 3 times with increasing delays (1s, 2s, 4s) plus random jitter. Tradeoff: retries can add up to ~15 seconds of execution time. Forge post-functions have a 30-second hard limit — if you chain multiple steps with backoff enabled, later steps may time out. Best for: single-step functions, external APIs, or steps that must not fail silently. Skip for: multi-step chains where speed matters, or when the API is reliable." />
            </span>
          </label>
        </div>
      </div>

      {/* Variable name — for chaining steps */}
      {opType !== "log_function" && (
        <div className="form-group">
          <label className="label">
            Result Variable
            <Tooltip text="Name for this step's return value so later steps can reference it. For example, if you name it 'searchResults', step 2 can use ${searchResults} to access the data. Leave empty if no other step needs this result." />
          </label>
          <input
            type="text"
            className="input"
            value={functionData.variableName || ""}
            onChange={(e) => update("variableName", e.target.value)}
            placeholder={`result${index + 1}`}
          />
        </div>
      )}

      {/* Generate / code section */}
      {isGenerating ? (
        <AILoadingState type="codegen" />
      ) : (
        <div className="generate-row">
          <button
            className={`btn-generate ${hasCode ? "btn-generate-secondary" : ""}`}
            onClick={handleGenerate}
            disabled={!hasPrompt || stepBusy}
            /* F-152 — every control `stepBusy` disables says why. */
            title={stepBusy ? busyTitle : (!hasPrompt ? "Describe what this step does first" : undefined)}
          >
            {hasCode ? "Regenerate Code" : "Generate Code"}
          </button>
          {!hasPrompt && (
            <span className="generate-hint">Describe what this step does to enable code generation</span>
          )}
        </div>
      )}

      {/* F-129 — a tenant Stop-all cancelled the queued task. Neutral slate, not red:
          this is an operator action, not a defect, and the step is untouched. */}
      {cancelledNote && !isGenerating && !fixing && (
        <div className="async-cancelled-note anim-rise">
          <span className="acn-text">
            <strong>{cancelledNote === "fix" ? "Fix cancelled." : "Generation cancelled."}</strong>{" "}
            Cancelled — nothing was changed. Run it again when the stop is lifted.
          </span>
          <button className="acn-dismiss" onClick={() => setCancelledNote(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      {/* F-133 — generation failed while the step ALREADY had code. Nothing was replaced:
          the code, its provenance chips and its dry-run verdict are all still the author's.
          Solid red (this IS a failure, unlike a Stop-all cancel), white text, with Retry. */}
      {generationKept && !isGenerating && (
        <div className="async-error-note anim-rise">
          <span className="aen-text">
            <strong>Generation failed — your existing code was kept.</strong> {generationKept}
          </span>
          {/* F-141 / F-143 — Retry is a generate, so it obeys the ONE RULE (see `stepBusy`):
              offered only when nothing else is writing this step's code. */}
          {!stepBusy && <button className="aen-retry" onClick={handleGenerate}>Retry</button>}
          <button className="aen-dismiss" onClick={() => setGenerationKept(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      {/* Surfaced when AI generation failed and we filled in a generic template instead.
          User should know they're not looking at AI-tailored code. */}
      {generationFallback && !isGenerating && (
        <div
          className="anim-rise"
          style={{
            margin: "8px 0",
            padding: "8px 10px",
            background: "#d97706",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#ffffff",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <span style={{ flex: 1 }}>
            <strong>AI generation failed.</strong> A generic template was inserted — review and customize it before saving. Reason: {generationFallback}.
          </span>
          <button
            onClick={() => setGenerationFallback(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "#ffffff", fontSize: "16px", lineHeight: 1, padding: 0 }}
          >
            &times;
          </button>
        </div>
      )}

      {hasCode && (
        <div className="form-group">
          <div className="code-header">
            <label className="label" style={{ margin: 0 }}>
              Generated Code
              <Tooltip text={`This JavaScript runs ${executionWhen} with no AI cost for the code itself. You can edit it directly.`} />
            </label>
            <div className="code-header-actions">
              <button
                className="btn-api-ref"
                onClick={() => setShowApiRef(!showApiRef)}
              >
                {showApiRef ? "Hide" : "Show"} API Reference
              </button>
              <button
                className="btn-test-run"
                onClick={() => setShowTestPanel(!showTestPanel)}
              >
                {showTestPanel ? "Hide" : "Test Run"}
              </button>
            </div>
          </div>

          {/* API Reference panel — rendered from the shared sandbox API spec */}
          {showApiRef && <div className="anim-rise"><ApiReferencePanel /></div>}

          {/* Provenance — recipe origin, or what knowledge the AI used for this code */}
          {functionData.generationMeta?.source === "recipe" && (
            <div className="gen-meta-bar">
              <span className="gen-meta-label">FROM RECIPE</span>
              <span className="gen-meta-chip gmc-recipe">
                {functionData.generationMeta.recipeLabel || functionData.generationMeta.recipeKey}
              </span>
            </div>
          )}
          {functionData.generationMeta && functionData.generationMeta.source !== "recipe" && (
            <div className="gen-meta-bar">
              <span className="gen-meta-label">GENERATED WITH</span>
              {functionData.generationMeta.appliedDocs?.length > 0 && (
                <span className="gen-meta-chip gmc-docs">
                  {functionData.generationMeta.appliedDocs.length} doc{functionData.generationMeta.appliedDocs.length > 1 ? "s" : ""}
                </span>
              )}
              {(functionData.generationMeta.appliedSkills || []).map((s) => (
                <span key={s.id || s.name} className="gen-meta-chip gmc-skill">
                  {s.auto ? "✨ " : ""}{s.name}
                </span>
              ))}
              {functionData.generationMeta.appliedMemories > 0 && (
                <span className="gen-meta-chip gmc-mem">
                  {functionData.generationMeta.appliedMemories} memor{functionData.generationMeta.appliedMemories > 1 ? "ies" : "y"}
                </span>
              )}
            </div>
          )}

          {/* Context-limit truncation warnings */}
          {(functionData.generationMeta?.truncatedDocs || []).map((d, i) => (
            <div key={i} className="truncation-warning anim-rise">
              Doc {d.title} was truncated to fit the AI context limit - trim it in the library for best accuracy.
            </div>
          ))}

          {/* AI fix card — shown until verified/undone/dismissed/edited */}
          {fixResult && (
            <div className={`fix-result anim-rise${fixResult.verified ? " fix-verified" : ""}`}>
              <div className="fix-undo-bar">
                <strong>{fixResult.verified ? "AI fix applied & verified" : "AI fix applied"}</strong>
                <button
                  className="btn-add-doc"
                  onClick={handleUndoFix}
                  disabled={stepBusy}
                  title={stepBusy ? busyTitle : undefined}
                >
                  Undo
                </button>
                {/* F-156 — dismissing the fix CARD must not drop the memory badge: the memory is
                    already persisted and this badge is the only place to forget it. Same rule as
                    handleUndoFix. The `!fixResult && memorySaved` card below picks it up. */}
                <button className="test-dismiss" onClick={() => setFixResult(null)}>&times;</button>
              </div>
              {fixResult.explanation && (
                <p className="fix-explanation">{fixResult.explanation}</p>
              )}
              {/* F-158 — this card shows ONLY the memory THIS fix produced. Most repairs
                  (typos, ReferenceErrors) return no memoryCandidate at all, so an earlier
                  fix's badge rendered here read as "this fix learned that" — a claim about a
                  lesson drawn from different code. When it is not this fix's, the badge falls
                  through to the card below, which names the version that taught it. */}
              {memorySaved && memorySaved.fixToken === fixResult.token && renderMemoryBadge()}
              {memoryNotKept && <p className="memory-not-kept">{memoryNotKept}</p>}
            </div>
          )}

          {/* The memory persists even after the fix card is undone — keep the
              badge (and its veto) visible until vetoed or dismissed.
              F-151 — this card is also where a memory lands when the author typed during
              the save tail: the keystroke cleared the fix card, but the memory is real and
              must stay forgettable. `learnedFrom` lets it say which code version taught it
              rather than implying it describes what is on screen now. */}
          {memorySaved && (!fixResult || memorySaved.fixToken !== fixResult.token) && (
            <div className="fix-result memory-card anim-rise">
              {/* F-162 — this standalone card is NOT a fix outcome: it survives an undone,
                  dismissed or superseded fix, and it renders alongside a LIVE fix whose re-run
                  FAILED. Wearing `fix-verified` painted it green in that state and claimed a
                  verification nothing had earned (and the F-158 harness gate keyed on
                  `.fix-result.fix-verified` was satisfied by this always-green card, so the
                  journey would have passed with fix #2 never verified). Its own class, in the
                  memories hue, makes no claim about any fix. */}
              {/* F-157 — a fingerprint mismatch means "this is not the code the memory was
                  learned from". It does NOT mean the code was edited: Undo restores the
                  pre-fix code without a keystroke and lands here too, where the old copy
                  accused the author of a phantom edit. State only what the comparison
                  proves. (Not shown for a merged save — that badge makes no claim about
                  which code version taught the memory.) */}
              {!memorySaved.merged && memorySaved.learnedFrom && memorySaved.learnedFrom !== codeFingerprint(functionData.code || "") && (
                <p className="fix-explanation">Learned from the version of this code the fix repaired — the code shown is not that version.</p>
              )}
              {renderMemoryBadge()}
            </div>
          )}

          <CodeEditor
            value={functionData.code || ""}
            onChange={handleCodeChange}
            customFields={fields}
            priorVariables={priorVariables}
            rows={12}
          />

          {/* Test panel */}
          {showTestPanel && (
            <div className="test-panel anim-rise">
              <div className="test-panel-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span className="test-panel-title">Test Run</span>
                <span className="test-panel-badge">Dry run — writes are logged, not executed</span>
              </div>

              <div className="test-panel-target">
                <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>
                  Issue context (optional)
                  <Tooltip text="Optionally select an issue to set api.context.issueKey. JQL searches always run against real Jira data regardless. Writes (updateIssue, transitionIssue) are always safe — logged but never executed." />
                </label>
                <div className="test-target-row">
                  <IssuePicker
                    value={testTarget}
                    onChange={setTestTarget}
                  />
                  <button
                    className={`btn-run-test${testRunning ? " is-busy busy-solid" : ""}`}
                    onClick={() => runTest()}
                    disabled={stepBusy || !functionData.code?.trim()}
                    title={stepBusy ? busyTitle : (!functionData.code?.trim() ? "Generate or write the step's code first" : undefined)}
                  >
                    Run Test
                  </button>
                </div>
                <p className="hint" style={{ marginTop: "4px" }}>
                  Reads use real Jira data; writes are simulated. Jira's write permissions, transition screens and validators are not exercised.
                  {testTarget.trim()
                    ? ` Using ${testTarget} as api.context.issueKey.`
                    : " No current issue: api.context.issueKey is null. Select an issue to test issue-bound actions."
                  }
                </p>
              </div>

              {/* While the AI repairs the code, the loading state replaces the result */}
              {fixing && <AILoadingState type="fix" />}

              {/* The sandbox run can take ~22s — fill the void left by the
                  cleared previous result while it's in flight */}
              {!fixing && testRunning && <AILoadingState type="test" />}

              {/* Test result */}
              {!fixing && testResult && (
                <div className={`test-result anim-rise ${testResult.success ? "test-pass" : "test-fail"}`}>
                  <div className="test-result-header">
                    <span className={`test-badge ${testResult.success ? "test-badge-pass" : "test-badge-fail"}`}>
                      {testResult.success ? "PASS" : "FAIL"}
                    </span>
                    <span className="test-result-meta">
                      {testResult.issueKey ? `Live reads against ${testResult.issueKey} · writes staged` : "Live reads · no current issue · writes staged"}
                      {testResult.executionTimeMs ? ` — ${testResult.executionTimeMs}ms` : ""}
                    </span>
                    {!testResult.success && (
                      <button
                        className="btn-fix-ai"
                        onClick={handleFixWithAI}
                        disabled={stepBusy || fixAttempts >= 2}
                        /* F-152 — busy wins over the availability copy: this button used to
                           advertise itself as ready while it was disabled by the tail. */
                        title={stepBusy
                          ? busyTitle
                          : fixAttempts >= 2
                          ? "Fix attempts exhausted — edit the code manually or regenerate"
                          : "AI repairs the code and re-runs the test automatically"}
                      >
                        Fix with AI
                      </button>
                    )}
                    <button className="test-dismiss" onClick={() => setTestResult(null)}>&times;</button>
                  </div>
                  {testResult.fixError && (
                    <div className="test-logs">
                      <div className="test-log-line"><code>AI fix failed: {testResult.fixError}</code></div>
                    </div>
                  )}
                  {testResult.logs && testResult.logs.length > 0 && (
                    <div className="test-logs">
                      <div className="test-logs-title">Execution log:</div>
                      {testResult.logs.map((log, i) => (
                        <div key={i} className="test-log-line"><code>{log}</code></div>
                      ))}
                    </div>
                  )}
                  {testResult.changes && testResult.changes.length > 0 && (
                    <div className="test-logs">
                      <div className="ndr-chips">
                        <span className="ndr-count">{testResult.changes.length} write{testResult.changes.length !== 1 ? "s" : ""} staged</span>
                        {Object.entries(countChangeVerbs(testResult.changes)).map(([verb, n]) => (
                          <span key={verb} className="ndr-verb">{CHANGE_VERB_LABEL[verb] || verb}{n > 1 ? ` ×${n}` : ""}</span>
                        ))}
                      </div>
                      {testResult.changes.map((c, i) => (
                        <div key={i} className="test-log-line">
                          <code>{c.action}({c.key}{c.fields ? ", " + JSON.stringify(c.fields) : ""})</code>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Narrate: plain-English summary of what the dry-run would change */}
                  {testResult.success && testResult.changes && testResult.changes.length > 0 && (
                    <div className="ndr">
                      {narrateState === "done" && narration && (
                        <div className="ndr-card">
                          <div className="ndr-eyebrow">§ WHAT THIS WOULD DO</div>
                          <div className="ndr-summary">{narration.summary}</div>
                          {narration.verify && narration.verify.length > 0 && (
                            <ul className="ndr-verify">
                              {narration.verify.map((v, i) => <li key={i}>{v}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                      {narrateState === "degraded" && (
                        <div className="ndr-note">
                          {narrateReason === "lmstudio"
                            ? "Plain-English summaries aren't available with the self-hosted LM Studio provider — switch to a hosted provider in CogniRunner Settings."
                            : narrateReason === "timeout"
                            ? "The AI provider didn't respond in time — try again in a moment."
                            : "Couldn't summarize the changes right now — try again in a moment."}
                        </div>
                      )}
                      {narrateState === "error" && (
                        <div className="ndr-note">Couldn't summarize the changes.</div>
                      )}
                      {(narrateState === "idle" || narrateState === "loading" || narrateState === "error" ||
                        (narrateState === "degraded" && narrateReason === "timeout")) && (
                        <button
                          className={`ndr-btn${narrateState === "loading" ? " is-busy busy-solid" : ""}`}
                          onClick={runNarrate}
                          disabled={narrateState === "loading"}
                        >
                          ✦ Explain these changes in plain English
                        </button>
                      )}
                    </div>
                  )}
                  {testResult.success && (
                    <div className="test-result-actions">
                      <button
                        className="btn-save-skill"
                        onClick={() => setShowSkillEditor(true)}
                        title="Turn this working step into a reusable skill the AI applies to future generations"
                      >
                        Save as Skill
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Save-as-Skill editor — pre-filled from this step */}
          {showSkillEditor && (
            <div className="anim-rise">
              <SkillEditor
                initial={{
                  name: functionData.name || (functionData.operationPrompt || "").slice(0, 60),
                  category: SKILL_CATEGORY_BY_OPTYPE[opType] || "Other",
                  description: "",
                  descriptionPlaceholder: "When should the AI reuse this?",
                  instructions: functionData.operationPrompt || "",
                  examples: functionData.code || "",
                }}
                distillContext={{
                  prompt: functionData.operationPrompt || "",
                  code: functionData.code || "",
                  operationType: opType,
                  testLogs: testResult?.logs?.slice(-10),
                }}
                onSaved={() => setShowSkillEditor(false)}
                onCancel={() => setShowSkillEditor(false)}
              />
            </div>
          )}

          <p className="hint">
            This code runs as-is {executionWhen}. Edit directly if needed.
          </p>
        </div>
      )}
    </div>
  );
}
