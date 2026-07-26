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
  // Bump to force a counts refresh from the parent (e.g. after a flow outside
  // the panel persisted a memory).
  refreshKey = 0,
}) {
  const [open, setOpen] = useState(false);
  // The body mounts on FIRST open and then stays mounted (collapsed via the
  // .reveal grid) so reopening never refetches or loses child state.
  const [openedOnce, setOpenedOnce] = useState(false);
  // True once the expand transition has finished — lifts the reveal clip so
  // dropdowns can overflow the panel; reset the moment a collapse starts.
  const [revealSettled, setRevealSettled] = useState(false);
  useEffect(() => {
    if (!open) setRevealSettled(false);
  }, [open]);
  const [activeTab, setActiveTab] = useState("docs");
  // Tab panels also mount on first activation and stay mounted (display:none
  // when inactive) so revisiting a tab doesn't refetch its list.
  const [activatedTabs, setActivatedTabs] = useState({ docs: true });
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

  useEffect(() => { loadCounts(); }, [loadCounts, refreshKey]);

  const toggleOpen = () => {
    setOpen((prev) => !prev);
    if (!openedOnce) setOpenedOnce(true);
  };

  const selectTab = (tab) => {
    setActiveTab(tab);
    setActivatedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
  };

  // Inactive panels stay mounted but hidden; the active one fades in.
  const panelProps = (tab) => ({
    className: activeTab === tab ? "anim-fade" : "",
    style: activeTab === tab ? undefined : { display: "none" },
  });

  const memCount = counts ? counts.memories : "—";

  return (
    <div className="knowledge-panel">
      <div
        className="knowledge-summary"
        onClick={toggleOpen}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); } }}
      >
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

      {/* Animated expand/collapse — children persist across collapses so their
          fetched lists and form state survive (mounted on first open only).
          reveal-settled lifts the overflow:hidden clip once the expand finishes,
          so absolutely-positioned dropdowns near the bottom aren't cut off. */}
      <div
        className={"reveal" + (open ? " reveal-open" : "") + (revealSettled ? " reveal-settled" : "")}
        onTransitionEnd={(e) => {
          if (e.propertyName === "grid-template-rows" && open) setRevealSettled(true);
        }}
      >
        <div>
          {openedOnce && (
            <>
              <div className="knowledge-tabs">
                <button
                  className={`knowledge-tab knowledge-tab-docs${activeTab === "docs" ? " active" : ""}`}
                  onClick={() => selectTab("docs")}
                >
                  Documentation
                </button>
                <button
                  className={`knowledge-tab knowledge-tab-skills${activeTab === "skills" ? " active" : ""}`}
                  onClick={() => selectTab("skills")}
                >
                  Skills
                </button>
                <button
                  className={`knowledge-tab knowledge-tab-memories${activeTab === "memories" ? " active" : ""}`}
                  onClick={() => selectTab("memories")}
                >
                  Memories
                </button>
              </div>

              {activatedTabs.docs && (
                <div {...panelProps("docs")}>
                  <DocRepository
                    embedded
                    selectedDocs={selectedDocIds}
                    onSelectionChange={onDocSelectionChange}
                    onChanged={loadCounts}
                  />
                </div>
              )}
              {activatedTabs.skills && (
                <div {...panelProps("skills")}>
                  <SkillsTab
                    selectedSkills={selectedSkillIds}
                    onSkillSelectionChange={onSkillSelectionChange}
                    onChanged={loadCounts}
                  />
                </div>
              )}
              {activatedTabs.memories && (
                <div {...panelProps("memories")}>
                  <MemoriesTab onChanged={loadCounts} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
