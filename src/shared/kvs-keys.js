/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ONE HOME for the two things every KVS claim site needs: how a key part is made
// safe, and how a FAIL_IF_EXISTS conflict is told apart from an infrastructure
// fault. Both rules existed as copy-pasted literals at several call sites; the
// difference between them decides whether a caller dedups or fails closed, so a
// site that gets the predicate wrong reports a throttle as a duplicate.
// Dependency-free — this module bundles into the backend and the frontends.

/** Make an arbitrary id safe to embed in a KVS key (same shape as listeners.js). */
export const safeKeyPart = (s) => String(s).replace(/[^a-zA-Z0-9:._#-]/g, "-").slice(0, 120);

/**
 * TRUE only for "this key already exists" — the intended FAIL_IF_EXISTS outcome.
 * Everything else (429 throttle, 5xx, rejected key/TTL option) is an infrastructure
 * fault and MUST NOT be reported as a duplicate.
 */
export const isKeyConflict = (e) =>
  e?.code === "KEY_ALREADY_EXISTS"
  || e?.responseDetails?.status === 409
  || /already\s*exist/i.test(String(e?.message));
