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
  // Fix-with-AI loop state
  const [fixing, setFixing] = useState(false);
  const [fixAttempts, setFixAttempts] = useState(0);
  const [fixResult, setFixResult] = useState(null); // { explanation, verified, preFixCode, preFixMeta }
  const [memorySaved, setMemorySaved] = useState(null); // { id, content }
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

  const update = (field, value) => onUpdate({ [field]: value });

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

  const handleGenerate = async () => {
    genTokenRef.current += 1;
    const token = genTokenRef.current;
    setIsGenerating(true);
    setGenerationFallback(null);
    // A verdict earned by the OLD code must not stand against the new code.
    setTestResult(null);
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
      if (result && result.success && result.code) {
        onUpdate({ code: result.code, generationMeta: compactMeta(result.meta) });
      } else {
        // Fallback to local template if AI fails. Surface a notice so the user knows
        // they're looking at a generic template, not AI-tailored code.
        const code = generateCode(
          functionData.operationType,
          functionData.operationPrompt,
          functionData.endpoint,
          functionData.method,
          functionData.includeBackoff,
        );
        onUpdate({ code, generationMeta: null });
        setGenerationFallback(result?.error || "AI generation failed");
        console.warn("AI generation failed, used template:", result?.error);
      }
    } catch (e) {
      if (genTokenRef.current !== token) return;
      // Fallback to local template on network error
      const code = generateCode(
        functionData.operationType,
        functionData.operationPrompt,
        functionData.endpoint,
        functionData.method,
        functionData.includeBackoff,
      );
      onUpdate({ code, generationMeta: null });
      setGenerationFallback(e.message || "Network error");
      console.warn("AI generation error, used template:", e.message);
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
        mode: testResult.mode || "mock",
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
    if (fixing || fixAttempts >= 2) return;
    genTokenRef.current += 1;
    const token = genTokenRef.current;
    const failedResult = testResult;
    setFixAttempts((n) => n + 1);
    setFixing(true);
    setMemorySaved(null);
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

      if (result && result.success && result.code) {
        const preFixCode = functionData.code;
        const preFixMeta = functionData.generationMeta || null;
        onUpdate({ code: result.code, generationMeta: compactMeta(result.meta) });
        setTestResult(null);
        setFixResult({
          explanation: result.explanation || "",
          verified: false,
          preFixCode,
          preFixMeta,
        });
        setFixing(false);

        // Auto re-run against the fixed code
        const rerun = await runTest(result.code);
        if (genTokenRef.current !== token) return;
        if (rerun && rerun.success) {
          setFixResult((prev) => (prev ? { ...prev, verified: true } : prev));
          // Persist the fix-derived memory only once the fix is verified
          if (result.memoryCandidate && result.memoryCandidate.content) {
            try {
              const memRes = await invoke("addMemory", {
                content: result.memoryCandidate.content,
                projectKey: result.memoryCandidate.projectScoped ? deriveProjectKey() : null,
                source: "fix",
              });
              if (genTokenRef.current !== token) return;
              if (memRes.success) {
                setMemorySaved({ id: memRes.id, content: result.memoryCandidate.content });
                setKnowledgeRefresh((n) => n + 1);
                showToast("Fix verified — memory saved");
              }
            } catch (e) {
              console.warn("Memory save failed:", e.message);
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

  // Manual edits dismiss the fix card and reset the fix-attempt guard.
  // (External value updates don't trigger CodeMirror's onChange, so applying
  // an AI fix doesn't immediately dismiss its own card.)
  const handleCodeChange = (v) => {
    // A manual edit takes ownership of the code — invalidate any in-flight
    // generate/fix so its eventual result is discarded.
    genTokenRef.current += 1;
    update("code", v);
    if (fixResult) setFixResult(null);
    if (fixAttempts !== 0) setFixAttempts(0);
    if (generationFallback) setGenerationFallback(null);
    // The verdict belongs to the pre-edit code — clear it.
    if (testResult) setTestResult(null);
    if (narrateState !== "idle") resetNarrate();
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
        <button type="button" className="recipe-bar-toggle" onClick={() => setShowRecipes((v) => !v)}>
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
                    disabled={!supported || missing.length > 0}
                    onClick={() => {
                      const params = {};
                      for (const pp of recipe.params) params[pp.name] = recipeParams[pp.name] ?? pp.default ?? "";
                      onUpdate({
                        code: recipe.build(params),
                        operationType: recipe.operationType || functionData.operationType,
                        generationMeta: { source: "recipe", recipeKey: recipe.key, recipeLabel: recipe.label, recipeParams: params },
                      });
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
          <Tooltip text="Describe the action in plain language. AI will generate JavaScript code that runs automatically on every transition — no AI cost at runtime." />
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
            disabled={!hasPrompt || fixing || testRunning}
          >
            {hasCode ? "Regenerate Code" : "Generate Code"}
          </button>
          {!hasPrompt && (
            <span className="generate-hint">Describe what this step does to enable code generation</span>
          )}
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
              <Tooltip text="This JavaScript runs on every workflow transition with no AI cost. You can edit it directly." />
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
                <button className="btn-add-doc" onClick={handleUndoFix}>Undo</button>
                <button className="test-dismiss" onClick={() => { setFixResult(null); setMemorySaved(null); }}>&times;</button>
              </div>
              {fixResult.explanation && (
                <p className="fix-explanation">{fixResult.explanation}</p>
              )}
              {memorySaved && (
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
              )}
            </div>
          )}

          {/* The memory persists even after the fix card is undone — keep the
              badge (and its veto) visible until vetoed or dismissed. */}
          {!fixResult && memorySaved && (
            <div className="fix-result fix-verified anim-rise">
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
                    disabled={testRunning || fixing || isGenerating || !functionData.code?.trim()}
                  >
                    Run Test
                  </button>
                </div>
                <p className="hint" style={{ marginTop: "4px" }}>
                  JQL searches always run against real Jira data. Writes are always safe (dry run).
                  {testTarget.trim()
                    ? ` Using ${testTarget} as api.context.issueKey.`
                    : " api.context.issueKey will be MOCK-1 — select an issue to set a real one."
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
                      {testResult.mode === "live" ? `Tested against ${testResult.issueKey}` : "Mock data"}
                      {testResult.executionTimeMs ? ` — ${testResult.executionTimeMs}ms` : ""}
                    </span>
                    {!testResult.success && (
                      <button
                        className="btn-fix-ai"
                        onClick={handleFixWithAI}
                        disabled={fixing || isGenerating || testRunning || fixAttempts >= 2}
                        title={fixAttempts >= 2
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
            This code runs as-is on every transition. Edit directly if needed.
          </p>
        </div>
      )}
    </div>
  );
}
