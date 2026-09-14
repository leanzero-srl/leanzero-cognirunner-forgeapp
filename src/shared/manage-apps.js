/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The ONE home for "where does a Jira admin manage apps".
 *
 * F-958 - a banner that says "a Jira admin installs it under Apps, Manage apps" and
 * gives no link makes the reader hunt for a page the app already knows the URL of. The
 * path is site-relative and the origin comes from `view.getContext().siteUrl`, so a
 * caller builds the href only when it actually has an origin (no origin -> no link, the
 * prose still stands on its own). admin-panel's AgentOffState.jsx carries the same path
 * for its upgrade link; that component is admin-panel-only and cannot be imported from a
 * component that is byte-copied across apps, which is why the helper lives here.
 */

/** Jira's own app-management page, relative to the SITE origin. */
export const MANAGE_APPS_PATH = "/jira/settings/apps/manage";

/**
 * @param {string} siteUrl the site origin (e.g. https://acme.atlassian.net), or ""
 * @returns {string|null} an absolute Manage apps URL, or null when there is no origin.
 */
export function manageAppsUrl(siteUrl) {
  if (!siteUrl || typeof siteUrl !== "string") return null;
  const origin = siteUrl.trim().replace(/\/+$/, "");
  return origin ? origin + MANAGE_APPS_PATH : null;
}
