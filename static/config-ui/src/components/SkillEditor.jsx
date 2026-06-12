/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Inline editor for a skill: name, category, one-line description (the AI's
 * routing hint), instructions, and code examples. Used by the Skills tab
 * ("+ New Skill") and by the post-fix "Save as Skill" flow, which can also
 * delegate writing to the AI via distillSkillFromStep.
 */

import React, { useState } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";
import CodeEditor from "./CodeEditor";

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
}) {
  const [name, setName] = useState(initial.name || "");
  const [category, setCategory] = useState(initial.category || "Other");
  const [description, setDescription] = useState(initial.description || "");
  const [instructions, setInstructions] = useState(initial.instructions || "");
  const [examples, setExamples] = useState(initial.examples || "");
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [error, setError] = useState(null);

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
      if (result.success) {
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
      {error && <div className="doc-error">{error}</div>}
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
        placeholder="What the AI should know when applying this skill — rules, pitfalls, formats..."
      />
      <label className="label" style={{ fontSize: "11px", marginBottom: 0 }}>
        Examples (code)
      </label>
      <CodeEditor value={examples} onChange={setExamples} />
      <div className="doc-add-actions">
        <span className="doc-size-hint">
          {distilling ? "AI is writing the skill..." : ""}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          {onCancel && (
            <button className="btn-add-doc" onClick={onCancel} disabled={saving || distilling}>
              Cancel
            </button>
          )}
          {distillContext && (
            <button
              className="btn-add-doc"
              onClick={handleDistill}
              disabled={saving || distilling}
              title="One AI call writes the description, instructions, and examples from this step's prompt, code, and test logs"
            >
              {distilling ? "Distilling..." : "Let AI write it"}
            </button>
          )}
          <button
            className="btn-save-doc"
            onClick={handleSave}
            disabled={saving || distilling || !name.trim() || !instructions.trim()}
          >
            {saving ? "Saving..." : "Save Skill"}
          </button>
        </div>
      </div>
    </div>
  );
}
