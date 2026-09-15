/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Inline editor for a skill: name, category, one-line description (the AI's
 * routing hint), instructions, and code examples. Used by the Skills tab
 * ("+ New Skill") and by the post-fix "Save as Skill" flow, which can also
 * delegate writing to the AI via distillSkillFromStep.
 */

import React, { useState } from "react";
import useDraft from "./useDraft";
import DraftResumeCard from "./DraftResumeCard";
import { DRAFT_FORM_IDS } from "../../../../src/shared/draft-state.js";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";
import CodeEditor from "./CodeEditor";
import AILoadingState from "./AILoadingState";
import { showToast } from "./toast";

export const SKILL_CATEGORIES = [
  "Jira API",
  "External / Webhooks",
  "Fields & Data",
  "ADF & Formatting",
  "Workflow Patterns",
  "Other",
];

// Polls getAsyncTaskResult for slow providers (LM Studio) that return
// { async: true, taskId } instead of an inline result. Mirrors
// FunctionBlock's pollAsyncResult: 40 tries * 3s = 120s.
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

export default function SkillEditor({
  initial = {},
  // Optional context for the AI-distill path ({ prompt, code, operationType, testLogs })
  distillContext = null,
  onSaved,
  onCancel,
  accountId = null,
}) {
  const [name, setName] = useState(initial.name || "");
  const [category, setCategory] = useState(initial.category || "Other");
  const [description, setDescription] = useState(initial.description || "");
  const [instructions, setInstructions] = useState(initial.instructions || "");
  const [examples, setExamples] = useState(initial.examples || "");
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [error, setError] = useState(null);
  // F-129 — set when the queued distill was cancelled by a tenant Stop-all. Neutral slate
  // note, NOT an error: the form keeps its pre-fill so the user can just retry.
  const [cancelled, setCancelled] = useState(false);

  /* -- F-990 - A HALF-WRITTEN SKILL ---------------------------------------------------
     Instructions are the long field here, often several paragraphs, and losing them to a
     reload is the owner's complaint in its purest form. A skill has no credentials and no
     async state of its own (the distill's in-flight flags are separate useState and are
     not in this object), so the whole form goes in.

     ONLY FOR A NEW SKILL: an EDIT has a saved record behind it, so nothing is lost by a
     reload, and a week-old draft laid over a skill someone else has since changed would
     revert their edit without saying so.

     THE `accountId` PROP IS OPTIONAL, AND IN config-ui IT IS ALWAYS NULL. This file is a
     byte-identical copy shared with the admin panel, and only the admin panel knows who
     is looking: `checkIsAdmin` returns an accountId and config-ui never asks. `draftKey`
     refuses a null account (a draft keyed on "null" would be shared by every admin on the
     machine), so in the rule editor this hook reads nothing and writes nothing and the
     card never appears. That is a deliberate inertness, not a bug: the two copies stay
     byte-identical and the behaviour differs only because one caller can answer the
     question and the other cannot. Passing the account down through config-ui is a
     separate change.

     Byte-identical copy in static/admin-panel/src/components/SkillEditor.jsx. */
  const skillDraftState = { name, category, description, instructions, examples };
  const skillDraft = useDraft(DRAFT_FORM_IDS.SKILL_EDITOR, accountId, skillDraftState, !initial.id);
  const restoreSkillDraft = () => {
    const d = skillDraft.restore();
    if (!d) return;
    if (typeof d.name === "string") setName(d.name);
    if (typeof d.category === "string") setCategory(d.category);
    if (typeof d.description === "string") setDescription(d.description);
    if (typeof d.instructions === "string") setInstructions(d.instructions);
    if (typeof d.examples === "string") setExamples(d.examples);
  };

  const handleSave = async () => {
    if (!name.trim() || !instructions.trim()) {
      setError("Name and instructions are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await invoke("saveSkill", {
        ...(initial.id ? { id: initial.id } : {}),
        name: name.trim(),
        category,
        description: description.trim(),
        instructions,
        examples,
      });
      if (result.success) {
        skillDraft.clear();   // F-990 - the skill exists now
        showToast("Skill saved");
        onSaved && onSaved(result.id);
      } else {
        setError(result.error || "Failed to save skill");
      }
    } catch (e) {
      setError("Failed to save: " + e.message);
    }
    setSaving(false);
  };

  const handleDistill = async () => {
    if (!distillContext) return;
    setDistilling(true);
    setError(null);
    setCancelled(false);
    try {
      let result = await invoke("distillSkillFromStep", {
        name: name.trim() || undefined,
        prompt: distillContext.prompt,
        code: distillContext.code,
        operationType: distillContext.operationType,
        testLogs: distillContext.testLogs,
      });
      // Slow self-hosted providers (LM Studio) queue the task instead.
      if (result.async && result.taskId) {
        result = await pollAsyncResult(result.taskId);
      }
      // F-129 — a tenant Stop-all cancelled the queued distill. Nothing was written, so
      // keep the form open on its pre-fill and say so neutrally instead of raising a
      // red "AI could not distill the skill", which reads as an AI defect.
      if (result && result.cancelled) { setCancelled(true); setDistilling(false); return; }
      if (result.success) {
        // The editor closes immediately on success — confirm WHAT was saved.
        const savedName = result.skill?.name || name.trim() || "new skill";
        showToast("Skill saved: " + savedName);
        onSaved && onSaved(result.id);
      } else {
        setError(result.error || "AI could not distill the skill");
      }
    } catch (e) {
      setError("Distill failed: " + e.message);
    }
    setDistilling(false);
  };

  return (
    <div className="doc-add-form">
      {skillDraft.hasDraft && (
        <DraftResumeCard
          savedAt={skillDraft.savedAt}
          what="an unfinished skill"
          onContinue={restoreSkillDraft}
          onDiscard={skillDraft.discard}
        />
      )}
      {error && <div className="doc-error">{error}</div>}
      {/* F-129 — operator Stop-all, not a distill failure. Neutral slate. */}
      {cancelled && (
        <div className="async-cancelled-note anim-rise">
          <span className="acn-text">
            <strong>Distill cancelled.</strong> Cancelled, nothing was changed. Your draft is untouched; try again when the stop is lifted.
          </span>
          <button className="acn-dismiss" onClick={() => setCancelled(false)} aria-label="Dismiss">&times;</button>
        </div>
      )}
      <input
        type="text"
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Skill name (e.g., 'Slack webhook notifications')"
      />
      <div className="doc-add-row">
        <div className="doc-category-select">
          <CustomSelect
            value={category}
            onChange={setCategory}
            options={SKILL_CATEGORIES.map((c) => ({ value: c, label: c }))}
            placeholder="Category..."
          />
        </div>
      </div>
      <label className="label" style={{ fontSize: "11px", marginBottom: 0 }}>
        Description
        <Tooltip text="One sentence the AI uses to decide when this skill applies" />
      </label>
      <textarea
        className="textarea"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={initial.descriptionPlaceholder || "When should the AI reuse this?"}
      />
      <label className="label" style={{ fontSize: "11px", marginBottom: 0 }}>
        Instructions
      </label>
      <textarea
        className="textarea"
        rows={6}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="What the AI should know when applying this skill, rules, pitfalls, formats..."
      />
      <label className="label" style={{ fontSize: "11px", marginBottom: 0 }}>
        Examples (code)
      </label>
      <CodeEditor value={examples} onChange={setExamples} />
      {/* The distill round-trip can take up to 120s on slow self-hosted
          providers — show a real loading state, not just a busy button. */}
      {distilling && <AILoadingState type="codegen" statusOverride="AI is writing the skill…" />}
      <div className="doc-add-actions">
        <span className="doc-size-hint" />
        <div style={{ display: "flex", gap: "8px" }}>
          {onCancel && (
            <button className="btn-add-doc" onClick={onCancel} disabled={saving || distilling}>
              Cancel
            </button>
          )}
          {distillContext && (
            <button
              className={`btn-add-doc${distilling ? " is-busy" : ""}`}
              onClick={handleDistill}
              disabled={saving || distilling}
              title="One AI call writes the description, instructions, and examples from this step's prompt, code, and test logs"
            >
              Let AI write it
            </button>
          )}
          <button
            className={`btn-save-doc${saving ? " is-busy busy-solid" : ""}`}
            onClick={handleSave}
            disabled={saving || distilling || !name.trim() || !instructions.trim()}
          >
            Save Skill
          </button>
        </div>
      </div>
    </div>
  );
}
