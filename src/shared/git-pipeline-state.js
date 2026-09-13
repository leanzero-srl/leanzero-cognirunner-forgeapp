/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE DERIVED STATE OF A PIPELINE ROW, in a dependency-free module.
 *
 * Two questions are asked about a `git_pipeline:*` row by more than one caller, and both
 * used to be answered inline wherever they were needed:
 *
 *   1. "Are the files committed in this repository stale?" - asked by the row's public
 *      projection (the Code tab renders the answer) and by the deploy trigger, which must
 *      refuse rather than send a dispatch the provider answers with 422 (F-611).
 *   2. "Is a run actually in flight?" - asked by the projection, by the Code tab's poll
 *      loop, and by every gate that used to read `status === "queued"` (F-605).
 *
 * They live HERE rather than in src/git-pipeline.js because that module imports @forge/kvs
 * and node:crypto and so cannot be pulled into a browser bundle - the same reason the step
 * ids moved to src/shared/git-pipeline-steps.js (F-465). The screenshot harness's fixture
 * imports these functions instead of re-stating the rule, which is what keeps a fixture
 * from quietly describing a world the product no longer has (F-600).
 */

import { scaffoldOutdatedReason } from "./git-scaffolds.js";

/**
 * How long a setup run may take before it is presumed gone.
 *
 * This is the SAME number as the concurrency claim's TTL in src/git-pipeline.js, which is
 * the app's own statement of how long one run may hold a repository. Past it the claim is
 * released and another setup is accepted, so a row still saying "queued" past it is a run
 * that is not coming back.
 */
export const PIPELINE_CLAIM_TTL_MINUTES = 10;

/**
 * Is what is committed in the repository older than what this build installs?
 *
 * DERIVED ON READ, never stored: the comparison is against the SCAFFOLD_VERSION this build
 * carries, so a row goes stale the moment the app ships a new scaffold and no migration
 * touches a single row (F-579).
 *
 * A row that has never installed is NOT outdated. Nothing was committed, so there are no
 * stale bytes to replace; a first setup that died in the queue is a setup that did not
 * finish, which is a different sentence and a different remedy (`pipelineLive`).
 */
export function pipelineOutdated(row) {
  if (!row || typeof row !== "object") return false;
  if (!row.installedAt) return false;
  return scaffoldOutdatedReason(row.scaffoldVersion) !== null;
}

/**
 * THE REMEDY, in one sentence, for a repository whose committed scaffold is stale.
 *
 * F-611 - the Code tab and the deploy refusal must say the same thing, because they are
 * about the same fact: what is committed is not what this build installs, and re-running
 * the setup is the only way to replace it. The REASON is the scaffold changelog line for
 * the version the repo is stuck on (`scaffoldOutdatedReason`); this is what to do about it.
 */
export const PIPELINE_OUTDATED_REMEDY =
  "Set up the pipeline again to commit the current workflow to this repository.";

/**
 * Is a run actually in flight? Derived from the clock, never from `status` alone.
 *
 * F-605 - `status` is written BY the run, so a run that dies leaves "queued" behind for
 * ever and every gate reading it treated the repository as busy from then on: the Code tab
 * polled, declared itself stalled, and hid both the outdated banner and the setup form on
 * every later visit, for a repository whose committed workflow was still the broken one.
 *
 * FAILS TO "LIVE" when the row carries no usable timestamp: a row that cannot be dated is
 * more likely mid-flight than abandoned, and offering a second setup while the first is
 * committing is worse than making the admin wait - the claim would refuse it anyway.
 */
export function pipelineLive(row) {
  if (!row || typeof row !== "object") return false;
  if (row.status !== "queued" && row.status !== "running") return false;
  const at = Date.parse(row.updatedAt || row.startedAt || row.queuedAt || "");
  if (!Number.isFinite(at)) return true;
  return Date.now() - at < PIPELINE_CLAIM_TTL_MINUTES * 60 * 1000;
}

/** Queued or running, and not live: the run stopped reporting and will not resume. */
export function pipelineStuck(row) {
  if (!row || typeof row !== "object") return false;
  return (row.status === "queued" || row.status === "running") && !pipelineLive(row);
}
