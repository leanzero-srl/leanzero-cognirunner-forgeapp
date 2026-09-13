/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * The knowledge INDEX: titles, tags, audiences and provenance — no bodies.
 *
 * This is the module the UI bundles import. Bodies live in the packs and are only ever
 * loaded by the backend, so a Knowledge tab costs kilobytes rather than megabytes.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

/** Content fingerprint of the baked corpus. Changes whenever any section changes. */
export const KNOWLEDGE_CONTENT_VERSION = "4daff10f6d5d5c5b";

/**
 * Fingerprint of this file's METADATA — pack pin lists, the pin map, section audiences.
 * `KNOWLEDGE_CONTENT_VERSION` only hashes bodies, so it cannot see a hand edit here;
 * `npm run bake:check` compares BOTH and fails on either (F-570).
 */
export const KNOWLEDGE_INDEX_META_VERSION = "79ef69a85db14862";

export const KNOWLEDGE_PACKS = [
  {
    "id": "administrator-practice",
    "title": "Administrator practice",
    "sections": 9,
    "bytes": 23557,
    "pinned": [
      "administrator-practice#administrator-practice"
    ]
  },
  {
    "id": "automation-semantics",
    "title": "Automation semantics",
    "sections": 4,
    "bytes": 12385,
    "pinned": []
  },
  {
    "id": "cognirunner-sandbox-traps",
    "title": "CogniRunner sandbox traps",
    "sections": 5,
    "bytes": 12702,
    "pinned": [
      "cognirunner-sandbox-traps#gotchas-traps-each-with-its-receipt"
    ]
  },
  {
    "id": "confluence-rest-correctness",
    "title": "Confluence REST correctness",
    "sections": 46,
    "bytes": 115555,
    "pinned": []
  },
  {
    "id": "forge-app-builder",
    "title": "Forge app builder",
    "sections": 61,
    "bytes": 144173,
    "pinned": [
      "forge-app-builder#core-forge-concepts"
    ]
  },
  {
    "id": "forge-platform-facts",
    "title": "Forge platform facts",
    "sections": 23,
    "bytes": 59741,
    "pinned": []
  },
  {
    "id": "jira-rest-correctness",
    "title": "Jira REST correctness",
    "sections": 11,
    "bytes": 24317,
    "pinned": []
  },
  {
    "id": "jsm-correctness",
    "title": "Jira Service Management correctness",
    "sections": 11,
    "bytes": 26437,
    "pinned": []
  },
  {
    "id": "voice-rules",
    "title": "Voice rules",
    "sections": 9,
    "bytes": 21923,
    "pinned": []
  }
];

/**
 * The PINS the selector reads — audience -> section pins, from knowledge/sources.json
 * (`packs[].pinned` + `packs[].pinnedFor`). ONE home: the backend registers this map
 * with `registerKnowledgePins` and knowledge/MANIFEST.md renders the same object.
 */
export const KNOWLEDGE_PINS = {
  "coder": [
    "forge-app-builder#core-forge-concepts"
  ],
  "codegen": [
    "cognirunner-sandbox-traps#gotchas-traps-each-with-its-receipt"
  ],
  "fix": [
    "cognirunner-sandbox-traps#gotchas-traps-each-with-its-receipt"
  ],
  "va": [
    "administrator-practice#administrator-practice"
  ]
};

export const KNOWLEDGE_INDEX = [
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/administrator-practice-1",
    "pack": "administrator-practice",
    "title": "Administrator practice",
    "tags": [
      "administrator",
      "practice"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2906,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/burstiness-length-and-the-shape-of-outward-text-8",
    "pack": "administrator-practice",
    "title": "Burstiness, length and the shape of outward text",
    "tags": [
      "burstiness",
      "length",
      "shape",
      "outward",
      "text"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2652,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/guard-discipline-and-dead-enforcement-5",
    "pack": "administrator-practice",
    "title": "Guard discipline and dead enforcement",
    "tags": [
      "guard",
      "discipline",
      "dead",
      "enforcement"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2624,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/platform-cap-guards-6",
    "pack": "administrator-practice",
    "title": "Platform-cap guards",
    "tags": [
      "platform",
      "cap",
      "guards",
      "http-429"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2364,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/proven-negatives-and-what-an-endpoint-quietly-excludes-2",
    "pack": "administrator-practice",
    "title": "Proven negatives and what an endpoint quietly excludes",
    "tags": [
      "proven",
      "negatives",
      "endpoint",
      "quietly",
      "excludes",
      "http-404"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2310,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/speaking-versus-changing-and-the-approval-axis-3",
    "pack": "administrator-practice",
    "title": "Speaking versus changing, and the approval axis",
    "tags": [
      "speaking",
      "versus",
      "changing",
      "approval",
      "axis"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 3207,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/the-effects-ledger-4",
    "pack": "administrator-practice",
    "title": "The effects ledger",
    "tags": [
      "effects",
      "ledger"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 1863,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/the-operating-loop-9",
    "pack": "administrator-practice",
    "title": "The operating loop",
    "tags": [
      "operating",
      "loop"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2072,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/unattended-operation-7",
    "pack": "administrator-practice",
    "title": "Unattended operation",
    "tags": [
      "unattended",
      "operation"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 3559,
    "provenance": {
      "source": "administrator-practice",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "automation-semantics/automation-semantics/9d8eb604/automation-semantics-1",
    "pack": "automation-semantics",
    "title": "Automation semantics",
    "tags": [
      "automation",
      "semantics",
      "http-404",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "validator"
    ],
    "bytes": 3008,
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "automation-semantics/automation-semantics/9d8eb604/rule-limits-worth-designing-around-3",
    "pack": "automation-semantics",
    "title": "Rule limits worth designing around",
    "tags": [
      "rule",
      "limits",
      "worth",
      "designing",
      "around",
      "http-401",
      "http-500",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "validator"
    ],
    "bytes": 3255,
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "automation-semantics/automation-semantics/9d8eb604/service-management-over-rest-workflows-fields-and-verificati-4",
    "pack": "automation-semantics",
    "title": "Service management over REST: workflows, fields and verification",
    "tags": [
      "service",
      "management",
      "over",
      "rest",
      "workflows",
      "fields",
      "verification",
      "/rest/api/3/field",
      "/rest/api/3/field/search",
      "/rest/api/3/issue/",
      "http-429",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "validator"
    ],
    "bytes": 2259,
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "automation-semantics/automation-semantics/9d8eb604/smart-values-what-renders-and-what-silently-renders-empty-2",
    "pack": "automation-semantics",
    "title": "Smart values: what renders and what silently renders empty",
    "tags": [
      "smart",
      "values",
      "renders",
      "silently",
      "empty"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "validator"
    ],
    "bytes": 3863,
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/12-two-agents-one-working-tree-4",
    "pack": "cognirunner-sandbox-traps",
    "title": "12. Two agents, one working tree",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "12.",
      "two",
      "agents",
      "one",
      "working",
      "tree",
      "http-404",
      "http-403",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "bytes": 2296,
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    }
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/17-an-assets-object-field-silently-stores-nothing-until-conf-5",
    "pack": "cognirunner-sandbox-traps",
    "title": "17. An Assets object field silently stores nothing until configured in the UI",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "17.",
      "assets",
      "object",
      "field",
      "silently",
      "stores",
      "nothing",
      "until",
      "/rest/api/3/field/",
      "/rest/insight/1.0/",
      "/rest/servicedesk/cmdb/",
      "/rest/internal/2/",
      "/rest/servicedeskapi/servicedesk",
      "http-404",
      "http-429",
      "api",
      "asapp",
      "requestjira",
      "requestconfluence"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "bytes": 3191,
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    }
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/4-a-silent-wrong-issue-write-hides-behind-a-type-check-that--2",
    "pack": "cognirunner-sandbox-traps",
    "title": "4. A silent wrong-issue WRITE hides behind a type check that looks defensive",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "silent",
      "wrong",
      "issue",
      "write",
      "hides",
      "behind",
      "type",
      "check",
      "/rest/api/3/issue/createmeta/",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "bytes": 2196,
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    }
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/7-forge-logs-cannot-be-relied-on-for-a-specific-window-3",
    "pack": "cognirunner-sandbox-traps",
    "title": "7. forge logs cannot be relied on for a specific window",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "forge",
      "logs",
      "cannot",
      "relied",
      "specific",
      "window",
      "http-404",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "bytes": 2134,
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    }
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/gotchas-traps-each-with-its-receipt-1",
    "pack": "cognirunner-sandbox-traps",
    "title": "GOTCHAS — traps, each with its receipt",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "gotchas",
      "traps",
      "each",
      "its",
      "receipt",
      "/rest/api/3/issue/undefined",
      "http-404",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "bytes": 2885,
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/7042ac24/email-address-needs-a-scope-3",
    "pack": "confluence-rest-correctness",
    "title": "Email address needs a scope",
    "tags": [
      "rest",
      "confluence",
      "gotcha",
      "trap",
      "email",
      "address",
      "needs",
      "scope",
      "/rest/api/user",
      "/rest/api/user/email",
      "api",
      "asapp"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix"
    ],
    "bytes": 841,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/gotchas.md",
      "hash": "15cada9d99696f26",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/7042ac24/forge-development-gotchas-confluence-1",
    "pack": "confluence-rest-correctness",
    "title": "Forge Development Gotchas (Confluence)",
    "tags": [
      "rest",
      "confluence",
      "gotcha",
      "trap",
      "forge",
      "development",
      "gotchas",
      "http-429",
      "api",
      "asapp",
      "asuser"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix"
    ],
    "bytes": 2273,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/gotchas.md",
      "hash": "15cada9d99696f26",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/7042ac24/large-page-content-in-custom-ui-2",
    "pack": "confluence-rest-correctness",
    "title": "Large Page Content in Custom UI",
    "tags": [
      "rest",
      "confluence",
      "gotcha",
      "trap",
      "large",
      "page",
      "content",
      "custom",
      "/rest/api/group/",
      "/rest/api/user/memberof",
      "/rest/api/search",
      "/rest/api/group",
      "requestconfluence",
      "api"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix"
    ],
    "bytes": 2387,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/gotchas.md",
      "hash": "15cada9d99696f26",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/95b3f442/next-steps-6",
    "pack": "confluence-rest-correctness",
    "title": "Next Steps",
    "tags": [
      "rest",
      "confluence",
      "problem",
      "pattern",
      "error",
      "next",
      "steps"
    ],
    "audience": [
      "codegen",
      "agent",
      "va"
    ],
    "bytes": 190,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/95b3f442/pattern-2-display-sync-status-on-page-2",
    "pack": "confluence-rest-correctness",
    "title": "Pattern 2: Display Sync Status on Page",
    "tags": [
      "rest",
      "confluence",
      "problem",
      "pattern",
      "error",
      "display",
      "sync",
      "status",
      "page",
      "api",
      "route"
    ],
    "audience": [
      "codegen",
      "agent",
      "va"
    ],
    "bytes": 2553,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/95b3f442/pattern-3-space-wide-configuration-with-per-page-overrides-3",
    "pack": "confluence-rest-correctness",
    "title": "Pattern 3: Space-Wide Configuration with Per-Page Overrides",
    "tags": [
      "rest",
      "confluence",
      "problem",
      "pattern",
      "error",
      "space",
      "wide",
      "configuration",
      "per",
      "page",
      "overrides",
      "api"
    ],
    "audience": [
      "codegen",
      "agent",
      "va"
    ],
    "bytes": 2825,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/95b3f442/pattern-4-reconciliation-scheduler-for-missed-webhooks-4",
    "pack": "confluence-rest-correctness",
    "title": "Pattern 4: Reconciliation Scheduler for Missed Webhooks",
    "tags": [
      "rest",
      "confluence",
      "problem",
      "pattern",
      "error",
      "reconciliation",
      "scheduler",
      "missed",
      "webhooks",
      "api"
    ],
    "audience": [
      "codegen",
      "agent",
      "va"
    ],
    "bytes": 2777,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/95b3f442/pattern-5-handle-rate-limits-with-exponential-backoff-5",
    "pack": "confluence-rest-correctness",
    "title": "Pattern 5: Handle Rate Limits with Exponential Backoff",
    "tags": [
      "rest",
      "confluence",
      "problem",
      "pattern",
      "error",
      "handle",
      "rate",
      "limits",
      "exponential",
      "backoff",
      "http-429",
      "api",
      "route"
    ],
    "audience": [
      "codegen",
      "agent",
      "va"
    ],
    "bytes": 3645,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-api/95b3f442/problem-patterns-common-confluence-forge-solutions-1",
    "pack": "confluence-rest-correctness",
    "title": "Problem Patterns: Common Confluence Forge Solutions",
    "tags": [
      "rest",
      "confluence",
      "problem",
      "pattern",
      "error",
      "patterns",
      "common",
      "forge",
      "solutions",
      "confluence:page",
      "http-500",
      "api",
      "storage"
    ],
    "audience": [
      "codegen",
      "agent",
      "va"
    ],
    "bytes": 2219,
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/1-manifest-manifest-yml-3",
    "pack": "confluence-rest-correctness",
    "title": "1. Manifest (manifest.yml)",
    "tags": [
      "confluence",
      "modules",
      "content",
      "manifest",
      "manifest.yml",
      "confluence:contentAction",
      "confluence:contextMenu",
      "confluence:contentBylineItem",
      "confluence:homepageFeed",
      "confluence:pageBanner",
      "confluence:customContent",
      "confluence:backgroundScript",
      "confluence:contentProperty",
      "confluence:created"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2976,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/3-resources-4",
    "pack": "confluence-rest-correctness",
    "title": "3. Resources",
    "tags": [
      "confluence",
      "modules",
      "content",
      "resources",
      "requestconfluence",
      "invoke",
      "api",
      "asuser",
      "asapp"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2658,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/architecture-overview-2",
    "pack": "confluence-rest-correctness",
    "title": "Architecture Overview",
    "tags": [
      "confluence",
      "modules",
      "content",
      "architecture",
      "overview",
      "requestconfluence",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3047,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/core-concepts-forge-for-confluence-cloud-1",
    "pack": "confluence-rest-correctness",
    "title": "Core Concepts: Forge for Confluence Cloud",
    "tags": [
      "confluence",
      "modules",
      "content",
      "core",
      "concepts",
      "forge",
      "cloud"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2008,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/event-types-for-triggers-part-1-7",
    "pack": "confluence-rest-correctness",
    "title": "Event Types for Triggers (part 1)",
    "tags": [
      "confluence",
      "modules",
      "content",
      "event",
      "types",
      "triggers",
      "part",
      "confluence:created",
      "confluence:updated",
      "confluence:viewed",
      "confluence:trashed",
      "confluence:restored",
      "confluence:deleted",
      "confluence:archived",
      "confluence:unarchived",
      "confluence:moved",
      "confluence:copied",
      "confluence:liked",
      "confluence:removed"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 4020,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/event-types-for-triggers-part-2-8",
    "pack": "confluence-rest-correctness",
    "title": "Event Types for Triggers (part 2)",
    "tags": [
      "confluence",
      "modules",
      "content",
      "event",
      "types",
      "triggers",
      "part",
      "confluence:created"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 1710,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/permissions-scopes-6",
    "pack": "confluence-rest-correctness",
    "title": "Permissions & Scopes",
    "tags": [
      "confluence",
      "modules",
      "content",
      "permissions",
      "scopes",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 1619,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/0a6ac900/the-resolver-pattern-backend-api-calls-5",
    "pack": "confluence-rest-correctness",
    "title": "The Resolver Pattern (Backend API Calls)",
    "tags": [
      "confluence",
      "modules",
      "content",
      "resolver",
      "pattern",
      "backend",
      "api",
      "calls",
      "confluence:contentBylineItem",
      "confluence:contentAction",
      "confluence:spaceSettings",
      "confluence:created",
      "confluence:updated",
      "/rest/v2/api-group-blog-post/",
      "invoke",
      "route",
      "asuser",
      "requestconfluence",
      "asapp"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3823,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/1-capsule-style-resolver-registration-2",
    "pack": "confluence-rest-correctness",
    "title": "1. Capsule-style resolver registration",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "capsule",
      "style",
      "resolver",
      "registration",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3239,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/10-dual-strategy-asuser-asapp-fallback-7",
    "pack": "confluence-rest-correctness",
    "title": "10. Dual-strategy asUser → asApp fallback",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "10.",
      "dual",
      "strategy",
      "asuser",
      "asapp",
      "fallback",
      "http-500",
      "api",
      "route",
      "requestconfluence"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3691,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/12-resolver-middleware-withmigrations-wrapper-8",
    "pack": "confluence-rest-correctness",
    "title": "12. Resolver middleware (withMigrations) wrapper",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "12.",
      "resolver",
      "middleware",
      "withmigrations",
      "wrapper",
      "api",
      "asapp",
      "requestconfluence",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2647,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/14-email-without-a-third-party-provider-jira-issue-notify-tr-9",
    "pack": "confluence-rest-correctness",
    "title": "14. Email without a third-party provider (Jira issue notify trick)",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "14.",
      "email",
      "without",
      "third",
      "party",
      "provider",
      "jira",
      "issue",
      "/rest/api/3/issue/",
      "http-400",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2841,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/16-in-isolate-config-cache-for-high-frequency-handlers-10",
    "pack": "confluence-rest-correctness",
    "title": "16. In-isolate config cache for high-frequency handlers",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "16.",
      "isolate",
      "config",
      "cache",
      "high",
      "frequency",
      "handlers",
      "confluence:viewed",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2675,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/18-dual-index-ts-handler-resolution-typescript-forge-apps-11",
    "pack": "confluence-rest-correctness",
    "title": "18. Dual index.ts handler resolution (TypeScript Forge apps)",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "18.",
      "dual",
      "index.ts",
      "handler",
      "resolution",
      "typescript",
      "forge",
      "apps",
      "http-422",
      "requestconfluence",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2148,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/3-content-property-version-handling-3",
    "pack": "confluence-rest-correctness",
    "title": "3. Content-property version handling",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "content",
      "property",
      "version",
      "handling",
      "http-409",
      "api",
      "route",
      "asapp",
      "requestconfluence",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3039,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/5-app-account-id-loop-prevention-4",
    "pack": "confluence-rest-correctness",
    "title": "5. App-account-id loop prevention",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "app",
      "account",
      "loop",
      "prevention",
      "confluence:updated",
      "/rest/api/user/current",
      "api",
      "route",
      "kvs",
      "asapp",
      "requestconfluence",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2952,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/7-cursor-paginated-space-scan-from-a-queue-5",
    "pack": "confluence-rest-correctness",
    "title": "7. Cursor-paginated space scan from a queue",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "cursor",
      "paginated",
      "space",
      "scan",
      "from",
      "queue",
      "api",
      "route",
      "kvs",
      "asapp",
      "requestconfluence"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2244,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/8-three-level-confluence-authorization-6",
    "pack": "confluence-rest-correctness",
    "title": "8. Three-level Confluence authorization",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "three",
      "level",
      "authorization",
      "/rest/api/space/",
      "/rest/api/user",
      "http-401",
      "http-400",
      "api",
      "asapp",
      "requestconfluence",
      "route",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3745,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/production-patterns-confluence-1",
    "pack": "confluence-rest-correctness",
    "title": "Production Patterns (Confluence)",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "kvs",
      "storage",
      "asuser",
      "asapp",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2418,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/42e5ae3d/see-also-12",
    "pack": "confluence-rest-correctness",
    "title": "See also",
    "tags": [
      "production",
      "patterns",
      "confluence",
      "see",
      "also",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 549,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/6e1199f9/architecture-patterns-that-survived-production-part-1-5",
    "pack": "confluence-rest-correctness",
    "title": "Architecture patterns that survived production (part 1)",
    "tags": [
      "rate limit",
      "points",
      "429",
      "confluence",
      "architecture",
      "patterns",
      "that",
      "survived",
      "production",
      "part",
      "http-429",
      "http-409",
      "http-404"
    ],
    "audience": [
      "coder",
      "agent"
    ],
    "bytes": 4073,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/6e1199f9/architecture-patterns-that-survived-production-part-2-6",
    "pack": "confluence-rest-correctness",
    "title": "Architecture patterns that survived production (part 2)",
    "tags": [
      "rate limit",
      "points",
      "429",
      "confluence",
      "architecture",
      "patterns",
      "that",
      "survived",
      "production",
      "part"
    ],
    "audience": [
      "coder",
      "agent"
    ],
    "bytes": 2273,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/6e1199f9/points-based-rate-limiting-enforced-2026-03-02-surviving-tie-1",
    "pack": "confluence-rest-correctness",
    "title": "Points-based rate limiting (enforced 2026-03-02) — surviving Tier 1",
    "tags": [
      "rate limit",
      "points",
      "429",
      "confluence",
      "based",
      "rate",
      "limiting",
      "enforced",
      "2026",
      "surviving",
      "tier",
      "http-401",
      "http-429"
    ],
    "audience": [
      "coder",
      "agent"
    ],
    "bytes": 2140,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/6e1199f9/pool-scope-what-is-actually-documented-4",
    "pack": "confluence-rest-correctness",
    "title": "Pool scope: what is actually documented",
    "tags": [
      "rate limit",
      "points",
      "429",
      "confluence",
      "pool",
      "scope",
      "actually",
      "documented"
    ],
    "audience": [
      "coder",
      "agent"
    ],
    "bytes": 701,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/6e1199f9/the-space-permissions-trap-measured-and-it-will-bite-you-3",
    "pack": "confluence-rest-correctness",
    "title": "The space-permissions trap (measured, and it will bite you)",
    "tags": [
      "rate limit",
      "points",
      "429",
      "confluence",
      "space",
      "permissions",
      "trap",
      "measured",
      "will",
      "bite",
      "you",
      "http-480",
      "http-501",
      "api",
      "storage"
    ],
    "audience": [
      "coder",
      "agent"
    ],
    "bytes": 3091,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/6e1199f9/what-actually-counts-the-cheapest-optimisation-there-is-2",
    "pack": "confluence-rest-correctness",
    "title": "What actually counts (the cheapest optimisation there is)",
    "tags": [
      "rate limit",
      "points",
      "429",
      "confluence",
      "actually",
      "counts",
      "cheapest",
      "optimisation",
      "there",
      "/rest/api/3/group/member",
      "/rest/api/3/search/jql",
      "http-500",
      "http-501",
      "requestjira",
      "api",
      "route",
      "asapp",
      "asuser"
    ],
    "audience": [
      "coder",
      "agent"
    ],
    "bytes": 2896,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/cf6b16f6/adf-and-storage-format-confluence-body-formats-1",
    "pack": "confluence-rest-correctness",
    "title": "ADF and Storage Format — Confluence body formats",
    "tags": [
      "adf",
      "storage format",
      "body",
      "confluence",
      "storage",
      "format",
      "formats",
      "http-409",
      "api",
      "route",
      "asapp",
      "requestconfluence"
    ],
    "audience": [
      "coder",
      "codegen",
      "va"
    ],
    "bytes": 2710,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/cf6b16f6/building-common-adf-nodes-2",
    "pack": "confluence-rest-correctness",
    "title": "Building common ADF nodes",
    "tags": [
      "adf",
      "storage format",
      "body",
      "confluence",
      "building",
      "common",
      "nodes",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen",
      "va"
    ],
    "bytes": 2480,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/cf6b16f6/canonical-adf-hashing-tamper-detection-3",
    "pack": "confluence-rest-correctness",
    "title": "Canonical ADF hashing (tamper detection)",
    "tags": [
      "adf",
      "storage format",
      "body",
      "confluence",
      "canonical",
      "hashing",
      "tamper",
      "detection",
      "confluence:macro"
    ],
    "audience": [
      "coder",
      "codegen",
      "va"
    ],
    "bytes": 2667,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/cf6b16f6/mixing-v1-and-v2-endpoints-4",
    "pack": "confluence-rest-correctness",
    "title": "Mixing v1 and v2 endpoints",
    "tags": [
      "adf",
      "storage format",
      "body",
      "confluence",
      "mixing",
      "endpoints",
      "/rest/api/content/",
      "api",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen",
      "va"
    ],
    "bytes": 1705,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/db2a8d8f/4-permission-check-in-functions-3",
    "pack": "confluence-rest-correctness",
    "title": "4. Permission Check in Functions",
    "tags": [
      "confluence",
      "scopes",
      "permissions",
      "auth",
      "permission",
      "check",
      "functions",
      "http-403",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 1981,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/12-permissions-scopes.md",
      "hash": "5a59c6f071d52f01",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/db2a8d8f/blog-post-events-2",
    "pack": "confluence-rest-correctness",
    "title": "Blog Post Events",
    "tags": [
      "confluence",
      "scopes",
      "permissions",
      "auth",
      "blog",
      "post",
      "events",
      "confluence:created",
      "confluence:updated",
      "api",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2613,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/12-permissions-scopes.md",
      "hash": "5a59c6f071d52f01",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/db2a8d8f/confluence-forge-permissions-oauth-scopes-1",
    "pack": "confluence-rest-correctness",
    "title": "Confluence Forge Permissions & OAuth Scopes",
    "tags": [
      "confluence",
      "scopes",
      "permissions",
      "auth",
      "forge",
      "oauth",
      "confluence:created",
      "confluence:updated",
      "confluence:deleted",
      "api",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2336,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/12-permissions-scopes.md",
      "hash": "5a59c6f071d52f01",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/f719b57e/kvs-key-schemes-2",
    "pack": "confluence-rest-correctness",
    "title": "KVS key schemes",
    "tags": [
      "macro",
      "section",
      "confluence",
      "kvs",
      "key",
      "schemes",
      "asapp",
      "requestconfluence",
      "route",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2123,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/f719b57e/macros-section-sealing-1",
    "pack": "confluence-rest-correctness",
    "title": "Macros & Section Sealing",
    "tags": [
      "macro",
      "section",
      "confluence",
      "macros",
      "sealing"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3258,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/f719b57e/realm-space-seal-index-via-prefix-query-4",
    "pack": "confluence-rest-correctness",
    "title": "Realm/space seal index via prefix query",
    "tags": [
      "macro",
      "section",
      "confluence",
      "realm",
      "space",
      "seal",
      "index",
      "via",
      "prefix",
      "query",
      "kvs",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 1220,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "confluence-rest-correctness/confluence-forge/f719b57e/three-way-seal-lifecycle-3",
    "pack": "confluence-rest-correctness",
    "title": "Three-way seal lifecycle",
    "tags": [
      "macro",
      "section",
      "confluence",
      "three",
      "way",
      "seal",
      "lifecycle",
      "confluence:trashed",
      "confluence:deleted",
      "/rest/api/content/",
      "http-510",
      "kvs",
      "asapp",
      "requestconfluence",
      "route",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 3529,
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/060270ba/2-the-unvalidated-zero-a-scanner-with-no-rules-looks-exactly-2",
    "pack": "forge-app-builder",
    "title": "2. The unvalidated zero — a scanner with no rules looks exactly like clean code",
    "tags": [
      "security",
      "gotcha",
      "review",
      "scanner",
      "unvalidated",
      "zero",
      "rules",
      "looks",
      "exactly",
      "like",
      "clean"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2926,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/gotchas.md",
      "hash": "b8f9e42bf9397ac5",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/060270ba/5-the-sandbox-is-a-blast-radius-argument-not-an-absolution-3",
    "pack": "forge-app-builder",
    "title": "5. The sandbox is a blast-radius argument, not an absolution",
    "tags": [
      "security",
      "gotcha",
      "review",
      "scanner",
      "sandbox",
      "blast",
      "radius",
      "argument",
      "not",
      "absolution"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2202,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/gotchas.md",
      "hash": "b8f9e42bf9397ac5",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/060270ba/8-vendor-attestation-dressed-up-as-proof-4",
    "pack": "forge-app-builder",
    "title": "8. Vendor attestation dressed up as proof",
    "tags": [
      "security",
      "gotcha",
      "review",
      "scanner",
      "vendor",
      "attestation",
      "dressed",
      "proof"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 408,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/gotchas.md",
      "hash": "b8f9e42bf9397ac5",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/060270ba/the-traps-read-before-reporting-anything-1",
    "pack": "forge-app-builder",
    "title": "The traps — read before reporting anything",
    "tags": [
      "security",
      "gotcha",
      "review",
      "scanner",
      "traps",
      "read",
      "before",
      "reporting",
      "anything"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2108,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/gotchas.md",
      "hash": "b8f9e42bf9397ac5",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/9babab17/forge-app-security-review-run-the-reports-then-write-one-tha-1",
    "pack": "forge-app-builder",
    "title": "Forge app security review — run the reports, then write one that holds up",
    "tags": [
      "security",
      "golden rules",
      "review",
      "forge",
      "app",
      "run",
      "reports",
      "then",
      "write",
      "kvs"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 3181,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/SKILL.md",
      "hash": "13a7e1c26b8f541b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/9babab17/standing-directive-keep-this-current-3",
    "pack": "forge-app-builder",
    "title": "Standing directive: keep this current",
    "tags": [
      "security",
      "golden rules",
      "review",
      "standing",
      "directive",
      "keep",
      "this",
      "current",
      "http-429",
      "api",
      "route",
      "storage",
      "kvs"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 1413,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/SKILL.md",
      "hash": "13a7e1c26b8f541b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/9babab17/the-method-2",
    "pack": "forge-app-builder",
    "title": "The method",
    "tags": [
      "security",
      "golden rules",
      "review",
      "method",
      "storage"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2716,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/SKILL.md",
      "hash": "13a7e1c26b8f541b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/da20948d/2-decompression-bombs-on-the-untrusted-file-path-2",
    "pack": "forge-app-builder",
    "title": "2. Decompression bombs on the untrusted-file path",
    "tags": [
      "security",
      "sast",
      "sca",
      "risk",
      "review",
      "decompression",
      "bombs",
      "untrusted",
      "file",
      "path"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2267,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/03-beyond-scanners.md",
      "hash": "6c772d84056bfab6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/da20948d/6-scope-over-provisioning-3",
    "pack": "forge-app-builder",
    "title": "6. Scope over-provisioning",
    "tags": [
      "security",
      "sast",
      "sca",
      "risk",
      "review",
      "scope",
      "over",
      "provisioning"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2147,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/03-beyond-scanners.md",
      "hash": "6c772d84056bfab6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/da20948d/a-turn-boundary-is-not-consent-4",
    "pack": "forge-app-builder",
    "title": "A turn boundary is not consent",
    "tags": [
      "security",
      "sast",
      "sca",
      "risk",
      "review",
      "turn",
      "boundary",
      "not",
      "consent"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2003,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/03-beyond-scanners.md",
      "hash": "6c772d84056bfab6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/forge-security-review/da20948d/what-sast-and-sca-structurally-cannot-see-in-a-forge-app-1",
    "pack": "forge-app-builder",
    "title": "What SAST and SCA structurally cannot see in a Forge app",
    "tags": [
      "security",
      "sast",
      "sca",
      "risk",
      "review",
      "structurally",
      "cannot",
      "see",
      "forge",
      "app"
    ],
    "audience": [
      "coder",
      "review"
    ],
    "bytes": 2110,
    "provenance": {
      "source": "forge-security-review",
      "path": "~/Projects/skill-jira-forge/forge-security-review/docs/03-beyond-scanners.md",
      "hash": "6c772d84056bfab6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/010c4865/a-custom-ui-resource-is-a-directory-4",
    "pack": "forge-app-builder",
    "title": "A Custom UI resource is a DIRECTORY",
    "tags": [
      "limits",
      "timeout",
      "cost",
      "invocation",
      "faas",
      "custom",
      "resource",
      "directory",
      "http-404"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 259,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/27-faas-limits-and-cost.md",
      "hash": "c9e43204410bb1e1",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/010c4865/faas-limits-cost-reference-1",
    "pack": "forge-app-builder",
    "title": "FaaS Limits & Cost Reference",
    "tags": [
      "limits",
      "timeout",
      "cost",
      "invocation",
      "faas",
      "reference",
      "http-512",
      "http-500",
      "http-429",
      "kvs",
      "route"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2499,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/27-faas-limits-and-cost.md",
      "hash": "c9e43204410bb1e1",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/010c4865/queue-forge-events-limits-2",
    "pack": "forge-app-builder",
    "title": "Queue (@forge/events) limits",
    "tags": [
      "limits",
      "timeout",
      "cost",
      "invocation",
      "faas",
      "queue",
      "forge",
      "events",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2236,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/27-faas-limits-and-cost.md",
      "hash": "c9e43204410bb1e1",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/010c4865/when-you-hit-a-wall-3",
    "pack": "forge-app-builder",
    "title": "When you hit a wall",
    "tags": [
      "limits",
      "timeout",
      "cost",
      "invocation",
      "faas",
      "you",
      "hit",
      "wall",
      "http-500",
      "kvs",
      "api",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2332,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/27-faas-limits-and-cost.md",
      "hash": "c9e43204410bb1e1",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/636106f9/2-heartbeat-self-heal-cap-4",
    "pack": "forge-app-builder",
    "title": "2. Heartbeat + self-heal cap",
    "tags": [
      "queue",
      "consumer",
      "async",
      "events",
      "heartbeat",
      "self",
      "heal",
      "cap",
      "jira:updated",
      "http-409",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2703,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/26-async-events-and-queues.md",
      "hash": "f12be3e551a5ccd7",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/636106f9/2-hourly-lazy-refresh-scheduled-trigger-3",
    "pack": "forge-app-builder",
    "title": "2. Hourly lazy-refresh scheduled trigger",
    "tags": [
      "queue",
      "consumer",
      "async",
      "events",
      "hourly",
      "lazy",
      "refresh",
      "scheduled",
      "trigger",
      "http-429",
      "storage",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2608,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/26-async-events-and-queues.md",
      "hash": "f12be3e551a5ccd7",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/636106f9/async-events-queues-forge-events-1",
    "pack": "forge-app-builder",
    "title": "Async Events & Queues (`@forge/events`)",
    "tags": [
      "queue",
      "consumer",
      "async",
      "events",
      "queues",
      "forge",
      "jira:updated"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2311,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/26-async-events-and-queues.md",
      "hash": "f12be3e551a5ccd7",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/636106f9/consumer-handler-signature-2",
    "pack": "forge-app-builder",
    "title": "Consumer: handler signature",
    "tags": [
      "queue",
      "consumer",
      "async",
      "events",
      "handler",
      "signature",
      "http-429",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2114,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/26-async-events-and-queues.md",
      "hash": "f12be3e551a5ccd7",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/636106f9/see-also-5",
    "pack": "forge-app-builder",
    "title": "See also",
    "tags": [
      "queue",
      "consumer",
      "async",
      "events",
      "see",
      "also",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 328,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/26-async-events-and-queues.md",
      "hash": "f12be3e551a5ccd7",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/790cea09/core-forge-concepts-1",
    "pack": "forge-app-builder",
    "title": "Core Forge Concepts",
    "tags": [
      "manifest",
      "modules",
      "forge",
      "scopes",
      "app structure",
      "core",
      "concepts",
      "jira:issueCreatedTrigger",
      "jira:created",
      "jira:workflowValidator",
      "jira:workflowCondition",
      "jira:workflowPostFunction",
      "jira:globalPage",
      "jira:adminPage",
      "jira:projectPage",
      "jira:issuePanel",
      "jira:issueAction",
      "jira:customField",
      "jira:customFieldType",
      "jira:dashboardGadget",
      "storage"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2695,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/01-core-concepts.md",
      "hash": "7657c92219bee4a8",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/790cea09/function-2",
    "pack": "forge-app-builder",
    "title": "Function",
    "tags": [
      "manifest",
      "modules",
      "forge",
      "scopes",
      "app structure",
      "function"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2095,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/01-core-concepts.md",
      "hash": "7657c92219bee4a8",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/790cea09/scheduled-triggers-3",
    "pack": "forge-app-builder",
    "title": "Scheduled Triggers",
    "tags": [
      "manifest",
      "modules",
      "forge",
      "scopes",
      "app structure",
      "scheduled",
      "triggers",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 1898,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/01-core-concepts.md",
      "hash": "7657c92219bee4a8",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/1-define-functions-in-backend-2",
    "pack": "forge-app-builder",
    "title": "1. Define Functions in Backend",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "define",
      "functions",
      "backend",
      "/rest/api/3/myself",
      "api",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2791,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/3-performance-optimization-7",
    "pack": "forge-app-builder",
    "title": "3. Performance Optimization",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "performance",
      "optimization",
      "http-500",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2128,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/caching-5",
    "pack": "forge-app-builder",
    "title": "Caching",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "caching",
      "/rest/api/3/",
      "http-403",
      "api",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2203,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/forge-resolver-patterns-1",
    "pack": "forge-app-builder",
    "title": "Forge Resolver Patterns",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "forge",
      "patterns"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2303,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/input-payload-structure-3",
    "pack": "forge-app-builder",
    "title": "Input Payload Structure",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "input",
      "payload",
      "structure",
      "/rest/api/3/user",
      "/rest/api/3/project",
      "/rest/api/3/myself",
      "/rest/api/3/projects",
      "api",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2744,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/input-validation-4",
    "pack": "forge-app-builder",
    "title": "Input Validation",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "input",
      "validation",
      "http-429",
      "http-500",
      "api",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2322,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/keep-the-one-shot-path-8",
    "pack": "forge-app-builder",
    "title": "Keep the one-shot path",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "keep",
      "one",
      "shot",
      "path"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2044,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/7d4704eb/transaction-management-6",
    "pack": "forge-app-builder",
    "title": "Transaction Management",
    "tags": [
      "resolver",
      "invoke",
      "custom ui",
      "bridge",
      "transaction",
      "management",
      "http-400"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2188,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/16-resolver-patterns.md",
      "hash": "46dc7a1b95127308",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/80f86740/agentic-validation-validators-only-4",
    "pack": "forge-app-builder",
    "title": "Agentic validation (validators only)",
    "tags": [
      "workflow",
      "validator",
      "condition",
      "post function",
      "agentic",
      "validation",
      "validators",
      "only"
    ],
    "audience": [
      "coder",
      "codegen",
      "validator"
    ],
    "bytes": 2555,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/25-workflow-modules-deep-dive.md",
      "hash": "dc9975f9a961f12a",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/80f86740/field-editability-pre-flight-for-semantic-post-functions-5",
    "pack": "forge-app-builder",
    "title": "Field editability pre-flight for semantic post-functions",
    "tags": [
      "workflow",
      "validator",
      "condition",
      "post function",
      "field",
      "editability",
      "pre",
      "flight",
      "semantic",
      "post",
      "functions",
      "/rest/api/3/issue/",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "validator"
    ],
    "bytes": 1955,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/25-workflow-modules-deep-dive.md",
      "hash": "dc9975f9a961f12a",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/80f86740/one-resolver-separately-exported-runtime-functions-2",
    "pack": "forge-app-builder",
    "title": "One resolver, separately-exported runtime functions",
    "tags": [
      "workflow",
      "validator",
      "condition",
      "post function",
      "one",
      "resolver",
      "separately",
      "exported",
      "runtime",
      "functions",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen",
      "validator"
    ],
    "bytes": 3084,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/25-workflow-modules-deep-dive.md",
      "hash": "dc9975f9a961f12a",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/80f86740/registry-cache-30-s-warm-container-staleness-3",
    "pack": "forge-app-builder",
    "title": "Registry cache: ~30 s warm-container staleness",
    "tags": [
      "workflow",
      "validator",
      "condition",
      "post function",
      "registry",
      "cache",
      "warm",
      "container",
      "staleness",
      "/rest/api/3/workflows/search",
      "/rest/api/3/workflows/update",
      "/rest/api/3/workflow/",
      "http-500",
      "kvs",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "validator"
    ],
    "bytes": 3059,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/25-workflow-modules-deep-dive.md",
      "hash": "dc9975f9a961f12a",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/80f86740/workflow-modules-deep-dive-1",
    "pack": "forge-app-builder",
    "title": "Workflow Modules — Deep Dive",
    "tags": [
      "workflow",
      "validator",
      "condition",
      "post function",
      "modules",
      "deep",
      "dive",
      "jira:workflowValidator",
      "jira:workflowCondition",
      "jira:workflowPostFunction",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen",
      "validator"
    ],
    "bytes": 2581,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/25-workflow-modules-deep-dive.md",
      "hash": "dc9975f9a961f12a",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/1-kvs-sharding-for-100-item-collections-2",
    "pack": "forge-app-builder",
    "title": "1. KVS sharding for >100-item collections",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "kvs",
      "sharding",
      "100",
      "item",
      "collections"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2232,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/10-workflow-injection-programmatic-rule-add-9",
    "pack": "forge-app-builder",
    "title": "10. Workflow injection (programmatic rule add)",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "10.",
      "workflow",
      "injection",
      "programmatic",
      "rule",
      "add",
      "/rest/api/3/workflows/search",
      "/rest/api/3/workflows/update",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2600,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/11-hourly-lazy-refresh-scheduled-trigger-10",
    "pack": "forge-app-builder",
    "title": "11. Hourly lazy-refresh scheduled trigger",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "11.",
      "hourly",
      "lazy",
      "refresh",
      "scheduled",
      "trigger",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2773,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/13-concurrency-deep-dive-stale-draft-invalidation-cleanup-11",
    "pack": "forge-app-builder",
    "title": "13. Concurrency deep-dive: stale-draft invalidation + cleanup",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "13.",
      "concurrency",
      "deep",
      "dive",
      "stale",
      "draft",
      "invalidation",
      "cleanup"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2917,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/14-chunked-write-back-with-a-post-write-verify-step-12",
    "pack": "forge-app-builder",
    "title": "14. Chunked write-back with a post-write VERIFY step",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "14.",
      "chunked",
      "write",
      "back",
      "post",
      "verify",
      "step",
      "/rest/api/3/issue/bulkfetch",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 3737,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/16-layered-config-loader-loaded-fresh-per-invocation-13",
    "pack": "forge-app-builder",
    "title": "16. Layered config loader, loaded fresh per invocation",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "16.",
      "layered",
      "config",
      "loader",
      "loaded",
      "fresh",
      "per",
      "invocation",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2737,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/18-issue-link-inward-outward-semantics-14",
    "pack": "forge-app-builder",
    "title": "18. Issue-link inward/outward semantics",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "18.",
      "issue",
      "link",
      "inward",
      "outward",
      "semantics",
      "/rest/api/3/issueLink",
      "/rest/api/3/field",
      "/rest/api/3/issuetypescreenscheme/project",
      "/rest/api/3/issuetypescreenscheme/mapping",
      "/rest/api/3/screenscheme",
      "/rest/api/3/screens/",
      "api",
      "asapp",
      "requestjira",
      "route"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2779,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/2-two-pass-dependency-filtering-3",
    "pack": "forge-app-builder",
    "title": "2. Two-pass dependency filtering",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "two",
      "pass",
      "dependency",
      "filtering",
      "http-429"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 3354,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/20-field-screen-warning-preflight-15",
    "pack": "forge-app-builder",
    "title": "20. Field-screen warning preflight",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "20.",
      "field",
      "screen",
      "warning",
      "preflight",
      "/rest/api/3/issue/",
      "api",
      "asapp",
      "requestjira",
      "route"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 1200,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/21-materialising-a-generated-hierarchy-into-jira-resumably-16",
    "pack": "forge-app-builder",
    "title": "21. Materialising a generated hierarchy into Jira, resumably",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "21.",
      "materialising",
      "generated",
      "hierarchy",
      "into",
      "jira",
      "resumably"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 3126,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/4-chunked-write-back-with-lock-refresh-4",
    "pack": "forge-app-builder",
    "title": "4. Chunked write-back with lock refresh",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "chunked",
      "write",
      "back",
      "lock",
      "refresh",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 1937,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/5-drafts-write-locks-for-multi-user-concurrency-5",
    "pack": "forge-app-builder",
    "title": "5. Drafts + write-locks for multi-user concurrency",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "drafts",
      "write",
      "locks",
      "multi",
      "user",
      "concurrency",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2361,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/6-capability-token-web-triggers-6",
    "pack": "forge-app-builder",
    "title": "6. Capability-token web triggers",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "capability",
      "token",
      "web",
      "triggers",
      "http-401",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2656,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/7-async-queue-offload-for-25-s-work-7",
    "pack": "forge-app-builder",
    "title": "7. Async-queue offload for >25 s work",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "async",
      "queue",
      "offload",
      "work",
      "kvs",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 3955,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/9-fail-open-workflow-validators-8",
    "pack": "forge-app-builder",
    "title": "9. Fail-open workflow validators",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "fail",
      "open",
      "workflow",
      "validators"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 1852,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/hash-a-canonical-blast-radius-not-the-raw-arguments-18",
    "pack": "forge-app-builder",
    "title": "Hash a canonical BLAST RADIUS, not the raw arguments",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "hash",
      "canonical",
      "blast",
      "radius",
      "not",
      "raw",
      "arguments",
      "http-404"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2017,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/production-patterns-1",
    "pack": "forge-app-builder",
    "title": "Production Patterns",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2357,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/b96476d2/see-also-17",
    "pack": "forge-app-builder",
    "title": "See also",
    "tags": [
      "production",
      "error handling",
      "retry",
      "storage",
      "patterns",
      "see",
      "also"
    ],
    "audience": [
      "coder",
      "codegen",
      "review"
    ],
    "bytes": 2724,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/24-production-patterns.md",
      "hash": "06c00bc784756552",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/byok-multi-provider-adapter-3",
    "pack": "forge-app-builder",
    "title": "BYOK multi-provider adapter",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "byok",
      "multi",
      "provider",
      "adapter",
      "http-400",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2843,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/forge-ai-llm-integration-1",
    "pack": "forge-app-builder",
    "title": "Forge AI & LLM Integration",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "forge",
      "llm",
      "integration",
      "api"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2649,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/hosted-vs-byok-how-to-choose-4",
    "pack": "forge-app-builder",
    "title": "Hosted vs BYOK — how to choose",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "hosted",
      "byok",
      "choose",
      "http-409",
      "http-500",
      "kvs",
      "api",
      "invoke"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2307,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/model-ids-use-these-verbatim-from-the-claude-api-skill-2",
    "pack": "forge-app-builder",
    "title": "Model ids (use these verbatim — from the claude-api skill)",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "ids",
      "use",
      "these",
      "verbatim",
      "from",
      "claude",
      "api",
      "http-500",
      "kvs"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2790,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/output-ceiling-is-not-32k-it-is-the-model-s-own-5",
    "pack": "forge-app-builder",
    "title": "Output ceiling is NOT 32k — it is the model's own",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "output",
      "ceiling",
      "not",
      "32k",
      "own",
      "http-429"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2102,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/output-length-is-the-ceiling-for-structured-generation-not-c-6",
    "pack": "forge-app-builder",
    "title": "OUTPUT LENGTH is the ceiling for structured generation, not context",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "output",
      "length",
      "ceiling",
      "structured",
      "generation",
      "not",
      "context"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2239,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-app-builder/jira-forge/e23d057d/write-progress-to-the-job-row-the-poller-is-already-reading--7",
    "pack": "forge-app-builder",
    "title": "Write progress to the job row; the poller is already reading it",
    "tags": [
      "forge llm",
      "ai",
      "model",
      "token",
      "write",
      "progress",
      "job",
      "row",
      "poller",
      "already",
      "reading"
    ],
    "audience": [
      "coder",
      "codegen"
    ],
    "bytes": 2413,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/31-forge-ai-and-llm.md",
      "hash": "45710125f9b8f6d9",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/5-use-etags-for-conditional-requests-5",
    "pack": "forge-platform-facts",
    "title": "5. Use ETags for Conditional Requests",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "use",
      "etags",
      "conditional",
      "requests",
      "/rest/api/3/issue/",
      "/rest/api/3/myself",
      "api",
      "asapp",
      "requestjira",
      "route"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 2524,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/complete-implementation-with-quota-tracking-part-1-3",
    "pack": "forge-platform-facts",
    "title": "Complete Implementation with Quota Tracking (part 1)",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "complete",
      "implementation",
      "quota",
      "tracking",
      "part",
      "http-429",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 3930,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/complete-implementation-with-quota-tracking-part-2-4",
    "pack": "forge-platform-facts",
    "title": "Complete Implementation with Quota Tracking (part 2)",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "complete",
      "implementation",
      "quota",
      "tracking",
      "part",
      "/rest/api/3/issue/PROJ-123",
      "/rest/api/3/issue/",
      "route",
      "api",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 2877,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/detect-all-three-limit-types-2",
    "pack": "forge-platform-facts",
    "title": "Detect All Three Limit Types",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "detect",
      "all",
      "three",
      "limit",
      "types",
      "/rest/api/3/issue/PROJ-123",
      "/rest/api/3/search",
      "http-429",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 3039,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/if-you-build-a-self-meter-it-is-not-capture-only-if-anything-8",
    "pack": "forge-platform-facts",
    "title": "If you build a self-meter, it is not \"capture-only\" if anything reads it",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "you",
      "build",
      "self",
      "meter",
      "not",
      "capture",
      "only",
      "anything",
      "http-501",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 1386,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/jira-s-identity-class-is-wider-than-confluence-s-7",
    "pack": "forge-platform-facts",
    "title": "Jira's identity class is wider than Confluence's",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "jira",
      "identity",
      "class",
      "wider",
      "than",
      "confluence",
      "/rest/api/3/group/member",
      "/rest/api/3/search/jql",
      "http-500",
      "http-571",
      "http-501",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 2142,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/patterns-proven-under-the-confluence-points-quota-that-trans-6",
    "pack": "forge-platform-facts",
    "title": "Patterns proven under the Confluence points quota that transfer to Jira (2026-08-20)",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "patterns",
      "proven",
      "under",
      "confluence",
      "points",
      "quota",
      "that",
      "transfer",
      "http-409",
      "http-404",
      "requestjira",
      "api",
      "route",
      "asapp",
      "asuser"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 3013,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/5b7cf75d/rate-limit-handling-in-jira-forge-1",
    "pack": "forge-platform-facts",
    "title": "Rate Limit Handling in Jira Forge",
    "tags": [
      "rate limit",
      "429",
      "retry",
      "backoff",
      "rate",
      "limit",
      "handling",
      "jira",
      "forge",
      "http-500",
      "http-429"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "fix"
    ],
    "bytes": 2102,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/bulk-endpoints-need-the-global-bulk-change-permission-7",
    "pack": "forge-platform-facts",
    "title": "Bulk endpoints need the Global bulk change permission",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "bulk",
      "endpoints",
      "need",
      "global",
      "change",
      "permission",
      "/rest/api/3/bulk/issues/fields",
      "http-403",
      "api",
      "asuser"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 1165,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/custom-ui-modal-sizing-5",
    "pack": "forge-platform-facts",
    "title": "Custom UI modal sizing",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "custom",
      "modal",
      "sizing"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 2341,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/forge-development-gotchas-jira-1",
    "pack": "forge-platform-facts",
    "title": "Forge Development Gotchas (Jira)",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "development",
      "gotchas",
      "jira",
      "kvs",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 2342,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/kvs-query-has-no-sort-6",
    "pack": "forge-platform-facts",
    "title": "kvs.query() has no sort()",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "kvs.query",
      "has",
      "sort",
      "/rest/api/3/field/",
      "/rest/api/3/field",
      "http-405",
      "http-400",
      "kvs",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 3703,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/no-use-before-define-is-not-a-style-rule-in-a-forge-function-2",
    "pack": "forge-platform-facts",
    "title": "no-use-before-define is not a style rule in a Forge function",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "use",
      "before",
      "define",
      "not",
      "style",
      "rule",
      "function",
      "api",
      "asapp",
      "asuser"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 2243,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/permissions-external-images-is-separate-from-fetch-3",
    "pack": "forge-platform-facts",
    "title": "permissions.external.images is separate from fetch",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "permissions.external.images",
      "separate",
      "from",
      "fetch",
      "http-429",
      "http-500",
      "kvs",
      "storage",
      "api"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 2576,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/jira-forge/e828b082/workflow-validator-error-messages-4",
    "pack": "forge-platform-facts",
    "title": "Workflow validator error messages",
    "tags": [
      "gotcha",
      "trap",
      "forge",
      "workflow",
      "validator",
      "error",
      "messages",
      "jira:workflowCondition",
      "jira:customField"
    ],
    "audience": [
      "coder",
      "codegen",
      "agent",
      "review",
      "fix"
    ],
    "bytes": 2280,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "cb83656981c6988c",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/async-events-queues-and-post-function-timing-3",
    "pack": "forge-platform-facts",
    "title": "Async events, queues and post-function timing",
    "tags": [
      "async",
      "events",
      "queues",
      "post",
      "function",
      "timing",
      "jira:workflowPostFunction",
      "http-400",
      "storage"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 3226,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/automation-the-browser-and-rest-first-8",
    "pack": "forge-platform-facts",
    "title": "Automation, the browser, and REST first",
    "tags": [
      "automation",
      "browser",
      "rest",
      "first",
      "http-404",
      "http-400",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 1803,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/custom-ui-jira-expressions-in-the-wild-and-the-route-helper-5",
    "pack": "forge-platform-facts",
    "title": "Custom UI, Jira expressions in the wild, and the route helper",
    "tags": [
      "custom",
      "jira",
      "expressions",
      "wild",
      "route",
      "helper",
      "storage"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 1906,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/forge-llm-contract-and-cost-4",
    "pack": "forge-platform-facts",
    "title": "Forge LLM contract and cost",
    "tags": [
      "forge",
      "llm",
      "contract",
      "cost",
      "http-401",
      "asapp",
      "requestconfluence",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 3592,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/forge-platform-facts-1",
    "pack": "forge-platform-facts",
    "title": "Forge platform facts",
    "tags": [
      "forge",
      "platform",
      "facts",
      "jira:workflowCondition",
      "/rest/api/3/issue/",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 3196,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/identity-permissions-and-what-an-endpoint-quietly-excludes-6",
    "pack": "forge-platform-facts",
    "title": "Identity, permissions and what an endpoint quietly excludes",
    "tags": [
      "identity",
      "permissions",
      "endpoint",
      "quietly",
      "excludes",
      "/rest/api/3/mypermissions",
      "/rest/api/3/user/search",
      "/rest/api/3/users/search",
      "/rest/api/3/permissions/check",
      "http-400",
      "http-403",
      "http-401",
      "http-404",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 2597,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/service-management-comments-and-visibility-7",
    "pack": "forge-platform-facts",
    "title": "Service management comments and visibility",
    "tags": [
      "service",
      "management",
      "comments",
      "visibility",
      "/rest/api/3/issue/",
      "/rest/servicedeskapi/request/",
      "/rest/api/3/issueLink",
      "http-400",
      "http-404",
      "api",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 3694,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "forge-platform-facts/platform-fact-memories/93df0223/workflow-rules-over-rest-and-the-workflows-api-2",
    "pack": "forge-platform-facts",
    "title": "Workflow rules over REST and the workflows API",
    "tags": [
      "workflow",
      "rules",
      "over",
      "rest",
      "workflows",
      "api",
      "/rest/api/3/workflows",
      "http-500",
      "http-404"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review",
      "fix",
      "validator"
    ],
    "bytes": 2064,
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/86cb78d3/field-writes-can-silently-no-op-editmeta-before-write-2",
    "pack": "jira-rest-correctness",
    "title": "Field writes can silently no-op (editmeta before write)",
    "tags": [
      "rest",
      "jira",
      "gotcha",
      "trap",
      "field",
      "writes",
      "can",
      "silently",
      "editmeta",
      "before",
      "write",
      "/rest/api/3/issue/",
      "/rest/api/3/issue/bulkfetch",
      "/rest/api/3/issueLink",
      "/rest/api/3/issueLinkType",
      "http-403",
      "api"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "validator",
      "fix"
    ],
    "bytes": 2294,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/gotchas.md",
      "hash": "32fcbc215217ea63",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/86cb78d3/forge-development-gotchas-jira-1",
    "pack": "jira-rest-correctness",
    "title": "Forge Development Gotchas (Jira)",
    "tags": [
      "rest",
      "jira",
      "gotcha",
      "trap",
      "forge",
      "development",
      "gotchas",
      "jira:workflowValidator",
      "http-429",
      "api",
      "asapp",
      "asuser"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "validator",
      "fix"
    ],
    "bytes": 2215,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/gotchas.md",
      "hash": "32fcbc215217ea63",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/86cb78d3/post-rest-api-3-issue-bulk-returns-only-the-successes-3",
    "pack": "jira-rest-correctness",
    "title": "POST /rest/api/3/issue/bulk returns ONLY the successes",
    "tags": [
      "rest",
      "jira",
      "gotcha",
      "trap",
      "post",
      "api",
      "issue",
      "bulk",
      "returns",
      "only",
      "successes",
      "http-400"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "validator",
      "fix"
    ],
    "bytes": 1934,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/gotchas.md",
      "hash": "32fcbc215217ea63",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/common-problem-patterns-for-jira-forge-1",
    "pack": "jira-rest-correctness",
    "title": "Common Problem Patterns for Jira Forge",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "common",
      "patterns",
      "forge",
      "jira:workflowValidator",
      "/rest/api/3/project",
      "requestjira",
      "api"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 2187,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/configuration-ui-3",
    "pack": "jira-rest-correctness",
    "title": "Configuration UI",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "configuration",
      "/rest/api/3/field",
      "/rest/api/3/search",
      "requestjira",
      "api",
      "route",
      "asapp"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 3267,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/detect-and-respond-to-configuration-updates-6",
    "pack": "jira-rest-correctness",
    "title": "Detect and Respond to Configuration Updates",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "detect",
      "respond",
      "configuration",
      "updates",
      "jira:workflowValidator",
      "api",
      "route"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 2583,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/manifest-configuration-2",
    "pack": "jira-rest-correctness",
    "title": "Manifest Configuration",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "manifest",
      "configuration",
      "jira:workflowValidator",
      "api",
      "route",
      "asapp",
      "requestjira",
      "requestconfluence",
      "asuser"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 2066,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/next-steps-8",
    "pack": "jira-rest-correctness",
    "title": "Next Steps",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "next",
      "steps"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 182,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/rate-limit-helper-function-4",
    "pack": "jira-rest-correctness",
    "title": "Rate Limit Helper Function",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "rate",
      "limit",
      "helper",
      "function",
      "/rest/api/3/issue/",
      "/rest/api/3/issue/bulk",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 2837,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/validator-with-multiple-validation-rules-5",
    "pack": "jira-rest-correctness",
    "title": "Validator with Multiple Validation Rules",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "validator",
      "multiple",
      "validation",
      "rules"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 2374,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jira-rest-correctness/jira-api/ff281fe4/webhook-style-sync-to-external-system-7",
    "pack": "jira-rest-correctness",
    "title": "Webhook-style Sync to External System",
    "tags": [
      "rest",
      "jira",
      "problem",
      "pattern",
      "error",
      "webhook",
      "style",
      "sync",
      "external",
      "system",
      "/rest/api/3/search",
      "api",
      "route",
      "storage",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "codegen",
      "agent",
      "va",
      "fix",
      "validator"
    ],
    "bytes": 2378,
    "provenance": {
      "source": "jira-api",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/auto-assignment-based-on-category-7",
    "pack": "jsm-correctness",
    "title": "Auto-Assignment Based on Category",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "auto",
      "assignment",
      "based",
      "category",
      "/rest/api/3/issue/",
      "/rest/api/3/group/bulk",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 1762,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/auto-resolve-based-on-customer-inactivity-8",
    "pack": "jsm-correctness",
    "title": "Auto-Resolve Based on Customer Inactivity",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "auto",
      "resolve",
      "based",
      "customer",
      "inactivity",
      "/rest/api/3/search",
      "/rest/api/3/issue/",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 2433,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/custom-email-notifications-via-webhooks-10",
    "pack": "jsm-correctness",
    "title": "Custom Email Notifications via Webhooks",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "custom",
      "email",
      "notifications",
      "via",
      "webhooks",
      "/rest/api/3/issue/",
      "/rest/api/3/user",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 2897,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/custom-form-with-validation-part-1-5",
    "pack": "jsm-correctness",
    "title": "Custom Form with Validation (part 1)",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "custom",
      "form",
      "validation",
      "part",
      "http-500",
      "invoke"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 3370,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/custom-form-with-validation-part-2-6",
    "pack": "jsm-correctness",
    "title": "Custom Form with Validation (part 2)",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "custom",
      "form",
      "validation",
      "part",
      "/rest/api/3/issue",
      "http-500",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 2977,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/jira-service-management-jsm-extensions-with-forge-1",
    "pack": "jsm-correctness",
    "title": "Jira Service Management (JSM) Extensions with Forge",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "jira",
      "service",
      "management",
      "extensions",
      "forge",
      "jira:adminPage",
      "jira:workflowPostFunction",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 3479,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/link-service-requests-to-kb-articles-9",
    "pack": "jsm-correctness",
    "title": "Link Service Requests to KB Articles",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "link",
      "service",
      "requests",
      "articles",
      "/rest/api/content/search",
      "api",
      "route",
      "asapp",
      "requestjira",
      "storage"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 1908,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/manifest-configuration-for-sla-monitoring-4",
    "pack": "jsm-correctness",
    "title": "Manifest Configuration for SLA Monitoring",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "manifest",
      "configuration",
      "sla",
      "monitoring",
      "jira:portalCustomContent",
      "invoke"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 2351,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/monitor-and-act-on-sla-breaches-3",
    "pack": "jsm-correctness",
    "title": "Monitor and Act on SLA Breaches",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "monitor",
      "act",
      "sla",
      "breaches",
      "/rest/api/3/search",
      "/rest/api/3/issue/",
      "api",
      "route",
      "asapp",
      "requestjira"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 3212,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/step-2-add-custom-fields-to-request-types-2",
    "pack": "jsm-correctness",
    "title": "Step 2: Add Custom Fields to Request Types",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "step",
      "add",
      "custom",
      "fields",
      "request",
      "types",
      "api",
      "asapp",
      "requestjira",
      "route"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 1240,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "jsm-correctness/jira-forge/2aa673c7/summary-of-jsm-forge-capabilities-11",
    "pack": "jsm-correctness",
    "title": "Summary of JSM Forge Capabilities",
    "tags": [
      "jsm",
      "service desk",
      "queue",
      "request type",
      "sd.public.comment",
      "summary",
      "forge",
      "capabilities",
      "jira:portalCustomContent",
      "jira:workflowPostFunction",
      "api"
    ],
    "audience": [
      "agent",
      "va",
      "codegen",
      "fix",
      "validator"
    ],
    "bytes": 808,
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/affirmationopeners-and-assistanttalk-6",
    "pack": "voice-rules",
    "title": "affirmationOpeners and assistantTalk",
    "tags": [
      "affirmationopeners",
      "assistanttalk"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 1951,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/blockrules-4",
    "pack": "voice-rules",
    "title": "blockRules",
    "tags": [
      "blockrules"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 3699,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/claimwords-and-airegisterwords-8",
    "pack": "voice-rules",
    "title": "claimWords and aiRegisterWords",
    "tags": [
      "claimwords",
      "airegisterwords",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2544,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/methodleaks-2",
    "pack": "voice-rules",
    "title": "methodLeaks",
    "tags": [
      "methodleaks",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2086,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/methodleakverbs-and-hedgewords-7",
    "pack": "voice-rules",
    "title": "methodLeakVerbs and hedgeWords",
    "tags": [
      "methodleakverbs",
      "hedgewords",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2539,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/registerwordcaps-and-defaultregister-3",
    "pack": "voice-rules",
    "title": "registerWordCaps and defaultRegister",
    "tags": [
      "registerwordcaps",
      "defaultregister"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 1300,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/shapethresholds-9",
    "pack": "voice-rules",
    "title": "shapeThresholds",
    "tags": [
      "shapethresholds"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 1774,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/voice-rules-1",
    "pack": "voice-rules",
    "title": "Voice rules",
    "tags": [
      "voice",
      "rules"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 2066,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/warnrules-5",
    "pack": "voice-rules",
    "title": "warnRules",
    "tags": [
      "warnrules",
      "http-404",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "bytes": 3964,
    "provenance": {
      "source": "voice-rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    }
  }
];

export default KNOWLEDGE_INDEX;
