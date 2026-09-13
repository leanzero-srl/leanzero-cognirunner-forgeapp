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

/**
 * OPTIONAL steps, in the order they run, each keyed by the request field that turns it
 * on (F-527 / F-528). They are inserted before `commit-scaffold` because the scaffold
 * commit is the last thing a setup does.
 *
 * WHY OPTIONAL AND NOT ALWAYS-PRESENT. The row's steps are the admin's record of what
 * this app DID. A step stamped "done" for a variable nobody asked to be written is a
 * lie in the only place an admin can read the truth, and a step left "pending" forever
 * on a finished run reads as a half-installed pipeline. So the list is a function of the
 * request as well as of the provider kind, and it stays FIXED for the length of one run.
 */
export const PIPELINE_OPTIONAL_STEPS = Object.freeze([
  Object.freeze({ field: "developerSpaceId", step: "var:FORGE_DEVELOPER_SPACE" }),
  Object.freeze({ field: "appId", step: "var:FORGE_APP_ID" }),
]);

/**
 * The FIXED step list for one run: the provider kind, plus the optional variable steps
 * this particular request asked for. `opts` is the request (or the queued params) — any
 * object; a field that is absent or empty simply does not add its step.
 */
export const pipelineStepNames = (kind, opts = {}) => {
  const o = opts && typeof opts === "object" ? opts : {};
  const optional = PIPELINE_OPTIONAL_STEPS.filter(
    (x) => typeof o[x.field] === "string" && o[x.field].trim() !== ""
  ).map((x) => x.step);
  const common = PIPELINE_COMMON_STEPS.filter((s) => s !== "commit-scaffold");
  return [
    ...(kind === "bitbucket" ? PIPELINE_BITBUCKET_PREFIX : []),
    ...common,
    ...optional,
    "commit-scaffold",
  ];
};
