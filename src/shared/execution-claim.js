/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Dependency-free so the shared module remains safe for both bundlers. The
// caller supplies KVS and its existing key/TTL; claim identity is never changed.
export const claimRuleExecution = async (storage, key, ttl, source) => {
  try {
    // One conditional write, not get-then-set: concurrent deliveries must have
    // exactly one owner before either one reaches the AI gate or Jira writes.
    await storage.set(key, { at: new Date().toISOString() }, { keyPolicy: "FAIL_IF_EXISTS", ...ttl });
    return true;
  } catch (e) {
    const conflict = e?.code === "KEY_ALREADY_EXISTS"
      || e?.responseDetails?.status === 409
      || /already\s*exist/i.test(String(e?.message));
    if (conflict) return false;
    // Preserve the existing availability policy: a KVS infrastructure failure
    // permits execution and can therefore permit duplicates. Never hide it.
    console.warn(`[${source}] claim failed (continuing):`, e?.message);
    return true;
  }
};
