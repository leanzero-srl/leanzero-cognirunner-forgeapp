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
 * Skills admin tab. Full management of the skill repository: create via the
 * shared SkillEditor, view/edit content, enable/disable (builtins disable via
 * deleteSkill, which flips enabled:false), and hard-delete custom skills.
 * The config-ui Skills tab shows a compact pick-list; this tab is the
 * complete table, including disabled rows.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import SkillEditor from "./SkillEditor";

const CATEGORY_CLASS = {
  "Jira API": "skill-cat-jira",
  "External / Webhooks": "skill-cat-external",
  "Fields & Data": "skill-cat-fields",
  "ADF & Formatting": "skill-cat-adf",
  "Workflow Patterns": "skill-cat-workflow",
  "Other": "skill-cat-other",
};

export default function SkillsAdminTab({ invoke, isAdmin }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedContent, setExpandedContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingInitial, setEditingInitial] = useState(null);
  const [loadingEditId, setLoadingEditId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [error, setError] = useState(null);
  // Mirrors expandedId for in-flight getSkillContent calls — a response for
  // a skill the user has since collapsed/switched away from is discarded.
  const expandedIdRef = useRef(null);

  const loadSkills = useCallback(async () => {
    try {
      const result = await invoke("getSkills");
      if (result.success) setSkills(result.skills || []);
    } catch (e) {
      console.error("Failed to load skills:", e);
    }
    setLoading(false);
  }, [invoke]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleView = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      expandedIdRef.current = null;
      return;
    }
    setExpandedId(id);
    expandedIdRef.current = id;
    setExpandedContent(null);
    setLoadingContent(true);
    try {
      const result = await invoke("getSkillContent", { id });
      // Stale response — the user expanded another skill (or collapsed this
      // one) while the fetch was in flight. The newer call owns the state.
      if (expandedIdRef.current !== id) return;
      if (result.success) setExpandedContent(result.skill);
      else setExpandedContent({ description: result.error || "Failed to load skill content" });
    } catch (e) {
      if (expandedIdRef.current !== id) return;
      setExpandedContent({ description: "Failed to load skill content" });
    }
    setLoadingContent(false);
  };

  const handleEdit = async (skill) => {
    if (loadingEditId) return;
    setLoadingEditId(skill.id);
    setError(null);
    try {
      const result = await invoke("getSkillContent", { id: skill.id });
      if (result.success) {
        setShowAdd(false);
        setExpandedId(null);
        expandedIdRef.current = null;
        setEditingInitial(result.skill);
        setEditingId(skill.id);
      } else {
        setError(result.error || "Failed to load skill content.");
      }
    } catch (e) {
      setError(e.message);
    }
    setLoadingEditId(null);
  };

  const handleToggleEnabled = async (skill) => {
    if (togglingId) return;
    const enable = skill.enabled === false;
    setTogglingId(skill.id);
    setError(null);
    try {
      let result;
      if (skill.builtin && !enable) {
        // deleteSkill IS the builtin disable path — it flips enabled:false
        // instead of deleting, so a reseed cannot resurrect the row.
        result = await invoke("deleteSkill", { id: skill.id });
      } else {
        // Enable (any row) and non-builtin disable go through saveSkill with
        // the full record, so name/instructions pass validation and the
        // tags/operationTypes the editor never sends are preserved.
        const content = await invoke("getSkillContent", { id: skill.id });
        if (!content.success) {
          setError(content.error || "Failed to load skill content.");
          setTogglingId(null);
          return;
        }
        const full = content.skill;
        result = await invoke("saveSkill", {
          id: full.id,
          name: full.name,
          category: full.category,
          description: full.description,
          tags: full.tags,
          operationTypes: full.operationTypes,
          instructions: full.instructions,
          examples: full.examples,
          enabled: enable,
        });
      }
      if (result.success) await loadSkills();
      else setError(result.error || (enable ? "Failed to enable skill." : "Failed to disable skill."));
    } catch (e) {
      setError(e.message);
    }
    setTogglingId(null);
  };

  const handleDelete = async (skill) => {
    if (!window.confirm("Delete this skill permanently? This cannot be undone.")) return;
    setError(null);
    try {
      const result = await invoke("deleteSkill", { id: skill.id });
      if (result.success === false) {
        setError(result.error || "Failed to delete skill.");
      } else {
        await loadSkills();
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const byNewest = (a, b) =>
    new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  const enabledRows = skills.filter((s) => s.enabled !== false).sort(byNewest);
  const disabledRows = skills.filter((s) => s.enabled === false).sort(byNewest);
  const colCount = 5;

  const renderRow = (skill) => {
    const isDisabled = skill.enabled === false;
    const builtinLocked = skill.builtin === true && !isAdmin;
    const isExpanded = expandedId === skill.id;
    const isEditing = editingId === skill.id;
    return (
      <React.Fragment key={skill.id}>
        <tr className={isDisabled ? "skills-admin-disabled-row" : undefined}>
          <td style={{ wordBreak: "break-word" }}>
            <span style={{ fontWeight: 600 }}>{skill.name}</span>
            {skill.builtin === true && (
              <span className="builtin-badge" style={{ marginLeft: "6px" }}>BUILT-IN</span>
            )}
          </td>
          <td>
            <span className={`skill-cat-badge ${CATEGORY_CLASS[skill.category] || "skill-cat-other"}`}>
              {skill.category || "Other"}
            </span>
          </td>
          <td>
            <span className="skills-admin-desc" title={skill.description || undefined}>
              {skill.description || "—"}
            </span>
          </td>
          <td>
            <span className="timestamp">
              {skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString() : "—"}
            </span>
          </td>
          <td>
            <div className="row-actions">
              <button className="btn-small" onClick={() => handleView(skill.id)}>
                {isExpanded ? "Hide" : "View"}
              </button>
              <button
                className="btn-small"
                onClick={() => handleEdit(skill)}
                disabled={builtinLocked || loadingEditId === skill.id}
                title={builtinLocked ? "Only admins can edit built-in skills" : undefined}
              >
                {loadingEditId === skill.id ? "Loading..." : "Edit"}
              </button>
              <button
                className="btn-small"
                onClick={() => handleToggleEnabled(skill)}
                disabled={builtinLocked || togglingId === skill.id}
                title={builtinLocked
                  ? `Only admins can ${isDisabled ? "enable" : "disable"} built-in skills`
                  : undefined}
              >
                {togglingId === skill.id ? "Saving..." : isDisabled ? "Enable" : "Disable"}
              </button>
              {skill.builtin !== true && (
                <button className="btn-small btn-danger" onClick={() => handleDelete(skill)}>
                  Delete
                </button>
              )}
            </div>
          </td>
        </tr>
        {isExpanded && !isEditing && (
          <tr>
            <td colSpan={colCount} style={{ padding: 0 }}>
              <div className="doc-preview" style={{ borderTop: "none", padding: "10px 14px" }}>
                {loadingContent ? "Loading..." : expandedContent ? (
                  <>
                    {expandedContent.description && (
                      <p style={{ margin: "0 0 6px", fontSize: "12px" }}>{expandedContent.description}</p>
                    )}
                    {expandedContent.instructions && (
                      <pre className="doc-preview-content">{expandedContent.instructions}</pre>
                    )}
                    {expandedContent.examples && (
                      <pre className="doc-preview-content" style={{ marginTop: "6px" }}>{expandedContent.examples}</pre>
                    )}
                  </>
                ) : "No content"}
              </div>
            </td>
          </tr>
        )}
        {isEditing && (
          <tr>
            <td colSpan={colCount} style={{ padding: 0 }}>
              <SkillEditor
                initial={editingInitial || {}}
                onSaved={async () => {
                  setEditingId(null);
                  setEditingInitial(null);
                  await loadSkills();
                }}
                onCancel={() => { setEditingId(null); setEditingInitial(null); }}
              />
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="skills-admin-tab">
      <div className="section-header">
        <span className="section-title">Skills</span>
        <button className="btn-add-skill" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ New Skill"}
        </button>
      </div>
      <div className="skills-admin-explainer">
        Skills are reusable instruction packs that teach the AI code generator domain-specific
        patterns. They are attached to post-function steps manually or auto-matched from the
        step description.
      </div>

      {error && (
        <div style={{ color: "var(--error-color)", fontSize: "12px", fontWeight: 600, marginBottom: "10px" }}>
          {error}
        </div>
      )}

      {showAdd && (
        <div className="card" style={{ marginBottom: "14px" }}>
          <SkillEditor
            onSaved={async () => {
              setShowAdd(false);
              await loadSkills();
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      <div className="card">
        {loading ? (
          <div style={{ padding: "14px" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", gap: "16px", alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border-color)" : "none" }}>
                <div className="sk sk-text" style={{ width: 180, height: 13 }} />
                <div className="sk sk-text" style={{ width: 70, height: 16, borderRadius: 10 }} />
                <div className="sk sk-text" style={{ width: 220, height: 11 }} />
                <div className="sk sk-text" style={{ width: 60, height: 11 }} />
              </div>
            ))}
          </div>
        ) : skills.length === 0 ? (
          <div className="empty-state">
            <div className="skills-admin-empty-title">No skills yet</div>
            Create one here, or save a passing post-function step as a skill from the workflow editor.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Description</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {enabledRows.map(renderRow)}
              {disabledRows.length > 0 && (
                <tr className="skills-admin-divider">
                  <td colSpan={colCount}>
                    <span className="skills-admin-disabled-badge">Disabled</span>
                  </td>
                </tr>
              )}
              {disabledRows.map(renderRow)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
