/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect } from "react";

const DEFAULT_MESSAGES = [
  "Analyzing your configuration...",
  "Checking for potential issues...",
  "Evaluating field mappings...",
  "Reviewing prompt clarity...",
  "Almost there...",
];

const REVIEW_MESSAGES = [
  "Reading your configuration...",
  "Checking for missing fields...",
  "Evaluating prompt effectiveness...",
  "Looking for potential issues...",
  "Reviewing cost implications...",
  "Generating recommendations...",
];

const CODE_GEN_MESSAGES = [
  "Understanding your requirements...",
  "Selecting the right API endpoints...",
  "Writing JavaScript code...",
  "Adding error handling...",
  "Optimizing for Forge runtime...",
  "Finalizing code...",
];

const TEST_MESSAGES = [
  "Connecting to Jira...",
  "Fetching issue data...",
  "Running your code in sandbox...",
  "Collecting execution logs...",
  "Preparing results...",
];

const FIX_MESSAGES = [
  "Reading the failure...",
  "Checking the sandbox API spec...",
  "Rewriting the failing section...",
  "Validating the fix...",
  "Saving what it learned...",
];

const MESSAGE_SETS = {
  review: REVIEW_MESSAGES,
  codegen: CODE_GEN_MESSAGES,
  test: TEST_MESSAGES,
  fix: FIX_MESSAGES,
  default: DEFAULT_MESSAGES,
};

export default function AILoadingState({ type = "default", statusOverride }) {
  const messages = MESSAGE_SETS[type] || MESSAGE_SETS.default;
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [messages]);

  const displayText = statusOverride || messages[messageIndex];

  return (
    <div className="ai-loading">
      <div className="ai-loading-dots">
        <span className="ai-dot" />
        <span className="ai-dot" />
        <span className="ai-dot" />
      </div>
      <span className="ai-loading-text" key={displayText}>{displayText}</span>
    </div>
  );
}
