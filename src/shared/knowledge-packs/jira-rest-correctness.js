/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "jira-rest-correctness" — 11 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "jira-rest-correctness";

export const SECTIONS = [
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/gotchas.md",
      "hash": "32fcbc215217ea63",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2294,
    "body": "A `PUT /rest/api/3/issue/{key}` to a field that isn't on that issue's **edit screen** (for its project + issue type) returns **2xx but never applies the value** — no error, no warning.\n- **Fix**: Pre-flight with `GET /rest/api/3/issue/{key}/editmeta` and only write fields present in `data.fields`. Run it per project/issue-type combo, not per issue, for homogeneous batches. See `06-api-endpoints.md`.\n- **Escape hatch**: `PUT ...?overrideScreenSecurity=true` writes off-screen fields anyway, but needs admin permission (non-admin → 403) and bypasses the protection editmeta reports on — use deliberately, not as a default.\n\n## Verify after write — re-read to confirm Jira accepted it\nBecause writes can be silently dropped (off-screen fields, automation rules, validators, or workflow conditions rewriting your value), a 2xx is **not** proof the change landed. se-ppm-forge re-fetches written issues with `POST /rest/api/3/issue/bulkfetch` and compares each field's actual value against what it intended to write; a mismatch is reported as a real failure.\n- **Fix**: For anything you must guarantee (bulk migrations, scheduling writes), re-read the issues after writing and diff expected vs actual. Normalize before comparing (dates, durations) so formatting differences don't read as false mismatches.\n\n## Suppress notification spam on bulk writes (notifyUsers=false)\nBy default every `PUT /rest/api/3/issue/{key}` e-mails watchers and the assignee.\n- **Gotcha**: A loop over hundreds of issues sends hundreds of e-mails and can itself trip rate limits / mail throttling.\n- **Fix**: Append `?notifyUsers=false` to bulk/automation writes. Keep notifications on only for genuinely user-initiated single edits.\n\n## Issue-link direction is counter-intuitive\n`POST /rest/api/3/issueLink` reads as `outwardIssue <type.outward> inwardIssue`. For **Blocks**, `outwardIssue` is the blocker/predecessor and `inwardIssue` is blocked-by/successor — the field names feel reversed vs the UI wording, and admins rename link descriptions per site.\n- **Fix**: Before any bulk link creation, GET `/rest/api/3/issueLinkType` to read the inward/outward labels, create one probe link, and re-read the issue (`?fields=issuelinks`) to confirm direction. Details + worked example in `06-api-endpoints.md`."
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/gotchas.md",
      "hash": "32fcbc215217ea63",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2215,
    "body": "# Forge Development Gotchas (Jira)\n\nThis document contains environment-specific facts and common pitfalls that defy reasonable assumptions. Use this to avoid common mistakes during development.\n\n## Forge Tunnel & Manifest Changes\nWhen you modify `manifest.yml` (e.g., adding a new scope or module), **the running `forge tunnel` will not automatically pick up the changes.**\n- **Fix**: Stop the tunnel (`Ctrl+C`) and restart it to apply the new manifest configuration.\n\n## Authentication Context\nThe behavior of your app changes significantly depending on the authentication method used:\n- `api.asApp()`: Executes with the app's own permissions. Best for background tasks and system-level operations.\n- `api.asUser()`: Executes with the permissions of the user who triggered the event. Best for UI interactions where user context is required.\n- **Gotcha**: If you use `asApp()` for a UI interaction, the user might see data they shouldn't, or the app might perform actions on their behalf that they didn't intend.\n\n## CSP (Content Security Policy) in Custom UI\nCustom UI apps run in a highly restrictive sandbox.\n- **Issue**: \"Refused to load script\" or \"Refused to connect to...\" errors.\n- **Fix**: Ensure all external domains are explicitly declared in the `permissions.external.fetch.client` section of your `manifest.yml`.\n- **Note**: You cannot use inline `<script>` tags or inline styles in Custom UI.\n\n## Rate Limiting (429)\nJira Cloud has strict rate limits on REST API calls.\n- **Issue**: Your app suddenly starts receiving `429 Too Many Requests` errors.\n- **Fix**: Implement exponential backoff in your resolver functions. Avoid making massive batches of requests in a single loop.\n\n## Workflow Validator Errors\nWhen a `jira:workflowValidator` fails, the error message returned via `errorMessage` is what the user sees in the Jira UI.\n- **Gotcha**: Keep error messages concise and actionable. Avoid technical jargon or stack traces.\n\n## Custom UI Modal Sizing\nThe `viewportSize` property for `contentAction` (e.g., `small`, `medium`, `large`) is a hint, not a strict rule.\n- **Gotcha**: Extremely complex UIs might feel cramped in `small` or `medium` viewports. Test your UI layout across different sizes."
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/gotchas.md",
      "hash": "32fcbc215217ea63",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 1934,
    "body": "The obvious mapping — `body.issues[n]` is the nth thing you sent — is wrong the\ninstant one element fails. Jira omits the rejected element from `issues`\nentirely and reports it separately in `body.errors[]` by `failedElementNumber`,\nso **every later success shifts down by one** and is recorded against the wrong\ninput.\n\nIt also answers **201 for a full success and 400 for a PARTIAL one**, with the\nsuccesses still present in `issues` — so the status code alone must not decide\nwhether anything was created.\n\nOn a flat batch that is a mislabel you might never notice. On a **hierarchy** it\nis not: if a later pass resolves a child's parent through that same array, one\nrejected element silently re-parents everything after it, and you get a tree\nthat looks plausible and is wrong.\n\n```js\n// Read the FAILURES first, then consume the successes against what is left.\nconst errs = Array.isArray(body?.errors) ? body.errors : [];\nconst failed = new Set(errs.map((e) => Number(e?.failedElementNumber)).filter(Number.isInteger));\nconst made = Array.isArray(body?.issues) ? body.issues : [];\nconst survived = sent.map((s, pos) => ({ s, pos })).filter(({ pos }) => !failed.has(pos));\n\nif (made.length === survived.length) {\n  made.forEach((m, n) => record(survived[n].s, m.key));\n} else {\n  // The counts disagree: Jira told you something you do not understand. Record\n  // NOTHING and report every entry as an honest failure — guessing here is\n  // exactly how the mis-attribution comes back.\n}\n```\n\nCarry the caller's original index back with each created issue. Summaries are\nneither unique nor echoed verbatim, so once the result array has been compacted\nan index is the only reliable way home.\n\nRelated: **JQL is eventually consistent**, so do not verify a bulk create by\nsearching for it. `parent = KEY` can return zero seconds after the children\nexist while `GET /issue/{key}` shows the parent set correctly. Read back by key."
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2187,
    "body": "# Common Problem Patterns for Jira Forge\n\nThis document provides copy-paste ready solutions for common development scenarios.\n\n---\n\n## Manifest Configuration\n```yaml\nmodules:\n  jira:workflowValidator:\n    - key: project-based-validator\n      name: Project-Based Validator\n      description: Validates based on project context\n      function: validateByProject\n      \n      create:\n        resource: config-ui\n```\n\n## UI Component (src/Configure.js)\n```javascript\nimport React, { useState, useEffect } from 'react';\nimport { Form, Select, Loader } from '@forge/bridge';\n\nexport const Configure = () => {\n  const [projects, setProjects] = useState([]);\n  const [loading, setLoading] = useState(true);\n  const [selectedProject, setSelectedProject] = useState('');\n\n  useEffect(() => {\n    fetchProjects();\n  }, []);\n\n  const fetchProjects = async () => {\n    try {\n      const response = await bridge.requestJira('/rest/api/3/project');\n      const data = await response.json();\n      \n      setProjects(data.map(p => ({\n        label: `${p.key} - ${p.name}`,\n        value: p.id\n      })));\n      \n      setLoading(false);\n    } catch (error) {\n      console.error('Error fetching projects:', error);\n      setLoading(false);\n    }\n  };\n\n  return (\n    <Form>\n      {loading && <Loader />}\n      \n      <Select\n        label=\"Select Project\"\n        options={projects}\n        value={selectedProject}\n        onChange={(value) => setSelectedProject(value)}\n      />\n    </Form>\n  );\n};\n```\n\n## Validator Function (src/index.js)\n```javascript\nexport const validateByProject = async (args) => {\n  const { issue, configuration } = args;\n  \n  // Get selected project from configuration\n  const projectId = configuration.projectId;\n  \n  // Only validate if issue belongs to selected project\n  if (issue.fields.project.id !== projectId) {\n    return { result: true }; // Skip validation for other projects\n  }\n  \n  // Apply your validation logic here\n  const description = issue.fields.description || '';\n  \n  if (description.length < 20) {\n    return { \n      result: false, \n      errorMessage: \"Description must be at least 20 characters\" \n    };\n  }\n  \n  return { result: true };\n};\n```\n\n---"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 3267,
    "body": "```javascript\nimport React, { useState, useEffect } from 'react';\nimport { Form, Select, FieldText, ButtonGroup, Button } from '@forge/bridge';\n\nexport const Configure = () => {\n  const [fields, setFields] = useState([]);\n  const [fieldId, setFieldId] = useState('');\n  const [apiKey, setApiKey] = useState('');\n\n  useEffect(() => {\n    fetchCustomFields();\n  }, []);\n\n  const fetchCustomFields = async () => {\n    try {\n      // Get all fields from Jira\n      const response = await bridge.requestJira('/rest/api/3/field');\n      const data = await response.json();\n      \n      setFields(data.map(f => ({\n        label: f.name,\n        value: f.id\n      })));\n    } catch (error) {\n      console.error('Error fetching fields:', error);\n    }\n  };\n\n  return (\n    <Form>\n      <Select\n        label=\"Field to Validate\"\n        options={fields}\n        value={fieldId}\n        onChange={(e) => setFieldId(e.target.value)}\n      />\n      \n      <FieldText\n        label=\"API Key (optional)\"\n        value={apiKey}\n        onChange={(e) => setApiKey(e.target.value)}\n      />\n    </Form>\n  );\n};\n```\n\n---\n\n## Scheduled Trigger for Sync\n```yaml\nmodules:\n  scheduledTrigger:\n    - key: sync-external-system\n      name: { value: 'Sync Issues to External System' }\n      description: { value: 'Sends updated issues to external CRM' }\n      function: syncToExternalSystem\n      schedule:\n        period: hour\n```\n\n## Sync Function with Batching\n```javascript\nimport api, { route } from '@forge/api';\n\nexport const syncToExternalSystem = async (event, context) => {\n  console.log('Starting sync to external system');\n  \n  try {\n    // Get issues updated in last hour\n    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();\n    \n    const response = await api.asApp().requestJira(route`/rest/api/3/search`, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        jql: `updated >= \"${oneHourAgo}\"`,\n        fields: ['summary', 'description', 'status', 'assignee'],\n        maxResults: 50, // Batch size\n        startAt: 0\n      })\n    });\n    \n    const data = await response.json();\n    const issues = data.issues;\n    \n    console.log(`Found ${issues.length} issues to sync`);\n    \n    // Process in batches\n    for (const issue of issues) {\n      await sendToExternalSystem(issue);\n    }\n    \n    console.log('Sync completed successfully');\n    return { status: 'success', syncedCount: issues.length };\n    \n  } catch (error) {\n    console.error('Sync error:', error);\n    throw error;\n  }\n};\n\nasync function sendToExternalSystem(issue) {\n  const payload = {\n    issueKey: issue.key,\n    summary: issue.fields.summary,\n    description: issue.fields.description || '',\n    status: issue.fields.status.name,\n    assignee: issue.fields.assignee?.displayName\n  };\n  \n  try {\n    await api.asApp().requestJira(\n      route`https://api.example.com/sync/${issue.key}`,\n      {\n        method: 'PUT',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify(payload)\n      }\n    );\n    \n    console.log(`Synced issue ${issue.key}`);\n  } catch (error) {\n    console.error(`Failed to sync ${issue.key}:`, error);\n    // Don't throw - continue with other issues\n  }\n}\n```\n\n---"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2583,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\nexport const handleConfigUpdate = async (args) => {\n  const { issue, configuration, context } = args;\n  \n  // Check if this is a re-validation after config change\n  if (configuration.version !== '2') {\n    console.log('Configuration version changed, applying new rules');\n    \n    // Update configuration if needed\n    return { \n      result: true,\n      configurationUpdate: { version: '2' }\n    };\n  }\n  \n  // Apply current validation logic\n  return applyValidation(issue);\n};\n\n// Save updated configuration in UI\nexport const onSaveConfiguration = async () => {\n  const config = {\n    fieldId: document.getElementById('field-select').value,\n    ruleType: document.getElementById('rule-select').value,\n    version: '2', // Increment when rules change\n    enabled: true\n  };\n  \n  return JSON.stringify(config);\n};\n```\n\n---\n\n## Multi-Project Type Validator\n```yaml\nmodules:\n  jira:workflowValidator:\n    - key: multi-project-validator\n      name: Project-Aware Validator\n      description: Different rules for different project types\n      function: validateByProjectType\n      \n      projectTypes:\n        - company-managed\n        - team-managed\n        \n      create:\n        resource: config-ui\n```\n\n```javascript\nexport const validateByProjectType = async (args) => {\n  const { issue, configuration } = args;\n  \n  // Determine project type\n  const isCompanyManaged = issue.fields.project.scheme?.type === 'company';\n  \n  if (isCompanyManaged) {\n    return applyCompanyRules(issue);\n  } else {\n    return applyTeamRules(issue);\n  }\n};\n\nfunction applyCompanyRules(issue) {\n  // Stricter rules for company-managed projects\n  const rules = [\n    { field: 'summary', minLength: 10 },\n    { field: 'description', required: true }\n  ];\n  \n  return validateAgainstRules(rules, issue);\n}\n\nfunction applyTeamRules(issue) {\n  // Lighter rules for team-managed projects\n  const rules = [\n    { field: 'summary', minLength: 5 }\n  ];\n  \n  return validateAgainstRules(rules, issue);\n}\n\nfunction validateAgainstRules(rules, issue) {\n  const failures = [];\n  \n  for (const rule of rules) {\n    const value = issue.fields[rule.field];\n    \n    if (rule.required && (!value || value === '')) {\n      failures.push(`${rule.field} is required`);\n    }\n    \n    if (rule.minLength && String(value).length < rule.minLength) {\n      failures.push(`${rule.field} must be at least ${rule.minLength} characters`);\n    }\n  }\n  \n  return failures.length > 0\n    ? { result: false, errorMessage: failures.join('; ') }\n    : { result: true };\n}\n```\n\n---"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2066,
    "body": "```yaml\nmodules:\n  jira:workflowValidator:\n    - key: external-validation-validator\n      name: External Validation Validator\n      description: Validates against external service\n      function: validateExternal\n      \n      create:\n        resource: config-ui\n\npermissions:\n  scopes:\n    - read:jira-work\n  external:\n    fetch:\n      backend:\n        - \"api.example.com\"\n```\n\n## Function with External API Call\n```javascript\nimport api, { route } from '@forge/api';\n\nexport const validateExternal = async (args) => {\n  const { issue, configuration } = args;\n  \n  // Get field value to validate\n  const fieldValue = issue.fields[configuration.fieldId];\n  \n  if (!fieldValue) {\n    return { result: true }; // Skip empty fields\n  }\n  \n  try {\n    // Call external API for validation using fetch (api.asApp().requestJira is for Atlassian APIs only)\n    const endpoint = `https://api.example.com/validate?value=${encodeURIComponent(fieldValue)}`;\n    \n    // Option 1: Use requestConfluence from @forge/bridge for Custom UI frontend\n    // const response = await requestConfluence(endpoint);\n    \n    // Option 2: For backend functions, create a separate API endpoint that proxies to external service\n    const apiEndpoint = `/api/external/validate?value=${encodeURIComponent(fieldValue)}`;\n    const response = await api.asUser().requestConfluence(route`${apiEndpoint}`);\n    \n    if (!response.ok) {\n      const errorText = await response.text();\n      console.error('External validation failed:', errorText);\n      return { \n        result: false, \n        errorMessage: \"External validation service unavailable\" \n      };\n    }\n    \n    const result = await response.json();\n    \n    if (result.valid) {\n      return { result: true };\n    } else {\n      return { \n        result: false, \n        errorMessage: result.errorMessage || \"Validation failed\" \n      };\n    }\n  } catch (error) {\n    console.error('Error during external validation:', error);\n    return { \n      result: false, \n      errorMessage: \"Error contacting validation service\" \n    };\n  }\n};\n```"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 182,
    "body": "- Review `docs/when-to-use-which.md` to choose the right module type\n- See `templates/` directory for boilerplate configurations\n- Check existing docs for more detailed API reference"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2837,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n// Track requests per second\nlet requestTimestamps = [];\nconst MAX_REQUESTS_PER_SECOND = 5;\n\nasync function rateLimitedRequest(endpoint, options = {}) {\n  const now = Date.now();\n  \n  // Remove old timestamps (older than 1 second)\n  requestTimestamps = requestTimestamps.filter(\n    ts => now - ts < 1000\n  );\n  \n  // Wait if we've made too many requests in the last second\n  while (requestTimestamps.length >= MAX_REQUESTS_PER_SECOND) {\n    const oldestRequest = Math.min(...requestTimestamps);\n    const waitTime = 1000 - (now - oldestRequest);\n    \n    console.log(`Rate limit approaching, waiting ${waitTime}ms`);\n    await new Promise(resolve => setTimeout(resolve, waitTime));\n  }\n  \n  // Record this request\n  requestTimestamps.push(now);\n  \n  return api.asApp().requestJira(route`${endpoint}`, options);\n}\n\n// Usage example\nexport const bulkUpdateIssues = async (issueKeys) => {\n  const results = [];\n  \n  for (const key of issueKeys) {\n    try {\n      const response = await rateLimitedRequest(`/rest/api/3/issue/${key}`);\n      const issue = await response.json();\n      \n      results.push({\n        key: issue.key,\n        success: true\n      });\n    } catch (error) {\n      console.error(`Error fetching ${key}:`, error);\n      \n      results.push({\n        key: key,\n        success: false,\n        error: error.message\n      });\n    }\n  }\n  \n  return results;\n};\n```\n\n---\n\n## Bulk Issue Creation Example\n```javascript\nimport api, { route } from '@forge/api';\n\nexport const bulkCreateIssues = async (issuesToCreate) => {\n  try {\n    // Split into batches of 50 (Jira's limit)\n    const batchSize = 50;\n    \n    for (let i = 0; i < issuesToCreate.length; i += batchSize) {\n      const batch = issuesToCreate.slice(i, i + batchSize);\n      \n      const response = await api.asApp().requestJira(\n        route`/rest/api/3/issue/bulk`,\n        {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify({\n            issueUpdates: batch.map(issue => ({\n              fields: {\n                summary: issue.summary,\n                description: issue.description || '',\n                issuetype: { name: issue.issueType || 'Task' },\n                project: { key: issue.projectKey }\n              }\n            }))\n          })\n        }\n      );\n      \n      console.log(`Created ${batch.length} issues in batch`);\n    }\n    \n    return { \n      status: 'success', \n      totalCreated: issuesToCreate.length \n    };\n  } catch (error) {\n    console.error('Bulk creation error:', error);\n    throw error;\n  }\n};\n\n// Example usage\nconst newIssues = [\n  { summary: \"Issue 1\", projectKey: \"PROJ\" },\n  { summary: \"Issue 2\", projectKey: \"PROJ\" },\n  // ... more issues\n];\n\nawait bulkCreateIssues(newIssues);\n```\n\n---"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2374,
    "body": "```javascript\nexport const complexValidator = async (args) => {\n  const { issue, configuration } = args;\n  const rules = configuration.rules || [];\n  \n  // Track all validation failures\n  const failures = [];\n  \n  for (const rule of rules) {\n    const failure = await applyRule(rule, issue);\n    \n    if (failure) {\n      failures.push(failure);\n    }\n  }\n  \n  if (failures.length > 0) {\n    return { \n      result: false,\n      errorMessage: `Validation failed: ${failures.join('; ')}`\n    };\n  }\n  \n  return { result: true };\n};\n\nasync function applyRule(rule, issue) {\n  switch (rule.type) {\n    case 'requiredField':\n      const value = issue.fields[rule.fieldId];\n      if (!value || value === '') {\n        return `${rule.label} is required`;\n      }\n      break;\n      \n    case 'minLength':\n      const textValue = String(issue.fields[rule.fieldId] || '');\n      if (textValue.length < rule.minLength) {\n        return `${rule.label} must be at least ${rule.minLength} characters`;\n      }\n      break;\n      \n    case 'regex':\n      const regexValue = issue.fields[rule.fieldId];\n      if (regexValue && !new RegExp(rule.pattern).test(regexValue)) {\n        return `${rule.label} doesn't match pattern: ${rule.pattern}`;\n      }\n      break;\n  }\n  \n  return null; // No failure\n}\n```\n\n---\n\n## Get Current User Information\n```javascript\nimport { bridge } from '@forge/bridge';\n\nexport const getUserInfo = async () => {\n  try {\n    const context = await bridge.getContext();\n    \n    console.log('User Info:', {\n      accountId: context.accountId,\n      accountType: context.accountType,\n      displayName: context.displayName,\n      email: context.email\n    });\n    \n    return {\n      accountId: context.accountId,\n      accountType: context.accountType\n    };\n  } catch (error) {\n    console.error('Error getting user context:', error);\n    throw error;\n  }\n};\n\n// Use in a validator to apply user-specific rules\nexport const userAwareValidator = async (args) => {\n  const { issue, configuration } = args;\n  \n  // Get current user\n  const userInfo = await getUserInfo();\n  \n  // Apply different validation based on user type\n  if (userInfo.accountType === 'atlassian') {\n    // Stricter validation for internal users\n    return applyInternalRules(issue);\n  } else {\n    // Lighter validation for external users\n    return applyExternalRules(issue);\n  }\n};\n```\n\n---"
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
    "provenance": {
      "source": "jira-api",
      "sourceName": "LeanZero Forge Skills",
      "path": "~/Projects/skill-jira-forge/jira-api-skill/docs/problem-patterns.md",
      "hash": "668c2a14e965fab3",
      "licence": "Apache-2.0 (NOTICE retained)"
    },
    "bytes": 2378,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n// Store last sync timestamp in KVS\nconst LAST_SYNC_KEY = 'last-sync-timestamp';\n\nasync function getLastSyncTime() {\n  try {\n    const storage = api.asApp().storage.get(LAST_SYNC_KEY);\n    return JSON.parse(await storage) || Date.now();\n  } catch {\n    return Date.now() - (24 * 60 * 60 * 1000); // Default to 24 hours ago\n  }\n}\n\nasync function setLastSyncTime(timestamp) {\n  const storage = api.asApp().storage.get(LAST_SYNC_KEY);\n  await storage.set(JSON.stringify(timestamp));\n}\n\nexport const syncToExternalTicketing = async (event, context) => {\n  const lastSync = await getLastSyncTime();\n  \n  try {\n    // Find issues updated since last sync\n    const response = await api.asApp().requestJira(\n      route`/rest/api/3/search`,\n      {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          jql: `updated >= \"${new Date(lastSync).toISOString()}\"`,\n          fields: ['summary', 'description', 'status', 'customfield_10001']\n        })\n      }\n    );\n    \n    const data = await response.json();\n    \n    for (const issue of data.issues) {\n      // Send to external system\n      const payload = {\n        jiraKey: issue.key,\n        summary: issue.fields.summary,\n        status: issue.fields.status.name,\n        customValue: issue.fields.customfield_10001\n      };\n      \n      await api.asApp().requestJira(\n        route`https://api.external-system.com/sync/${issue.key}`,\n        {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify(payload)\n        }\n      );\n    }\n    \n    // Update last sync time\n    await setLastSyncTime(Date.now());\n    \n    return { \n      status: 'success', \n      syncedIssues: data.issues.length,\n      timestamp: Date.now()\n    };\n    \n  } catch (error) {\n    console.error('Sync error:', error);\n    throw error;\n  }\n};\n```\n\n---\n\n## Tips for Problem Patterns\n1. **Always handle errors gracefully** - Return failure results instead of throwing\n2. **Rate limit external calls** - Use the rate limiting helper from pattern #4\n3. **Batch operations** - Process in chunks to avoid timeouts\n4. **Log extensively** - Use `console.log()` for debugging, view with `forge logs`\n5. **Test locally first** - Use `forge tunnel` to test with your live instance\n\n---"
  }
];

export default SECTIONS;
