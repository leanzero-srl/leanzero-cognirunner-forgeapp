/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-862 — ONE HOME for the Documentation Library's KVS key names.
//
// Every other knowledge family exports its names from the module that owns the
// store: skills from src/skills.js (SKILL_INDEX_KEY / SKILL_PREFIX /
// SKILL_SEED_META_KEY), memories from src/memories.js, listeners from
// src/listeners.js, jobs from src/scheduled-jobs.js. The doc repository is the
// exception only because its owner is src/index.js — the 14k-line backend that
// registers every resolver on import. Importing THAT to learn three strings is
// not a home, it is a dependency, so the names live in a dependency-free shared
// module instead and index.js imports them like everyone else.
//
// Before this file the three names were module-private consts in index.js,
// index.js retyped the prefix a second time at its doc-fetch site, and
// src/test-hook.js retyped all three in its knowledge-snapshot families. An
// offline assertion now fails the suite if a `doc_repo:` literal reappears in
// src/ outside this file.

/** Index row array: metadata only, no document bodies. */
export const DOC_REPO_INDEX_KEY = "doc_repo_index";

/** Per-document record prefix — full key is `doc_repo:{id}`. */
export const DOC_REPO_PREFIX = "doc_repo:";

/** `{ seedVersion }` marker for the builtin-doc seeder. */
export const DOC_SEED_META_KEY = "doc_repo_seed_meta";
