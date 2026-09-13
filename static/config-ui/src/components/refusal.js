/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * F-242 / F-244..F-250 — THE ONE TEST for "the backend refused this reader", and the one
 * place that turns that answer into words.
 *
 * WHY THIS FILE EXISTS. Until F-242 a permission refusal and a genuine fault were the same
 * shape on the wire: `{ success: false, error: "<some English sentence>" }`. A frontend that
 * wanted to tell them apart had exactly one option, and MemoriesAdminTab took it — it
 * regexed the sentence (`/do(?:n['’]t| not) have permission/i`). That is a contract made of
 * prose. It breaks silently on a reworded refusal, it cannot see a refusal phrased any other
 * way ("Editor access required" never matched it), and it is unreviewable: nothing in the
 * backend tells you a string is load-bearing. F-242 gave every gate a machine-readable
 * `reason: "no-permission"` and, where the gate knows the level it wanted, `needsRole`.
 * This module is the frontend half of that contract.
 *
 * WHY IT MATTERS BEYOND TIDINESS. Every surface that could not detect a refusal rendered one
 * as an OUTAGE — "Couldn't load documents." next to a Retry button. That is wrong twice over.
 * It is a false claim (nothing is broken; the answer is "not you"), and Retry is a control
 * that CANNOT succeed: it re-asks the same question and gets the same no, so the reader keeps
 * pressing it instead of learning who to ask. A refusal names the remedy and its owner; an
 * outage names the fault and offers a retry. They are different sentences with different
 * controls, and the app had only one of them.
 *
 * ONE HOME. This file is byte-identical between config-ui and admin-panel (the duplication
 * convention — copy, then `diff -q`). config-view carries its own copy of the one-liner
 * because it has no components/ directory to share. It imports NOTHING, which is what keeps
 * it copyable.
 */

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
