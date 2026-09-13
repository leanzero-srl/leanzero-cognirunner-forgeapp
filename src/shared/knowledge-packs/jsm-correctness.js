/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "jsm-correctness" — 11 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "jsm-correctness";

export const SECTIONS = [
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1762,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n/**\n * Post-function: Auto-assign issue based on category and team capacity\n */\nexport const autoAssignIssue = async (payload) => {\n  const { issueId, categoryId } = payload;\n\n  // Get available agents for this category\n  const availableAgents = await getAvailableAgents(categoryId);\n  \n  if (!availableAgents.length) {\n    console.log('No available agents found');\n    return { result: true }; // Don't block the workflow\n  }\n\n  // Simple round-robin assignment (could be enhanced with load balancing)\n  const assignedAgent = selectAgentByLoad(availableAgents);\n\n  // Update issue assignee\n  await api.asApp().requestJira(\n    route`/rest/api/3/issue/${issueId}`,\n    {\n      method: 'PUT',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        fields: {\n          assignee: { accountId: assignedAgent.accountId }\n        }\n      })\n    }\n  );\n\n  console.log(`Assigned issue ${issueId} to ${assignedAgent.displayName}`);\n  \n  return { result: true };\n};\n\nasync function getAvailableAgents(categoryId) {\n  // Get all users in the service desk group\n  const groupsResponse = await api.asApp().requestJira(\n    route`/rest/api/3/group/bulk?groupQuery=service-desk-agents`\n  );\n  \n  const groupsData = await groupsResponse.json();\n  \n  // For each group, get members (simplified - you'd need proper pagination)\n  // This is a simplified example\n  \n  return [\n    { accountId: '5b10a2849c3f7d0d562c', displayName: 'Agent One' },\n    { accountId: '5b10a2849c3f7d0d563e', displayName: 'Agent Two' }\n  ];\n}\n\nfunction selectAgentByLoad(agents) {\n  // Simplified selection - in production, check actual workload\n  return agents[Math.floor(Math.random() * agents.length)];\n}\n```"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2433,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n/**\n * Scheduled trigger: Auto-resolve issues with no customer response for X days\n */\nexport const autoResolveStaleIssues = async () => {\n  const staleThresholdDays = 7;\n  const cutoffDate = new Date(Date.now() - staleThresholdDays * 24 * 60 * 60 * 1000);\n\n  // Find issues waiting for customer that haven't been updated since cutoff\n  const jql = `project = SVC AND status IN (\"Waiting for Customer\", \"Pending\") \n               AND updated < \"${cutoffDate.toISOString()}\"`;\n\n  const response = await api.asApp().requestJira(\n    route`/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,assignee,status`\n  );\n\n  if (!response.ok) {\n    throw new Error(`Search failed: ${await response.text()}`);\n  }\n\n  const data = await response.json();\n  \n  console.log(`Found ${data.total} stale issues to auto-resolve`);\n\n  for (const issue of data.issues) {\n    await resolveStaleIssue(issue);\n  }\n\n  return { resolved: data.issues.map(i => i.key) };\n};\n\nasync function resolveStaleIssue(issue) {\n  try {\n    // Add comment explaining auto-resolution\n    await api.asApp().requestJira(\n      route`/rest/api/3/issue/${issue.id}/comment`,\n      {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          body: {\n            type: 'doc',\n            version: 1,\n            content: [\n              {\n                type: 'paragraph',\n                content: [{\n                  type: 'text',\n                  text: `🤖 **Auto-Resolution Notice**: This ticket has been automatically resolved due to no customer response for 7 days. If you need further assistance, please create a new request.`\n                }]\n              }\n            ]\n          },\n          visibility: {\n            type: 'group',\n            value: 'service-desk-customers'\n          }\n        })\n      }\n    );\n\n    // Transition to resolved/closed\n    await api.asApp().requestJira(\n      route`/rest/api/3/issue/${issue.id}/transitions`,\n      {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          transition: { id: '5' } // Replace with actual \"Done\" transition ID\n        })\n      }\n    );\n\n    console.log(`Auto-resolved issue ${issue.key}`);\n  } catch (error) {\n    console.error(`Failed to auto-resolve ${issue.key}:`, error.message);\n  }\n}\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2897,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n/**\n * Trigger: Send custom notifications when issue is updated\n */\nexport const handleIssueUpdate = async (payload) => {\n  const { issueId, fieldChanged, newValue } = payload;\n  \n  // Get issue details\n  const issueResponse = await api.asApp().requestJira(\n    route`/rest/api/3/issue/${issueId}?fields=summary,assignee,status,reporter`\n  );\n  \n  if (!issueResponse.ok) {\n    throw new Error('Failed to fetch issue');\n  }\n  \n  const issue = await issueResponse.json();\n  const fields = issue.fields;\n\n  // Determine notification type based on change\n  let notificationTemplate;\n  \n  switch (fieldChanged) {\n    case 'status':\n      if (newValue === 'Resolved' || newValue === 'Done') {\n        notificationTemplate = 'issue_resolved';\n      } else if (newValue === 'Waiting for Customer') {\n        notificationTemplate = 'waiting_for_customer';\n      }\n      break;\n      \n    case 'assignee':\n      notificationTemplate = 'assigned';\n      break;\n      \n    default:\n      return; // No custom notification needed\n  }\n\n  if (notificationTemplate) {\n    await sendCustomerNotification(\n      fields.reporter?.accountId,\n      issue.key,\n      fields.summary,\n      notificationTemplate,\n      newValue\n    );\n  }\n};\n\nasync function sendCustomerNotification(customerAccountId, issueKey, summary, template, value) {\n  // Get customer's email\n  const userResponse = await api.asApp().requestJira(\n    route`/rest/api/3/user?accountId=${customerAccountId}`\n  );\n  \n  if (!userResponse.ok) {\n    console.warn('Could not fetch user info');\n    return;\n  }\n  \n  const user = await userResponse.json();\n  \n  // Send via external email service (example with SendGrid)\n  try {\n    await sendEmail({\n      to: user.emailAddress,\n      subject: `[${issueKey}] ${summary} - Status Update`,\n      templateId: template,\n      dynamicTemplateData: {\n        issueKey,\n        summary,\n        newValue: value,\n        link: `https://your-domain.atlassian.net/servicedesk/customer/portal/1/${issueKey}`\n      }\n    });\n    \n    console.log(`Sent ${template} notification to ${user.emailAddress}`);\n  } catch (error) {\n    console.error('Failed to send email:', error.message);\n  }\n}\n\nasync function sendEmail(config) {\n  // Example: SendGrid integration\n  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {\n    method: 'POST',\n    headers: {\n      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify({\n      personalizations: [{ to: [{ email: config.to }] }],\n      from: { email: 'support@your-company.com' },\n      subject: config.subject,\n      template_id: config.templateId,\n      dynamic_template_data: config.dynamicTemplateData\n    })\n  });\n\n  if (!response.ok) {\n    throw new Error(`SendGrid API error: ${await response.text()}`);\n  }\n}\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3370,
    "body": "```tsx\nimport React, { useState } from 'react';\nimport { invoke } from '@forge/bridge';\n\ninterface FormData {\n  summary: string;\n  description: string;\n  priority: string;\n  category: string;\n  attachmentIds?: number[];\n}\n\nfunction CustomRequestForm() {\n  const [formData, setFormData] = useState<FormData>({\n    summary: '',\n    description: '',\n    priority: 'Medium',\n    category: ''\n  });\n  const [submitting, setSubmitting] = useState(false);\n  const [result, setResult] = useState<{ success?: boolean; key?: string; error?: string } | null>(null);\n\n  const handleSubmit = async (e: React.FormEvent) => {\n    e.preventDefault();\n    setSubmitting(true);\n    \n    try {\n      const response = await invoke('createServiceRequest', formData);\n      setResult({ success: true, key: response.key });\n    } catch (error) {\n      setResult({ error: error.message || 'Failed to create request' });\n    } finally {\n      setSubmitting(false);\n    }\n  };\n\n  if (result?.success) {\n    return (\n      <div style={{ padding: '20px', textAlign: 'center' }}>\n        <h3>Request Created!</h3>\n        <p>Your ticket <strong>{result.key}</strong> has been submitted.</p>\n        <button onClick={() => window.location.reload()}>Create Another</button>\n      </div>\n    );\n  }\n\n  if (result?.error) {\n    return (\n      <div style={{ padding: '20px', color: '#de350b' }}>\n        <h3>Error</h3>\n        <p>{result.error}</p>\n        <button onClick={() => setResult(null)}>Try Again</button>\n      </div>\n    );\n  }\n\n  return (\n    <form onSubmit={handleSubmit} style={{ maxWidth: '600px' }}>\n      <h2>New Service Request</h2>\n      \n      <div style={{ marginBottom: '16px' }}>\n        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>\n          Summary *\n        </label>\n        <input\n          type=\"text\"\n          value={formData.summary}\n          onChange={(e) => setFormData({ ...formData, summary: e.target.value })}\n          required\n          style={{\n            width: '100%',\n            padding: '8px',\n            border: '1px solid #DFE1E6',\n            borderRadius: '3px'\n          }}\n        />\n      </div>\n\n      <div style={{ marginBottom: '16px' }}>\n        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>\n          Description *\n        </label>\n        <textarea\n          value={formData.description}\n          onChange={(e) => setFormData({ ...formData, description: e.target.value })}\n          required\n          rows={5}\n          style={{\n            width: '100%',\n            padding: '8px',\n            border: '1px solid #DFE1E6',\n            borderRadius: '3px'\n          }}\n        />\n      </div>\n\n      <div style={{ marginBottom: '16px' }}>\n        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>\n          Priority\n        </label>\n        <select\n          value={formData.priority}\n          onChange={(e) => setFormData({ ...formData, priority: e.target.value })}\n          style={{\n            width: '100%',\n            padding: '8px',\n            border: '1px solid #DFE1E6',\n            borderRadius: '3px'\n          }}\n        >\n          <option value=\"Low\">Low</option>\n          <option value=\"Medium\">Medium</option>\n          <option value=\"High\">High</option>\n          <option value=\"Highest\">Highest</option>\n        </select>\n      </div>"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2977,
    "body": "<div style={{ marginBottom: '16px' }}>\n        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>\n          Category\n        </label>\n        <select\n          value={formData.category}\n          onChange={(e) => setFormData({ ...formData, category: e.target.value })}\n          required\n          style={{\n            width: '100%',\n            padding: '8px',\n            border: '1px solid #DFE1E6',\n            borderRadius: '3px'\n          }}\n        >\n          <option value=\"\">Select a category</option>\n          <option value=\"incident\">Incident</option>\n          <option value=\"service_request\">Service Request</option>\n          <option value=\"question\">Question</option>\n        </select>\n      </div>\n\n      <button \n        type=\"submit\" \n        disabled={submitting}\n        style={{\n          padding: '10px 20px',\n          backgroundColor: submitting ? '#6B77FFC4' : '#0052CC',\n          color: 'white',\n          border: 'none',\n          borderRadius: '3px',\n          cursor: submitting ? 'not-allowed' : 'pointer'\n        }}\n      >\n        {submitting ? 'Submitting...' : 'Submit Request'}\n      </button>\n    </form>\n  );\n}\n\nexport default CustomRequestForm;\n```\n\n## Backend Resolver for Creating Requests\n```javascript\nimport api, { route } from '@forge/api';\n\nresolver.define('createServiceRequest', async (payload) => {\n  const { summary, description, priority, category } = payload;\n\n  // Map category to request type ID\n  const requestTypeMap = {\n    'incident': 10001,      // Replace with actual request type IDs\n    'service_request': 10002,\n    'question': 10003\n  };\n\n  const issueTypeId = requestTypeMap[category];\n  \n  if (!issueTypeId) {\n    throw new Error('Invalid category selected');\n  }\n\n  // Create the issue (which becomes a service request)\n  const response = await api.asApp().requestJira(\n    route`/rest/api/3/issue`,\n    {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        fields: {\n          project: { key: 'SVC' }, // Replace with your service desk key\n          issuetype: { id: issueTypeId.toString() },\n          summary,\n          description: {\n            type: 'doc',\n            version: 1,\n            content: [\n              {\n                type: 'paragraph',\n                content: [{ type: 'text', text: description }]\n              }\n            ]\n          },\n          priority: { name: priority }\n        }\n      })\n    }\n  );\n\n  if (!response.ok) {\n    const errorText = await response.text();\n    console.error('Error creating service request:', errorText);\n    \n    // Parse Jira error details if available\n    try {\n      const errorData = JSON.parse(errorText);\n      throw new Error(errorData.errors?.summary || errorData.message || 'Failed to create request');\n    } catch (parseErr) {\n      throw new Error('Failed to create request: ' + errorText);\n    }\n  }\n\n  return await response.json();\n});\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3479,
    "body": "# Jira Service Management (JSM) Extensions with Forge\n\nThis guide covers building Forge apps that extend Jira Service Management, including custom request types, SLA automation, customer portal customizations, and knowledge base integrations.\n\n---\n\n## What is Jira Service Management?\nJira Service Management (JSM) is Atlassian's IT service management solution that helps teams manage incidents, service requests, and changes. Forge provides several ways to extend JSM:\n\n## Key Extension Points\n| Feature | Forge Module | Use Case |\n|---------|--------------|----------|\n| Custom request types | `jira:adminPage` + JSM API | Add specialized service forms |\n| SLA automation | `trigger` + `scheduledTrigger` | Auto-escalate, notify on breaches |\n| Customer portal UI | Custom UI | Enhanced customer experience |\n| Knowledge base | Confluence integration | Self-service articles |\n| Notifications | `trigger` + webhooks | Custom email/SMS alerts |\n| Workflows | `jira:workflowPostFunction` | Auto-assign, auto-resolve |\n\n---\n\n## Service Desk vs Project\nA **Service Desk** is a project with the JSM template enabled. Each service desk has:\n- A portal (customer-facing interface)\n- Request types (categories of requests)\n- SLAs (service level agreements)\n- Queue configurations\n- Customer permissions settings\n\n## Request Types\nRequest types define how customers interact with your service desk:\n- **System request types**: Built-in (Incident, Service Request, etc.)\n- **Custom request types**: Created via UI or API\n\n## SLA Metrics\nSLAs track time-based goals:\n- **Time to first response**: Initial agent reply\n- **Time to resolution**: Complete fix\n- **Custom metrics**: Defined per service desk\n\n---\n\n## Overview\nWhile request types are typically created via the UI, Forge can programmatically configure and enhance them:\n\n## Step 1: Create the Request Type (Via API)\n```javascript\nimport api, { route } from '@forge/api';\n\n/**\n * Create a custom request type for the service desk\n */\nasync function createRequestType(projectId, name, description, icon) {\n  const response = await api.asApp().requestJira(\n    route`/servicedesk/api/v1/requests/type`,\n    {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        name,\n        description,\n        icon,\n        projectKey: projectId,\n        requestTypeStructureId: null // Will be auto-generated\n      })\n    }\n  );\n\n  if (!response.ok) {\n    throw new Error(`Failed to create request type: ${await response.text()}`);\n  }\n\n  return await response.json();\n}\n\n// Usage in a scheduled trigger or admin action\nresolver.define('setupServiceDesk', async (payload) => {\n  const { projectKey, requestTypes } = payload;\n\n  const createdTypes = [];\n  \n  for (const rt of requestTypes) {\n    const newType = await createRequestType(\n      projectKey,\n      rt.name,\n      rt.description,\n      rt.icon || 'fa-solid fa-question'\n    );\n    \n    // Configure fields for this request type\n    await configureRequestTypeFields(newType.id, rt.fields);\n    \n    createdTypes.push(newType);\n  }\n\n  return { createdTypes };\n});\n\nasync function configureRequestTypeFields(requestTypeId, fields) {\n  const response = await api.asApp().requestJira(\n    route`/servicedesk/api/v1/requests/type/${requestTypeId}/fields`,\n    {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ fields })\n    }\n  );\n\n  return await response.json();\n}\n```"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1908,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n/**\n * Suggest relevant knowledge base articles when creating a request\n */\nresolver.define('suggestKBArticles', async (payload) => {\n  const { summary, description } = payload;\n\n  // Search Confluence for matching articles\n  const searchQuery = `title~\"${summary}\" OR body~\"${description.substring(0, 50)}\"`;\n  \n  const response = await api.asApp().requestJira(\n    route`/wiki/rest/api/content/search?cql=${encodeURIComponent(searchQuery)}&limit=3&expand=space,version`\n  );\n\n  if (!response.ok) {\n    console.warn('Confluence search failed:', await response.text());\n    return []; // Return empty array on error\n  }\n\n  const data = await response.json();\n  \n  return data.results.map(article => ({\n    id: article.id,\n    title: article.title,\n    link: `${article._links.base}${article._links.webui}`,\n    space: article.space?.key,\n    excerpt: extractExcerpt(summary, description)\n  }));\n});\n\nfunction extractExcerpt(summary, description) {\n  // Simple excerpt extraction - in production, use AI/matching algorithms\n  const maxLength = 150;\n  const text = `${summary}\\n\\n${description}`.replace(/[#*\\[\\]]/g, '');\n  \n  return text.length > maxLength \n    ? text.substring(0, maxLength) + '...' \n    : text;\n}\n\n/**\n * Record that an article was viewed from a service request\n */\nresolver.define('recordArticleView', async (payload) => {\n  const { issueId, articleId } = payload;\n\n  // Store the view in KVS for analytics\n  await storage.set(`view:${articleId}:${issueId}`, {\n    timestamp: Date.now()\n  });\n\n  return { success: true };\n});\n```\n\n## Manifest with Confluence Permissions\n```yaml\npermissions:\n  scopes:\n    - read:jira-work\n    - write:jira-work\n    - read:confluence-content      # Search KB articles\n    - read:confluence-space        # Read space info\n    \n  external:\n    fetch:\n      backend:\n        - \"*.atlassian.net\"\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 2351,
    "body": "```yaml\nmodules:\n  # Scheduled trigger to check SLAs every hour\n  scheduledTrigger:\n    - key: sla-monitor\n      function: checkSLABreaches\n      schedule: \"0 * * * *\"  # Every hour\n      \n# Functions\nfunctions:\n  - key: checkSLABreaches\n    handler: src/sla.checkSLABreaches\n\n# Permissions\npermissions:\n  scopes:\n    - read:jira-work\n    - write:jira-work\n```\n\n---\n\n## Create a Custom Portal Widget\n```yaml\nmodules:\n  # Add custom widget to customer portal\n  jira:portalCustomContent:\n    - key: my-portal-widget\n      title: Quick Actions\n      resource: widgetResource\n      \nresources:\n  - key: widgetResource\n    path: static/portal-widget/build\n    \npermissions:\n  scopes:\n    - read:jira-user\n    - read:jira-work\n  content:\n    styles:\n      - 'unsafe-inline'\n```\n\n## Portal Widget React Component\n```tsx\nimport React from 'react';\nimport { invoke } from '@forge/bridge';\n\nfunction PortalWidget() {\n  const [quickActions, setQuickActions] = React.useState([\n    { id: 1, title: 'Password Reset', icon: 'fa-key' },\n    { id: 2, title: 'Access Request', icon: 'fa-lock' },\n    { id: 3, title: 'Software Installation', icon: 'fa-download' }\n  ]);\n\n  return (\n    <div style={{\n      padding: '16px',\n      backgroundColor: '#f4f5f7',\n      borderRadius: '8px',\n      marginBottom: '16px'\n    }}>\n      <h3 style={{ margin: '0 0 12px', color: '#172B4D' }}>Quick Actions</h3>\n      \n      <div style={{ display: 'grid', gap: '8px' }}>\n        {quickActions.map(action => (\n          <button \n            key={action.id}\n            onClick={() => handleActionClick(action)}\n            style={{\n              padding: '12px 16px',\n              backgroundColor: '#0052CC',\n              color: 'white',\n              border: 'none',\n              borderRadius: '4px',\n              cursor: 'pointer',\n              textAlign: 'left',\n              display: 'flex',\n              alignItems: 'center',\n              gap: '12px'\n            }}\n          >\n            <i className={`fa-solid ${action.icon}`} />\n            <span>{action.title}</span>\n          </button>\n        ))}\n      </div>\n    </div>\n  );\n}\n\nasync function handleActionClick(action) {\n  // Navigate to create request with pre-filled fields\n  window.location.href = `/secure/CreateRequestDetails!default.jspa?pid=10000&issuetype=10001`;\n}\n\nexport default PortalWidget;\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 3212,
    "body": "```javascript\nimport api, { route } from '@forge/api';\n\n/**\n * Get all SLAs for a service desk project\n */\nasync function getServiceDeskSLAs(projectId) {\n  const response = await api.asApp().requestJira(\n    route`/servicedesk/api/v1/sla/metrics?projectId=${projectId}`\n  );\n\n  if (!response.ok) {\n    throw new Error(`Failed to get SLAs: ${await response.text()}`);\n  }\n\n  return await response.json();\n}\n\n/**\n * Get issues that are approaching or have breached an SLA\n */\nasync function getIssuesWithSLABreaches(projectId, slaMetricId, hoursUntilBreach = 2) {\n  const jql = `project = ${projectId} AND status != Done \n               AND sla_${slaMetricId}_days_remaining < ${hoursUntilBreach}`;\n\n  const response = await api.asApp().requestJira(\n    route`/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,status,assignee,sla_${slaMetricId}_days_remaining`\n  );\n\n  if (!response.ok) {\n    throw new Error(`Failed to get SLA breach issues: ${await response.text()}`);\n  }\n\n  const data = await response.json();\n  return data.issues;\n}\n\n/**\n * Scheduled trigger to check for SLA breaches and send notifications\n */\nexport const checkSLABreaches = async (payload) => {\n  const { projectId, slaMetricId, notificationGroupId } = payload;\n\n  // Get issues approaching breach\n  const approachingBreach = await getIssuesWithSLABreaches(projectId, slaMetricId, 2);\n  \n  // Get already breached issues\n  const alreadyBreached = await getIssuesWithSLABreaches(projectId, slaMetricId, 0);\n\n  console.log(`Found ${approachingBreach.length} approaching breach, ${alreadyBreached.length} already breached`);\n\n  // Send notifications for breached issues\n  for (const issue of alreadyBreached) {\n    await notifyAboutSLABreach(issue, notificationGroupId);\n  }\n\n  return {\n    approachingBreach: approachingBreach.map(i => i.key),\n    breached: alreadyBreached.map(i => i.key)\n  };\n};\n\nasync function notifyAboutSLABreach(issue, groupId) {\n  // Get existing comments to avoid duplicates\n  const commentsResponse = await api.asApp().requestJira(\n    route`/rest/api/3/issue/${issue.id}/comment?maxResults=1`\n  );\n  \n  const comments = await commentsResponse.json();\n  const hasRecentNotification = comments.comments.some(c => \n    c.body.includes('SLA breach notification') &&\n    Date.parse(c.created) > Date.now() - 24 * 60 * 60 * 1000 // Last 24 hours\n  );\n\n  if (!hasRecentNotification) {\n    // Add comment to issue\n    await api.asApp().requestJira(\n      route`/rest/api/3/issue/${issue.id}/comment`,\n      {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          body: {\n            type: 'doc',\n            version: 1,\n            content: [\n              {\n                type: 'paragraph',\n                content: [{\n                  type: 'text',\n                  text: `⚠️ **SLA Breach Notification**: This issue has breached the SLA metric. Please prioritize resolution.`\n                }]\n              }\n            ]\n          },\n          visibility: {\n            type: 'group',\n            value: groupId\n          }\n        })\n      }\n    );\n\n    console.log(`Notified about breach for issue ${issue.key}`);\n  }\n}\n```"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 1240,
    "body": "```javascript\n/**\n * Configure which fields appear in a request type form\n */\nasync function configureRequestTypeFields(requestTypeId, fieldConfig) {\n  const response = await api.asApp().requestJira(\n    route`/servicedesk/api/v1/requests/type/${requestTypeId}/fields`,\n    {\n      method: 'PUT',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        fields: fieldConfig.map(field => ({\n          fieldId: field.id,\n          visible: field.visible ?? true,\n          required: field.required ?? false,\n          position: field.position || 0\n        }))\n      })\n    }\n  );\n\n  if (!response.ok) {\n    throw new Error(`Failed to configure fields: ${await response.text()}`);\n  }\n\n  return await response.json();\n}\n\n// Example usage\nresolver.define('configureIncidentType', async () => {\n  const incidentTypeId = '10001'; // Get from createRequestType or list\n  \n  await configureRequestTypeFields(incidentTypeId, [\n    { id: 'summary', required: true, position: 0 },\n    { id: 'description', required: true, position: 1 },\n    { id: 'priority', required: false, visible: true, position: 2 },\n    { id: 'customfield_10001', required: true, visible: true, position: 3 } // Custom field\n  ]);\n});\n```\n\n---"
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
    "provenance": {
      "source": "jira-forge",
      "path": "~/Projects/skill-jira-forge/atlassian-jira-forge-skill/docs/22-jira-service-management.md",
      "hash": "97401216f2606f72",
      "licence": "Apache-2.0 (leanzero-forge-skills, NOTICE retained)"
    },
    "bytes": 808,
    "body": "| Capability | Module(s) Used | Key APIs |\n|------------|----------------|----------|\n| Custom request types | `scheduledTrigger` + REST API | `/servicedesk/api/v1/requests/type` |\n| SLA monitoring | `trigger`, `scheduledTrigger` | `/servicedesk/api/v1/sla/metrics` |\n| Portal widgets | `jira:portalCustomContent` | Custom UI |\n| Auto-assignment | `jira:workflowPostFunction` | REST API + team logic |\n| KB integration | Trigger functions | Confluence CQL API |\n| Customer notifications | `trigger` + webhooks | External email/SMS services |\n\n---\n\n## Related Documentation\n- [Custom UI Troubleshooting](18-custom-ui-troubleshooting.md)\n- [Rate Limit Handling](19-rate-limit-handling.md)\n- [Performance Optimization](20-performance-optimization.md)\n- [Complete Custom UI Guide](21-complete-custom-ui-guide.md)"
  }
];

export default SECTIONS;
