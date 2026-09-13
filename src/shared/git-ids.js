/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-310 — THE ONE HOME for a repository identifier.
 *
 * A repo id is the string "owner/name" (GitHub) or "workspace/slug" (Bitbucket), and
 * the app compares it in four places that must all agree: the connection allow-list
 * (`isRepoAllowed`, src/git-connections.js), the per-repo webhook secret key
 * (`gitHookSecretKey`), the normalised webhook envelope (`src/shared/jira-events.js`
 * slims `payload.repoId`), and now a listener's `filters.repos` typed by a human in
 * the admin panel's EventPicker. Before this module there were THREE copies of
 * `String(x).trim().toLowerCase()` — one of them in a BACKEND module the frontend
 * cannot import (git-connections.js loads @forge/kvs), which is exactly why the
 * fourth copy was about to be typed into a .jsx file.
 *
 * Case: provider repo names are case-INSENSITIVE for addressing and the webhook
 * envelope already lower-cases what it stores, so lower-case is the canonical form.
 * A filter that stored "Acme/Web" would silently never match the envelope's
 * "acme/web" — a listener that looks configured and never fires.
 *
 * Dependency-free: this bundles into the Forge backend AND two webpack builds.
 */

/** Canonical form of one repo id: trimmed, lower-cased, surrounding slashes dropped. */
export const normalizeRepoId = (repoId) =>
  String(repoId == null ? "" : repoId).trim().replace(/^\/+|\/+$/g, "").toLowerCase();

/**
 * Is this a plausible "owner/name"? Deliberately SHAPE-only — it is not a claim that
 * the repository exists, and it must not be used as a security control (the
 * allow-list is). It exists so the picker can tell a human "that is not owner/name"
 * instead of storing a filter that can never match.
 */
export const isRepoIdShaped = (repoId) => /^[^\s/]+\/[^\s/]+$/.test(normalizeRepoId(repoId));

/**
 * Parse what a human typed (comma, semicolon, newline or whitespace separated) into
 * canonical ids, de-duplicated, order preserved. Empty entries vanish; malformed ones
 * are KEPT (the caller shows them as invalid) — dropping them silently would make a
 * typo look like it was accepted.
 */
export const parseRepoList = (text) => {
  const out = [];
  for (const raw of String(text == null ? "" : text).split(/[\s,;]+/)) {
    const id = normalizeRepoId(raw);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
};

/** The canonical rendering of a parsed list back into an input field. */
export const formatRepoList = (repos) =>
  (Array.isArray(repos) ? repos : []).map(normalizeRepoId).filter(Boolean).join(", ");

/**
 * THE provider-kind vocabulary, and its brand hues, in a module the ADMIN PANEL can
 * import. `src/git-providers.js` owned this list first but pulls in `tweetnacl`, so a
 * frontend that needed the two ids would have retyped them - and a kind the picker
 * offers but the backend does not know is a connection that cannot be saved.
 * git-providers.js now re-exports from here, so there is still one list.
 *
 * NO HUES HERE, deliberately. The brand colours (GitHub #0f172a / dark #334155,
 * Bitbucket #0052cc / dark #2684ff) live in CSS as `.code-kind-github` /
 * `.code-kind-bitbucket` because they need a dark-mode override, and an inline style
 * read from JS cannot have one. `EVENT_CATEGORIES` keeps its hues in JS only because
 * EventPicker renders them inline; that is the exception, not the pattern to copy.
 */
export const GIT_PROVIDER_KINDS = ["github", "bitbucket"];
export const GIT_PROVIDER_KIND_META = {
  github: { id: "github", label: "GitHub" },
  bitbucket: { id: "bitbucket", label: "Bitbucket" },
};
/** Never guesses: an unknown kind renders as itself, and the CSS gives it neutral slate. */
export const gitProviderKindMeta = (kind) =>
  GIT_PROVIDER_KIND_META[String(kind || "").toLowerCase()]
  || { id: String(kind || "unknown"), label: String(kind || "Unknown") };
