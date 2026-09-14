/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "forge-platform-facts" — 23 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "forge-platform-facts";

export const SECTIONS = [
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2524,
    "body": "```javascript\nasync function getIssueIfChanged(issueKey, previousEtag) {\n  const response = await api.asApp().requestJira(\n    route`/rest/api/3/issue/${issueKey}`,\n    {\n      headers: {\n        'If-None-Match': previousEtag\n      }\n    }\n  );\n  \n  if (response.status === 304) {\n    return null; // Not modified, use cached data\n  }\n  \n  return await response.json();\n}\n```\n\n---\n\n## Pattern: Distributed Updates with Delays\n```javascript\nasync function batchUpdateIssue(issueKey, updates) {\n  const BATCH_SIZE = 10; // Max writes per ~2 seconds\n  \n  for (let i = 0; i < updates.length; i += BATCH_SIZE) {\n    const batch = updates.slice(i, i + BATCH_SIZE);\n    \n    await Promise.all(\n      batch.map(update => \n        api.asApp().requestJira(\n          route`/rest/api/3/issue/${issueKey}`,\n          {\n            method: 'PUT',\n            body: JSON.stringify(update)\n          }\n        )\n      )\n    );\n    \n    // Add delay between batches\n    if (i + BATCH_SIZE < updates.length) {\n      console.log(`Pausing before next batch...`);\n      await new Promise(resolve => setTimeout(resolve, 2000));\n    }\n  }\n}\n```\n\n---\n\n## Log Quota Usage Periodically\n```javascript\n// Add to your scheduled trigger for monitoring\nexport const checkRateLimits = async () => {\n  // This won't directly give quota, but you can track from headers\n  console.log('Checking rate limit status...');\n  \n  try {\n    // Make a lightweight request to get current limits\n    const response = await api.asApp().requestJira(\n      route`/rest/api/3/myself`\n    );\n    \n    const policy = response.headers.get('Beta-RateLimit-Policy');\n    const limit = response.headers.get('Beta-RateLimit');\n    \n    console.log('Rate Limit Policy:', policy);\n    console.log('Rate Limit Status:', limit);\n    \n  } catch (error) {\n    console.error('Error checking rate limits:', error.message);\n  }\n};\n```\n\n---\n\n## Summary: Rate Limit Response Handling\n| Header | Purpose | Action |\n|--------|---------|--------|\n| `Beta-RateLimit-Policy` | Shows current quota policy | Track limit type (global vs tenant) |\n| `Beta-RateLimit` with r=0 | Quota exhausted | Stop all requests until reset |\n| `RateLimit-Reason: jira-quota-*` | Hourly quota exceeded | Wait for hour reset |\n| `RateLimit-Reason: jira-burst-based` | Per-second limit hit | Slow down, retry after delay |\n| `RateLimit-Reason: jira-per-issue-on-write` | Too many writes to one issue | Add delays between updates |\n| `Retry-After` | Seconds until safe retry | Wait this duration before retrying |\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3930,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\nclass RateLimitedApiClient {\n  constructor() {\n    this.quotaUsed = 0;\n    this.quotaLimit = 65000; // Default Global Pool\n    this.windowStart = Date.now();\n    this.pendingRequests = [];\n  }\n\n  /**\n   * Parse rate limit headers to update quota tracking\n   */\n  updateQuotaFromHeaders(headers) {\n    const policy = headers.get('Beta-RateLimit-Policy');\n    const limit = headers.get('Beta-RateLimit');\n    \n    if (policy && limit) {\n      // Extract remaining from Beta-RateLimit header\n      const match = limit.match(/r=(\\d+)/);\n      if (match) {\n        this.quotaUsed = this.quotaLimit - parseInt(match[1]);\n      }\n      \n      // Update quota limit if different tier\n      const policyMatch = policy.match(/q=(\\d+)/);\n      if (policyMatch) {\n        this.quotaLimit = parseInt(policyMatch[1]);\n      }\n    }\n  }\n\n  /**\n   * Check if we should pause requests based on quota\n   */\n  shouldPauseRequests() {\n    // Pause if less than 5% of quota remaining\n    const remainingPercent = (this.quotaLimit - this.quotaUsed) / this.quotaLimit;\n    return remainingPercent < 0.05;\n  }\n\n  /**\n   * Calculate points cost for a request\n   */\n  estimatePoints(method, objectsReturned = 1) {\n    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {\n      return 1; // Write operations cost base only\n    }\n    \n    // Read operations: base + object costs\n    const objectCost = 1; // Default for most objects\n    return 1 + (objectsReturned * objectCost);\n  }\n\n  /**\n   * Make a rate-limit aware request\n   */\n  async request(path, options = {}) {\n    const method = options.method || 'GET';\n    \n    // Check if we should pause due to quota\n    if (this.shouldPauseRequests()) {\n      console.warn('Approaching quota limit, pausing requests');\n      await this.waitUntilQuotaReset();\n    }\n\n    let response;\n    try {\n      response = await api.asApp().requestJira(\n        route`${path}`,\n        options\n      );\n      \n      // Update quota tracking from headers\n      this.updateQuotaFromHeaders(response.headers);\n      \n      const rateLimitReason = response.headers.get('RateLimit-Reason');\n      \n      if (response.status === 429) {\n        const retryAfter = parseInt(response.headers.get('Retry-After')) || 1;\n        \n        // Handle different rate limit types differently\n        switch (rateLimitReason) {\n          case 'jira-per-issue-on-write':\n            console.log('Per-issue write limit hit, waiting...', retryAfter);\n            await new Promise(r => setTimeout(r, retryAfter * 1000));\n            return this.request(path, options); // Retry\n            \n          case 'jira-burst-based':\n            console.log('Burst limit hit, slowing down...');\n            await new Promise(r => setTimeout(r, retryAfter * 1000));\n            return this.request(path, options); // Retry\n            \n          case 'jira-quota-global-based':\n          case 'jira-quota-tenant-based':\n            console.log('Hourly quota exhausted, waiting until reset...');\n            await this.waitUntilQuotaReset();\n            return this.request(path, options); // Retry\n            \n          default:\n            throw new Error(`Unknown rate limit reason: ${rateLimitReason}`);\n        }\n      }\n      \n      return response;\n      \n    } catch (error) {\n      console.error('API request failed:', error.message);\n      throw error;\n    }\n  }\n\n  /**\n   * Wait until current quota window resets\n   */\n  async waitUntilQuotaReset() {\n    const now = Date.now();\n    const nextHour = new Date(now + (60 - new Date().getMinutes()) * 60 * 1000).getTime();\n    const secondsToWait = Math.ceil((nextHour - now) / 1000);\n    \n    console.log(`Waiting ${secondsToWait} seconds until quota reset...`);\n    await new Promise(resolve => setTimeout(resolve, secondsToWait * 1000));\n    \n    // Reset tracking\n    this.quotaUsed = 0;\n    this.windowStart = Date.now();\n  }"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2877,
    "body": "/**\n   * Get current quota status\n   */\n  getQuotaStatus() {\n    return {\n      used: this.quotaUsed,\n      limit: this.quotaLimit,\n      remaining: this.quotaLimit - this.quotaUsed,\n      percentUsed: (this.quotaUsed / this.quotaLimit) * 100\n    };\n  }\n}\n\n// Usage\nconst client = new RateLimitedApiClient();\n\n// Make requests with automatic rate limit handling\nconst issueResponse = await client.request(\n  route`/rest/api/3/issue/PROJ-123`,\n  { method: 'GET' }\n);\n\n// Check quota status\nconsole.log('Quota status:', client.getQuotaStatus());\n```\n\n---\n\n## 1. Field Filtering\n**Bad:** Fetching all fields\n```javascript\nconst response = await api.asApp().requestJira(route`/rest/api/3/issue/PROJ-123`);\n```\n\n**Good:** Request only needed fields\n```javascript\nconst response = await api.asApp().requestJira(\n  route`/rest/api/3/issue/PROJ-123?fields=summary,status,assignee,reporter`\n);\n```\n\n## 2. Use Expand Wisely\n**Bad:** Expanding everything\n```javascript\nconst response = await api.asApp().requestJira(\n  route`/rest/api/3/issue/PROJ-123?expand=renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations`\n);\n```\n\n**Good:** Expand only what you need\n```javascript\nconst response = await api.asApp().requestJira(\n  route`/rest/api/3/issue/PROJ-123?expand=changelog` // Only if you need history\n);\n```\n\n## 3. Batch Operations\n**Bad:** Multiple individual updates\n```javascript\nfor (const issueKey of issueKeys) {\n  await api.asApp().requestJira(\n    route`/rest/api/3/issue/${issueKey}`,\n    { method: 'PUT', body: JSON.stringify({ fields }) }\n  );\n}\n```\n\n**Good:** Use bulk endpoints where available\n```javascript\n// Jira doesn't have a true bulk update endpoint, but you can:\n// 1. Parallelize with Promise.all (faster but same points)\nconst updates = issueKeys.map(key => \n  api.asApp().requestJira(\n    route`/rest/api/3/issue/${key}`,\n    { method: 'PUT', body: JSON.stringify({ fields }) }\n  )\n);\nawait Promise.all(updates);\n\n// 2. Or use search + bulk update pattern if modifying many issues\n```\n\n## 4. Cache Stable Responses\n```javascript\nimport api, { route } from '@forge/api';\n\nconst cache = new Map();\n\nasync function getCachedIssue(issueKey) {\n  const cacheKey = `issue:${issueKey}`;\n  \n  // Check in-memory cache first (lasts one invocation)\n  if (cache.has(cacheKey)) {\n    return cache.get(cacheKey);\n  }\n  \n  // Fetch from API\n  const response = await api.asApp().requestJira(\n    route`/rest/api/3/issue/${issueKey}`\n  );\n  const data = await response.json();\n  \n  // Store in cache\n  cache.set(cacheKey, data);\n  \n  return data;\n}\n\n// Use throughout your resolver\nresolver.define('getIssueData', async (payload) => {\n  const issue = await getCachedIssue(payload.issueKey);\n  return {\n    summary: issue.fields.summary,\n    // Reuse cached issue for other operations in same invocation\n    status: issue.fields.status.name\n  };\n});\n```"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3039,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\nasync function checkRateLimits(response) {\n  const headers = {\n    rateLimitPolicy: response.headers.get('Beta-RateLimit-Policy'),\n    rateLimit: response.headers.get('Beta-RateLimit'),\n    rateLimitReason: response.headers.get('RateLimit-Reason'),\n    retryAfter: response.headers.get('Retry-After')\n  };\n\n  // Check if near limit (less than 20% remaining)\n  const isNearLimit = response.headers.get('X-Beta-RateLimit-NearLimit') === 'true';\n  \n  return {\n    isRateLimited: response.status === 429,\n    reason: headers.rateLimitReason,\n    retryAfter: parseInt(headers.retryAfter) || 0,\n    isNearLimit,\n    headers\n  };\n}\n\n// Usage\nconst response = await api.asApp().requestJira(route`/rest/api/3/issue/PROJ-123`);\nconst limits = await checkRateLimits(response);\n\nif (limits.isRateLimited) {\n  console.log(`Rate limited: ${limits.reason}, retry after ${limits.retryAfter}s`);\n}\n```\n\n---\n\n## Complete Retry Logic\n```javascript\n/**\n * Implements exponential backoff with jitter for rate limit handling\n */\nasync function fetchWithRetry(\n  url, \n  options = {},\n  maxRetries = 4,\n  baseDelayMs = 2000,\n  maxDelayMs = 30000\n) {\n  let lastError;\n  \n  for (let attempt = 0; attempt <= maxRetries; attempt++) {\n    try {\n      const response = await api.asApp().requestJira(url, options);\n      \n      // Handle non-rate-limit errors\n      if (!response.ok && response.status !== 429) {\n        throw new Error(`HTTP ${response.status}: ${await response.text()}`);\n      }\n      \n      // Check for rate limit\n      const retryAfter = response.headers.get('Retry-After');\n      const rateLimitReason = response.headers.get('RateLimit-Reason');\n      \n      if (response.status === 429) {\n        console.log(`Attempt ${attempt + 1}/${maxRetries}: Rate limited (${rateLimitReason})`);\n        \n        // Use Retry-After header or calculate delay\n        let delayMs;\n        if (retryAfter) {\n          delayMs = Math.min(parseInt(retryAfter) * 1000, maxDelayMs);\n        } else {\n          // Exponential backoff: base * 2^attempt\n          delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);\n          \n          // Add jitter (random factor between 0.7 and 1.3)\n          const jitter = 0.7 + Math.random() * 0.6;\n          delayMs *= jitter;\n        }\n        \n        console.log(`Waiting ${delayMs}ms before retry...`);\n        await new Promise(resolve => setTimeout(resolve, delayMs));\n        continue; // Retry\n      }\n      \n      return response; // Success\n      \n    } catch (error) {\n      lastError = error;\n      console.error(`Attempt ${attempt + 1} failed:`, error.message);\n    }\n  }\n  \n  throw new Error(`Max retries exceeded. Last error: ${lastError.message}`);\n}\n\n// Usage example\nconst response = await fetchWithRetry(\n  route`/rest/api/3/search?jql=project=PROJ`,\n  { method: 'GET' },\n  4,           // maxRetries\n  2000,        // baseDelayMs (2 seconds)\n  30000        // maxDelayMs (30 seconds)\n);\n\nconst data = await response.json();\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1386,
    "body": "the system, because a self-imposed hourly budgeter summed its estimate to decide when\nto stand work down. It under-counted by ~4x (self-reported 250-280k/day against\nAtlassian's measured 1.11M), so the budgeter effectively never fired. The three\ndefects, all worth checking in yours: implementing only two of the model's three terms\n(dropping \"+1 per other object\"); ONE call site passing its count under the wrong\nargument name (a 250-row page booked as 1 point against 501); and batched tallies\nflushed from background handlers only, so everything spent serving the UI died with\nthe isolate. Pin the expected points per response shape in a test and mutation-test\nit — a structural test passes on all three.\n\n## Pool scope is per APP in the docs; \"per environment\" is not documented\nEvery doc line and staff answer says per app, shared across all tenants. The word\n*environment* appears in neither rate-limiting doc nor in any of the 31 staff posts in\nenforcement keys on the **OAuth client id** and each Forge environment therefore gets\nits own 65k — undocumented, and a partner states the opposite in thread 98197\nuncorrected. Get it in writing before assuming your dev environment is free.\n\n## Related Documentation\n- [Custom UI Troubleshooting](18-custom-ui-troubleshooting.md)\n- [Performance Optimization](20-performance-optimization.md)\n- [API Endpoints](06-api-endpoints.md)"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2142,
    "body": "Confluence lists \"Users, Groups, Permissions\" at 2 points. **The Jira twin page adds\nProject Roles.** So role and permission reads are identity-priced, and a\npermission-scheme or role-membership walk is far more expensive than its object count\nsuggests. The doc also warns that Permissions, Search and Admin operations carry\nadditional burst protections beyond the pool.\n\n## The only published multi-object example is on the Jira page — use it\n> \"Since each user object costs 2 points ... `GET /rest/api/3/group/member?groupname=my-group`\n> Cost calculation: **1 (base) + 8 users = 17 points (1 + 8 × 2)**\"\n\nThat is the entire documented basis for multiplying a paginated identity collection.\nEverything else is derived.\n\n## The rule is NOT applied consistently — derived costs are upper bounds\nA Marketplace partner measured Jira endpoints that ignore the documented rule and\ncharge a flat 1 point regardless of object count: `project/{id}/version` (~500\nresults → 1), `permissions/project` (~1000 → 1), `user/search?query=` (~10 → 1).\nTheir conclusion: \"we cannot trust the global rule documented so far.\" Atlassian never\nanswered. Do not plan a budget against a derived number — measure it.\n\n## A POST that READS is ambiguous, and the fork is large\nThe write row is keyed on HTTP verb, but its description says \"operations that\ncreate, update, or remove data\". `POST /rest/api/3/search/jql` does neither. Partner\nmeasurement: 50 calls consumed **571 points** (~11.4/call), i.e. charged per returned\nresult, not 1 flat. **Assume the expensive reading on a hot path until measured.**\n\n## Measure against Atlassian's own counter, not your model\nThe DELTA in `X-RateLimit-Remaining` between two consecutive responses is the true\ncost of what happened in between — the only way to calibrate a derived model without\nasking anybody. `FORGE_API_REQUEST_COUNT` from the Forge App metrics API counts\nREQUESTS and carries no object multiplier, so it cannot distinguish 1 point per page\nfrom 501. And Forge surfaces no Atlassian request/trace id to app code, so a refusal\nin your logs cannot be joined to a row in Atlassian's telemetry."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3013,
    "body": "platform-generic and apply to any Forge app under the points model:\n\n- **Credit your own writes.** An app that both WATCHES a population (member\n  counts, issue counts, entity totals as change-detection tripwires) and WRITES\n  to that same population will read its own writes as external change and pay a\n  full re-read to discover them. Ledger the app's own writes at the lowest HTTP\n  write function (the funnel every feature path drains through), credit only\n  GENUINE state changes (a 409 already-exists / 404 not-present moved nothing —\n  a credited no-op is the one inaccuracy that can MASK a real external change;\n  every other inaccuracy just costs one spurious re-read), and treat a count\n  that moved exactly as far as your ledgered writes as no-evidence.\n- **Failed-pass retries are schedule, not evidence.** Retrying a failed repair\n  pass every daytime hour spends quota on a read that keeps failing. Defer\n  non-load-bearing retries to a quiet window, with bounded degradation (past\n  48h → any hour; never-completed → immediately) and an operator run-now bypass.\n- **Grace windows are not ground truth.** Auth-path resilience built as a\n  \"serve the last proven verdict for ≤N hours\" TTL still locks out anyone\n  returning after a gap longer than N during an exhausted hour. Durable local\n  state (a small mirrored group in SQL, refreshed opportunistically) survives\n  storms; recent-success TTLs always have an edge, and the edge gets hit.\n- **Forge SQL has its own installation rate limits** (\"Limits for the current\n  installation have been exceeded\", code RATE_LIMIT_EXCEEDED) — hit in practice\n  by product-event handlers doing one SQL write per event during view storms.\n  Batch event-driven writes; treat the error as transient backpressure.\n\nFull write-up with the Confluence-side evidence: the sibling skill's\n`atlassian-confluence-forge-skill/docs/31-points-rate-limiting.md`.\n\n---\n\n---\n\n## Only app-initiated BACKEND traffic consumes points\nAtlassian Staff, on the record (community.developer.atlassian.com thread 97828, #133):\n\n> \"only app-initiated backend traffic counts toward points-based rate limits. Direct,\n> user-initiated UI calls from Forge UI to Jira or Confluence using\n> `@forge/bridge.requestJira` (with no resolver or backend) is treated as standard UI\n> traffic and is **not** included in points.\"\n\nCounted (#135): \"UI → resolver → backend (`@forge/api`); Forge Remote flows invoked\nfrom the UI; Forge Remote flows invoked from backend code.\"\n\n⇒ **A read that only paints a screen can move from a resolver to `@forge/bridge` and\nstops costing points.** Highest-leverage change available to a points-constrained\nForge app, and it is not in the rate-limiting docs. Caveats: Atlassian may include\nthis category later \"with clear advance notice\"; bridge calls run as the USER so they\nsee only what that user sees; and it is not a route for background work. `asApp()` vs\n`asUser()` through `@forge/api` makes no difference — the line is backend-vs-frontend."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/19-rate-limit-handling.md",
      "hash": "0ca6d38ed57a95ff",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2102,
    "body": "# Rate Limit Handling in Jira Forge\n\nThis guide covers the new points-based rate limiting model (effective March 2026) and how to handle rate limits gracefully in your Forge apps.\n\n---\n\n## Points-Based Quota System\nJira Cloud now uses a **points-based model** instead of simple request counting. Each API call consumes points based on:\n- Base cost: 1 point per request\n- Object costs: Additional points for each object returned\n- Write operations: Only base cost (1 point)\n\n## Point Costs by Operation Type\n| Operation Type | Points | Example |\n|----------------|--------|---------|\n| Core domain objects (GET) | 1 + objects × 1 | Get single issue = 2 points |\n| Identity & access (GET) | 1 + users × 2 | Get group members |\n| Write/modify/delete | 1 point | Create/update issue |\n\n## Hourly Quotas by Tier\n#### Tier 1 - Global Pool (Default)\n- **65,000 points/hour** shared across all tenants\n- Applies to most apps automatically\n\n#### Tier 2 - Per-Tenant Pool (After Review)\n\n| Edition | Formula | Cap |\n|---------|---------|-----|\n| Free | 65,000 pts/hr | N/A |\n| Standard | 100,000 + (10 × users) | 500,000 |\n| Premium | 130,000 + (20 × users) | 500,000 |\n| Enterprise | 150,000 + (30 × users) | 500,000 |\n\n---\n\n## 1. Points-Based Quota (Hourly)\n**Trigger:** Total points exceed hourly allocation\n\n**Response Headers:**\n```\nBeta-RateLimit-Policy: \"global-app-quota\";q=65000;w=3600\nBeta-RateLimit: \"global-app-quota\";r=11000;t=600\n```\n\n**When r (remaining) is 0:** All requests denied until window resets\n\n---\n\n## 2. Burst Rate Limit (Per-Second)\n**Default Limits by HTTP Method:**\n\n| Method | Requests/Second |\n|--------|-----------------|\n| GET | 100 |\n| POST | 100 |\n| PUT | 50 |\n| DELETE | 50 |\n\n**Response Headers:**\n```\nHTTP/1.1 429 Too Many Requests\nRetry-After: 1\nRateLimit-Reason: jira-burst-based\nX-RateLimit-Limit: 350\nX-RateLimit-Remaining: 0\n```\n\n---\n\n## 3. Per-Issue Write Limit\n**Limits:**\n- **Short window:** 20 writes per 2 seconds\n- **Long window:** 100 writes per 30 seconds\n\n**Response Headers:**\n```\nRateLimit-Reason: jira-per-issue-on-write\nRetry-After: <seconds>\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1165,
    "body": "`POST /rest/api/3/bulk/issues/fields`, `/transition` and `/move` all require it,\nand ordinary users do not have it. Treat them as an admin-only accelerator and\ntranslate the 403 into that sentence; the default path for \"change N issues\"\nshould be a capped sequential loop with partial-failure reporting.\n\n## Creating components and versions needs manage:jira-project\nIf the app does not hold it, `setComponents` / `setFixVersions` can only use\nvalues that already exist. Say so rather than failing on a name the user\ninvented.\n\n## archiveIssues needs Premium/Enterprise AND admin\nUnder `asUser` it 403s for almost everyone. A tool that always fails is worse\nthan no tool.\n\n## JQL is eventually consistent\n`parent = KEY` can return **zero** seconds after the children were created,\nwhile a direct `GET /issue/{key}` shows `fields.parent` set correctly. Verified\nlive. Read back **by key** after a write; an empty JQL result looks exactly like\n\"nothing was created\", which is a completely different diagnosis.\n\nAlso: `~` is a **tokenised** text match, not a substring match. `summary ~ \"a b\"`\nmatches those words in any order and will not match the phrase you expect."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2549,
    "body": "The `viewportSize` (`small`, `medium`, `large`) is a hint, not a strict cap. Test layouts in each size; complex forms feel cramped in `small`.\n\n## FaaS Limits\n| Surface | Default Timeout | Hard Ceiling |\n|---|---|---|\n| Resolver / trigger / validator / post-function | 25 s | 25 s |\n| `consumer` / scheduled trigger function | 55 s default, set `timeoutSeconds:` to extend (limits-invocation page, verified 2026-09-14: \"Default timeout is 55 seconds. Use timeoutSeconds to extend it.\") | 900 s |\n| `preUninstall` | 55 s (unverified — not stated on the limits-invocation page as of 2026-09-14) | 55 s (unverified) |\n| `queue.push` payload | — | 50 events / 200 KB combined |\n| `InvocationError.retryData` | — | 4 KB |\n| Async retries | — | 4 retries |\n\nIf you need >25 s, push to an async queue. See `26-async-events-and-queues.md`.\n\n## An ESM-only subpath export is a landmine in the backend bundle\nThe Forge backend bundler is **webpack 5, target node18, CommonJS output**. A\npackage whose subpath is exported only under the `import` condition resolves\nfine in plain `node` and fails **only inside the bundle** — which is the one\nplace you cannot easily debug.\n\nReal case: `unpdf` loads PDF.js with `await import(\"unpdf/pdfjs\")`. Under\n`require` conditions that throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, surfacing to\nthe user as *\"Serverless PDF.js bundle could not be resolved\"* — which reads\nlike a corrupt PDF, not a build problem.\n\nThe fix removes both possible mechanisms rather than betting on which one bit:\n\n```js\nimport * as pdfjsModule from \"unpdf/pdfjs\";   // STATIC — same chunk, no runtime resolution\nimport { definePDFJSModule } from \"unpdf\";\nexport const ensurePdfjs = () => definePDFJSModule(() => Promise.resolve(pdfjsModule));\n```\n\nVerify against the deployed bundle, never locally: this class of bug is invisible\nin `node`.\n\n## Async chunks land OUTSIDE the Custom UI resource directory\nA Custom UI resource is a **directory** (`resources: [{key, path: src/chat/globalPage}]`).\nWebpack emits async chunks next to `output.path`, which is usually the parent —\nso `import()` anywhere in the frontend produces a chunk that **404s at runtime\nwith no useful error**. A third-party library doing `import()` internally\n(tesseract.js does) cannot be fixed by a static import on your side.\n\n```js\n// webpack.config.js\nmodule: {\n  parser: { javascript: { dynamicImportMode: \"eager\" } },  // inline every import()\n  rules: [...],\n}\n```\n\nBeware: a second `module:` key silently replaces the first. Merge into the\nexisting block."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2342,
    "body": "# Forge Development Gotchas (Jira)\n\nEnvironment-specific facts and pitfalls that defy reasonable assumptions. Read once before you start; revisit when something's mysteriously broken.\n\n## A stubbed node_modules/@forge/ deploys silently, and looks exactly like a platform outage\n`forge deploy` bundles whatever is in `node_modules`. If anything has replaced\n`@forge/kvs`, `@forge/llm` or `@forge/api` with a local test double — an agent\nrunning app modules under plain node, a half-finished offline harness, a\n`npm link` — **that double is what ships**, and every check you have will pass:\n\n- `npm run lint` — fine, it is valid JavaScript.\n- `npm run build` — fine, webpack bundles it happily.\n- `npx forge lint` — fine, it reads the manifest, not the dependency tree.\n- The unit suite — fine, and this is the trap: unit tests **stub these packages\n  themselves** and never load the real ones, so a green suite is evidence about\n  the stubs, not about the app.\n\n\n| Symptom | Cause in the stub |\n|---|---|\n| A resolver writes a key; the async consumer reads it back as `undefined`, for minutes, while the resolver keeps returning it | the stub kvs is an in-memory `Map` and **every Forge function gets its own copy** |\n| Every `kvs.query().where('key', beginsWith(...))` returns zero results for rows `kvs.set` definitely wrote | the stub's `query()` returns `{results: []}` unconditionally |\n| `_forge_kvs.zH.batchGet is not a function` | the stub implements only `get`/`set`/`delete` |\n| Every model call fails with a message you have never written | the stub's `chat()` throws |\n\nTwo hours went into diagnosing that as an Atlassian incident. The tell was in\n`node_modules/@forge/kvs/package.json`: **`\"version\": \"0.0.0\"`**, where the lock\nfile said `1.6.5`.\n\n**If the app behaves impossibly, check the dependency versions BEFORE you\nbelieve a platform story**, then `npm ci`.\n\n**The fix is a pre-deploy check**, because nothing else in the pipeline can see\nit. `templates/check-forge-deps.mjs` in this skill: every critical `@forge/*`\npackage must match the version the lock file names and carry no stub marker in\nits entry point. Wire it as the first line of your deploy script.\n\n```bash\necho \"🔒 Checking dependency integrity...\"\nnode scripts/check-forge-deps.mjs   # exits 1 and deploys nothing if a package was replaced\n```"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3703,
    "body": "Only the **entity store** sorts. The plain KVS query exposes `where`, `limit`\nand `cursor` — nothing else. Keys come back in an order the docs do not promise,\nso `beginsWith(prefix).limit(50)` on `conv:<id>:msg:<timestamp>` returns the\n**oldest** 50, not the newest.\n\nSymptom in production: past 50 messages a chat silently stops showing the model\nthe user's newest turn, sidebar previews show the opening line forever, and a\nmessage count saturates at exactly the limit. Maintain your own ordered index\ninstead, and back it with a cursor walk for rows that predate it.\n\nOther shapes worth knowing: the cursor field is `nextCursor`; `batchGet` answers\n`{successfulKeys, failedKeys}`; and TTL **is** supported —\n`kvs.set(k, v, { ttl: { value: 30, unit: \"DAYS\" } })`.\n\n## There is no compare-and-swap on a plain KVS key\n`kvs.transact()`'s conditional `check` requires the **entity** store. On plain\nkeys, read-modify-write is all you have — so any value written concurrently WILL\nlose writes.\n\nReal case: an index array of uploaded files, updated by up to five concurrent\nuploads. Each read `[]`, each wrote `[itself]`, last writer won, and the losers'\ndata rows were orphaned with nothing referencing them. The fix is structural,\nnot defensive: **one row per item**, enumerated with a prefix query. Separate\nkeys cannot collide.\n\n## beginsWith matches more than you think\n`upload:<id>` and `upload:<id>:c:<n>` share a prefix, and KVS has **no keys-only\nprojection** — every result carries its full value. A sweep over `upload:` to\nfind manifests therefore drags every chunk body through a 25-second resolver.\nGive different record types **different key prefixes**, not different suffixes.\n\n## GET /rest/api/3/field/{fieldId} does not exist\nIt answers **405 Method Not Allowed** — \"Method 'GET' is not supported\" —\nwhile `GET /rest/api/3/field` (the list form) succeeds on the same credentials.\nProbed live; it is not a permissions problem. Any tool built on it can only ever\nfail.\n\n## POST /issue/bulk returns ONLY the successes in body.issues\nThe obvious mapping — `body.issues[n]` is the nth thing you sent — is wrong the\ninstant one element fails. Jira omits the rejected element from `issues`\nentirely and reports it separately in `body.errors[]` by `failedElementNumber`,\nso **every later success shifts down by one** and is recorded against the wrong\ninput.\n\nIt also answers **201 for a full success and 400 for a PARTIAL one**, with the\nsuccesses still present — so status alone must not decide either.\n\nOn a flat batch this is a mislabel. On a **hierarchy** it is not: if the next\npass resolves a child's parent through that same array, one rejected story\nsilently re-parents everything after it, and the user gets a tree that looks\nplausible and is wrong.\n\n```js\n// Read the FAILURES first, then consume the successes against what is left.\nconst errs = Array.isArray(body?.errors) ? body.errors : [];\nconst failedPositions = new Set(errs.map((e) => Number(e?.failedElementNumber)).filter(Number.isInteger));\nconst made = Array.isArray(body?.issues) ? body.issues : [];\nconst survived = sent.map((s, pos) => ({ s, pos })).filter(({ pos }) => !failedPositions.has(pos));\nif (made.length === survived.length) {\n  made.forEach((m, n) => record(survived[n].s, m.key));\n} else {\n  // Counts disagree: Jira said something you do not understand. Record NOTHING\n  // and report every entry as an honest failure — guessing is how the\n  // mis-attribution comes back.\n}\n```\n\nAlso return the caller's original index with each created issue. Summaries are\nneither unique nor echoed verbatim, so an index is the only reliable way back to\nthe input when the result array has been compacted."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2243,
    "body": "A `const` read above its own declaration is a **`ReferenceError` at runtime and\nnowhere else** — the TDZ is invisible to lint defaults, to webpack, and to\n`forge lint`. In an async consumer it kills every invocation of that function\nwith a message (`Cannot access 'x' before initialization`) that names a variable\nand not a cause.\n\nIt shipped once because a tool list came to depend on a flag declared eighteen\nlines further down. Turn the rule on and it becomes a build failure:\n\n```js\n// .eslintrc.js — functions stay hoistable, which most codebases rely on\n\"no-use-before-define\": [\"error\", { functions: false, classes: false, variables: true }],\n```\n\nEnabling it found two more latent cases in the same repo the same minute.\n\n## forge tunnel doesn't pick up manifest changes\nAdding a scope, module, or external-fetch entry to `manifest.yml` while the tunnel is running will *not* apply.\n- Stop the tunnel (`Ctrl+C`).\n- Run `forge deploy` (or `forge install --upgrade` if scopes changed — users must approve new scopes).\n- Restart `forge tunnel`.\n\n## api.asApp() vs api.asUser()\n- `asApp()` runs with the app's own permissions — use for background tasks, scheduled triggers, post-functions, async consumers.\n- `asUser()` runs with the invoking user's permissions — use for UI interactions where row-level visibility matters.\n- Mixing them up leaks data: `asApp()` in a UI handler can show users data they shouldn't see; `asUser()` in a scheduled trigger fails because there is no user.\n\n## Auth context vanishes outside an invocation\nTimers and unawaited promises that fire after a handler returns lose their auth context (and may also be killed mid-flight). Don't `setTimeout` from a Forge function — push to an async queue (`@forge/events`) instead.\n\n## CSP blocks Custom UI by default\nCustom UI is iframed with strict CSP. Symptoms: \"Refused to load script\", \"Refused to connect to...\"\n- Declare every external host in `permissions.external.fetch.client` (frontend) or `permissions.external.fetch.backend` (resolvers).\n- Inline `<script>` and inline event handlers are forbidden. Use `addEventListener` from a bundled file.\n- Inline `<style>` *is* allowed in Custom UI HTML, but external stylesheets must also be allowlisted."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2576,
    "body": "Images on `<img src=…>` need `permissions.external.images`, not `permissions.external.fetch`.\n\n## Rate limiting (429)\nJira Cloud rate-limits REST. Symptoms: bursts of `429 Too Many Requests`.\n- Implement exponential backoff with jitter (see `19-rate-limit-handling.md` and `24-production-patterns.md`).\n- Honor `Retry-After` when present.\n- Per-issue write limit: 20 writes / 2s. Burst limit: 100 writes/s. Plan chunked write-back accordingly.\n\n## Use @forge/kvs, not storage from @forge/api\nThe legacy `storage` API stopped receiving feature updates after **2025-03-17**. New apps should use `import { kvs } from '@forge/kvs'` (named import). Required scope: `storage:app`.\n\n## KVS limits worth remembering\n- 500-char key, regex `/^(?!\\s+$)[a-zA-Z0-9:._\\s-#]+$/`.\n- 240 KiB per value, max object depth 31. **BYTES, not characters** — see below.\n- 12 MB/s reads & 1 MB/s writes per key — shard hot keys.\n- 24 MB/s queries per index value.\n- See `27-faas-limits-and-cost.md` for what to do when you hit each.\n\n## The 240 KiB value limit is BYTES; chunking by characters is a bug waiting for a German document\nA payload split at `PART_CHARS` characters is only inside the limit for ASCII. A\ncharacter is 1–4 bytes in UTF-8, so the same code that works all through\ndevelopment on English test data fails the first time a real customer uploads a\nspecification with umlauts in it — and it fails at the *write*, after the\nexpensive work that produced the payload is already done.\n\nEither split on bytes, or pick a character size that is safe at the worst case:\n\n```js\n// 60_000 chars is inside 240 KiB even at UTF-8's 4-bytes-per-character worst case.\nconst PART_CHARS = 60_000;\n```\n\nThe same applies to any per-item cap you derive from the value limit: count what\nthe platform counts.\n\n## Secrets need setSecret / getSecret\nPlain `kvs.set` is *not* encrypted at rest in the same way. Use `kvs.setSecret(key, value)` / `kvs.getSecret(key)` for credentials.\n\n## KVS has no atomic compare-and-set (TOCTOU on locks)\n`acquireLock` style check-then-set is racy: two callers who pass the check in the same window both `set`, last write wins. **There is no CAS primitive.** Narrow the window with **acquire-then-reread** (write, then re-read the holder; if someone else's write landed last, treat it as a lost race and back off) — but understand this does *not* eliminate the race. For exactly-once side effects use `keyPolicy: 'FAIL_IF_EXISTS'` (an atomic conditional create), see `26-async-events-and-queues.md`. Source: se-ppm `src/services/concurrency/write-lock.js:44-50`."
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/gotchas.md",
      "hash": "45ade5457663916b",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2280,
    "body": "`{ result: false, errorMessage: \"...\" }` — the field is `errorMessage`, not `message`. The user sees this string verbatim in the Jira UI.\n- Keep messages short and actionable.\n- Fail-open in `catch` blocks for external-dependency validators — never block a transition on your dependency's outage.\n\n## expression: \"true\" is required on jira:workflowCondition\nWithout it, Jira treats the condition as static and **never invokes your Forge function** to compute transition-button visibility. With it, the function runs on every issue view — keep it cheap. See `25-workflow-modules-deep-dive.md`.\n\n## Warm-container registry/cache staleness (~30 s)\nA module-scoped cache (e.g. a disabled-rules registry read on the hot path) persists across invocations in a warm container. If you invalidate it only on the resolver write path, *another* warm container won't see the change — so a just-disabled rule can run for up to your cache TTL (~30 s in CogniRunner). Bounded staleness is fine for advisory data; never cache credentials this way (a stale key is binary-wrong).\n\n## Custom UI: stale closures after await\nReact handlers that read a value *after* an `await` capture the value from render time, not the latest. For values you read post-await (latest payload, a token, an abort flag) store them in a `useRef` and read `.current`, or you'll act on stale state.\n\n## Custom UI manifest layout: basic → blank\nThe Custom UI resource `layout: basic` was deprecated in 2025; use `layout: blank` for full-page Custom UI. Verify against the current manifest reference if a page renders with unexpected Atlassian chrome.\n\n## Async events: v2 manifest shape\n`@forge/events` v2 declares consumers with `function:` (not v1's `resolver:`). The v1 shape still works but is deprecated. See `26-async-events-and-queues.md`.\n\n## Custom field rendering\n`jira:customField` view rendering must use UI Kit (`@forge/react`, `render: native`). Custom UI is **not** supported for view rendering. Edit can use either.\n\n## Workflow update is a full-replacement POST\nProgrammatically adding a rule to a workflow requires GET → modify entire definition in memory → POST the whole thing back. Forgetting any transition or omitting the `system:update-issue-status` post-function breaks the transition."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3226,
    "body": "Async events are delivered at least once and there is no dead-letter queue. An application-level throw inside a consumer does not trigger an automatic retry on its own; the retry contract is the SDK's error type. Payload limits are around 200 KB per push and 100 KB per event for consumers that run longer than 55 seconds, and a consumer may declare a timeout of up to 900 seconds.\n\nA `jira:workflowPostFunction` cannot raise its timeout: the manifest linter rejects `timeoutSeconds` on it and the hard cap is 25 seconds. Post-function invocations are not exactly-once either. The pattern that follows from both facts is to enqueue heavy work to a consumer and claim each execution with an atomic key-value write using `FAIL_IF_EXISTS`, so a redelivery finds the claim and stops.\n\nThe `@forge/events` package changed shape at major version 2: the consumer is a plain exported handler, and the manifest declares `consumer: [{ key, queue, function }]` with no resolver block. Mixing the older resolver-style consumer with the v2 package makes `queue.push()` fail with a 400, because the platform validates the consumer definition when it accepts the push. Check the installed major version before writing a consumer; some documentation still shows the older shape.\n\nUser-triggered invocations (resolvers, UI-initiated calls) are capped at 25 seconds and `timeoutSeconds` does not apply to them; it only lengthens scheduled triggers and queue consumers. Anything that pages through group membership or a permission list belongs on a queue. A resolver that dies mid-read looks to the frontend like an empty result, which is how a \"does this space exist\" panel once offered to create a space that already held thousands of people.\n\n## Key-value storage facts\nThe TTL option on a key-value write is `{ ttl: { value, unit } }`; a `ttlSeconds` argument is accepted and silently ignored. `set(key, value, { keyPolicy: \"FAIL_IF_EXISTS\" })` is the atomic claim primitive. `query()` is eventually consistent, supports only a begins-with filter, pages at most 100 results, and its result order is undocumented, so always sort on the client. `batchDelete` accepts at most 25 keys and a single value may be at most 240 KiB.\n\nStorage is siloed per product installation. A cross-product app installed on both Jira and Confluence has two separate stores, and rows written from one product are invisible to functions running in the other. Cross-product features must either re-derive the state they need from the product REST APIs or rely on a signal that crosses the boundary, such as the user's actual group membership.\n\nForge SQL is backed by a MySQL-compatible engine with its own wrapper rules: one statement per query, no foreign keys, a 20-second DDL timeout, and `LIMIT`/`OFFSET` cannot be bound as `?` parameters (the driver answers with an incorrect-arguments error). Interpolate only constants the code owns into a limit clause, never user input. Verify every DDL statement against the platform's documented restrictions and the engine's statement reference before deploying a migration; a standalone `CREATE INDEX` that is ordinary elsewhere failed on the live platform, and the `ALTER TABLE ... ADD INDEX` form was the one accepted."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 1803,
    "body": "Jira Cloud Automation has no public API to create or edit a rule. The internal gateway routes answer 404 to an API token, and the documented rule endpoints exist for Data Center only. When a task needs an automation rule on Cloud, drive the builder UI with a browser session; keep any secret for a web-request action in a header rather than the URL, because the URL is logged. Smart-value facts proven in that builder belong in the automation pack.\n\nThe order of attack for any configuration job is REST first, then REST proven on a sandbox, then the browser, and never browser-first. Probe the REST surface before writing a line of browser automation; a browser is for things that genuinely have no API, and that has to be verified rather than assumed. When a write returns a 400, do not conclude \"unsupported\": for an undocumented route the accepted schema is whatever the server just handed back on a read. Prototype writes on a sandbox tenant, not on production, and port the proven call.\n\nBrowser automation against Atlassian stays expensive: an API token cannot mint a browser session, a headless profile can trip device-verification e-mail, sessions idle out after weeks, and the UI reshapes between loads. Run headed with a persistent profile on the same machine, or automate a second factor for headless work.\n\nA Forge app's health dashboard can itself be a major API consumer: several pollers at a few seconds each, every one starting with a paged group-membership walk, add up to dozens of resolver calls a minute from one browser tab. A module-scope cache mostly misses because containers are not reliably reused; keep a durable verdict cache with a short TTL, and back off pollers exponentially on a refusal, because a client that keeps firing at the same rate after a denial is the outage."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 1906,
    "body": "A Custom UI app renders in a single, non-nested iframe; UI Kit renders natively into the host DOM with no iframe. The iframe source hostname is served from a CDN and is not stable, so never hardcode it. Global pages, project pages and full pages have deep-link URLs built from the bare app id and the environment id; an issue panel and a macro are not deep-linkable and must be reached by driving the host UI.\n\nThe `route` template tag escapes every interpolated value. Interpolating `limit=250&cursor=X` as one string transmits the separators percent-encoded, the server ignores the whole query and returns page one at the default size on every iteration, and a paging loop that counts results then reports duplicates as volume. Interpolate values only, never separators: `route\\`/spaces?limit=250&cursor=${cursor}\\``. The failure is silent and directional, which is the worst kind for a compliance figure.\n\nDisplay conditions on Confluence modules can read only entity properties, never key-value storage or custom entities, so a display-driven feature must keep its state in a space, page or user property. `entityPropertyEqualTo` on a space entity works and tracks changes; `entityPropertyExists` gives a zero-cost unconfigured state. A Forge app cannot block a Confluence publish, because no pre-publish validator module exists. The paired-control method makes such work trustworthy: every gated module gets a twin with no condition, so \"condition false\" can be told apart from \"module not rendering\".\n\nClassic-transform React apps require `import React` in every file that contains JSX, or the component throws at render and the iframe goes blank. A screenshot harness that mocks the bridge module and aliases it through the bundler is the way to verify Custom UI components outside a live site; the live CSS source in such apps is whatever function injects it at mount, not an unimported stylesheet."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3592,
    "body": "Through `@forge/llm` (around version 0.6) the usage fields are plural (`input_tokens`), a tool call's `function.arguments` arrives as an object rather than the JSON string other providers send, `list()` returns `{ models: [{ model, status }] }`, and tool-result messages carry a `name` plus content parts. Some documentation still shows singular usage field names; the SDK types are the authority. When sending a tool call back to the model in the OpenAI-style shape, serialise the arguments as a string, or the request fails to deserialise.\n\nAdding the `llm` module to a manifest is a major version change that an administrator must approve on upgrade. Tokens are billed to the app vendor, input is text only, and the per-installation cap is about 50,000 tokens per minute per model, enforced only after a minute has already exceeded it. Hosted MCP tools still reach a Forge LLM call when the app proxies them from its own backend, because the proxy runs in the app, not at the inference endpoint.\n\nForge is consumption-billed to the developer, not to the customer, and a free Marketplace listing gives no shelter. What is billed is function duration in GB-seconds (invocation count is free) and key-value bytes transferred, where a write costs roughly twenty times a read and even an empty read is charged as one kilobyte. Async events, scheduled triggers and product events cost only the duration they cause. Design any background work with the question \"what does this cost at a thousand of them a day\" answered before it ships.\n\n## Installation, licensing and product scope\nA single `forge install` registers the app with one product. A cross-product app must be installed on each product separately; modules for a product that is not installed stay in the manifest and simply never appear. `forge deploy` updates existing installations only and never installs to a new product. After a fresh install, list the installations and confirm every expected product is present. Cross-product apps are not accepted on the Marketplace.\n\nWith `app.compatibility.confluence.required: false` declared and a Confluence install added, `asApp().requestConfluence` works from Jira-triggered functions. The service management API (desks, queues, queue issues) is readable as the app with the request read scope.\n\nThe licence object exposed to functions carries `capabilitySet` as a camel-case value (for example `\"capabilityAdvanced\"`) alongside a `state`, and it is present in web triggers and in the async consumer via the app context. It is null on installs made without a licence flag, and `forge install --upgrade --license X` does not re-apply to an install that is already current; a fresh install does.\n\nAssets (CMDB) reads from an app: measured recently, `POST /jsm/assets/workspace/{id}/v1/object/aql` returns 200 as the app from a web trigger with no user context, provided the app is installed on the relevant products, declares the compatibility block, holds the CMDB read scopes and has been granted access inside Assets. Earlier reports of a 401 in every context most likely lacked one of those. Keep the Assets call off any render path regardless: do the work in a scheduled job or through the supported import-type module and have the UI read local state. The deprecated `GET .../aql/objects` route is explicitly closed to apps; use the POST form with pagination in the body. The AQL response returns attribute names in a top-level `objectTypeAttributes` array rather than inline on each attribute; reading them inline makes every value resolve to nothing while the run reports success."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3196,
    "body": "<!--\n CogniRunner - AI-powered workflow validation for Jira\n Copyright (C) 2025 LeanZero\n SPDX-License-Identifier: Apache-2.0\n\n Tier C replacement, written from scratch in our own words. The facts below were each\n verified on a live site or against the published SDK types at the time they were learned;\n the dates in the text say when. Nothing here is copied from a memory file, and no tenant,\n account, e-mail, ticket key or client travels with a fact.\n-->\n\n# Forge platform facts\n\n## Workflow conditions: which kind is enforced\nThere are two ways a Forge app can put a condition on a Jira workflow transition, and they behave differently at runtime. Treat this as one reconciled rule, because earlier notes disagreed with each other.\n\nA `jira:workflowCondition` module is expression-only. The module has no working `function` property: if a manifest declares both a function and an expression, the function is never invoked and only the expression decides. A condition whose expression is the literal `true` therefore always passes, whatever the backing function was meant to do. The reason this matters is that a condition looks configured in the workflow editor while enforcing nothing, and the failure is silent on every transition.\n\nAn expression-backed condition, on the other hand, is enforced everywhere, including the REST transition path. When the expression evaluates to false the transition is absent from `GET /rest/api/3/issue/{key}/transitions` and a `POST` to the same transition is rejected with a 4xx. So \"conditions are a no-op over REST\" is true only of the function-backed shape; a deterministic Jira expression is a real gate. Bulk operations and automation are subject to it too, because the platform evaluates the expression, not the app.\n\nJira expression facts that were proven live and shape how a condition should be written: a custom field is read by its REST id (`issue[\"customfield_12345\"]`), and that accessor works for every standard custom-field kind. An unset field reads as `null`, never as an empty string or an empty array, so guard with a null check before calling anything on the value. The `==` operator is strict: comparing a Number to a String is an evaluation error, and an evaluation error hides the transition, which is the fail-closed direction. A `null == \"x\"` comparison is a safe false. Numbers written into the module configuration arrive typed into the expression, a multi-line text value is a rich object rather than a plain String, and `.match()` with a regular expression works as a guard. System-field accessors do not share the REST id naming (`issue.dueDate` versus `duedate`), and a mismatch there is a fail-closed surprise, so prefer custom fields or a per-field verified whitelist. A condition expression can also read `issue.properties?.[\"key\"]`, and a handful of such reads per transition is well within budget.\n\nRule shape when writing a defensive expression: gate each branch behind a check that the configured property looks like a custom-field id, resolve every unknown case to `true` (default-allow), and keep evaluation errors branch-local. Hiding a transition on a healthy issue is the outcome a condition must never produce."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 2597,
    "body": "Global administration does not grant project-level edit permission in Jira Cloud. A site admin can receive an empty `editmeta` and a 400 \"not on the appropriate screen\" on every update, because project permissions come from the permission scheme through project roles. Before any bulk field write, check `GET /rest/api/3/mypermissions?issueKey=...&permissions=EDIT_ISSUES` on a sample issue from every project in scope. The `overrideScreenSecurity` and `overrideEditableFlag` query flags work only for apps, not for a basic-auth token, and 403 even for global admins.\n\nMentions are indexed by account id, not display name. There is no mention-aware JQL function; `comment ~ \"Surname\"` does not find a mention node, while `text ~ \"<accountId>\"` does, and the match is precise because real account ids are high-entropy. Confluence CQL has a native `mention = \"<accountId>\"` operator that likewise needs an id. The notification inbox endpoint is OAuth-only and answers 401 to an API token.\n\n`GET /rest/api/3/user/search` returns active users only. A directory that is mostly deactivated accounts is mostly invisible to it, so an \"exists on the target\" check built on that endpoint is blind to most of the population. Use `/rest/api/3/users/search` paged in full or `/user/bulk`, both of which return inactive users, and prove any absence by a direct id lookup. Account ids are global for ordinary accounts, but portal-only customer ids are site-scoped: a 404 for one of those on another site is guaranteed by construction and carries no information.\n\n`POST /rest/api/3/permissions/check` reads another user's project and global permissions and returns a genuine empty list when the user holds none. It disproves the belief that Jira cannot answer that question, and it is the endpoint that settles \"can this person see the internal comment I left\".\n\nGroups and users are organisation-scoped and shared by every site in the organisation, including a customer's own sandbox. Creating a group in a sandbox writes to the shared directory and appears in the production audit log, which is immutable. Projects, schemes, security levels, fields and workflows are site-scoped. A guard that names one production host does not fence a shared directory; name the tenant where writes are allowed positively, and never create groups or users anywhere but a separate organisation.\n\nThe Teams API lives on the platform API host, not the site, takes a plain user API token with basic auth (apps and OAuth clients are explicitly excluded), returns members as account ids only, and repeats its cursor on the last page."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3694,
    "body": "Creating a service management comment with a chosen visibility requires the `sd.public.comment` property inline on the create request: `properties: [{ key: \"sd.public.comment\", value: { internal: true } }]` on `POST /rest/api/3/issue/{key}/comment`. Setting the property afterwards through the comment-properties endpoint stores it, and it reads back, but the agent UI ignores it and the comment keeps its original visibility. The top-level `jsdPublic` field on that endpoint is silently ignored.\n\nThe inline properties array accepts only object values. Including a string-valued sibling property makes the whole request fail with a 400 whose message names the visibility property rather than the real culprit. Put object-valued properties inline at creation and set primitive-valued tags afterwards with a separate property write.\n\nThe portal-side comment endpoint under `/rest/servicedeskapi/request/{key}/comment` returns 404 unless the calling user is a participant on that specific request, so it is not a route for agent-driven bulk work.\n\nAn internal comment is readable only by someone who holds the agent permission on that project. A licensed agent tenant-wide can still be a portal-only customer on one project and will never see an internal question left there. Before concluding that a person is ignoring a question, prove they can see it with the permissions check above, and re-ask publicly if they cannot.\n\nDescriptions and comment bodies are capped at 32,767 characters, measured on the serialised document JSON, not on the visible text. Heavy formatting can push a 20,000-character description over the cap. Detection must be client-side after fetching the body, because JQL has no length operator.\n\n## Issue links, migrations and the Connect timeline\n`POST /rest/api/3/issueLink` treats the body's `inwardIssue` as the subject that performs the outward verb: `{ type, inwardIssue: X, outwardIssue: Y }` renders as \"X <outward verb> Y\". That is the inverse of how links read back on an issue, where an entry with `outwardIssue: P` means \"this issue <outward verb> P\". To recreate a link read from a source, swap the slots, and read the created link back from both ends before trusting direction. A dry run that only logs intent cannot catch this.\n\nData classification in Jira, Confluence and service management Cloud requires a separate premium security add-on, not a product plan tier. The hierarchy is organisation default, space default, per-content; the visible artefact is a byline badge on pages, and nothing renders at space level. Endpoints under `/wiki/api/v2/classification-levels` and per-space and per-page classification routes take the numeric space id, not the key.\n\nMoving third-party CMDB data to Cloud Assets is one hop: extract, transform to the Cloud model, load through the Assets API. Staging through the bundled Data Center Assets pays twice for one transformation and inherits every migration-tool limit. Migrate all schemas before projects or linking silently fails; per-object limits apply to name and description length and to objects per work item per field. Measure the issue-to-object link count before choosing, because a large number is the one thing that justifies the double hop.\n\nThe Connect end-of-support timeline has three phases: new Marketplace apps must be Forge-only since September 2025, existing Connect descriptors froze in March 2026, and end of support arrives at the end of 2026 as a gradual \"use at your own risk\" decay rather than a switch-off. Forge is the successor platform, not the thing being retired; customers of Marketplace apps take no action, and only self-built Connect apps put the migration clock on the customer."
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
    "provenance": {
      "source": "platform-fact-memories",
      "path": "knowledge/authored/forge-platform-facts.md",
      "hash": "9365f20107b9760b",
      "licence": "ours (re-authored)"
    },
    "bytes": 2064,
    "body": "The Jira Cloud v3 workflows API attaches rules at the top level of a transition: `validators[]`, `actions[]` (post-functions), and `conditions` as a recursive tree of `{operation, conditions[], conditionGroups[]}`. There is no `rules` wrapper, and `operation` is required on an update. Forge rule keys are `forge:expression-validator`, `forge:expression-condition` and `forge:workflow-post-function`; `parameters.key` carries the app's extension identifier and `parameters.config` a stringified, self-contained configuration. Post-function flavours from one app share the single post-function rule key and are routed by a field inside the config, not by distinct keys.\n\nRules attached this way run even when the app's own registry has no record of them, so an app must treat \"no registry entry\" as an ordinary state and decide deliberately whether that means fail-open or fail-closed. Validators attached over REST are enforced on the REST transition path: the transition is refused with a 4xx and the validator's message appears in `errorMessages`.\n\nReading rules back through `POST /rest/api/3/workflows` returns them in the same `{ruleKey, parameters}` shape that the write endpoints accept, so copying between sites needs no key translation. Facts that cost real time on that path: rules from other vendors' apps require their `parameters.id`, and stripping it makes the validation endpoint return a 500; an initial transition rejects any `conditions` object, even an empty one; the bulk read returns 404 if any requested workflow name is missing, so enumerate first and request the intersection; system workflows marked `isEditable:false` cannot be updated; Jira regenerates rule ids on every read, so they are not stable references. Unresolved entity ids inside a rule must pass through unchanged rather than be dropped, because an emptied group list turns \"allow these groups\" into \"block everyone\".\n\nJira applies transition field values only when the transition has a screen. A transition with no screen silently ignores `fields` in the transition request."
  }
];

export default SECTIONS;
