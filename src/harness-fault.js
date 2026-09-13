/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE ONE HOME OF THE DEV-ONLY FAULT LEVER (F-335 live proof).
 *
 * WHY IT EXISTS: F-335 made a git delivery whose dispatch THROWS fail closed — the
 * `git_delivery` claim is released, the attempt counter advances, and the throw is
 * rethrown so the platform redelivers, up to GIT_DISPATCH_MAX_ATTEMPTS. None of that
 * could ever be proven on a live tenant: every envelope `gitWebhook` accepts dispatches
 * cleanly, and there is no sanctioned way to make `dispatchGitEvent` fail. An invariant
 * about failure that can only be exercised by breaking the app for real is an invariant
 * that stays unproven — so the failure gets a LEVER, with one home and one gate.
 *
 * THE GATE IS `process.env.HARNESS_SECRET`, exactly like src/test-hook.js: development
 * and staging builds carry it, PRODUCTION NEVER DOES. `harnessFaultArmed` returns false
 * on its FIRST statement when the variable is absent — before any storage call — so on a
 * production deployment this helper performs no KVS read, no allocation beyond the call
 * itself, and cannot change any outcome. That is asserted offline by stubbing the env
 * (async-handler-helpers.test.mjs counts KVS reads of the fault key and expects zero).
 *
 * SHAPE: `harness_fault:<kind>:<part>:<part>…`, value `{ count, armedAt }`, TTL 10 min so
 * an armed lever that is never consumed disarms itself. Every part goes through
 * `safeKeyPart`/`assertKvsKey` (F-334): a delivery id is a clamped but otherwise raw
 * provider header and must never shape a key.
 *
 * Each ARMED read consumes one unit: the row is decremented and deleted at zero, so a
 * count of N produces exactly N failures and the (N+1)-th attempt runs for real. The
 * consumer, not the arming call, is what decrements — that is what makes the counter a
 * measurement of real dispatch attempts.
 */
import { kvs as storage } from "@forge/kvs";
import { safeKeyPart, assertKvsKey } from "./shared/kvs-keys.js";

/** Never let a test arm more failures than the delivery could survive. */
export const HARNESS_FAULT_MAX_COUNT = 5;

/** TTL of an armed lever. Short on purpose: a forgotten arm must not outlive the test. */
export const HARNESS_FAULT_TTL = { value: 10, unit: "MINUTES" };

/** The one kind in use today: a forced throw at the git-event dispatch seam. */
export const HARNESS_FAULT_GIT_DISPATCH = "git-dispatch";

/** THE key shape. Parts are sanitised here, never at the call sites. */
export const harnessFaultKey = (kind, ...parts) =>
  assertKvsKey(`harness_fault:${safeKeyPart(kind)}:${parts.map((p) => safeKeyPart(p == null ? "none" : p)).join(":")}`);

/**
 * A fault the lever injected. NAMED so a log reader can tell a planted failure from a
 * real one at a glance, and so nothing downstream can mistake it for a product error.
 */
export class HarnessFault extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessFault";
    this.harnessFault = true;
  }
}

/**
 * Is a fault armed for this key — and if so, consume one unit of it?
 *
 * Returns false, with NO storage access at all, whenever HARNESS_SECRET is absent (i.e.
 * in production). Best-effort on every storage error: a lever that cannot be read is a
 * lever that is not armed. It must never be able to fail a delivery by accident.
 */
export const harnessFaultArmed = async (kind, ...parts) => {
  if (!process.env.HARNESS_SECRET) return false;
  try {
    const key = harnessFaultKey(kind, ...parts);
    const row = (await storage.get(key)) || null;
    const count = Number(row && row.count) || 0;
    if (count <= 0) return false;
    if (count <= 1) await storage.delete(key);
    else await storage.set(key, { ...row, count: count - 1 }, { ttl: HARNESS_FAULT_TTL });
    return true;
  } catch {
    return false;
  }
};

/** Arm `count` consecutive faults. Dev-gated by the caller (src/test-hook.js). */
export const armHarnessFault = async (kind, parts, count) => {
  const n = Math.max(1, Math.min(HARNESS_FAULT_MAX_COUNT, Math.floor(Number(count) || 1)));
  const key = harnessFaultKey(kind, ...parts);
  await storage.set(key, { count: n, armedAt: new Date().toISOString() }, { ttl: HARNESS_FAULT_TTL });
  return { key, count: n };
};

/** Disarm. Idempotent: removing a lever that was never armed is a success. */
export const disarmHarnessFault = async (kind, parts) => {
  const key = harnessFaultKey(kind, ...parts);
  await storage.delete(key);
  return { key, disarmed: true };
};

/** What is left on the lever (the live driver polls this to prove consumption). */
export const readHarnessFault = async (kind, parts) => {
  const key = harnessFaultKey(kind, ...parts);
  return { key, value: (await storage.get(key)) || null };
};
