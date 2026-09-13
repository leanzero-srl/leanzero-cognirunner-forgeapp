/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE DEPLOY PIPELINE'S STEP IDS — the ONE home (F-465).
 *
 * The step ids are a CONTRACT between three readers that cannot import each other:
 * the executor in src/git-pipeline.js (which runs them and stamps each one on the
 * row), the Code tab in static/admin-panel (which renders the row's steps by name and
 * names the failed one in its warning), and the screenshot harness fixture that stands
 * in for the backend. `git-pipeline.js` imports @forge/kvs and node:crypto and can
 * therefore never be pulled into a browser bundle, so the list used to be MIRRORED by
 * hand in the fixture with a comment asking the next person to keep it in step — which
 * is exactly the N-copies-of-one-rule defect this repo keeps paying for.
 *
 * This module is dependency-free on purpose: it bundles into the Forge backend and into
 * three webpack builds unchanged.
 *
 * ORDER IS MEANINGFUL. The steps run in this order and a row's `steps` array is rebuilt
 * from this list on every attempt, so it is bounded by construction and can never
 * accumulate. `enable-pipelines` exists only on Bitbucket (GitHub Actions needs no
 * enabling), which is why the list is a function of the provider kind rather than a
 * constant.
 *
 * A rename here is a rename of what an admin sees in the pipeline card AND of what a
 * stored row from a previous run says; test-harness/scripts/git-pipeline.test.mjs holds
 * the ids to this list so a drift fails the run instead of the eye.
 */

/** Steps every provider runs, in order. */
export const PIPELINE_COMMON_STEPS = Object.freeze([
  "secret:FORGE_EMAIL",
  "secret:FORGE_API_TOKEN",
  "var:FORGE_SITE",
  "var:FORGE_PRODUCT",
  "var:FORGE_ENV",
  "commit-scaffold",
]);

/** Bitbucket needs its pipelines switched on first; GitHub Actions does not. */
export const PIPELINE_BITBUCKET_PREFIX = Object.freeze(["enable-pipelines"]);

/** The FIXED step list for a run on this provider kind. */
export const pipelineStepNames = (kind) => [
  ...(kind === "bitbucket" ? PIPELINE_BITBUCKET_PREFIX : []),
  ...PIPELINE_COMMON_STEPS,
];
