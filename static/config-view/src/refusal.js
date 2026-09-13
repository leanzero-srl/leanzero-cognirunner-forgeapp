/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * F-247 — config-view's copy of the refusal test. See the full rationale in
 * config-ui/src/components/refusal.js (the byte-identical home shared with admin-panel).
 *
 * This app has no components/ directory to share, and these two functions import nothing,
 * so a local copy is cheaper and safer than a cross-app relative import. The CONTRACT is
 * what must not drift — `reason: "no-permission"`, set by permissionDenied() in
 * src/index.js (F-242) — and that is owned by the backend, not by either copy.
 *
 * F-273 — it is no longer true that these functions import nothing: the Coder feature
 * LABELS come from src/shared/edition.js, the one table that says what the paid edition
 * sells. A frontend copy of those labels would be a second answer to a product question,
 * and the stale one. The path differs from the shared pair only by depth.
 */

import { ADVANCED_FEATURES, EDITIONS } from "../../../src/shared/edition.js";

/**
 * Did the backend REFUSE this caller, as opposed to fail?
 *
 * Reads only the machine-readable flag — never the sentence. A `success: true` result is
 * never a refusal no matter what it carries, and a THROWN invoke never reaches here at all:
 * a throw is a transport fault (the resolver answers refusals with a resolved body), so
 * callers must keep it in their catch arm and out of this one.
 *
 * F-255 — it must NOT match an EDITION denial. Those carry `reason: "upgrade-required"` and
 * a `featureId`, and they are a different product statement with a different remedy: the
 * reader's ROLE is fine, the SITE's plan does not include the feature, and the action is to
 * upgrade rather than to ask a CogniRunner admin for a role they cannot grant. Routing one
 * through this helper would send a paying admin to the Permissions tab to fix a billing
 * question — and would quietly delete the upgrade copy that already exists for it. The test
 * is `=== "no-permission"` precisely so a new `reason` value never falls in here by default:
 * an unknown refusal reason should render as itself, not be absorbed by the nearest helper.
 */
export function isPermissionRefusal(result) {
  return !!result && !result.success && result.reason === "no-permission";
}

/**
 * F-255 — the edition twin, so call sites have a name for the case they must NOT treat as a
 * permission problem. Kept in this file because the two are only ever meaningful next to each
 * other: the whole point is that a refusal is one of these, never both.
 */
export function isUpgradeRequired(result) {
  return !!result && !result.success && result.reason === "upgrade-required";
}

/**
 * The sentence to show in place of the list/panel that was refused.
 *
 * F-252/F-254 — a refusal has TWO shapes and they need different sentences, because they
 * have different remedies and different people to talk to.
 *
 *   hint "ask-app-admin" (+ needsRole) — a ROLE FLOOR. The reader is below the level the gate
 *     wanted. Naming the level turns "you can't" into a one-step request, and a CogniRunner
 *     admin can actually grant it.
 *
 *   hint "not-owner" (no needsRole, deliberately) — an OWNERSHIP refusal. The reader may
 *     already hold the highest role the app has and STILL be refused, because this particular
 *     rule belongs to somebody else. Telling them to "ask a CogniRunner admin for viewer
 *     access" would be false (their role is fine), unactionable (there is no role to grant)
 *     and insulting to an admin who has every permission and is being told to go ask for one.
 *     The absence of `needsRole` is the backend saying "no role fixes this" — so the sentence
 *     names the AUTHOR and the admin override instead, which is the real remedy.
 *
 * When no hint is present we fall back to `needsRole`, then to the backend's own sentence,
 * then to a generic line. Inventing a role we were not told about would be a confident guess
 * about someone else's permissions, so the unnamed case stays vague on purpose.
 */
export function permissionRefusalText(result, what = "this") {
  const hint = result && result.hint;
  if (hint === "not-owner") {
    return "This rule belongs to another editor; only its author or an admin can change it.";
  }
  const need = result && result.needsRole;
  if (need === "viewer" || need === "editor" || need === "admin") {
    return `You need CogniRunner ${need} access to see ${what}. Ask a CogniRunner admin under Permissions.`;
  }
  const sentence = result && result.error ? String(result.error).trim() : "";
  if (sentence) return `${sentence} Ask a CogniRunner admin under Permissions.`;
  return `You do not have access to ${what}. Ask a CogniRunner admin under Permissions.`;
}

/**
 * F-273 — the edition copy, carried here for the same reason the rest of this file is:
 * the VOCABULARY is one vocabulary, and a third app holding two thirds of it is how a
 * "one home" rule quietly becomes three homes that disagree. config-view renders no
 * knowledge surface today, so nothing here calls these yet — they exist so that the next
 * surface which does cannot invent its own words for an upgrade.
 *
 * The only permitted difference from the shared pair is the DEPTH of the src/shared import
 * (this file sits one directory higher); refusal-contract.test.mjs normalises exactly that
 * and nothing else, so any real drift still fails the build.
 */
export function upgradeRequiredText(result) {
  const id = result && result.featureId;
  const feature = ADVANCED_FEATURES.find((f) => f.id === id);
  const label = feature ? feature.label : "This feature";
  return `${label} is part of the ${EDITIONS.advanced.label} edition — upgrade in Settings.`;
}

export const UPGRADE_REQUIRED_HEADLINE = `This needs CogniRunner ${EDITIONS.advanced.label}.`;
