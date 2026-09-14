/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { isKeyConflict, safeKeyPart } from "./kvs-keys.js";

// Dependency-free so the shared module remains safe for both bundlers. The
// caller supplies KVS and its existing key/TTL; claim identity is never changed.
export const claimRuleExecution = async (storage, key, ttl, source, { failClosed = false } = {}) => {
  try {
    // One conditional write, not get-then-set: concurrent deliveries must have
    // exactly one owner before either one reaches the AI gate or Jira writes.
    await storage.set(key, { at: new Date().toISOString() }, { keyPolicy: "FAIL_IF_EXISTS", ...ttl });
    return true;
  } catch (e) {
    // ONE home for "is this the FAIL_IF_EXISTS conflict?" — kvs-keys.js.
    if (isKeyConflict(e)) return false;
    // Capability handlers require ownership before serving data or uploading;
    // unlike rule delivery, their documented single-use contract is fail-closed.
    if (failClosed) throw e;
    // Preserve the existing availability policy: a KVS infrastructure failure
    // permits execution and can therefore permit duplicates. Never hide it.
    console.warn(`[${source}] claim failed (continuing):`, e?.message);
    return true;
  }
};

/**
 * THE PER-EVENT COMPLETION CLAIM FOR A QUEUED TASK (F-393 -> F-911 -> F-919).
 *
 * Forge async events are at-least-once: the platform may deliver the SAME taskId twice,
 * and the consumer's own status row is no defence. `handler` stamps
 * `async_task:<taskId> = { status: "processing" }` on EVERY delivery before it runs the
 * body, so a redelivery of a task that already finished clobbers a completed row back to
 * "processing" - the poller then waits on a row that will never change again - and, for
 * the four AI task types that had no claim of their own (`review`, `codegen`, `fixcode`,
 * `skilldistill`), the model is called a SECOND time and paid for a second time.
 *
 * So the question "has this EVENT already been executed?" gets ONE answer in ONE shape:
 * `task_done:<taskId>`, written FAIL_IF_EXISTS before anything is stamped or spent, with
 * a 24 h TTL - longer than any redelivery horizon, short enough to stay bounded. It
 * deliberately OUTLIVES `async_task:<taskId>` (1 h TTL, and `getAsyncTaskResult` deletes
 * the row the moment a poller consumes it): a duplicate arriving after the panel has
 * already read the result must write NOTHING, and only a record that survives the row's
 * deletion can say so.
 *
 * F-911 shipped this guarantee for coder turns under `coder_done:`; F-919 generalises it
 * to every polled task type, so the prefix is task-type-agnostic and there is ONE builder.
 * A claim written by the F-911 build under `coder_done:` is not seen by this one for the
 * tail of its 24 h TTL - the same bounded deploy-window cost F-911 accepted, paid once
 * more to REMOVE the second key shape rather than keep it forever.
 *
 * Claiming FAILS OPEN on a KVS fault (claimRuleExecution without `failClosed`): an
 * unreachable store must never stop a task's first and only delivery.
 */
export const taskDoneClaimKey = (taskId) => `task_done:${safeKeyPart(taskId)}`;
export const TASK_DONE_TTL = { ttl: { value: 24, unit: "HOURS" } };
