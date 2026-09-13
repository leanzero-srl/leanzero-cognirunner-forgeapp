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
 * and staging builds carry it, PRODUCTION NEVER DOES. It has ONE home in this file,
 * `harnessEnabled()`, and BOTH sides ask it on their FIRST statement — `harnessFaultArmed`
 * returns false and `armHarnessFault` returns `{ ok: false, reason: "harness-off" }`, both
 * before any storage call. So on a production deployment this module performs no KVS read
 * and no KVS write, and cannot change any outcome, no matter who imports it (F-517: the
 * arming side used to rely on its caller's Bearer check alone). That is asserted offline by
 * stubbing the env (async-handler-helpers.test.mjs counts KVS reads of the fault key and
 * expects zero, and counts KVS writes from arming both kinds and expects zero).
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

/** A forced throw at the git-event dispatch seam (F-335). */
export const HARNESS_FAULT_GIT_DISPATCH = "git-dispatch";

/**
 * F-504 — the SECOND kind. SAME home, SAME env gate, SAME one-shot semantics; a fault
 * kind that grew its own arming/consuming code elsewhere would be the defect this file
 * exists to prevent.
 *
 * WHY IT EXISTS: `rotateGitHookSecret` step 3 (the PROMOTE write) is the failure F-481
 * was built for — the provider already signs the new secret while the store still holds
 * the old one, so the row must keep BOTH (`getHookSecretCandidates` returns two) and the
 * connection must be stamped `hookState:"rotation-failed"`. Offline that state is reached
 * by failing a mock KVS write; LIVE there was no way to reach it at all, so F-481's
 * pending-secret acceptance window and F-491's reconcile-on-retry were unobservable on a
 * real tenant — an invariant about failure that nothing could exercise.
 *
 * Keyed by `<connId>:<repoId>`: the repo id is normalised by the caller and sanitised by
 * `harnessFaultKey`, never embedded raw (F-334/F-346 — a "/" is not a legal key part).
 * Consumed INSIDE step 3's own try block, so a planted throw takes exactly the path a
 * real storage refusal takes: same catch, same `rotation-failed` stamp, same refusal
 * string, no side effect the real failure would not have had. One armed unit == one
 * failed promote; the retry the banner invites then runs for real.
 */
export const HARNESS_FAULT_HOOK_PROMOTE = "hook-promote";

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
 * THE gate, in ONE home. `process.env.HARNESS_SECRET` is set in development and staging
 * builds and NEVER in production, exactly as in src/test-hook.js. Both the consuming side
 * (`harnessFaultArmed`) and the arming side (`armHarnessFault`, F-517) ask this — and ask
 * it as their FIRST statement, before any storage call, so a production deployment performs
 * no KVS access through this module at all.
 */
export const harnessEnabled = () => Boolean(process.env.HARNESS_SECRET);

/**
 * Is a fault armed for this key — and if so, consume one unit of it?
 *
 * Returns false, with NO storage access at all, whenever HARNESS_SECRET is absent (i.e.
 * in production). Best-effort on every storage error: a lever that cannot be read is a
 * lever that is not armed. It must never be able to fail a delivery by accident.
 */
export const harnessFaultArmed = async (kind, ...parts) => {
  if (!harnessEnabled()) return false;
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

/**
 * Arm `count` consecutive faults.
 *
 * F-517 — the ARMING side carries the SAME env gate as the consuming side, on its FIRST
 * statement, and writes NOTHING when it refuses. The Bearer check in src/test-hook.js is
 * still the authorization for the one caller that exists today, but a gate that lives only
 * in the caller is a gate the NEXT caller does not inherit, and this file's whole premise is
 * one home and one gate — `harnessFaultArmed` already refuses here rather than trusting its
 * callers. Refusal shape is `{ ok: false, reason: "harness-off" }`: the web trigger spreads
 * this return into a `{ ok: true, ... }` body, so the refusal overrides the optimistic ok.
 */
export const armHarnessFault = async (kind, parts, count) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
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
