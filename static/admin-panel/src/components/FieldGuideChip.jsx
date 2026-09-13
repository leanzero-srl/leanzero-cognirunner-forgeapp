/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Field guide: N sections" — the provenance chip for the baked knowledge (1.4 commit 14b).
 *
 * ⚠️ FOUR BYTE-IDENTICAL HOMES, and it is a shared FILE rather than four copies of the
 * same twelve lines for one reason: the rule it carries is "an id the index has never heard
 * of must not be printed". The section ids are long, generated and meaningless to a reader
 * (`forge-app-builder/forge-app-builder/9c1f/core-forge-concepts-3`), and a chip that fell
 * back to printing the raw id when a lookup missed would leak a build artefact into the UI
 * on exactly the occasion it is least able to explain itself — a rule config saved before a
 * re-bake, whose stored ids no longer exist. One home, one fallback:
 *
 *   static/config-ui/src/components/FieldGuideChip.jsx
 *   static/admin-panel/src/components/FieldGuideChip.jsx
 *   static/issue-glance/src/components/FieldGuideChip.jsx
 *   static/config-view/src/components/FieldGuideChip.jsx
 *
 * After editing one: copy to the other three and verify with `diff -q`, then rebuild all four
 * apps. Self-contained on purpose (no import from App.js) so the copy stays a copy.
 *
 * F-572 added the fourth home. config-view is the READ-ONLY review surface, and it was the
 * one provenance renderer the guide never reached: its `hasProvenance` predicate tested
 * docs/skills/memories only, so a step generated with the field guide ALONE — the default
 * for a first-time author with no docs picked, no skills bound and memory injection off —
 * told its reviewer the code was generated with nothing.
 *
 * WHAT IT READS. `src/shared/knowledge-titles.js` — the GENERATED id→title map, and NOTHING
 * else: no tags, no provenance, no bodies. A chip needs one string per id, so that is all
 * this import may cost. It used to read `knowledge-index.js`, which carries the tags and
 * provenance no frontend renders and put ~110 KB of dead weight in FOUR bundles (F-582);
 * the packs themselves are 582 KB and backend-only. Do not reach for the index, and never
 * for a pack module, from a frontend.
 *
 * WHAT IT DOES NOT DO. It never asks the backend anything. The ids are already on the
 * record the caller is rendering (`generationMeta.fieldGuide` on a step, or
 * `knowledge.fieldGuideSections` on a Coder turn), and the titles are in the bundle, so a
 * chip that made a resolver call would add a network round trip and a loading state to a
 * label. It also never claims a COUNT it cannot name: the number on the chip is the number
 * of sections it could actually resolve, so the chip and its expanded list can never
 * disagree.
 */

import React, { useState } from "react";
import { KNOWLEDGE_TITLES } from "../../../../src/shared/knowledge-titles.js";

/* A plain object lookup keyed by section id — no Map to build, so nothing is paid by an app
   that never renders a chip. `hasOwnProperty` via the null-prototype-safe guard keeps an id
   like "constructor" from resolving to something that is not a title. */
const titleFor = (id) => {
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(KNOWLEDGE_TITLES, id)) return null;
  const t = KNOWLEDGE_TITLES[id];
  return typeof t === "string" && t ? t : null;
};

/**
 * @param sections  the section ids from the record. Anything not an array, and any id the
 *                  titles map cannot name, is dropped rather than printed.
 */
export default function FieldGuideChip({ sections }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(sections) || !sections.length) return null;

  /* Resolve first, THEN count. De-duplicated by title, because the bake splits one long
     document into numbered chunks that all carry the document's title: three chunks of
     "Core Forge concepts" is one thing a reader recognises, listed three times. */
  const titles = [];
  for (const id of sections) {
    const t = titleFor(id);
    if (t && !titles.includes(t)) titles.push(t);
  }
  if (!titles.length) return null;

  return (
    <span className="fg-chip-wrap">
      <button
        type="button"
        className="gen-meta-chip gmc-fieldguide"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen((v) => !v)}
      >
        Field guide: {titles.length} section{titles.length === 1 ? "" : "s"}
        <span className="fg-chip-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <span className="fg-chip-list">
          {titles.map((t) => <span className="fg-chip-item" key={t}>{t}</span>)}
        </span>
      )}
    </span>
  );
}
