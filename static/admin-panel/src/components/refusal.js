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
 * because it has no components/ directory to share.
 *
 * WHAT IT MAY IMPORT. Nothing from App.js, and nothing from a sibling component — that is
 * what keeps it copyable, and it is the rule the original "imports NOTHING" note was really
 * stating. `src/shared/*` is the one exception, because those modules are deliberately
 * bundled by BOTH apps (and by the Forge backend) and sit at the same relative depth from
 * config-ui/src/components and admin-panel/src/components, so byte-identity survives the
 * copy. F-273 takes that exception exactly once, for the Coder feature labels, rather than
 * giving the product a second home for what the paid edition sells.
 */

import { ADVANCED_FEATURES, EDITIONS } from "../../../../src/shared/edition.js";

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
 * F-273 — THE ONE SENTENCE for an edition denial, for the same reason
 * permissionRefusalText exists for a role refusal: the four knowledge surfaces
 * (DocRepository, SkillsTab, MemoriesTab, KnowledgePanel's counts) each branch on
 * `isPermissionRefusal` and then fall through to their OUTAGE arm — "Couldn't load
 * documents." beside a Retry. F-255 taught the predicate to tell the two families
 * apart but gave the call sites no second arm to route the edition case into, so a
 * Standard tenant reading a Coder-only store still got the false claim and the
 * button that cannot succeed. A retry does not buy a licence.
 *
 * WHY THE LABEL IS IMPORTED, not retyped. `ADVANCED_FEATURES` in
 * src/shared/edition.js is the single home for what Coder sells, and the backend's
 * own `upgradeRequired()` already renders its `error` from that table. Keeping a
 * second copy of those labels here would give the product two answers to "what is
 * in Coder", and the frontend copy would be the one nobody updates. This is the
 * same relative path from config-ui/src/components and admin-panel/src/components,
 * so the duplication convention (byte-identical, `diff -q`) still holds — the
 * "imports nothing" note above means no import from App.js, which is what makes a
 * component copyable; src/shared is deliberately shared by both bundlers.
 *
 * An UNKNOWN or absent featureId degrades to "this feature" rather than guessing —
 * the same discipline as the unnamed-role case above.
 *
 * F-330 — WHY THE REMEDY LEADS. The labels in ADVANCED_FEATURES are noun phrases and
 * one of them ("the Coder toolset …") is deliberately lowercase, because the backend
 * embeds it mid-sentence in its error strings (F-297) — so that table must not change.
 * Putting the label first made the rendered body open in lowercase AND, sitting under
 * "This needs CogniRunner Coder.", named the edition three times in two lines. Leading
 * with the remedy fixes both at the render site: the sentence starts with a capital, the
 * label is still used VERBATIM as a noun phrase, and the edition is named once — by the
 * headline. Do not re-add the edition name here.
 */
export function upgradeRequiredText(result) {
  const id = result && result.featureId;
  const feature = ADVANCED_FEATURES.find((f) => f.id === id);
  const label = feature ? feature.label : "this feature";
  return `Upgrade in Settings to unlock ${label}.`;
}

/**
 * The headline above that sentence. Split out so every surface renders the SAME two
 * lines in the same order (title then detail) instead of each one inventing a lead —
 * the drift that .memory-full-banner / .memories-admin-capwall / .memory-cap-refusal
 * suffered before F-212 collapsed them.
 */
export const UPGRADE_REQUIRED_HEADLINE = `This needs CogniRunner ${EDITIONS.advanced.label}.`;
