/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Cheap fingerprint of a static-PF step's code. The tested-state chip compares the fingerprint of the code that
// last PASSED a dry-run to the CURRENT code, so "edited since tested" (stale) + undo are DERIVED — never a
// stored flag that can drift. SINGLE SOURCE so FunctionBlock (config-ui + admin byte-copies) and config-view
// compute it IDENTICALLY: a mismatch here would make the comparison silently lie. Dependency-free (bundles into
// every frontend). Not cryptographic — a fingerprint for change detection; collisions are astronomically
// unlikely for real code edits (length is part of the key).
export const codeFingerprint = (s) => {
  const str = String(s || "");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return `${str.length}:${h}`;
};
