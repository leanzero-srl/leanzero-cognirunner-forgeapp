/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import React from "react";
import { draftAgeLabel } from "../../../../src/shared/draft-state.js";

/**
 * The one way a form offers unfinished work back (F-990).
 *
 * ONE component rather than a block of JSX in each of nine forms, because nine copies of
 * a sentence is nine chances to phrase it differently and nine places a hue has to be
 * kept in both themes.
 *
 * It is a SOLID BLOCK, not a tinted callout and not a left rail: #2563eb with white text
 * at 600-700, the app's own docs hue, one shade lighter in dark. Both buttons are real
 * buttons and Discard is destructive only of a convenience, so it does not ask twice and
 * it never reaches for a native confirm.
 *
 * Byte-identical copy in static/config-ui/src/components/DraftResumeCard.jsx.
 */
export default function DraftResumeCard({ savedAt, onContinue, onDiscard, what = "unsaved work" }) {
  return (
    <div className="draft-resume" role="status">
      <div className="draft-resume-text">
        <span className="draft-resume-title">You have {what} from {draftAgeLabel(savedAt)}</span>
        <span className="draft-resume-sub">Continue where you left off, or start fresh.</span>
      </div>
      <div className="draft-resume-actions">
        <button type="button" className="draft-resume-continue" onClick={onContinue}>Continue</button>
        <button type="button" className="draft-resume-discard" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}
