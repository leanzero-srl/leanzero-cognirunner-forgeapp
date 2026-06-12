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
 * Collapsible Knowledge panel grouping the three AI context sources for a
 * post-function step: Documentation (library docs), Skills (reusable how-to
 * knowledge), and Memories (instance facts injected into every generation).
 * Collapsed by default to keep the describe -> generate -> test flow clean.
 */

import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";
import DocRepository from "./DocRepository";
import SkillsTab from "./SkillsTab";
import MemoriesTab from "./MemoriesTab";

export default function KnowledgePanel({
  selectedDocIds,
  onDocSelectionChange,
  selectedSkillIds,
  onSkillSelectionChange,
  autoAppliedSkills = [],
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("docs");
  const [counts, setCounts] = useState(null); // { docs, skills, memories } | null

  // Loaded on mount AND re-invoked by the tabs after any successful
  // add/delete/save so the summary counts never go stale.
  const loadCounts = useCallback(() => {
    invoke("getKnowledgeCounts")
      .then((result) => {
        if (result && result.success) {
          setCounts({ docs: result.docs, skills: result.skills, memories: result.memories });
        }
      })
      .catch(() => { /* fail-soft to em-dashes */ });
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const memCount = counts ? counts.memories : "—";

  return (
    <div className="knowledge-panel">
      <div className="knowledge-summary" onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
        <span className="knowledge-title">KNOWLEDGE</span>
        <span className="knowledge-summary-counts">
          <span className="kc-docs">{selectedDocIds.length} docs</span>
          {", "}
          <span className="kc-skills">{selectedSkillIds.length} skills</span>
          {" selected · "}
          <span className="kc-mem">{memCount} memories</span>
          {" active"}
        </span>
        {autoAppliedSkills.length > 0 && (
          <span className="knowledge-auto-chips">
            {autoAppliedSkills.map((s) => (
              <span key={s.id || s.name} className="skill-auto-chip">
                ✨ AI attached: {s.name}
              </span>
            ))}
          </span>
        )}
        <span className={`knowledge-chevron${open ? " open" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </div>

      {open && (
        <>
          <div className="knowledge-tabs">
            <button
              className={`knowledge-tab knowledge-tab-docs${activeTab === "docs" ? " active" : ""}`}
              onClick={() => setActiveTab("docs")}
            >
              Documentation
            </button>
            <button
              className={`knowledge-tab knowledge-tab-skills${activeTab === "skills" ? " active" : ""}`}
              onClick={() => setActiveTab("skills")}
            >
              Skills
            </button>
            <button
              className={`knowledge-tab knowledge-tab-memories${activeTab === "memories" ? " active" : ""}`}
              onClick={() => setActiveTab("memories")}
            >
              Memories
            </button>
          </div>

          {activeTab === "docs" && (
            <DocRepository
              embedded
              selectedDocs={selectedDocIds}
              onSelectionChange={onDocSelectionChange}
              onChanged={loadCounts}
            />
          )}
          {activeTab === "skills" && (
            <SkillsTab
              selectedSkills={selectedSkillIds}
              onSkillSelectionChange={onSkillSelectionChange}
              onChanged={loadCounts}
            />
          )}
          {activeTab === "memories" && <MemoriesTab onChanged={loadCounts} />}
        </>
      )}
    </div>
  );
}
