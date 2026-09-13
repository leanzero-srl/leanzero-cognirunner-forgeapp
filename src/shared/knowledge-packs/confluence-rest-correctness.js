/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "confluence-rest-correctness" — 46 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "confluence-rest-correctness";

export const SECTIONS = [
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/gotchas.md",
      "hash": "15cada9d99696f26",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 841,
    "body": "- **Issue**: A user-context token often can't read email; `GET /wiki/rest/api/user` usually returns `publicName` only.\n- **Fix**: Read email from the separate `GET /wiki/rest/api/user/email?accountId=...` endpoint with the `read:email-address:confluence` scope (or an `asApp()` Forge call granted that scope).\n\n## Not every group grants a seat — and revokes can strip admin rights\n- Guest groups (`confluence-guests-{site}`) and `confluence-user-access-admins` grant **no** product seat; admin groups (`confluence-admins`, `site-admins`, `org-admins`) grant a seat **and** admin rights. A license-revoke that blindly removes a user from every Confluence group can strip admin access or push them into a guest group (a soft reactivation backdoor to unlicensed content). Only the `confluence-users[-{site}]` membership reclaims a plain seat."
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/gotchas.md",
      "hash": "15cada9d99696f26",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2273,
    "body": "# Forge Development Gotchas (Confluence)\n\nThis document contains environment-specific facts and common pitfalls that defy reasonable assumptions. Use this to avoid common mistakes during development.\n\n## Forge Tunnel & Manifest Changes\nWhen you modify `manifest.yml` (e.g., adding a new scope or module), **the running `forge tunnel` will not automatically pick up the changes.**\n- **Fix**: Stop the tunnel (`Ctrl+C`) and restart it to apply the new manifest configuration.\n\n## Authentication Context\nThe behavior of your app changes significantly depending the authentication method used:\n- `api.asApp()`: Executes with the app's own permissions. Best for background tasks and system-level operations.\n- `api.asUser()`: Executes with the permissions of the user who triggered the event. Best for UI interactions where user context is required.\n- **Gotcha**: If you use `asApp()` for a UI interaction, the user might see data they shouldn't, or the app might perform actions on their behalf that they didn't intend.\n\n## CSP (Content Security Policy) in Custom UI\nCustom UI apps run in a highly restrictive sandbox.\n- **Issue**: \"Refused to load script\" or \"Refused to connect to...\" errors.\n- **Fix**: Ensure all external domains are explicitly declared in the `permissions.external.fetch.client` section of your `manifest.yml`.\n- **Note**: You cannot use inline `<script>` tags or inline styles in Custom UI.\n\n## Rate Limiting (429)\nConfluence Cloud has strict rate limits on REST API calls.\n- **Issue**: Your app suddenly starts receiving `429 Too Many Requests` errors.\n- **Fix**: Implement exponential backoff in your resolver functions. Avoid making massive batches of requests in a single loop.\n\n## Content Action Modal Sizing\nThe `viewportSize` property for `contentAction` (e.g., `small`, `medium`, `large`) is a hint, not a strict rule.\n- **Gotcha**: Extremely complex UIs might feel cramped in `small` or `medium` viewports. Test your UI layout across different sizes.\n\n## Page Context Loading\nIn Custom UI, `view.getContext()` is asynchronous and returns a Promise.\n- **Issue**: `context.extension` is `undefined` when trying to access page/space info immediately.\n- **Fix**: Always use `await view.getContext()` or `.then()` before accessing context properties."
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/gotchas.md",
      "hash": "15cada9d99696f26",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2387,
    "body": "Fetching large pages via `requestConfluence` can impact performance and memory in the Custom UI sandbox.\n- **Issue**: Slow UI response or browser tab crashes when handling large page bodies.\n- **Fix**: Use pagination where possible, or fetch only the necessary parts of the page (e.g., using specific fields in the REST API).\n\n## Group + CQL endpoints live only on v1\nThe v2 API (`/wiki/api/v2`) has **no group-member endpoints, no `user/memberof`, and no CQL search.** For seat management, membership audits, and content-activity lookups you must use v1 (`/wiki/rest/api/group/...`, `/wiki/rest/api/user/memberof`, `/wiki/rest/api/search?cql=...`). Membership reads use `start`/`limit` **offset** pagination (max `limit=200`), not v2 cursor pagination — stop when `results.length < limit`. Count members cheaply with `membersByGroupId?limit=1&shouldReturnTotalSize=true` and read `totalSize`.\n\n## Suspended users are invisible to Confluence\n- **Issue**: `membersByGroupId` results carry no `status`/`active` field, and a **suspended account is silently omitted** from the list. You cannot tell from Confluence alone whether a missing user is removed or merely suspended.\n- **Fix**: Cross-reference the Org API (`/v1/orgs/{orgId}/directory/users`) for suspended visibility — see `atlassian-organizations-api-skill`.\n\n## Eventual consistency after suspend/reactivate\n- **Issue**: Suspending or reactivating a user at `admin.atlassian.com` / the Org API is **not** immediately reflected in Confluence group reads — propagation takes minutes (observed in production, 2026-06). The admin/org view can show the user Active while a group read still lags.\n- **Fix**: Re-check the more-authoritative Org API before acting on a membership read; don't treat a just-changed user's stale membership as truth.\n\n## Multi-site group contamination\n- **Issue**: `GET /wiki/rest/api/group` returns groups from **all sites in the org**, not just the current site. A naive audit mixes `confluence-users-siteA` with `confluence-users-siteB`. The live listing also takes **20–30 s on large orgs** (observed 2026-06) and pickers hit it twice.\n- **Fix**: Derive the site name from the `confluence-users-{site}` group (`/^confluence-users-(.+)$/`), filter to `*-{site}` plus explicit global admin groups (`site-admins`, `org-admins`), and cache the group list rather than paging it live on every UI load."
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 190,
    "body": "- [Core Concepts](01-core-concepts.md) - Forge fundamentals\n- [Page Custom UI](02-page-custom-ui.md) - Building page extensions\n- [Webhooks & Events](07-webhooks-events.md) - Handling events"
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2553,
    "body": "**Use case:** Show sync status and last sync time in a page extension.\n\n```jsx\n// src/page-ui/sync-status.jsx\nimport React, { useEffect, useState } from 'react';\nimport { api, routeHandlers } from '@forge/bridge';\nimport { Card, Heading, Text } from '@atlaskit/card';\nimport { InlineSpinner } from '@atlaskit/spinner';\nimport { StatusBadge } from '@atlaskit/status-badge';\n\nexport default function SyncStatus() {\n  const [status, setStatus] = useState(null);\n  const [loading, setLoading] = useState(true);\n\n  useEffect(() => {\n    async function loadSyncStatus() {\n      try {\n        const token = await AP.context.getToken();\n        \n        // Get current page ID from route\n        const route = routeHandlers.getCurrentRoute();\n        const match = route.path.match(/\\/page\\/(\\d+)/);\n        \n        if (!match) {\n          setLoading(false);\n          return;\n        }\n\n        const pageId = match[1];\n        \n        // Fetch sync status from page property\n        const response = await api.fetch({\n          url: `/wiki/api/v2/pages/${pageId}/properties/external-sync`,\n          headers: { Authorization: `Bearer ${token}` }\n        });\n\n        if (response.ok) {\n          const data = await response.json();\n          setStatus(data);\n        }\n      } catch (error) {\n        console.error('Failed to load sync status:', error);\n      } finally {\n        setLoading(false);\n      }\n    }\n\n    // Small delay to ensure route context is ready\n    const timer = setTimeout(loadSyncStatus, 200);\n    return () => clearTimeout(timer);\n  }, []);\n\n  if (loading) {\n    return (\n      <Card>\n        <InlineSpinner size=\"small\" /> Loading sync status...\n      </Card>\n    );\n  }\n\n  if (!status) {\n    return (\n      <Card>\n        <Heading>Sync Status</Heading>\n        <Text>Not yet synced</Text>\n      </Card>\n    );\n  }\n\n  const isError = status.status === 'error';\n  \n  return (\n    <Card>\n      <Heading>External Sync Status</Heading>\n      \n      <div style={{ marginTop: '16px' }}>\n        <StatusBadge \n          icon={isError ? 'error' : 'success'}\n          text={isError ? 'Sync Failed' : 'Synced'}\n          appearance={isError ? 'danger' : 'success'}\n        />\n      </div>\n\n      {status.timestamp && (\n        <Text style={{ marginTop: '12px' }}>\n          Last synced: {new Date(status.timestamp).toLocaleString()}\n        </Text>\n      )}\n\n      {isError && status.error && (\n        <Text style={{ marginTop: '8px', color: '#de350b' }}>\n          Error: {status.error}\n        </Text>\n      )}\n    </Card>\n  );\n}\n```\n\n---"
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2825,
    "body": "**Use case:** Configure app at space level, but allow page-specific overrides.\n\n```javascript\n// src/utils/config.js\nimport { api } from '@forge/bridge';\n\nconst SPACE_DEFAULTS_KEY = 'my-app-defaults';\nconst PAGE_OVERRIDES_KEY = 'my-app-overrides';\n\nexport async function getAppConfig(pageId, spaceId, token) {\n  // Load space defaults first\n  const spaceDefaults = await getSpaceProperty(spaceId, SPACE_DEFAULTS_KEY, token);\n  \n  // Then check for page overrides\n  let pageOverrides;\n  if (pageId) {\n    pageOverrides = await getPageProperty(pageId, PAGE_OVERRIDES_KEY, token);\n  }\n\n  // Merge: page overrides take precedence\n  return { ...spaceDefaults, ...pageOverrides };\n}\n\nexport async function getSpaceDefaults(spaceId, token) {\n  return getSpaceProperty(spaceId, SPACE_DEFAULTS_KEY, token);\n}\n\nexport async function setSpaceDefaults(spaceId, defaults, token) {\n  return saveSpaceProperty(spaceId, SPACE_DEFAULTS_KEY, defaults, token);\n}\n\nexport async function getPageOverride(pageId, token) {\n  return getPageProperty(pageId, PAGE_OVERRIDES_KEY, token);\n}\n\nexport async function setPageOverride(pageId, overrides, token) {\n  return savePageProperty(pageId, PAGE_OVERRIDES_KEY, overrides, token);\n}\n\n// --- Helper functions ---\n\nasync function getSpaceProperty(spaceId, key, token) {\n  try {\n    const response = await api.fetch({\n      url: `/wiki/api/v2/spaces/${spaceId}/properties/${key}`,\n      headers: { Authorization: `Bearer ${token}` }\n    });\n    \n    if (response.ok) return await response.json();\n  } catch (e) {\n    // Property doesn't exist - return defaults\n    return getDefaultSpaceConfig();\n  }\n  \n  return null;\n}\n\nasync function saveSpaceProperty(spaceId, key, value, token) {\n  const response = await api.fetch({\n    url: `/wiki/api/v2/spaces/${spaceId}/properties/${key}`,\n    method: 'PUT',\n    headers: { \n      Authorization: `Bearer ${token}`,\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify(value)\n  });\n  \n  return response.ok;\n}\n\nasync function getPageProperty(pageId, key, token) {\n  try {\n    const response = await api.fetch({\n      url: `/wiki/api/v2/pages/${pageId}/properties/${key}`,\n      headers: { Authorization: `Bearer ${token}` }\n    });\n    \n    if (response.ok) return await response.json();\n  } catch (e) {\n    return null;\n  }\n  \n  return null;\n}\n\nasync function savePageProperty(pageId, key, value, token) {\n  const response = await api.fetch({\n    url: `/wiki/api/v2/pages/${pageId}/properties/${key}`,\n    method: 'PUT',\n    headers: { \n      Authorization: `Bearer ${token}`,\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify(value)\n  });\n  \n  return response.ok;\n}\n\nfunction getDefaultSpaceConfig() {\n  return {\n    enabled: true,\n    syncOnCreate: true,\n    syncLabels: ['sync'],\n    externalApiUrl: ''\n  };\n}\n```\n\n---"
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2777,
    "body": "**Use case:** Catch pages that webhooks missed.\n\n```javascript\n// src/scheduled/reconcile.js\nimport { api } from '@forge/bridge';\n\nexport default async function handler() {\n  console.log('Starting reconciliation check...');\n  \n  const token = await AP.context.getToken();\n  const lastCheckTime = await getLastReconciliationTimestamp(token);\n  \n  // Find pages modified since last reconciliation\n  const response = await api.fetch({\n    url: `/wiki/api/v2/search?cql=type=page%20AND%20lastModified>${lastCheckTime}`,\n    headers: { Authorization: `Bearer ${token}` }\n  });\n\n  if (!response.ok) {\n    console.error('Search failed:', await response.text());\n    return;\n  }\n\n  const data = await response.json();\n  \n  let processedCount = 0;\n  \n  for (const page of data.results) {\n    // Check if already synced recently\n    const syncStatus = await getPageProperty(page.id, 'external-sync', token);\n    \n    if (!syncStatus || isNewerThan(page.lastModified, syncStatus.timestamp)) {\n      console.log(`Reconciling: ${page.title}`);\n      \n      try {\n        await syncPageToExternalSystem({ page });\n        processedCount++;\n      } catch (error) {\n        console.error(`Failed to reconcile ${page.id}:`, error);\n      }\n    }\n  }\n\n  // Update last check timestamp\n  await setLastReconciliationTimestamp(token);\n  \n  console.log(`Reconciliation complete. Processed ${processedCount} pages.`);\n}\n\nasync function getLastReconciliationTimestamp(token) {\n  try {\n    const response = await api.fetch({\n      url: '/wiki/api/v2/app-data/reconciliation-last-check',\n      headers: { Authorization: `Bearer ${token}` }\n    });\n    \n    if (response.ok) {\n      const data = await response.json();\n      return data.timestamp;\n    }\n  } catch (e) {}\n  \n  // Default to 7 days ago\n  const date = new Date();\n  date.setDate(date.getDate() - 7);\n  return date.toISOString();\n}\n\nasync function setLastReconciliationTimestamp(token) {\n  await api.fetch({\n    url: '/wiki/api/v2/app-data/reconciliation-last-check',\n    method: 'PUT',\n    headers: { \n      Authorization: `Bearer ${token}`,\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify({ timestamp: new Date().toISOString() })\n  });\n}\n\nfunction isNewerThan(pageModified, syncTimestamp) {\n  return new Date(pageModified) > new Date(syncTimestamp);\n}\n\nasync function getPageProperty(pageId, key, token) {\n  try {\n    const response = await api.fetch({\n      url: `/wiki/api/v2/pages/${pageId}/properties/${key}`,\n      headers: { Authorization: `Bearer ${token}` }\n    });\n    \n    return response.ok ? await response.json() : null;\n  } catch (e) {\n    return null;\n  }\n}\n\nasync function syncPageToExternalSystem({ page }) {\n  // Implement your sync logic here\n  // This is called during reconciliation\n}\n```\n\n---"
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3645,
    "body": "**Use case:** Gracefully handle API rate limits.\n\n```javascript\n// src/utils/rate-limit.js\n\nconst MAX_RETRIES = 3;\nconst BASE_DELAY = 1000; // 1 second\n\nexport async function fetchWithRetry(fetchFn, maxRetries = MAX_RETRIES) {\n  let lastError;\n  \n  for (let attempt = 1; attempt <= maxRetries; attempt++) {\n    try {\n      const response = await fetchFn();\n      \n      if (response.status === 429) {\n        throw new RateLimitError('Rate limit exceeded');\n      }\n      \n      return response;\n    } catch (error) {\n      lastError = error;\n      \n      if (isRetryable(error)) {\n        const delay = calculateBackoff(attempt);\n        console.log(`Retry ${attempt}/${maxRetries} in ${delay}ms...`);\n        \n        await sleep(delay);\n      } else {\n        // Non-retryable error, fail fast\n        throw error;\n      }\n    }\n  }\n  \n  throw lastError;\n}\n\nfunction isRetryable(error) {\n  return (\n    error instanceof RateLimitError ||\n    error.status === 429 ||\n    (error.response?.status === 429)\n  );\n}\n\nfunction calculateBackoff(attempt) {\n  // Exponential backoff with jitter\n  const exponentialDelay = Math.pow(2, attempt - 1) * BASE_DELAY;\n  const jitter = Math.random() * 0.3 * exponentialDelay;\n  return exponentialDelay + jitter;\n}\n\nfunction sleep(ms) {\n  return new Promise(resolve => setTimeout(resolve, ms));\n}\n\nclass RateLimitError extends Error {\n  constructor(message) {\n    super(message);\n    this.name = 'RateLimitError';\n  }\n}\n\n// Usage example:\nasync function makeApiCall(pageId, token) {\n  const response = await fetchWithRetry(() => \n    api.fetch({\n      url: `/wiki/api/v2/pages/${pageId}`,\n      headers: { Authorization: `Bearer ${token}` }\n    })\n  );\n  \n  return response.json();\n}\n```\n\n---\n\n## Pattern 6: Extract Page ID from Various URL Formats\n**Use case:** Handle different Confluence page URL formats.\n\n```javascript\n// src/utils/page-context.js\nimport { routeHandlers } from '@forge/bridge';\n\nexport function extractPageIdFromRoute() {\n  const route = routeHandlers.getCurrentRoute();\n  \n  // Try various patterns\n  const patterns = [\n    // Standard: /spaces/~username/page/123456789/Page+Title\n    /\\/page\\/(\\d+)/,\n    \n    // Legacy: /pages/viewpage.action?pageId=123456789\n    /pageId=(\\d+)/,\n    \n    // Modern viewer: /wiki/spaces/~username/pages/123456789\n    /\\/pages\\/(\\d+)/,\n    \n    // Space home page (no numeric ID in path)\n    /^\\/spaces\\/[^/]+(\\/home)?$/\n  ];\n\n  for (const pattern of patterns) {\n    const match = route.path.match(pattern);\n    \n    if (match && match[1]) {\n      return parseInt(match[1], 10);\n    }\n  }\n  \n  // Check query parameters as fallback\n  const params = new URLSearchParams(route.search);\n  const pageIdParam = params.get('pageId');\n  \n  if (pageIdParam) {\n    return parseInt(pageIdParam, 10);\n  }\n  \n  return null;\n}\n\nexport function extractSpaceKeyFromRoute() {\n  const route = routeHandlers.getCurrentRoute();\n  \n  // Pattern: /spaces/KEY/page/... or /spaces/~username/...\n  const match = route.path.match(/^\\/spaces\\/([^/]+)/);\n  \n  if (match) {\n    return match[1];\n  }\n  \n  // Check query parameters\n  const params = new URLSearchParams(route.search);\n  return params.get('spaceKey');\n}\n\n// Usage in a component:\nexport function usePageContext() {\n  const [pageId, setPageId] = useState(null);\n  const [spaceKey, setSpaceKey] = useState(null);\n\n  useEffect(() => {\n    // Small delay to ensure route context is populated\n    const timer = setTimeout(() => {\n      setPageId(extractPageIdFromRoute());\n      setSpaceKey(extractSpaceKeyFromRoute());\n    }, 100);\n\n    return () => clearTimeout(timer);\n  }, []);\n\n  return { pageId, spaceKey };\n}\n```\n\n---"
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
    "provenance": {
      "source": "confluence-api",
      "path": "~/Projects/skill-jira-forge/confluence-api-skill/docs/problem-patterns.md",
      "hash": "29b62a6169bb7df6",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2219,
    "body": "# Problem Patterns: Common Confluence Forge Solutions\n\nThis guide provides ready-to-use code patterns for common Confluence Forge app scenarios.\n\n---\n\n## Pattern 1: Sync Page Content to External System\n**Use case:** Automatically sync page content when created or updated.\n\n```javascript\n// src/webhooks/sync-page.js\nimport { api } from '@forge/bridge';\n\nexport default async function handler(req, res) {\n  const { event, data } = req.body;\n  \n  try {\n    if (event === 'confluence:page:created' || \n        event === 'confluence:page:updated') {\n      \n      await syncPageToExternalSystem(data);\n    }\n    \n    res.status(200).json({ success: true });\n  } catch (error) {\n    console.error('Sync failed:', error);\n    res.status(500).json({ error: error.message });\n  }\n}\n\nasync function syncPageToExternalSystem(pageData) {\n  const { content, space } = pageData;\n  \n  // Fetch full page details with body\n  const token = await AP.context.getToken();\n  const response = await api.fetch({\n    url: `/wiki/api/v2/pages/${content.id}?bodyFormat=storage`,\n    headers: { Authorization: `Bearer ${token}` }\n  });\n\n  if (!response.ok) throw new Error('Failed to fetch page');\n  \n  const page = await response.json();\n  \n  // Send to external API\n  const syncResult = await fetch('https://external-api.com/pages/sync', {\n    method: 'POST',\n    headers: { \n      'Content-Type': 'application/json',\n      'X-Confluence-Token': token\n    },\n    body: JSON.stringify({\n      id: page.id,\n      title: page.title,\n      content: page.body.storage.value,\n      spaceKey: space.key,\n      lastModified: page.lastModified,\n      author: page.author?.accountId\n    })\n  });\n\n  if (!syncResult.ok) throw new Error('External sync failed');\n  \n  // Mark as synced in Confluence\n  await savePageProperty(\n    page.id, \n    'external-sync', \n    { timestamp: new Date().toISOString(), status: 'success' },\n    token\n  );\n}\n\nasync function savePageProperty(pageId, key, value, token) {\n  return api.fetch({\n    url: `/wiki/api/v2/pages/${pageId}/properties/${key}`,\n    method: 'PUT',\n    headers: { \n      Authorization: `Bearer ${token}`,\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify(value)\n  });\n}\n```\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2976,
    "body": "The manifest defines your app's configuration. Here is a verified example using `confluence:contentAction`:\n\n```yaml\napp:\n  id: ari:cloud:ecosystem::app/your-app-id\n  runtime:\n    name: nodejs24.x\n\npermissions:\n  scopes:\n    - read:confluence-content.summary\n    - write:confluence-content\n\nmodules:\n  confluence:contentAction:\n    - key: my-content-action\n      resource: main\n      resolver:\n        function: resolver\n      title: My Content Action\n  function:\n    - key: resolver\n      handler: index.handler\n\nresources:\n  - key: main\n    path: static/my-app/build\n```\n\n**Key manifest rules:**\n- The top-level key is `resources:` (plural), not `resource:`\n- Custom UI resources point to build output directories (e.g., `static/my-app/build`)\n- UI Kit resources point to source files (e.g., `src/frontend/index.jsx`)\n- Always include `app.runtime.name` (e.g., `nodejs24.x`)\n\n## 2. Modules\nModules are the building blocks of your app. Below are the **verified** Confluence modules:\n\n**UI modules:**\n\n| Module Type | Description |\n|-------------|-------------|\n| `macro` | Insert dynamic content into pages/blogs via the editor. One of the most common Confluence modules. |\n| `confluence:contentAction` | Menu item in \"more actions\" (•••) for pages/blogs. Opens a modal dialog. |\n| `confluence:contextMenu` | Context menu entry when text is selected on a page or blog. |\n| `confluence:contentBylineItem` | Displays information in the content byline area below the page title (next to contributor metadata). |\n| `globalSettings` | Top-level settings panel, accessible from the Confluence administration area. **Note:** Use `globalSettings` without prefix for site-wide admin settings. |\n| `spacePage` | A page scoped to a specific space, appearing as a link in space navigation. **Note:** Use `spacePage` without prefix for space-scoped pages. |\n| `globalPage` | A page accessible globally via the \"Apps\" section of the main navigation menu. **Note:** Use `globalPage` without prefix for global navigation items. |\n| `confluence:homepageFeed` | Adds a content section to the right panel of the Confluence Home page. |\n| `confluence:pageBanner` | Adds a banner to Confluence pages for displaying information or notifications. |\n| `confluence:customContent` | Create custom content types that integrate with existing structures and support search/indexing. |\n\n**Non-UI (background) modules:**\n\n| Module Type | Description |\n|-------------|-------------|\n| `confluence:backgroundScript` | Allows apps to run in the background of a Confluence page. |\n| `confluence:contentProperty` | Defines content properties which are indexed in CQL. |\n\n**Trigger and function modules (not Confluence-specific):**\n\n| Module Type | Description |\n|-------------|-------------|\n| `trigger` | Subscribes to product events (e.g., `avi:confluence:created:page`). |\n| `scheduledTrigger` | Runs a function on a cron-like schedule. |\n| `function` | Defines a serverless backend function handler. |"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2658,
    "body": "Resources are the static files that make up your Custom UI app:\n- **Custom UI**: React components built and bundled (referenced via build directory path)\n- **UI Kit**: React components using Atlassian UI Kit (referenced via source file path, rendered with `render: native`)\n- **Static assets**: Icons, images referenced in manifest\n\n---\n\n## Custom UI vs. UI Kit\nForge offers two UI approaches for Confluence modules:\n\n| Feature | Custom UI | UI Kit |\n|---------|-----------|--------|\n| Rendering | Runs inside a sandboxed iframe | Native Atlassian rendering |\n| Framework | Any React-based framework | `@forge/react` Atlassian UI Kit components |\n| Frontend API calls | `requestConfluence()` from `@forge/bridge` | `invoke()` from `@forge/bridge` to call resolver functions |\n| Backend API calls | Resolver functions using `api.asUser()`/`api.asApp()` from `@forge/api` | Resolver functions using `api.asUser()`/`api.asApp()` from `@forge/api` |\n| Manifest | `resource: main` (points to build dir) | `resource: main` + `render: native` (points to source file) |\n| Flexibility | Full control over UI | Constrained to Atlassian design system |\n\n**Official Documentation References:**\n- [Custom UI Overview](https://developer.atlassian.com/platform/forge/custom-ui/)\n- [UI Kit Overview](https://developer.atlassian.com/platform/forge/ui-kit/)\n\n---\n\n## Custom UI Lifecycle\n```mermaid\ngraph LR\n    A[User loads Confluence page] --> B[Confluence detects app modules]\n    B --> C[Loads Custom UI resource in sandboxed iframe]\n    C --> D[Custom UI calls requestConfluence via @forge/bridge]\n    D --> E[Forge proxy handles auth and forwards to REST API]\n    E --> F[Component renders the data]\n```\n\n## The Custom UI Pattern (Frontend API Calls)\nFor Custom UI apps, use `requestConfluence()` from `@forge/bridge` to make API calls. Forge handles authentication automatically via the proxy mechanism.\n\n```jsx\nimport React, { useEffect, useState } from 'react';\nimport { requestConfluence } from '@forge/bridge';\n\nexport default function PageExtension() {\n  const [pages, setPages] = useState(null);\n\n  useEffect(() => {\n    async function fetchData() {\n      // requestConfluence handles auth automatically via Forge proxy\n      const response = await requestConfluence(`/wiki/api/v2/pages?title=My+Page&space-id=12345`);\n      \n      if (response.ok) {\n        const result = await response.json();\n        setPages(result.results);\n      }\n    }\n    \n    fetchData();\n  }, []);\n\n  return <div>{/* Your UI here */}</div>;\n}\n```\n\n**Important**: Do NOT import `@forge/api` (backend-only package) in Custom UI components. Use `@forge/bridge` for all frontend API calls."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3047,
    "body": "Forge apps communicate with Atlassian products through this flow:\n\n```\n┌─────────────────────────────────────────────────────────────┐\n│                    Confluence UI                            │\n│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │\n│  │ Content      │  │ Custom UI    │  │ Space Settings   │   │\n│  │ Byline Item  │  │ (iframe)     │  │ Panel            │   │\n│  └─────────────┘  └──────────────┘  └──────────────────┘   │\n└─────────────────────────────────────────────────────────────┘\n                               │\n                     ┌─────────┴─────────┐\n                     │  @forge/bridge     │\n                     │  (requestConfluence)│\n                     └─────────┬─────────┘\n                               │\n┌─────────────────────────────────────────────────────────────┐\n│                   Forge Runtime                             │\n│  ┌───────────────────────────────────────────────────────┐  │\n│  │  Serverless Functions (your backend code)             │  │\n│  │  - Resolver functions (@forge/api)                    │  │\n│  │  - Trigger handlers                                   │  │\n│  │  - Scheduled triggers                                 │  │\n│  └───────────────────────────────────────────────────────┘  │\n└─────────────────────────────────────────────────────────────┘\n                               │\n                               ▼\n┌─────────────────────────────────────────────────────────────┐\n│              Confluence REST API v2                         │\n│  https://{domain}.atlassian.net/wiki/api/v2                │\n└─────────────────────────────────────────────────────────────┘\n```\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2008,
    "body": "# Core Concepts: Forge for Confluence Cloud\n\nThis guide covers the fundamental concepts needed to build apps on Atlassian's Forge platform specifically for Confluence Cloud.\n\n---\n\n## What is Forge?\nForge is Atlassian's **serverless development platform** for building apps and integrations for Atlassian Cloud products (Jira, Confluence, Bitbucket, Compass).\n\nUnlike the legacy Connect framework, Forge provides:\n\n- **Serverless**: No infrastructure to manage — Atlassian handles everything via AWS Lambda\n- **Managed runtime**: Your code runs in a secure, isolated Node.js environment\n- **Built-in authentication**: OAuth handled automatically via manifest permissions\n- **Rate-limited APIs**: Built-in rate limiting protection\n- **Modern tooling**: CLI-based development with `forge` commands\n- **Secure by design**: Apps run in a sandboxed environment with egress restrictions\n\n> **Important**: Connect is being deprecated. From September 17, 2025, only Forge apps can be submitted to the Atlassian Marketplace. All new extensibility features are delivered only on Forge.\n\n---\n\n## Runtime Versions\nForge supports multiple Node.js runtime versions:\n\n| Version | Description |\n|---------|-------------|\n| `nodejs24.x` | Latest recommended version (Node.js 24) |\n| `nodejs22.x` | Stable version (Node.js 22) |\n| `nodejs20.x` | Legacy version (Node.js 20) |\n\n**Note**: The legacy JavaScript sandbox runtime is deprecated. From February 28, 2025, all apps still running on it will no longer function.\n\n---\n\n## Connect vs Forge Comparison\n| Feature | Connect | Forge |\n|---------|---------|-------|\n| Hosting | Developer-managed (AWS, GCP, Heroku) | Atlassian-hosted (AWS Lambda) |\n| Security | JWT tokens + OAuth 1.0a/2.0 | Automatic OAuth via manifest scopes |\n| Runtime | Any language (Node.js, Java, etc.) | Node.js serverless functions |\n| UI Options | HTML/CSS/JS in iframes | UI Kit (native) or Custom UI (iframe) |\n| Marketplace | Still supported until Sep 2025 | **Only option after Sep 2025** |\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 4020,
    "body": "Forge uses the `trigger` module to subscribe to Confluence product events. Event names follow the pattern `avi:confluence:<action>:<content-type>`:\n\n**Pages, live docs, and blog posts** (scope: `read:confluence-content.summary`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:page` | New page created |\n| `avi:confluence:updated:page` | Page content changed |\n| `avi:confluence:viewed:page` | Page viewed |\n| `avi:confluence:trashed:page` | Page moved to trash |\n| `avi:confluence:restored:page` | Page restored from trash |\n| `avi:confluence:deleted:page` | Page permanently deleted |\n| `avi:confluence:archived:page` | Page archived |\n| `avi:confluence:unarchived:page` | Page unarchived |\n| `avi:confluence:moved:page` | Page moved to another location |\n| `avi:confluence:copied:page` | Page copied |\n| `avi:confluence:permissions_updated:page` | Page permissions changed |\n| `avi:confluence:created:blogpost` | New blog post published |\n| `avi:confluence:updated:blogpost` | Blog post updated |\n\n**Comments** (scope: `read:confluence-content.summary`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:comment` | Comment added |\n| `avi:confluence:updated:comment` | Comment edited |\n| `avi:confluence:liked:comment` | Comment liked |\n| `avi:confluence:deleted:comment` | Comment deleted |\n\n**Attachments** (scope: `read:confluence-content.summary`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:attachment` | Attachment uploaded |\n| `avi:confluence:updated:attachment` | Attachment updated |\n| `avi:confluence:viewed:attachment` | Attachment viewed |\n| `avi:confluence:trashed:attachment` | Attachment trashed |\n| `avi:confluence:restored:attachment` | Attachment restored |\n| `avi:confluence:deleted:attachment` | Attachment permanently deleted |\n| `avi:confluence:archived:attachment` | Attachment archived |\n| `avi:confluence:unarchived:attachment` | Attachment unarchived |\n\n**Inline tasks** (scope: `read:confluence-content.all`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:task` | Task created |\n| `avi:confluence:updated:task` | Task status changed |\n| `avi:confluence:removed:task` | Task removed |\n\n**Whiteboards, databases, smart links (embeds), and folders** (scope: `read:confluence-content.summary`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:whiteboard` | Whiteboard created |\n| `avi:confluence:moved:whiteboard` | Whiteboard moved |\n| `avi:confluence:copied:whiteboard` | Whiteboard copied |\n| `avi:confluence:permissions_updated:whiteboard` | Whiteboard permissions changed |\n| `avi:confluence:created:database` | Database created |\n| `avi:confluence:moved:database` | Database moved |\n| `avi:confluence:copied:database` | Database copied |\n| `avi:confluence:permissions_updated:database` | Database permissions changed |\n| `avi:confluence:created:embed` | Smart link created in content tree |\n| `avi:confluence:moved:embed` | Smart link moved |\n| `avi:confluence:copied:embed` | Smart link copied |\n| `avi:confluence:created:folder` | Folder created |\n| `avi:confluence:moved:folder` | Folder moved |\n| `avi:confluence:copied:folder` | Folder copied |\n| `avi:confluence:permissions_updated:folder` | Folder permissions changed |\n\n**Relations** (scopes: `read:confluence-content.summary`, `read:confluence-space.summary`, `read:confluence-user`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:relation` | Relationship between entities created |\n| `avi:confluence:deleted:relation` | Relationship between entities deleted |\n\n**Spaces** (scope: `read:confluence-space.summary`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:space:V2` | New space created |\n\n**Users** (scope: `read:confluence-user`):\n\n| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:user` | User created |\n| `avi:confluence:deleted:user` | User deleted |\n\n**Groups** (scope: `read:confluence-groups`):"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1710,
    "body": "| Event | Description |\n|-------|-------------|\n| `avi:confluence:created:group` | Group created |\n\n**Manifest example for a trigger:**\n\n```yaml\nmodules:\n  trigger:\n    - key: page-created-trigger\n      function: onPageCreated\n      events:\n        - avi:confluence:created:page\n  function:\n    - key: onPageCreated\n      handler: index.onPageCreated\n```\n\n**Required scope for most content events:** `read:confluence-content.summary`\n\n**Official Documentation References:**\n- [Confluence Events Reference](https://developer.atlassian.com/platform/forge/events-reference/confluence/)\n\n---\n\n## Development Workflow\n```bash\n# 1. Install Forge CLI\nnpm install -g @forge/cli\n\n# 2. Login to Atlassian account\nforge login\n\n# 3. Create new project (interactive template selection)\nforge create\n\n# 4. Navigate to your project\ncd your-app-name\n\n# 5. Deploy your app\nforge deploy\n\n# 6. Install the app on a Confluence site\nforge install\n\n# 7. Local development (with tunnel for hot-reload)\nforge tunnel\n\n# After manifest scope changes:\nforge deploy\nforge install --upgrade\n\n# Auto-fix scope issues:\nforge lint --fix\n```\n\n**There is no `forge register` command** — use `forge install` to register your app on a site.\n\n---\n\n## Next Steps\n- [Page Custom UI](02-page-custom-ui.md) - Build page extensions\n- [Webhooks & Events](07-webhooks-events.md) - Handle Confluence events  \n- [CLI Commands](13-cli-commands.md) - Complete CLI reference\n\n**Official Atlassian Resources:**\n- [Forge Platform Overview](https://developer.atlassian.com/platform/forge/)\n- [Confluence REST API v2 Reference](https://developer.atlassian.com/cloud/confluence/rest/)\n- [Atlassian Developer Community](https://community.developer.atlassian.com/)"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1619,
    "body": "Confluence Forge apps require specific OAuth scopes in the manifest. Scopes come in two formats:\n- **Classic scopes**: `action:product-resource` (e.g., `read:confluence-content.summary`)\n- **Granular scopes**: `action:resource:product` (e.g., `read:space:confluence`)\n\nBoth formats are valid and can be mixed. Granular scopes are preferred for new apps.\n\n```yaml\npermissions:\n  scopes:\n    # Classic scopes\n    - read:confluence-content.summary   # Read page/blogpost summaries\n    - read:confluence-content.all       # Read all content (needed for task events)\n    - write:confluence-content           # Create/update content\n    - read:confluence-user               # Read user information\n    # Granular scopes\n    - read:space:confluence              # Read space information\n    - write:space:confluence             # Write space properties\n    - read:comment:confluence            # Read comments\n    - write:comment:confluence           # Create/update comments\n    - read:page:confluence               # Read pages (granular)\n    - write:page:confluence              # Create/update pages (granular)\n  external:\n    fetch:\n      backend:\n        - https://api.example.com        # Allow backend calls to external APIs\n```\n\n**Key points about scopes:**\n- Scopes grant *potential* access — Confluence permissions still apply (a user without page edit permission can't edit even if the app has `write:confluence-content`)\n- Use `forge lint --fix` to auto-detect and add required scopes\n- After changing scopes, run `forge deploy` then `forge install --upgrade`\n- Some scopes imply other scopes automatically\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/01-core-concepts.md",
      "hash": "573e3415e6d86909",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3823,
    "body": "For UI Kit apps or when you need backend processing, use resolver functions with `@forge/api`. On the frontend, call resolvers using `invoke()` from `@forge/bridge`:\n\n```js\n// src/resolvers/index.js (backend)\nimport Resolver from '@forge/resolver';\nimport api, { route } from '@forge/api';\n\nconst resolver = new Resolver();\n\nresolver.define('getPages', async ({ payload, context }) => {\n  const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages?space-id=${context.spaceId}`);\n  const data = await response.json();\n  return data.results;\n});\n\nexport const handler = resolver.getDefinitions();\n```\n\n```js\n// src/frontend/index.jsx (frontend - invoking the resolver)\nimport { invoke } from '@forge/bridge';\n\nconst pages = await invoke('getPages', { /* payload */ });\n```\n\n---\n\n## Page (page)\nThe most common content type. Custom UI can be added to any page via modules like `confluence:contentBylineItem` or `confluence:contentAction`.\n\n## Blog Post (blogpost)\nBlog posts also support custom UI. Modules like `confluence:contentAction` work on both pages and blog posts.\n\n## Space (space)\nSpace-level configuration via `confluence:spaceSettings` module.\n\n## Whiteboard (whiteboard)\nCollaborative whiteboards. Supported by event triggers (e.g., `avi:confluence:created:whiteboard`) but with limited direct API support.\n\n## Database (database)\nConfluence databases. Supported by event triggers (e.g., `avi:confluence:created:database`).\n\n## Custom Content\nApps can create their own custom content types using Forge's custom content module. Events: `avi:confluence:created:custom_content`, `avi:confluence:updated:custom_content`, etc.\n\n---\n\n## REST API v2 Overview\nThe Confluence REST API v2 is the current standard with improvements over v1:\n\n```\nBase URL: https://{domain}.atlassian.net/wiki/api/v2\n```\n\n**Key Improvements in v2:**\n- Granular endpoints for specific operations (up to 30x faster)\n- Cursor-based pagination instead of offset-based\n- Better organization by content type\n\n**Key endpoints:**\n\n| Endpoint | Description |\n|----------|-------------|\n| `GET /pages` | List pages (filter by `space-id`, `title`, `status`) |\n| `GET /pages/{id}` | Get a specific page |\n| `POST /pages` | Create a new page |\n| `PUT /pages/{id}` | Update an existing page |\n| `DELETE /pages/{id}` | Delete (trash) a page |\n| `GET /pages/{id}/children` | Get child pages |\n| `GET /pages/{id}/footer-comments` | Get footer comments for a page |\n| `GET /pages/{id}/inline-comments` | Get inline comments for a page |\n| `GET /pages/{id}/versions` | Get page version history |\n| `GET /pages/{id}/operations` | Get permitted operations for a page |\n| `GET /pages/{id}/properties` | Get content properties for a page |\n| `GET /blogposts` | List blog posts |\n| `POST /blogposts` | Create a blog post |\n| `GET /blogposts/{id}` | Get a specific blog post |\n| `PUT /blogposts/{id}` | Update a blog post |\n| `DELETE /blogposts/{id}` | Delete (trash) a blog post |\n| `GET /spaces` | List spaces |\n| `GET /spaces/{id}` | Get a specific space |\n| `POST /spaces` | Create a new space |\n| `GET /spaces/{id}/pages` | Get pages in a space |\n| `GET /spaces/{id}/properties` | Get space properties |\n| `GET /spaces/{id}/permissions` | Get space permissions |\n\n**Authentication in Forge:**\n- **Custom UI (frontend)**: Use `requestConfluence()` from `@forge/bridge` — Forge proxy handles OAuth automatically\n- **Resolver functions (backend)**: Use `api.asUser()` or `api.asApp()` from `@forge/api` — token exchange handled automatically\n- **External apps**: OAuth 2.0 (3LO) with explicit token management\n\n**Official Documentation References:**\n- [Confluence Cloud REST API v2](https://developer.atlassian.com/cloud/confluence/rest/)\n- [Blog Post API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-blog-post/)\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3239,
    "body": "**Problem:** A single `src/index.js` with 50+ `resolver.define(...)` calls becomes unmaintainable, but splitting into many `Resolver` instances complicates the manifest mapping.\n\n**Pattern:** One `Resolver` instance, multiple per-domain \"capsule\" files that each export an `actions` array of `[key, handler]` tuples. The root file aggregates and registers.\n\n```javascript\n// src/server/registry.js  (Sentinel Vault)\nimport Resolver from '@forge/resolver';\nimport { actions as sealingActions }      from './capsules/sealing/actions.js';\nimport { actions as policyActions }       from './capsules/policies/actions.js';\nimport { actions as realmActions }        from './capsules/realms/actions.js';\nimport { actions as bulletinActions }     from './capsules/bulletins/actions.js';\nimport { actions as entitlementActions }  from './capsules/entitlements/actions.js';\nimport { actions as panelActions }        from './capsules/panels/actions.js';\n\nconst router = new Resolver();\nconst allActions = [\n  ...sealingActions, ...policyActions, ...realmActions,\n  ...bulletinActions, ...entitlementActions, ...panelActions,\n];\nallActions.forEach(([key, fn]) => router.define(key, fn));\nrouter.define('heartbeat', async () => 'operational');\n\nexport const actionRouter = router.getDefinitions();\n```\n\n**Why tuples not objects:** insertion order is preserved, multiple capsules can share a key prefix without object-property collisions, and adding a new action is a single export append.\n\n**Source:** Sentinel Vault `src/server/registry.js`.\n\n---\n\n## 2. KVS prefix indexing with WhereConditions.beginsWith\n**Problem:** You want O(1) \"list everything for resource X\" without maintaining a separate index value (which is itself rate-limited per key).\n\n**Pattern:** Encode the relationship in the *key*. Then `kvs.query().where('key', WhereConditions.beginsWith('prefix'))` is your index.\n\n```javascript\nimport { kvs, WhereConditions } from '@forge/kvs';\n\n// Sentinel Vault key conventions\n//   protection-{attachmentId}                  ← seal record\n//   space-protection-{spaceId}-{attachmentId}  ← per-space index entry\n//   admin-settings-global                      ← global policy\n//   admin-settings-space-{spaceKey}            ← per-space policy\n//   notification-{timestamp}-{random}          ← TTL=5min toast/banner\n//   recent-notifications                       ← TTL=1h, last 10 events\n//   space-scan-status-{spaceId}                ← long-running job state\n\n// \"Show me every seal in this space\":\nconst sealsInSpace = await kvs\n  .query()\n  .where('key', WhereConditions.beginsWith(`space-protection-${spaceId}-`))\n  .limit(100)\n  .getMany();\n\n// Cursor-paginate when the result might exceed 100:\nlet cursor;\ndo {\n  const page = await kvs.query()\n    .where('key', WhereConditions.beginsWith('protection-'))\n    .limit(100)\n    .cursor(cursor)\n    .getMany();\n  for (const r of page.results) yield r;\n  cursor = page.nextCursor;\n} while (cursor);\n```\n\n**Tradeoffs:** Prefix queries scale to ~24 MB/s per index value (the KVS limit). Above that, switch to bucketed prefixes (`protection-{shard}-{attachmentId}`).\n\n**Source:** Sentinel Vault `src/server/capsules/sealing/logic.js`, `src/server/capsules/policies/logic.js`.\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3691,
    "body": "**Problem:** Some Confluence operations work better with user context (correct permissions); others fail entirely without app context (no user in scheduled triggers). A single helper that tries both gives you maximum coverage.\n\n**Pattern:** Try `asUser` first; on `AUTH_TYPE_UNAVAILABLE` or transient `Hystrix`/5xx errors, fall through to `asApp`.\n\n```typescript\nimport api, { route } from '@forge/api';\n\nexport async function requestWithFallback(path, opts = {}) {\n  const strategies = [\n    { label: 'asUser', call: () => api.asUser().requestConfluence(route`${path}`, opts) },\n    { label: 'asApp',  call: () => api.asApp().requestConfluence(route`${path}`, opts) },\n  ];\n\n  for (const s of strategies) {\n    try {\n      const r = await s.call();\n      if (r.ok) return r;\n      // Hystrix circuit-breaker often returns 5xx with the word \"Hystrix\" in body\n      const text = await r.clone().text();\n      if (r.status >= 500 && text.includes('Hystrix') && s.label !== 'asApp') {\n        await sleep(2000);\n        continue;\n      }\n      return r; // any non-5xx, non-Hystrix → return for caller to inspect\n    } catch (err) {\n      // Forge surfaces \"no user context\" as PROXY_ERR AUTH_TYPE_UNAVAILABLE in scheduled triggers\n      if (/AUTH_TYPE_UNAVAILABLE/i.test(String(err)) && s.label !== 'asApp') continue;\n      throw err;\n    }\n  }\n}\n```\n\n**When this matters:** scheduled triggers and consumers run with no user context — `asUser()` will throw. Wrapping every call in this fallback means the same code paths work both in user-initiated UI flows and in background jobs.\n\n\n---\n\n## 11. Forge SQL config table with type helpers\n**Problem:** Storing dozens of admin-tunable settings (thresholds, feature flags, secrets, schedule intervals) as individual KVS keys gets messy fast — typos, no schema, no clear \"what settings exist?\" answer.\n\n**Pattern:** A single `app_config (config_key, config_value, updated_at)` table in Forge SQL, accessed via typed helpers and a constant manifest of key names.\n\n```typescript\n// src/utils/constants.ts\nexport const CONFIG_KEYS = {\n  INACTIVITY_DAYS:  'inactivity_days',\n  LICENSE_LIMIT:    'license_limit',\n  DRY_RUN:          'dry_run',\n  HMAC_SECRET:      'hmac_secret',\n  ORG_API_KEY:      'org_api_key',\n  ORG_ID:           'org_id',\n  REACTIVATION_URL: 'reactivation_url',\n} as const;\n```\n\n```typescript\n// src/services/config-service.ts\nimport { sql } from '@forge/sql';\nimport { CONFIG_KEYS } from '../utils/constants.js';\n\nexport async function getConfigValue(key: string): Promise<string | null> {\n  const r = await sql\n    .prepare<{ config_value: string }>('SELECT config_value FROM app_config WHERE config_key = ?')\n    .bindParams(key)\n    .execute();\n  return r.rows[0]?.config_value ?? null;\n}\n\nexport async function getConfigNumber(key: string, fallback: number): Promise<number> {\n  const v = await getConfigValue(key);\n  return v == null ? fallback : Number(v);\n}\n\nexport async function getConfigBoolean(key: string, fallback: boolean): Promise<boolean> {\n  const v = await getConfigValue(key);\n  return v == null ? fallback : v === 'true';\n}\n\nexport async function setConfigValue(key: string, value: string): Promise<void> {\n  await sql\n    .prepare(\n      `INSERT INTO app_config (config_key, config_value, updated_at)\n       VALUES (?, ?, ?)\n       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`\n    )\n    .bindParams(key, value, new Date().toISOString())\n    .execute();\n}\n```\n\n**Why SQL not KVS:** atomic upserts (`ON DUPLICATE KEY UPDATE`), one row per setting (not one KVS write per setting → less rate-limit pressure), and you get a real schema for migrations.\n\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2647,
    "body": "**Problem:** Every resolver action needs the SQL schema present and up-to-date, but you don't want to run migrations on every cold start manually.\n\n**Pattern:** A higher-order function that wraps every action with an idempotent `ensureMigrations()` call.\n\n```typescript\nimport Resolver from '@forge/resolver';\nimport { ensureMigrations } from '../services/migration-service.js';\n\nconst resolver = new Resolver();\n\nfunction withMigrations<A extends any[], R>(fn: (...args: A) => Promise<R>) {\n  return async (...args: A) => {\n    await ensureMigrations(); // idempotent — uses a \"current_schema_version\" row\n    return fn(...args);\n  };\n}\n\nresolver.define('getStats',     withMigrations(getStats));\nresolver.define('syncNow',      withMigrations(syncNow));\nresolver.define('updateConfig', withMigrations(updateConfig));\n// 13 more…\n\nexport const handler = resolver.getDefinitions();\n```\n\n\n---\n\n## 13. Atlassian Admin (Org) API integration from a Forge app\n**Problem:** You need data from `https://api.atlassian.com/admin/...` (org users, group memberships, last-active timestamps) — but Forge's `api.asApp().requestConfluence()` cannot reach that host.\n\n**Pattern:** Allowlist `api.atlassian.com`, store an Admin API key as a KVS secret (or read from `process.env`), and call out via `api.fetch`.\n\n```typescript\nimport api from '@forge/api';\nimport { kvs } from '@forge/kvs';\n\nlet cachedKey: string | null = null;\nlet cachedOrgId: string | null = null;\n\nasync function getCredentials() {\n  if (!cachedKey || !cachedOrgId) {\n    cachedKey   = process.env.ORG_API_KEY  ?? (await kvs.getSecret('org_api_key'));\n    cachedOrgId = process.env.ORG_ID       ?? (await kvs.get('org_id'));\n  }\n  return cachedKey && cachedOrgId ? { apiKey: cachedKey, orgId: cachedOrgId } : null;\n}\n\nexport async function orgFetch(path: string, init: RequestInit = {}) {\n  const creds = await getCredentials();\n  if (!creds) throw new Error('Admin API credentials not configured');\n  return api.fetch(`https://api.atlassian.com/admin${path}`, {\n    ...init,\n    headers: {\n      Authorization: `Bearer ${creds.apiKey}`,\n      Accept: 'application/json',\n      ...(init.headers ?? {}),\n    },\n  });\n}\n```\n\n```yaml\n# manifest.yml — required for the fetch above to work\npermissions:\n  external:\n    fetch:\n      backend:\n        - api.atlassian.com\n```\n\n> **Don't** sign a JWT locally and pass it as a Bearer token — `api.atlassian.com/admin` does not validate locally-signed JWTs. Use an Admin API key (issued at admin.atlassian.com → Settings → API keys) or an OAuth 2.0 access token. See the sibling `atlassian-organizations-api-skill` for full coverage.\n\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2841,
    "body": "**Problem:** You want to email a user but don't want to integrate Resend/SendGrid/SMTP and the Confluence \"post a mention comment\" trick (Pattern 6) doesn't fit your flow (no page context, etc.).\n\n**Pattern:** If you have Jira in the same site, create a single dummy issue per app installation, then `POST /rest/api/3/issue/{key}/notify`. Jira's notification engine emails the chosen recipients with your subject + HTML body.\n\n```typescript\nimport api, { route } from '@forge/api';\n\nexport async function sendEmailViaJira({\n  issueKey,           // a dummy issue you created at install time, persisted in config\n  toAccountIds,\n  subject,\n  htmlBody,\n}: { issueKey: string; toAccountIds: string[]; subject: string; htmlBody: string }) {\n  return api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/notify`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({\n      subject,\n      htmlBody,\n      to: { users: toAccountIds.map((accountId) => ({ accountId })) },\n    }),\n  });\n}\n```\n\n**Constraints:**\n- Requires Jira on the same site, plus `write:jira-work` and the persisted issue key.\n- Recipients must be Jira users.\n- Body is HTML (subset). Don't expect the same fidelity as a real mail provider.\n\n\n---\n\n## 15. Eventual-consistency protection (trust your local audit, not the REST group)\n**Problem:** You remove user X from a group via the Org API or Confluence REST. Two minutes later, your \"is X in group?\" check returns `true` because the index hasn't propagated yet. Your reactivation flow now lets X \"reactivate\" even though they were never actually deactivated.\n\n**Pattern:** Treat REST group membership as eventual; trust your local audit log (the row your app wrote when it called the deactivation endpoint) as the source of truth for app-level state machines.\n\n```typescript\n// reactivation-eligibility.ts\nexport async function isUserDeactivatedByApp(accountId: string): Promise<boolean> {\n  // Read OUR audit table, not a Confluence REST group check\n  const r = await sql.prepare<{ action: string; performed_at: string }>(\n    `SELECT action, performed_at\n       FROM deactivation_log\n      WHERE account_id = ?\n      ORDER BY performed_at DESC\n      LIMIT 1`,\n  ).bindParams(accountId).execute();\n\n  const last = r.rows[0];\n  if (!last) return false;\n  return last.action === 'deactivate';\n}\n```\n\n```typescript\n// In the reactivation handler:\nif (!(await isUserDeactivatedByApp(accountId))) {\n  return { statusCode: 400, body: 'not eligible — no record of app-initiated deactivation' };\n}\n// proceed with reactivation\n```\n\n**Why this matters:** without this, race conditions between trigger handlers, REST writes, and group-index propagation cause spurious \"user deactivated and reactivated three times in 90 seconds\" loops. Trusting your own log breaks the tie.\n\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2675,
    "body": "**Problem:** A trigger that fires on `avi:confluence:viewed:page` runs on every page open across the site. Re-reading config from KVS/SQL on each invocation adds latency and rate-limit pressure to your hottest path.\n\n**Pattern:** Cache config at **module scope** (the variable lives as long as the warm isolate) so repeated invocations within the same isolate reuse it. The cache evaporates naturally when the platform recycles the isolate, so there's no stale-forever risk — and a short TTL bounds it further.\n\n```typescript\n// Module scope — shared across invocations on the SAME warm isolate.\nlet cachedKey: string | null = null;\nlet cachedOrgId: string | null = null;\n\nasync function getCredentials() {\n  if (!cachedKey || !cachedOrgId) {\n    cachedKey   = process.env.ORG_API_KEY ?? (await kvs.getSecret('org_api_key'));\n    cachedOrgId = process.env.ORG_ID      ?? (await kvs.get('org_id'));\n  }\n  return cachedKey && cachedOrgId ? { apiKey: cachedKey, orgId: cachedOrgId } : null;\n}\n\n// Or with an explicit TTL when the value can change at runtime:\nlet cfg: { v: any; at: number } | null = null;\nconst TTL = 60_000;\nasync function getConfigCached() {\n  if (cfg && Date.now() - cfg.at < TTL) return cfg.v;\n  const v = await loadConfig();\n  cfg = { v, at: Date.now() };\n  return v;\n}\n```\n\n> **Caveat:** module-scope state is per-isolate and not shared across concurrent isolates — never use it for correctness-critical coordination (use KVS/SQL for that). It's a *latency* optimisation only. The migration-runner's `let migrationRan = false` guard (see `17-forge-sql.md`) is the same idea.\n\n\n---\n\n## 17. Debounced activity writes (adaptive window)\n**Problem:** A high-frequency event (page views) would hammer a single per-user row far beyond what you need — the data only needs day-level freshness.\n\n\n```typescript\nexport const DEBOUNCE_WITH_KEY_MS = 24 * 60 * 60 * 1000;\nexport const DEBOUNCE_WITHOUT_KEY_MS = 4 * 60 * 60 * 1000;\nexport const debounceWindowMs = (orgApiConfigured: boolean) =>\n  orgApiConfigured ? DEBOUNCE_WITH_KEY_MS : DEBOUNCE_WITHOUT_KEY_MS;\n\nexport async function recordActivityDebounced(accountId, eventType, windowMs) {\n  const existing = await getUserActivity(accountId);            // cheap PK lookup\n  if (!isWriteDue(existing?.last_active_at ?? null, Date.now(), windowMs)) return false;\n  await upsertActivity(accountId, eventType);                   // ON DUPLICATE KEY UPDATE\n  return true;\n}\n```\n\n> Forge product-event **subscriptions are static** (declared in `manifest.yml`). A runtime \"tracked events\" toggle reduces DB *writes* but not Forge *invocations* — to cut invocations you must trim the manifest and redeploy.\n\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2148,
    "body": "**Problem:** With a TypeScript app whose source is under `src/`, `forge lint` resolves `manifest.yml` `handler:` paths from the **repo root**, but the Forge bundler auto-prepends `src/`. A single entry file can't satisfy both.\n\n**Pattern:** Keep **two** barrel files that re-export the same handlers, and reference them with **no path** in the manifest (`handler: index.fn`):\n\n```typescript\n// /index.ts  (repo root — satisfies `forge lint`)\nexport { handler as trackActivity } from './src/handlers/track-activity';\nexport { handler as adminResolver } from './src/resolvers/admin-resolver';\n// …\n\n// /src/index.ts  (bundler auto-prepends `src/`)\nexport { handler as trackActivity } from './handlers/track-activity';\nexport { handler as adminResolver } from './resolvers/admin-resolver';\n// …\n```\n\n```yaml\n# manifest.yml — note: index.<fn>, no directory prefix\nfunction:\n  - key: trackActivity\n    handler: index.trackActivity\n  - key: checkInactivity\n    handler: index.checkInactivity\n    timeoutSeconds: 900\n```\n\n`package.json` `\"main\": \"src/index.ts\"`. Keep the two barrels in sync (same export names).\n\n\n---\n\n## 19. Custom UI: relative assets, portal dialogs, dark mode\n**Problem:** Custom UI iframes are easy to misconfigure: absolute asset paths 422 on deploy, overlay components get clipped by `overflow: hidden`, and Forge doesn't theme the iframe for you.\n\n**Patterns (each independent):**\n\n\n- **Portal overlays to `document.body`** — render Tooltip/ConfirmDialog/menus through a portal anchored at `document.body` so they escape any ancestor `overflow: hidden`/`transform` and aren't clipped inside the panel.\n\n- **Dark mode is opt-in** — Forge does **not** auto-theme Custom UI iframes. Read the theme from the bridge and apply it yourself:\n\n```javascript\nimport { view } from '@forge/bridge';\nconst theme = await view.theme();           // { colorMode: 'light' | 'dark' | ... }\ndocument.documentElement.dataset.theme = theme.colorMode;\n```\n\n- **Custom UI ↔ resolver auth** — never `AP.context.getToken()` (Atlassian Connect). Use `requestConfluence`/`invoke` from `@forge/bridge`; see the auth table in `SKILL.md`.\n\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3039,
    "body": "**Problem:** Content properties (per-page metadata exposed via `/wiki/api/v2/pages/{id}/properties`) require a **version number** on PUT. A mismatched version returns `409 Conflict`. Forgetting this is the #1 content-property bug.\n\n**Pattern:** GET first, increment, PUT with the new number.\n\n```javascript\nimport api, { route } from '@forge/api';\n\nasync function setContentProperty(pageId, key, value) {\n  // 1) Look up the existing property (if any) to read its current version\n  const get = await api.asApp().requestConfluence(\n    route`/wiki/api/v2/pages/${pageId}/properties?key=${key}&limit=1`\n  );\n  const list = await get.json();\n  const existing = list.results?.[0];\n\n  if (!existing) {\n    // First-time create: no version, just POST\n    return api.asApp().requestConfluence(\n      route`/wiki/api/v2/pages/${pageId}/properties`,\n      {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ key, value }),\n      }\n    );\n  }\n\n  // Existing: PUT with version.number = current + 1\n  const next = (existing.version?.number ?? 1) + 1;\n  return api.asApp().requestConfluence(\n    route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`,\n    {\n      method: 'PUT',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ key, value, version: { number: next } }),\n    }\n  );\n}\n```\n\n**Same trap exists for page bodies** — see `28-adf-and-storage-format.md`.\n\n**Source:** Sentinel Vault `src/server/infra/doc-surgery.js` (write-flag pattern around content properties).\n\n---\n\n## 4. ADF tree surgery (recursive traversal)\n**Problem:** You need to find or remove specific nodes in a page's ADF body — e.g. an extension/macro your app placed earlier — without rewriting the whole page or losing user content.\n\n**Pattern:** Recursive walker that returns a *new* tree with the targeted nodes filtered.\n\n```javascript\n// Find every media file id referenced in the doc (used by content protection)\nexport function collectMediaFileIds(node, out = new Set()) {\n  if (node?.type === 'media' && node.attrs?.id) out.add(node.attrs.id);\n  if (Array.isArray(node?.content)) {\n    for (const child of node.content) collectMediaFileIds(child, out);\n  }\n  return out;\n}\n\n// Remove all extension nodes whose extensionKey matches a target value\nexport function removeExtensions(node, extensionKey) {\n  if (Array.isArray(node?.content)) {\n    node.content = node.content\n      .filter((c) => !(c.type === 'extension' && c.attrs?.extensionKey === extensionKey))\n      .map((c) => removeExtensions(c, extensionKey));\n  }\n  return node;\n}\n\n// Inject your macro extension at the top of a page body\nexport function injectExtensionAtTop(adfDoc, extensionKey, parameters) {\n  const node = {\n    type: 'extension',\n    attrs: {\n      extensionType: 'com.atlassian.ecosystem',\n      extensionKey,\n      parameters,\n    },\n  };\n  return { ...adfDoc, content: [node, ...(adfDoc.content ?? [])] };\n}\n```\n\n**Source:** Sentinel Vault `src/server/infra/doc-surgery.js`.\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2952,
    "body": "**Problem:** Your trigger fires on `avi:confluence:updated:page`. Your handler updates the page. The update fires the trigger again. Infinite loop.\n\n**Pattern:** `filter.ignoreSelf: true` is **Jira-only — it is not supported for Confluence product events**, so the cached-app-accountId comparison *is* the defense here (not a fallback): cache the app's own `accountId` in KVS and discard events where the actor matches. (Confluence still delivers self-generated events; they carry `selfGenerated: true` on the payload, which you can also check.)\n\n```javascript\n// One-time bootstrap, cached in KVS\nimport api, { route } from '@forge/api';\nimport { kvs } from '@forge/kvs';\n\nlet _appAccountId = null;\nexport async function getAppAccountId() {\n  if (_appAccountId) return _appAccountId;\n  const cached = await kvs.get('app-account-id');\n  if (cached) return (_appAccountId = cached);\n\n  const r = await api.asApp().requestConfluence(route`/wiki/rest/api/user/current`);\n  const { accountId } = await r.json();\n  await kvs.set('app-account-id', accountId);\n  return (_appAccountId = accountId);\n}\n\n// In every trigger handler:\nexport async function onPageUpdated(event) {\n  const appId = await getAppAccountId();\n  if (event.atlassianId === appId) return; // skip our own writes\n  // …real work…\n}\n```\n\n**Source:** Sentinel Vault `src/server/triggers.js` (uses cached app account ID from KVS).\n\n---\n\n## 6. Native @mention notifications via storage-format XML\n**Problem:** You want to notify a specific user when something happens on a page (seal violation, license expiring, etc.) without integrating SendGrid / Resend / SMTP.\n\n**Pattern:** Post a footer comment that contains an `<ac:link><ri:user/>` mention. Confluence's notification engine emails the mentioned user according to *their* preferences — no external service required.\n\n```javascript\nimport api, { route } from '@forge/api';\n\nexport async function postMentionComment({ pageId, accountId, message }) {\n  // Storage format — note the lowercase ac: and ri: namespaces\n  const storageBody = `\n    <p>\n      <ac:link>\n        <ri:user ri:account-id=\"${accountId}\"/>\n      </ac:link>\n      ${escapeXml(message)}\n    </p>\n  `;\n\n  return api.asApp().requestConfluence(route`/wiki/api/v2/footer-comments`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({\n      pageId,\n      body: { representation: 'storage', value: storageBody },\n    }),\n  });\n}\n\nfunction escapeXml(s) {\n  return String(s)\n    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')\n    .replace(/\"/g, '&quot;').replace(/'/g, '&apos;');\n}\n```\n\n**Why storage format and not ADF mention?** Both formats accept mentions, but in practice the storage form is more reliable for triggering Confluence's email notification path. Sentinel Vault uses this exclusively.\n\n**Source:** Sentinel Vault `src/server/infra/notice-blueprints.js`, `outbound-notify.js`.\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2244,
    "body": "**Problem:** Scanning every page in a 10k-page space can't fit in a 25-second resolver, can't fit in a single 25-second trigger, and even a 900-second consumer can't always do it in one shot if you respect rate limits.\n\n**Pattern:** A scheduled trigger pushes a \"scan job\" onto a queue. The consumer pages through `/wiki/api/v2/spaces/{id}/pages?limit=100&cursor=...` until exhausted. State is keyed by `jobId` so reruns are idempotent.\n\n```javascript\nimport api, { route } from '@forge/api';\nimport { kvs } from '@forge/kvs';\nimport { Queue } from '@forge/events';\n\nconst scanQueue = new Queue({ key: 'space-scan-queue' });\n\nexport async function scanScheduledTrigger() {\n  const tracked = (await kvs.get('tracked-spaces')) ?? [];\n  for (const space of tracked) {\n    const meta = await kvs.get(`space-scan-status-${space.id}`);\n    if (meta?.status === 'scanning') continue; // already in flight\n    const jobId = `${space.id}-${Date.now()}`;\n    await kvs.set(`space-scan-status-${space.id}`, { status: 'scanning', jobId });\n    await scanQueue.push({ body: { jobId, spaceId: space.id } });\n  }\n}\n\nexport async function spaceScanConsumer(event) {\n  const { jobId, spaceId } = event.body;\n  let cursor;\n  let processed = 0;\n\n  do {\n    const url = cursor\n      ? `/wiki/api/v2/spaces/${spaceId}/pages?limit=100&cursor=${cursor}`\n      : `/wiki/api/v2/spaces/${spaceId}/pages?limit=100`;\n    const r = await api.asApp().requestConfluence(route`${url}`);\n    const data = await r.json();\n    for (const page of data.results) await visit(page); // rate-limit-aware\n    processed += data.results.length;\n    cursor = data._links?.next\n      ? new URL(data._links.next, 'https://x').searchParams.get('cursor')\n      : null;\n  } while (cursor);\n\n  await kvs.set(`space-scan-status-${spaceId}`, {\n    status: 'done', jobId, processed, finishedAt: new Date().toISOString(),\n  });\n}\n```\n\n**Optimization:** keep a `protections-last-modified` (or similar) timestamp in KVS. Skip the scan entirely if nothing has changed since the last run. Sentinel Vault's hourly index cron does this — without it, every hourly run re-scans every page in every space, which is prohibitive.\n\n**Source:** Sentinel Vault `src/server/capsules/realms/scan-worker.js`.\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3745,
    "body": "**Problem:** Different actions need different authority — anyone can manage their own seals, only space admins can force-unseal, only site admins can change global policy. You also want a configurable \"steward group\" mechanism.\n\n**Pattern:** OR three checks: site admin (Confluence groups), space admin (`/wiki/rest/api/space/{spaceKey}/permission/check`), explicit allowlist in KVS.\n\n```javascript\nasync function isSiteAdmin(accountId) {\n  const r = await api.asApp().requestConfluence(\n    route`/wiki/rest/api/user?accountId=${accountId}&expand=groups`\n  );\n  if (!r.ok) return false;\n  const { groups } = await r.json();\n  return (groups?.results ?? []).some(\n    (g) => g.name === 'site-admins' || g.name === 'confluence-administrators'\n  );\n}\n\nasync function hasSpaceAdmin(accountId, spaceKey) {\n  const r = await api.asApp().requestConfluence(\n    route`/wiki/rest/api/space/${spaceKey}/permission/check`,\n    {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation: 'administer' }),\n    }\n  );\n  if (!r.ok) return false;\n  const { hasPermission } = await r.json();\n  return Boolean(hasPermission);\n}\n\nasync function isInExplicitAllowlist(accountId, spaceKey) {\n  const policy = await kvs.get(`admin-settings-space-${spaceKey}`);\n  return Boolean(policy?.stewards?.includes(accountId));\n}\n\nexport async function isSteward(accountId, spaceKey) {\n  if (await isSiteAdmin(accountId)) return true;\n  if (await hasSpaceAdmin(accountId, spaceKey)) return true;\n  return isInExplicitAllowlist(accountId, spaceKey);\n}\n```\n\n**Source:** Sentinel Vault `src/server/shared/steward-checks.js`.\n\n---\n\n## 9. HMAC-signed web trigger for self-service flows\n**Problem:** You want to send a user an email link that lets them perform a privileged action (reactivate their account, approve a change, etc.) without forcing them through Atlassian login first.\n\n**Pattern:** Sign a token with HMAC-SHA256 over `{accountId, action, expiresAt}`, embed it in the URL, and verify on receipt with `timingSafeEqual`.\n\n```javascript\nimport { createHmac, timingSafeEqual } from 'crypto';\nimport { kvs } from '@forge/kvs';\n\nasync function getSecret() {\n  return (await kvs.getSecret('hmac-secret')) || process.env.HMAC_SECRET;\n}\n\nexport async function mintToken({ accountId, action, ttlMs = 24 * 3600 * 1000 }) {\n  const secret = await getSecret();\n  const expiresAt = Date.now() + ttlMs;\n  const payload = `${accountId}:${action}:${expiresAt}`;\n  const sig = createHmac('sha256', secret).update(payload).digest('base64url');\n  return Buffer.from(`${payload}:${sig}`).toString('base64url');\n}\n\nexport async function verifyToken(token) {\n  const decoded = Buffer.from(token, 'base64url').toString('utf8');\n  const [accountId, action, expiresAtStr, sig] = decoded.split(':');\n  if (!sig || Date.now() > Number(expiresAtStr)) return null;\n  const secret = await getSecret();\n  const expected = createHmac('sha256', secret)\n    .update(`${accountId}:${action}:${expiresAtStr}`)\n    .digest('base64url');\n  const a = Buffer.from(sig);\n  const b = Buffer.from(expected);\n  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;\n  return { accountId, action, expiresAt: Number(expiresAtStr) };\n}\n\n// Web trigger handler\nexport async function handleReactivation(event) {\n  const url = new URL(event.url);\n  const token = url.searchParams.get('t');\n  const claims = await verifyToken(token);\n  if (!claims) return { statusCode: 401, body: 'invalid or expired' };\n  if (claims.action !== 'reactivate') return { statusCode: 400, body: 'wrong action' };\n  await reactivateUser(claims.accountId);\n  return { statusCode: 200, body: 'reactivated' };\n}\n```\n\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2418,
    "body": "# Production Patterns (Confluence)\n\nProduction-tested patterns lifted from two shipping Confluence Forge apps:\n\n- **Sentinel Vault** — content protection / attachment-locking app, real-time event triggers, scheduled trigger fan-out, ADF surgery on every page open, three-level steward authorization, native @mention notifications.\n\nEach pattern lists the problem it solves, a copy-pasteable code excerpt, and a source pointer.\n\n## Index\n1. [Capsule-style resolver registration](#1-capsule-style-resolver-registration)\n2. [KVS prefix indexing with `WhereConditions.beginsWith`](#2-kvs-prefix-indexing-with-whereconditionsbeginswith)\n3. [Content-property version handling](#3-content-property-version-handling)\n4. [ADF tree surgery (recursive traversal)](#4-adf-tree-surgery-recursive-traversal)\n5. [App-account-id loop prevention](#5-app-account-id-loop-prevention)\n6. [Native `@mention` notifications via storage-format XML](#6-native-mention-notifications-via-storage-format-xml)\n7. [Cursor-paginated space scan from a queue](#7-cursor-paginated-space-scan-from-a-queue)\n8. [Three-level Confluence authorization](#8-three-level-confluence-authorization)\n9. [HMAC-signed web trigger for self-service flows](#9-hmac-signed-web-trigger-for-self-service-flows)\n10. [Dual-strategy `asUser` → `asApp` fallback](#10-dual-strategy-asuser--asapp-fallback)\n11. [Forge SQL config table with type helpers](#11-forge-sql-config-table-with-type-helpers)\n12. [Resolver middleware (`withMigrations`) wrapper](#12-resolver-middleware-withmigrations-wrapper)\n13. [Atlassian Admin (Org) API integration from a Forge app](#13-atlassian-admin-org-api-integration-from-a-forge-app)\n14. [Email without a third-party provider (Jira issue notify trick)](#14-email-without-a-third-party-provider-jira-issue-notify-trick)\n15. [Eventual-consistency protection (trust your local audit, not the REST group)](#15-eventual-consistency-protection-trust-your-local-audit-not-the-rest-group)\n16. [In-isolate config cache for high-frequency handlers](#16-in-isolate-config-cache-for-high-frequency-handlers)\n17. [Debounced activity writes (adaptive window)](#17-debounced-activity-writes-adaptive-window)\n18. [Dual `index.ts` handler resolution (TypeScript Forge apps)](#18-dual-indexts-handler-resolution-typescript-forge-apps)\n19. [Custom UI: relative assets, portal dialogs, dark mode](#19-custom-ui-relative-assets-portal-dialogs-dark-mode)\n\n---"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/24-production-patterns.md",
      "hash": "f309a04ef5f592eb",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 549,
    "body": "- `26-async-events-and-queues.md` — `@forge/events` reference (queues, retries)\n- `27-faas-limits-and-cost.md` — quotas these patterns work around\n- `28-adf-and-storage-format.md` — page body formats, `version.number`, ADF construction helpers\n- `12-permissions-scopes.md` — required scopes for the REST calls used above\n- `14-macros-and-section-sealing.md`, `15-forge-llm-integration.md`, `16-unified-content-triggers.md`, `17-forge-sql.md`, `18-unlicensed-access-and-web-triggers.md` — deep dives on the features these patterns come from"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 4073,
    "body": "1. **Contain at the SCHEDULING layer, never per call site.** Twelve polite callers\n   still add up to the same 137 pages. Gate whether a PASS runs; per-call 429\n   handling remains only as the reactive backstop. Never gate an AUTH path on\n   quota state — a background job's 429 must not lock admins out.\n2. **Count tripwires**: 1-pt member-count probes decide whether a full read runs.\n   Baselines must be RAW per-group counts keyed by group id, recorded by the same\n   representation you compare against (a filtered/union size never matches raw\n   totals — ships an inert tripwire that everyone believes works). Counts decide\n   whether to LOOK, never whether to ACT; exclude any consumer whose stale read\n   can revoke/destroy. Prove skips FIRE in prod logs — and log full-read REASONS\n   too, or flapping counts are indistinguishable from lost baselines.\n3. **Scheduled re-reads belong in a quiet window** (e.g. 18:00–05:00 UTC). The\n   count-can't-see swap case is schedule, not evidence: defer its re-baseline to\n   the night with a hard ceiling (bound the deferral on an EPISODE stamp set at\n   the first occurrence — a bound on a per-retry-restamped timestamp never fires).\n4. **Self-imposed soft budget** (e.g. 40k of 65k) with per-pass admission at\n   entry; exempt user-facing paths; clamp admitted cost to the whole budget or a\n   pass estimated above it parks forever; the computed hold must never be\n   persisted as an observed one.\n5. **Telemetry first**: meter 1+2×objects per response into an hourly\n   per-endpoint table (capture-only, never throws, never gates) BEFORE\n   optimizing. Our worst consumer was not the one anyone guessed — and one\n   consumer (auth memberof walks) was invisible until metered.\n6. **User-facing resilience**: the claim path falls back to the app's own count\n   (with an empty-read floor AND a near-cap margin) and writes through the Org\n   API pool — a real user got access back in 7s mid-storm.\n7. **Read-cost hygiene**: counts endpoints over member walks for display numbers;\n   delete unused pagers (especially any without a rate-limit gate); memoize\n   directory misses per invocation but record negatives ONLY from COMPLETE\n   listings and never persist them.\n8. **CREDIT YOUR OWN WRITES (2026-08-20).** An app that both watches group counts\n   (pattern 2) and writes memberships reads its own writes as external change:\n   one self-service grant at 11:00Z moved the managed count, and the 11:22Z\n   tripwire ordered the full ~36k-point sweep to discover the app's own write —\n   pool empty by :26. Keep a ledger of own membership writes at the LOWEST HTTP\n   write layer (the two-to-four functions every feature path drains through, so\n   no caller can forget it), and treat a count that moved exactly as far as your\n   ledgered writes as no-evidence. Credit only GENUINE state changes: Confluence\n   group add answers **409 for already-a-member**, DELETE **404 for\n   not-a-member**, Org API v2 memberships the same shape — a credited no-op is\n   the ONE inaccuracy that can mask a real external change (your phantom +1\n   cancelling a real +1); every other inaccuracy just costs one spurious full\n   read, so degrade toward \"no credit\" on any doubt (SQL error, missing baseline,\n   failed write). Sum per watched group since each consumer's OWN baseline stamp;\n   the residual maskable case (external change exactly cancelling real own\n   writes) is the same count-identical swap the bounded re-baseline (pattern 3)\n   has always existed to catch.\n9. **Failed-pass retries are schedule, not evidence (2026-08-20).** A repair pass\n   that retries a failed run every daytime hour spends the pool on a read that\n   keeps failing — ours finished off an already-tight hour at 14:23Z. Defer\n   retries of NON-load-bearing repair to the quiet window with bounded\n   degradation: >48h since last completion → retry any hour (a broken window\n   config degrades to old behaviour, never to \"never\"), never-completed → run\n   immediately (bootstrap must not be parked), and the operator's run-now button"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2273,
    "body": "bypasses everything. Persist the deferral in status, not only the log.\n10. **Grace windows are not ground truth (2026-08-20).** Auth resilience built as\n   a per-account stale-verdict TTL (serve the last proven verdict for ≤24h while\n   Atlassian refuses) still locks out any admin returning after a gap LONGER\n   than the grace, during an exhausted hour — widening the window (30min→24h\n   after the first incident) only moved the edge, and the edge was hit 8 days\n   later. Every fallback keyed to \"recent success\" expires; authorization that\n   must survive rate-limit storms needs durable local state (a mirrored small\n   group in SQL, refreshed opportunistically) whose staleness never opens a\n   deny-shaped hole.\n\n## Forge platform gotchas met on the way\n- `forge logs` silently caps output (~21 lines) — always pass `-n`.\n- Module scope survives warm containers: in-memory throttles/memos need explicit\n  time bounds; cross-invocation state belongs in SQL/KVS.\n- If your resolver wrapper authorizes BEFORE running migrations, any new column\n  read on the auth path must tolerate both schemas or a mid-storm deploy locks\n  admins out with no admin-path recovery.\n- `forge deploy` ships the existing `static/*/build` — rebuild frontends and\n  verify an in-app build stamp equals `git rev-parse --short HEAD`.\n- Cross-hop queue events drop ad-hoc fields — persist per-run attribution in the\n  run's own state blob, and always verify a threaded value has a PRODUCER.\n- **Forge SQL has its own installation rate limits**, hit in practice by\n  product-event handler storms: per-page-view tracking writes produced ~100\n  `ForgeSQLError RATE_LIMIT_EXCEEDED` (\"Limits for the current installation have\n  been exceeded\") in one burst (2026-08-20 11:44Z, 13.5k-user estate). Batch\n  event-driven SQL writes and treat this error as transient backpressure, not\n  data loss — but do NOT lean on SQL as a free relief valve inside hot loops.\n- The shared Tier-1 pool draining at the SAME wall-clock hour on different days\n  (`remaining=0` at ~:23 past 14:00Z on both 2026-08-12 and 2026-08-20, own\n  spend modest) is evidence of ANOTHER tenant's scheduled job in your pool —\n  export the per-hour ledger for the Tier-2 case rather than tuning your own app\n  harder."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2140,
    "body": "# Points-based rate limiting (enforced 2026-03-02) — surviving Tier 1\n\noutage → ~447k pts/day measured). Facts verified against\nhttps://developer.atlassian.com/cloud/confluence/rate-limiting/ on 2026-08-12 and\nre-verified 2026-08-26; re-verify before quoting, the tiers are still labelled beta\nin places.\n\n> ⚠ **2026-08-26 correction.** An earlier version of this file claimed \"~12-point\n> quiet hours\". That number was what four count-probes cost the app's OWN METER, not\n> what the hour cost. Atlassian's server-side telemetry for the same app came back at\n> **~1,110,000 pts/day (P75 66k/hr, P90 98k, max 102k)** against a self-reported\n> 250-280k — a ~4x under-count caused entirely by the app's own instrument. Never\n> quote a self-measured points figure without the reconciliation in §\"Measuring\n> truthfully\" below. If your meter and Atlassian's telemetry disagree, your meter is\n> wrong until proven otherwise.\n\n## The model (verified numbers)\n- **1 point per request**, +**2 points per identity object** returned (users,\n  groups, permissions), +1 per core content object (pages, spaces). Writes = 1.\n  ⇒ a `limit=200` group-members page = **401 points**.\n- **Tier 1 (default): 65,000 points/hour SHARED ACROSS EVERY INSTALL of your app**\n  — one noisy tenant starves the rest, and you can observe your pool being drained\n  by tenants you cannot see (measured: `remaining=0` at :23 past with own spend ≈ 0).\n- **Tier 2 (per-tenant, post-review only)**: Free 65k · Standard 100k+10/user ·\n  Premium 130k+20/user · Enterprise 150k+30/user, capped 500k/hr. No self-serve.\n- **Headers**: `Beta-RateLimit-Policy: \"global-app-quota\";q=65000;w=3600` (drops\n  the Beta- prefix at enforcement); on 429 `RateLimit-Reason` says which limit —\n  doc values `confluence-quota-global-based|tenant-based`, but LIVE we received\n  `conf-global-based`: match loosely. **Never infer your pool from silence** — the\n  header on a real 429 is the only proof a Tier-2 grant took effect.\n- The **Org Admin API is a separate pool** (~200 req/60s; pace ~325ms) and Forge\n  SQL/KVS cost nothing against either — both are relief valves."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 701,
    "body": "The docs and every Atlassian Staff answer say **per APP, shared across all tenants**:\n\"Your app shares a single 65,000 point hourly quota across all tenants.\" The word\n*environment* appears in NEITHER rate-limiting doc, in no staff post in the 174-post\nthread, and in the Forge environments doc.\n\non the **OAuth client id**, and that development/staging/production each therefore get\ntheir own 65k. **That is not documented anywhere and the published evidence points the\nother way** (a partner states in thread 98197 that \"the Global Pool applies across all\nenvironments\", uncorrected by two replying staff). Get it in writing before you plan\naround it, and do not assume your dev environment is free."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3091,
    "body": "`GET /wiki/api/v2/spaces/{id}/permissions` returns one row per (principal,\noperation), and **permissions are IDENTITY objects at 2 points each** — Atlassian's\nown cost table names \"Users, Groups, **Permissions**\". A partner reported, on this\nexact endpoint (thread 97828, post #157):\n\n> \"consumes two points. Not per call. Not per principal. **Two points per\n> permission.** ... Confluence generates 480 permissions for this space with two real\n> users, so invoking this endpoint once consumes nearly 1,000 points.\"\n\nAtlassian Staff replied \"I will review the point costs you highlighted and circle\nback\" (#160) and never did. At `limit=250` one page is **1 + 2×250 = 501 points**, so\na space whose permission list runs to 90 pages costs ~45,000 — most of a Tier-1 hour\nwalk was refused with `remaining=0` on page 94. At 1 pt/page those 94 pages are 94\npoints and the hour could not have been exhausted; at 501 they are ~47,000 and it\nlands exactly where it did.\n\nThe Confluence doc separately warns that \"**Permissions, Search, Admin operations**\"\ncarry additional burst protections beyond the points pool.\n\n## Measuring truthfully (the mistake that produced the 4x gap)\ncarried a \"CAPTURE ONLY: never gates\" contract — true of the function, false of the\nsystem, because a self-imposed budgeter summed its `est_points` to decide when to\nstand background work down. A meter that under-counts is a budgeter that never\nfires. Three defects, all worth checking in your own instrument:\n\n1. **Implementing only two of the three terms.** `points = 1 + 2*identity` drops\n   \"+1 per other object\" — every content object you read records as free.\n2. **The wrong argument at ONE call site.** One read passed its count as `objects:`\n   where the pricing line only read `identityObjects:`; a 250-row page booked as 1\n   point against 501. Grep every meter call site and make the odd one out impossible:\n   a test asserting the exact expected points per shape catches it, a structural\n   test does not.\n3. **Tallies that never reach storage.** Batched tallies flushed from background\n   handlers only; no resolver flushed, so everything spent serving the admin UI —\n   chiefly the authorisation walk — died with the isolate.\n\n**The ground truth is on every response.** `X-RateLimit-Remaining` (and\n`RateLimit-Policy` / `RateLimit` post-beta, carrying `q`, `w`, `r`, `t`) is\nAtlassian's own counter. The DELTA in `remaining` across two consecutive responses is\nthe true cost of what happened between them — which is how you calibrate a derived\nmodel against reality without asking anybody. Log it.\n\n**The Forge App metrics API cannot substitute.** `FORGE_API_REQUEST_COUNT`\n(developer.atlassian.com/platform/forge/export-app-metrics/) returns REQUEST counts;\nthe object multiplier is precisely the term it does not carry, so it cannot tell 1\npoint per page from 501.\n\n**Forge surfaces no Atlassian request/trace id to app code**, so a refusal in your\nlogs cannot be joined to a row in Atlassian's telemetry. Say so plainly in a support\nticket and offer to capture whatever header they name."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md",
      "hash": "fd00df96cdea4562",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2896,
    "body": "**Only app-initiated BACKEND traffic consumes points.** Atlassian Staff, on the\nrecord (community.developer.atlassian.com thread 97828, post #133):\n\n> \"For the March 2 enforcement, only app-initiated backend traffic counts toward\n> points-based rate limits. Direct, user-initiated UI calls from Forge UI to Jira or\n> Confluence using `@forge/bridge.requestJira` (with no resolver or backend) is\n> treated as standard UI traffic and is **not** included in points.\"\n\nAnd what IS counted (post #135): \"App-initiated backend calls — for example, UI →\nresolver → backend (`@forge/api`); Forge Remote flows invoked from the UI; Forge\nRemote flows invoked from backend code.\"\n\n⇒ **A read that exists only to paint a screen for the user in front of it can be\nmoved from a resolver to `@forge/bridge` and stops costing points entirely.** This is\nthe highest-leverage change available to a points-constrained Forge app and it is\nnot in the rate-limiting docs. Caveats before you reach for it: Atlassian reserve the\nright to include this category later \"with clear advance notice\"; `@forge/bridge`\ncalls run as the USER, so they see only what that user can see (a licence/admin view\nthat must be app-scoped cannot move); and it is not a laundering route for background\nwork — the exemption is for genuinely user-initiated UI reads.\n\n`asApp()` vs `asUser()` through `@forge/api` makes no difference: both are\napp-initiated backend calls. The line Atlassian draw is backend-vs-frontend, not\napp-vs-user.\n\n## The per-endpoint costs nobody publishes\n**There is no official per-endpoint cost catalog.** Atlassian publish exactly three\nworked Confluence examples (single page = 2, single space = 2, single user = 3) and\none multi-object example, on the JIRA page:\n\n> \"Since each user object costs 2 points ... `GET /rest/api/3/group/member` ...\n> Cost calculation: 1 (base) + 8 users = 17 points (1 + 8 × 2)\"\n\nEverything else you will read — here included — is DERIVED from the published rule\nplus the OpenAPI page-size defaults. Two consequences:\n\n- **The rule is not applied consistently.** A Marketplace partner measured Jira\n  endpoints that ignore it and charge a flat 1 point regardless of object count\n  (`project/{id}/version` at ~500 results → 1 point; `permissions/project` at ~1000\n  → 1). Their conclusion: \"we cannot trust the global rule documented so far.\"\n  Atlassian never answered. **Derived costs are upper bounds, not plans.**\n- **A POST that READS is ambiguous, and the fork is 500x.** The doc's write row is\n  keyed on HTTP verb but its description says \"operations that create, update, or\n  remove data\". `POST /wiki/api/v2/users-bulk` (250 ids) is therefore either 1 point\n  or 501. Partner measurements of `POST /rest/api/3/search/jql` show ~11.4 pts/call\n  against 50 calls, i.e. per-object. **Assume the expensive reading on a hot path\n  until you have measured it.**"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2710,
    "body": "# ADF and Storage Format — Confluence body formats\n\nConfluence pages are stored as a structured document. From the REST API you can ask for either of two body formats — they represent the same content but in very different shapes. Pick one consciously; mixing them halfway through a workflow is a common bug source.\n\n## The two formats\n| Format | What it is | Returned as | Use when |\n|---|---|---|---|\n| `atlas_doc_format` (ADF) | Atlassian Document Format — a JSON tree. Same shape used by Jira issues, comments, descriptions. | `body.atlas_doc_format.value` (a JSON string — `JSON.parse` it before traversing) | You're programmatically constructing or surgically editing pages. |\n| `storage` | Confluence's legacy XHTML \"storage format\". Tags include `<ac:link>`, `<ri:user/>`, `<ac:structured-macro/>`. | `body.storage.value` (an XML/HTML string) | You need a Confluence-specific element with no ADF equivalent (e.g. mention with `account-id`, certain macros), or you're integrating with older content. |\n\n> Forge UI Kit (`@forge/react`) renders ADF natively via the `Doc` component. Custom UI iframes render their own React; if you display Confluence content there, parse ADF with a library or convert to HTML.\n\n## Reading a page in ADF\n```javascript\nimport api, { route } from '@forge/api';\n\nconst r = await api.asApp().requestConfluence(\n  route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`\n);\nconst page = await r.json();\n\n// IMPORTANT: body.atlas_doc_format.value is a *stringified* JSON tree.\nconst adf = JSON.parse(page.body.atlas_doc_format.value);\n// adf.type === 'doc', adf.content is an array of block nodes\n```\n\n## Writing / updating a page (ADF)\n```javascript\nimport api, { route } from '@forge/api';\n\n// PUT requires the existing page version. Always GET → bump → PUT.\nconst get = await api.asApp().requestConfluence(\n  route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`\n);\nconst current = await get.json();\n\nconst newAdf = {\n  type: 'doc',\n  version: 1,\n  content: [\n    { type: 'paragraph', content: [{ type: 'text', text: 'Hello from Forge' }] },\n  ],\n};\n\nconst put = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {\n  method: 'PUT',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    id: pageId,\n    status: 'current',\n    title: current.title,                      // required even if unchanged\n    spaceId: current.spaceId,                  // required\n    body: { representation: 'atlas_doc_format', value: JSON.stringify(newAdf) },\n    version: { number: current.version.number + 1 },\n  }),\n});\n```\n\n> **Don't forget to bump `version.number`.** A mismatched version returns `409 Conflict`."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2480,
    "body": "```javascript\nconst paragraph = (text) => ({\n  type: 'paragraph',\n  content: [{ type: 'text', text }],\n});\n\nconst heading = (level, text) => ({\n  type: 'heading',\n  attrs: { level },\n  content: [{ type: 'text', text }],\n});\n\nconst bulletList = (items) => ({\n  type: 'bulletList',\n  content: items.map((it) => ({\n    type: 'listItem',\n    content: [paragraph(it)],\n  })),\n});\n\nconst codeBlock = (lang, src) => ({\n  type: 'codeBlock',\n  attrs: { language: lang },\n  content: [{ type: 'text', text: src }],\n});\n\nconst link = (text, href) => ({\n  type: 'text',\n  text,\n  marks: [{ type: 'link', attrs: { href } }],\n});\n\nconst panel = (kind, children) => ({\n  // kind: 'info' | 'note' | 'warning' | 'success' | 'error'\n  type: 'panel',\n  attrs: { panelType: kind },\n  content: children,\n});\n```\n\n## Why mentions are tricky\nA mention by `accountId` exists in both formats but with different shapes:\n\n```javascript\n// ADF mention node — what you build for a page body\n{\n  type: 'mention',\n  attrs: { id: 'ACCOUNT_ID', text: '@Display Name' },\n}\n```\n\n```xml\n<!-- Storage-format link with user-reference — what you put in a footer comment if the API requires it -->\n<p>\n  <ac:link>\n    <ri:user ri:account-id=\"ACCOUNT_ID\"/>\n  </ac:link>\n  please review this page.\n</p>\n```\n\nThe footer-comment endpoint accepts both, but historically the storage form is more reliable for triggering Confluence's @mention notification. Sentinel Vault uses storage-format XML for its notification comments for exactly this reason — it gets users emailed without needing an external mail service.\n\n## ADF tree surgery (recursive traversal)\nWhen you need to find or remove specific nodes (e.g. an extension/macro you placed earlier):\n\n```javascript\n// Collect every media node id referenced anywhere in the doc\nfunction collectMediaFileIds(node, out = new Set()) {\n  if (node.type === 'media' && node.attrs?.id) out.add(node.attrs.id);\n  if (Array.isArray(node.content)) for (const c of node.content) collectMediaFileIds(c, out);\n  return out;\n}\n\n// Remove all extension nodes whose extensionKey matches\nfunction removeExtensions(node, extensionKey) {\n  if (Array.isArray(node.content)) {\n    node.content = node.content.filter(\n      (c) => !(c.type === 'extension' && c.attrs?.extensionKey === extensionKey)\n    );\n    for (const c of node.content) removeExtensions(c, extensionKey);\n  }\n  return node;\n}\n```\n\n(Pattern lifted from Sentinel Vault's `doc-surgery.js` — see `24-production-patterns.md`.)"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2667,
    "body": "To answer \"did this ADF subtree actually change?\" you can't hash `JSON.stringify(node)` directly — object key order isn't guaranteed stable across reads, and the editor regenerates some attrs (`localId`) on a no-op save, so you'd get false-positive \"changed\" verdicts. **Canonicalise first**: recursively sort every object's keys and drop volatile keys, then hash.\n\n```javascript\nconst VOLATILE_ADF_KEYS = new Set([\"localId\"]);   // empirical (2026-06) — extend by round-tripping\n\nfunction canonicalizeAdf(value) {\n  if (Array.isArray(value)) return value.map(canonicalizeAdf);\n  if (value && typeof value === \"object\") {\n    const out = {};\n    for (const k of Object.keys(value).sort()) {\n      if (VOLATILE_ADF_KEYS.has(k)) continue;\n      const v = canonicalizeAdf(value[k]);\n      if (v !== undefined) out[k] = v;\n    }\n    return out;\n  }\n  return value;\n}\n\nfunction hashAdf(node) {                            // FNV-1a 32-bit → 8 hex chars\n  const str = JSON.stringify(canonicalizeAdf(node));\n  let h = 0x811c9dc5;\n  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))) >>> 0; }\n  return (\"0000000\" + h.toString(16)).slice(-8);\n}\n```\n\nStore the hash at \"seal\"/baseline time; on each edit, recompute and compare. Full pipeline (compare → restore-or-rebaseline) is in `16-unified-content-triggers.md`.\n\n## Building an extension node (your macro on a page)\n```javascript\n// Inject your own confluence:macro extension into a page\nconst extensionKey = `${appId}/${envId}/static/my-macro`;\nconst node = {\n  type: 'extension',\n  attrs: {\n    extensionType: 'com.atlassian.ecosystem',\n    extensionKey,\n    parameters: {\n      extensionId: `ari:cloud:ecosystem::extension/${appId}/${envId}/static/my-macro`,\n      // your macro's persisted config goes here\n    },\n  },\n};\n```\n\n## Storage format quick reference\n| Need | Storage tag |\n|---|---|\n| Mention by `accountId` | `<ac:link><ri:user ri:account-id=\"...\"/></ac:link>` |\n| Page link by id | `<ac:link><ri:page ri:content-id=\"...\"/></ac:link>` |\n| Status badge | `<ac:structured-macro ac:name=\"status\"><ac:parameter ac:name=\"title\">In Progress</ac:parameter></ac:structured-macro>` |\n| Info panel | `<ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p>…</p></ac:rich-text-body></ac:structured-macro>` |\n| Code block | `<ac:structured-macro ac:name=\"code\"><ac:parameter ac:name=\"language\">javascript</ac:parameter><ac:plain-text-body><![CDATA[…]]></ac:plain-text-body></ac:structured-macro>` |\n| Task list item | `<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>…</ac:task-body></ac:task></ac:task-list>` |"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/28-adf-and-storage-format.md",
      "hash": "0399deaad6f52a5e",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1705,
    "body": "Body format support varies between v1 and v2:\n\n| Endpoint | Body format support |\n|---|---|\n| v2 `/wiki/api/v2/pages/{id}` | `?body-format=atlas_doc_format` (preferred), `storage`, `view` |\n| v2 `/wiki/api/v2/blogposts/{id}` | same |\n| v2 `/wiki/api/v2/footer-comments` (POST) | `representation: 'atlas_doc_format'` or `'storage'` in body |\n| v1 `/wiki/rest/api/content/{id}` | `?expand=body.storage,body.atlas_doc_format,body.view` |\n\nStick to v2 for new code unless an operation is only available in v1 (CQL search, certain space operations, expanding macro bodies).\n\n## Common gotchas\n- **Stringified ADF**: `body.atlas_doc_format.value` is a string. Forgetting `JSON.parse` is the #1 ADF bug.\n- **`version.number` on PUT**: must be exactly `current + 1`. GET → bump → PUT, never compute it from a cached value.\n- **Title and spaceId required**: Confluence's PUT page is a full-replacement. Always include `title`, `status`, `spaceId`, and the full new body.\n- **Inline storage markup is HTML-like but case-sensitive**: `<ri:user>` (lowercase) works; `<RI:user>` doesn't.\n- **CDATA in code blocks**: storage format requires `<![CDATA[…]]>` wrapping for raw code.\n- **ADF version is `1`**: every `doc` node should have `version: 1`. Other numbers are not valid.\n\n## See also\n- `06-content-properties.md` — content-property schemas (separate from page body)\n- `24-production-patterns.md` — ADF tree-surgery and version-tracking patterns from Sentinel Vault\n- `08-api-endpoints.md` — REST endpoint reference\n- https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/ (ADF spec — same format used in Jira)\n- https://developer.atlassian.com/cloud/confluence/storage-format/"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/12-permissions-scopes.md",
      "hash": "5a59c6f071d52f01",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1981,
    "body": "```javascript\nimport { get } from '@forge/api';\n\nexport const handler = async (req) => {\n  // Function runs with app's permissions\n  const res = await get('/wiki/api/v2/pages', {\n    headers: { 'Accept': 'application/json' }\n  });\n  \n  return res;\n};\n```\n\n---\n\n## Issue: \"Permission denied\" when calling API\n**Error:** `403 Forbidden` or `insufficient permissions`\n\n**Solution:**\n1. Check required scope in API documentation\n2. Add scope to manifest.yml:\n```yaml\npermissions:\n  scopes:\n    - read:confluence-content.summary\n```\n3. Redeploy:\n```bash\nforge lint --fix && forge deploy && forge install --upgrade\n```\n\n## Issue: Missing external fetch permission\n**Error:** Network request fails for external API\n\n**Solution:**\n1. Add domain to manifest.yml:\n```yaml\npermissions:\n  external:\n    fetch:\n      backend:\n        - https://api.openai.com\n```\n2. Redeploy app\n\n---\n\n## Permission Hierarchy\n```\nread:confluence-content.summary (summary only)\n    └─ read:confluence-content (full access)\n\nread:confluence-space.summary (metadata only)\n    └─ write:confluence-space (modify space settings)\n```\n\n**Note:** Some operations require the higher-level scope even if you only need summary data.\n\n---\n\n## 1. Check Installed Permissions\nAfter deploying, verify permissions are granted:\n\n```bash\nforge display\n# Shows configured scopes and external permissions\n```\n\n## 2. Manual Test with cURL\n```bash\n# Get your app token from forge tunnel or deployment\nAPP_TOKEN=\"your-app-token\"\n\n# Test content read permission\ncurl -H \"Authorization: Bearer $APP_TOKEN\" \\\n     https://your-domain.atlassian.net/wiki/api/v2/pages\n\n# Test space read permission\ncurl -H \"Authorization: Bearer $APP_TOKEN\" \\\n     https://your-domain.atlassian.net/wiki/api/v2/spaces\n```\n\n---\n\n## Next Steps\n- **CLI Commands**: Learn how to deploy and manage permissions\n- **Real-world Patterns**: See permission handling in common scenarios\n- **API Endpoints**: Understand what scopes are needed for REST API calls"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/12-permissions-scopes.md",
      "hash": "5a59c6f071d52f01",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2613,
    "body": "| Event Type | Required Scopes |\n|------------|-----------------|\n| `avi:confluence:created:blogpost` | `read:confluence-content.summary` |\n| `avi:confluence:updated:blogpost` | `read:confluence-content.summary` |\n\n## Space Events\n| Event Type | Required Scopes |\n|------------|-----------------|\n| `avi:confluence:created:space:V2` | `read:confluence-space.summary` |\n| `avi:confluence:updated:space:V2` | `read:confluence-space.summary` |\n| `avi:confluence:permissions_updated:space:V2` | `read:confluence-space.summary`, `write:confluence-space` |\n\n## Content Property Events\n| Event Type | Required Scopes |\n|------------|-----------------|\n| `avi:confluence:created:contentproperty` | `read:confluence-content.summary` |\n| `avi:confluence:updated:contentproperty` | `read:confluence-content.summary` |\n\n---\n\n## Fetch Configuration\n```yaml\npermissions:\n  external:\n    fetch:\n      backend:                         # Backend to external API\n        - https://api.openai.com\n        - https://api.github.com\n        - https://slack.com/api\n      client:                          # Client-side (frontend)\n        - https://cdn.jsdelivr.net\n        - https://fonts.googleapis.com\n```\n\n## Image & Font Permissions\n```yaml\npermissions:\n  external:\n    images:                            # External image URLs\n      - https://example.com/images\n    fonts:                             # Custom font domains\n      - https://fonts.googleapis.com\n```\n\n---\n\n## 1. Request Minimum Required Scopes\n```yaml\n# Bad: Overly broad permissions\npermissions:\n  scopes:\n    - read:confluence-content         # Full content access\n    - write:confluence-space          # All space modifications\n\n# Good: Minimal required permissions\npermissions:\n  scopes:\n    - read:confluence-content.summary # Only metadata needed\n    - storage:app                     # For app data storage\n```\n\n## 2. Use lint --fix to Auto-Add Missing Scopes\n```bash\n# Automatically adds missing scopes based on code usage\nforge lint --fix\n```\n\n## 3. Check Permissions at Runtime (React UI)\n```javascript\nimport { usePermissions } from '@forge/react';\n\nconst MyComponent = () => {\n  const { hasPermission, missingPermissions, error } = usePermissions({\n    scopes: ['read:confluence-content', 'write:confluence-space'],\n    external: {\n      fetch: {\n        backend: ['https://api.example.com']\n      }\n    }\n  });\n\n  if (error) return <div>Error loading permissions</div>;\n  if (!hasPermission) {\n    return (\n      <div>\n        Missing permissions: {JSON.stringify(missingPermissions)}\n      </div>\n    );\n  }\n\n  return <div>Content goes here</div>;\n};\n```"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/12-permissions-scopes.md",
      "hash": "5a59c6f071d52f01",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2336,
    "body": "# Confluence Forge Permissions & OAuth Scopes\n\n## Overview\nForge apps use OAuth 2.0 scopes to request permissions for accessing Confluence data and services. These scopes must be declared in `manifest.yml` under the `permissions.scopes` section.\n\n---\n\n## Permission Structure\n```yaml\npermissions:\n  scopes:\n    - read:confluence-content.summary  # Basic content read access\n    - write:confluence-space           # Space modification permissions\n  external:\n    fetch:\n      backend:                         # External API access\n        - https://api.openai.com\n        - https://slack.com\n```\n\n---\n\n## Read Content Permissions\n| Scope | Access Level | Use Case |\n|-------|--------------|----------|\n| `read:confluence-content.summary` | View content metadata | List pages, search results |\n| `read:confluence-content` | Full content access | View page content, attachments |\n\n## Write Content Permissions\n| Scope | Access Level | Use Case |\n|-------|--------------|----------|\n| `write:confluence-content` | Create/modify content | Add pages, blog posts, comments |\n\n---\n\n## Space & Navigation Permissions\n| Scope | Access Level | Use Case |\n|-------|--------------|----------|\n| `read:confluence-space.summary` | View space metadata | List spaces, get space info |\n| `write:confluence-space` | Modify space settings | Update space name, description |\n| `read:space:confluence` | Full space read access | Space-level operations |\n| `write:space:confluence` | Full space write access | Space configuration changes |\n\n---\n\n## User & Activity Permissions\n| Scope | Access Level | Use Case |\n|-------|--------------|----------|\n| `read:confluence-user` | View user information | Get user details, avatars |\n| `read:confluence-group` | View group membership | Check if user is in a group |\n\n---\n\n## System & Storage Permissions\n| Scope | Access Level | Use Case |\n|-------|--------------|----------|\n| `storage:app` | App storage (KVS) | Store key-value data |\n| `read:app-system-token` | System token access | Remote webhook authentication |\n\n---\n\n## Page Events\n| Event Type | Required Scopes |\n|------------|-----------------|\n| `avi:confluence:created:page` | `read:confluence-content.summary` |\n| `avi:confluence:updated:page` | `read:confluence-content.summary` |\n| `avi:confluence:deleted:page` | `read:confluence-content.summary` |"
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2123,
    "body": "Sentinel's whole feature is built on prefix-addressable KVS keys (see `24-production-patterns.md` Pattern 2 for the general technique). The seal feature uses:\n\n| Key | Holds | TTL |\n|---|---|---|\n| `protection-{artifactId}` | attachment seal: `{ lockedBy, expiresAt, sealedVersion, sealedFileId, contentId, spaceId, attachmentName }` | none |\n| `space-protection-{spaceId}-{artifactId}` | per-space seal index entry (realm-scoped queries) | none |\n| `section-protection-{sectionId}` | section seal: `{ pageId, lockedBy, expiresAt, sectionId, sectionTitle, contentHash }` | none |\n| `section-snapshot-{sectionId}` | `{ wrapperNode, bodyContent, hash, originalIndex }` — the sealed body, for restore | none |\n| `edit-grant-{artifactId}-{editorAccountId}` | active edit authority | = `seal.expiresAt` |\n| `edit-request-{artifactId}-{requesterAccountId}` | pending/denied edit request | — |\n| `section-edit-grant-{sectionId}-{accountId}` / `section-edit-request-{sectionId}-{accountId}` | section variants | — |\n| `protections-last-modified` | global timestamp so the index cron can skip a no-op scan | — |\n| `app-account-id` / `macro-extension-key` / `section-macro-extension-key` | cached app identity / derived extension keys | — |\n\n**Content-property fast-path marker.** Before doing an expensive `kvs.query().beginsWith(...)`, Sentinel asks Confluence whether the page even carries a seal, using a content property keyed `protection-` (and `section-protection-`) written via `writeSealContentProp()`. The page-content trigger probes this first and bails with zero ADF reads if the page has no seal property:\n\n```javascript\n// triggers.js — collectMediaSealsForPage()\nconst propsResponse = await asApp().requestConfluence(\n  route`/wiki/api/v2/pages/${pageId}/properties?key=protection-`);\nif (!propsResponse.ok) return [];\nconst propsData = await propsResponse.json();\nif (!propsData.results?.length) return [];   // no seal on this page → skip entirely\n// only now run the KVS prefix query\n```\n\nContent-property writes follow the GET→bump version→PUT rule (see Pattern 3 in `24-production-patterns.md`)."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3258,
    "body": "# Macros & Section Sealing\n\nHow to use a **bodied macro** as a durable, tamper-detectable anchor inside a page body, and the KVS/content-property machinery that backs it. Grounded in Sentinel Vault's Content Sealing feature (`src/server/capsules/sealing/`, `src/server/capsules/section-seals/`, `src/server/infra/doc-surgery.js`).\n\nThis extends `content-macro.yml` (standard inline macro) and `21-custom-content.md`. The new idea here is using a macro's **own stable identifier** to correlate an in-body node with an app-side record across arbitrary user edits.\n\n## Standard vs bodied macro\n| | Standard `macro` | **Bodied `macro`** (`layout: bodied`) |\n|---|---|---|\n| ADF node type | `extension` | `bodiedExtension` (has its own `content[]` you wrap user content in) |\n| Use | Render dynamic content from config | Seal/annotate a *region* of the page; the user's own content lives inside |\n| Config UI | `config.resource` + `openOnInsert` | same |\n\nSentinel declares both in one manifest (`manifest.yml`):\n\n```yaml\nmacro:\n  - key: sentinel-vault-panel            # standard: file-reservation status panel\n    resource: inline-panel-ui\n    resolver: { function: action-router }\n    layout: block\n    config: { resource: panel-setup-ui, openOnInsert: false, viewportSize: medium }\n\n  - key: sentinel-vault-sealed-section   # bodied: locks the content inside this section\n    resource: section-setup-ui\n    resolver: { function: action-router }\n    layout: bodied\n    config: { resource: section-setup-ui, openOnInsert: true, viewportSize: medium }\n```\n\n`openOnInsert: true` opens the config dialog the moment the author inserts the macro — that's where you mint and persist the section's identity (below).\n\n## The stable sectionId trick\nA `bodiedExtension` node Confluence regenerates `localId` on across saves, so you can't rely on `localId` alone to recognise \"the same sealed section\" after an edit. Sentinel issues its **own** `sectionId` at seal time and stores it in the macro's config parameters, falling back to `localId`:\n\n```javascript\n// doc-surgery.js\nexport function getSectionId(node) {\n  return (\n    node?.attrs?.parameters?.guestParams?.sectionId ||   // app-issued, survives edits\n    node?.attrs?.parameters?.sectionId ||\n    node?.attrs?.localId ||                               // last-resort platform id\n    null\n  );\n}\n\nexport function buildSealedSectionNode({ sectionId, extensionKey, bodyContent }) {\n  const [appId, envId] = extensionKey.split(\"/\");\n  return {\n    type: \"bodiedExtension\",\n    attrs: {\n      extensionType: \"com.atlassian.ecosystem\",\n      extensionKey,\n      layout: \"default\",\n      parameters: {\n        extensionId: `ari:cloud:ecosystem::extension/${appId}/${envId}${SEALED_SECTION_KEY_SUFFIX}`,\n        extensionTitle: \"Sentinel Vault Sealed Section\",\n        guestParams: { sectionId },           // ← stable correlation key\n      },\n    },\n    content: Array.isArray(bodyContent) && bodyContent.length ? bodyContent\n      : [{ type: \"paragraph\", content: [] }],\n  };\n}\n```\n\nThe extension key is derived at runtime from `getAppContext()` (`<appId>/<envId>/static/<module-key>`) and cached in KVS — never hardcoded, because it differs per environment. See `resolveSealedSectionKey()` in `doc-surgery.js`."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1220,
    "body": "For a space-admin console that lists every seal in a space, write a per-artifact index key at seal time and query it by prefix (`confluence-sync.js`):\n\n```javascript\n// write index entry\nawait kvs.set(`space-protection-${realmId}-${artifactId}`, {\n  attachmentId, attachmentName, lockedBy, timestamp, expiresAt, contentId, spaceKey, pageTitle, ...\n});\n\n// later: every seal in this realm, O(prefix)\nconst { results } = await kvs.query()\n  .where(\"key\", WhereConditions.beginsWith(`space-protection-${realmId}-`))\n  .limit(100).getMany();\n```\n\nWhen a realm's seal volume exceeds the per-index-value throughput (24 MB/s — see `27-faas-limits-and-cost.md`), bucket the prefix (`space-protection-{realmId}-{shard}-{artifactId}`) and fan the query across buckets.\n\n## See also\n- `16-unified-content-triggers.md` — the single-read/passes/single-write trigger that enforces these seals, canonical ADF hashing, loop prevention.\n- `24-production-patterns.md` — Pattern 2 (KVS prefix indexing), Pattern 3 (content-property versioning), Pattern 4 (ADF surgery).\n- `28-adf-and-storage-format.md` — `bodiedExtension` node shape, `version.number` rules.\n- `06-content-properties.md` — content-property CRUD and CQL indexing."
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
    "provenance": {
      "source": "confluence-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-confluence-forge-skill/docs/14-macros-and-section-sealing.md",
      "hash": "8680837dff80bfdf",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3529,
    "body": "`computeSealStatus(artifactId, operatorAccountId)` (`sealing/logic.js`) collapses the record + expiry + actor into one of three states:\n\n```javascript\n// OPEN          → no live seal (or it just expired and was auto-cleaned)\n// HELD          → sealed by someone else\n// HELD_BY_ACTOR → sealed by the current operator (they may edit freely)\n```\n\nExpiry is **lazy + swept**: a read that finds `expiresAt < now` deletes the record inline (`computeSealStatus`, `breakSeal`), and the hourly `expirySweepTask` notifies owners. Auto-unseal is feature-flagged by `admin-settings-global.autoUnlockEnabled` — when off, the seal is kept and a `recurringNudgeTask` records a banner-only reminder every `reminderIntervalDays`.\n\n## Edit-request grants\nRather than mutate the seal record (which many flows rewrite), grants live in **sidecar keys** that carry a KVS TTL equal to the seal's `expiresAt`, so they self-expire with the seal:\n\n```javascript\n// editreq/logic.js — single O(1) read the trigger uses to authorize an edit\nexport async function getActiveEditGrant(attachmentId, accountId) {\n  const grant = await kvs.get(`edit-grant-${attachmentId}-${accountId}`);\n  if (!grant) return null;\n  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) return null;\n  return grant;\n}\n```\n\nWhen an approved editor edits, the trigger **re-baselines** instead of reverting — it stores the new `sealedVersion`/`sealedFileId` (attachments) or the new `contentHash` + snapshot (sections), so future reverts compare against the edited content (`triggers.js` `handleSealedArtifactEdit`, `restoreSealedSectionsPass`). On any seal teardown, `sweepEditAccess(artifactId)` prefix-deletes all grants and requests so a re-seal starts clean.\n\n## Attachment version reversion — there is no v2 \"revert\" API\nTo roll a tampered attachment back to its sealed version, you cannot call a v2 \"set version\" endpoint — it doesn't exist. The working recipe (`triggers.js:510-614`) is **download the old version (v1), re-upload it as new data (v1)**:\n\n```javascript\n// 1) download the sealed version (v1 download endpoint takes ?version=N)\nconst dl = await asApp().requestConfluence(\n  route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download?version=${targetVersion}`);\nconst fileBuffer = await dl.arrayBuffer();\n\n// 2) re-upload as the current data — v1 data endpoint, multipart, nocheck token\nconst form = new FormData();\nform.append(\"file\", new Blob([fileBuffer]), artifactDetails.title);\nform.append(\"comment\", \"(Sentinel Vault automatically reversed modifications)\");\nform.append(\"minorEdit\", \"true\");                       // don't spam the activity feed\nawait asApp().requestConfluence(\n  route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/data`,\n  { method: \"POST\", headers: { \"X-Atlassian-Token\": \"nocheck\" }, body: form });\n```\n\n`X-Atlassian-Token: nocheck` is **required** for the multipart upload (XSRF bypass for API clients). Prefer `sealedVersion` captured at seal time as the revert target; fall back to `currentVersion - 1`.\n\n**Trash vs permanent-delete are separate events** with different recovery:\n- `avi:confluence:trashed:attachment` → restorable: `PUT /wiki/rest/api/content/{pageId}/child/attachment/{artifactId}` with `status: \"current\"` and `version.number: current+1`. If the PUT fails the attachment is unrecoverable → clean up the seal.\n- `avi:confluence:deleted:attachment` → permanent; you can only notify and clean up KVS/content-property/grants."
  }
];

export default SECTIONS;
