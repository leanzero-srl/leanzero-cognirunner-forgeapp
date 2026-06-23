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
 * Skills tab of the Knowledge panel. Mirrors DocRepository's interaction
 * pattern against the skill repository resolvers: checkbox-select rows
 * (max 4 per step), preview expand, delete/disable, inline "+ New Skill".
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@forge/bridge";
import SkillEditor from "./SkillEditor";
import { showToast } from "./toast";

const MAX_SELECTED_SKILLS = 4;

const CATEGORY_CLASS = {
  "Jira API": "skill-cat-jira",
  "External / Webhooks": "skill-cat-external",
  "Fields & Data": "skill-cat-fields",
  "ADF & Formatting": "skill-cat-adf",
  "Workflow Patterns": "skill-cat-workflow",
  "Other": "skill-cat-other",
};

export default function SkillsTab({ selectedSkills, onSkillSelectionChange, onChanged = null }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // mount-load failure — render retry, not "no skills"
  const [refreshing, setRefreshing] = useState(false); // non-initial reload — veil over the visible list
  const [showAdd, setShowAdd] = useState(false);
  const [expandedSkill, setExpandedSkill] = useState(null);
  const [expandedContent, setExpandedContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [deletingId, setDeletingId] = useState(null); // row whose delete is in flight
  const [newSkillId, setNewSkillId] = useState(null); // freshly saved row — flashes green
  // Mirrors expandedSkill for in-flight getSkillContent calls — a response for
  // a skill the user has since collapsed/switched away from is discarded.
  const expandedIdRef = useRef(null);

  const loadSkills = useCallback(async () => {
    try {
      const result = await invoke("getSkills");
      if (result.success) {
        setSkills(result.skills || []);
        setLoadError(null);
      } else {
        setLoadError(result.error || "Failed to load skills.");
      }
    } catch (e) {
      console.error("Failed to load skills:", e);
      setLoadError(e.message || "Failed to load skills.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    loadSkills();
  };

  // Reload the list while keeping the current rows visible under a veil.
  const refreshSkills = async () => {
    setRefreshing(true);
    await loadSkills();
    setRefreshing(false);
  };

  // Disabled builtins come back in the index but must not render.
  const visibleSkills = skills.filter((s) => s.enabled !== false);

  const toggleSkillSelection = (id) => {
    if (selectedSkills.includes(id)) {
      onSkillSelectionChange(selectedSkills.filter((s) => s !== id));
    } else {
      if (selectedSkills.length >= MAX_SELECTED_SKILLS) return;
      onSkillSelectionChange([...selectedSkills, id]);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId) return; // one delete at a time — no double-fires
    setDeletingId(id);
    try {
      const result = await invoke("deleteSkill", { id });
      if (result.success) {
        if (selectedSkills.includes(id)) {
          onSkillSelectionChange(selectedSkills.filter((s) => s !== id));
        }
        await refreshSkills();
        if (onChanged) onChanged();
      } else {
        showToast(result.error || "Failed to delete skill.", "error");
      }
    } catch (e) {
      console.error("Failed to delete skill:", e);
      showToast("Failed to delete skill: " + e.message, "error");
    }
    setDeletingId(null);
  };

  const handleExpand = async (id) => {
    if (expandedSkill === id) {
      setExpandedSkill(null);
      expandedIdRef.current = null;
      return;
    }
    setExpandedSkill(id);
    expandedIdRef.current = id;
    setExpandedContent(null);
    setLoadingContent(true);
    try {
      const result = await invoke("getSkillContent", { id });
      // Stale response — the user expanded another skill (or collapsed this
      // one) while the fetch was in flight. The newer call owns the state.
      if (expandedIdRef.current !== id) return;
      if (result.success) setExpandedContent(result.skill);
    } catch (e) {
      if (expandedIdRef.current !== id) return;
      setExpandedContent({ description: "Failed to load skill content" });
    }
    setLoadingContent(false);
  };

  const atMax = selectedSkills.length >= MAX_SELECTED_SKILLS;

  return (
    <div className="doc-repo-embedded">
      <div className="doc-add-actions" style={{ padding: "8px 12px 0" }}>
        <span className="doc-size-hint">
          Reusable how-to knowledge the AI applies when generating code
        </span>
        <button className="btn-add-doc" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ New Skill"}
        </button>
      </div>

      {showAdd && (
        <div className="anim-rise">
          <SkillEditor
            onSaved={async (id) => {
              setShowAdd(false);
              await refreshSkills();
              if (id) setNewSkillId(id);
              if (onChanged) onChanged();
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {loading ? (
        <div style={{ padding: "12px" }}>
          <div className="sk sk-text" style={{ width: "60%", height: 12, marginBottom: 8 }} />
          <div className="sk sk-text" style={{ width: "40%", height: 12 }} />
        </div>
      ) : loadError ? (
        <div className="load-error" style={{ margin: "10px 12px" }}>
          <span>Couldn&apos;t load skills.</span>
          <button className="btn-retry" onClick={retryLoad}>Retry</button>
        </div>
      ) : visibleSkills.length === 0 ? (
        <div className="doc-empty">
          No skills yet. Save a tested step as a skill, or add one manually.
        </div>
      ) : (
        <div className="veil-host">
        {refreshing && (
          <div className="veil"><span className="spin-ring" /><span className="veil-label">Refreshing…</span></div>
        )}
        <div className="skill-list stagger">
          {visibleSkills.map((skill) => {
            const isSelected = selectedSkills.includes(skill.id);
            const isExpanded = expandedSkill === skill.id;
            const checkboxDisabled = !isSelected && atMax;
            return (
              <div key={skill.id} className={`skill-item ${isSelected ? "skill-selected" : ""}${skill.id === newSkillId ? " flash-success" : ""}`}>
                <div className="doc-item-row">
                  <label className="doc-checkbox" title={checkboxDisabled ? `Maximum ${MAX_SELECTED_SKILLS} skills per step` : undefined}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={checkboxDisabled}
                      onChange={() => toggleSkillSelection(skill.id)}
                    />
                  </label>
                  <div className="doc-item-info" onClick={() => toggleSkillSelection(skill.id)}>
                    <span className="skill-item-title">
                      {skill.name}
                      <span className={`skill-cat-badge ${CATEGORY_CLASS[skill.category] || "skill-cat-other"}`}>
                        {skill.category}
                      </span>
                      {skill.builtin && <span className="builtin-badge">BUILT-IN</span>}
                    </span>
                    {skill.description && (
                      <span className="skill-when">{skill.description}</span>
                    )}
                  </div>
                  <div className="doc-item-actions">
                    <button
                      className="doc-btn-preview"
                      onClick={() => handleExpand(skill.id)}
                      title="Preview"
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                    <button
                      className={`doc-btn-delete${deletingId === skill.id ? " is-busy" : ""}`}
                      onClick={() => handleDelete(skill.id)}
                      disabled={deletingId === skill.id}
                      title={skill.builtin ? "Disable" : "Delete"}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="doc-preview">
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
                )}
              </div>
            );
          })}
        </div>
        </div>
      )}

      {atMax && (
        <div className="doc-selection-info">
          Maximum of {MAX_SELECTED_SKILLS} skills per step — deselect one to pick another.
        </div>
      )}
    </div>
  );
}
