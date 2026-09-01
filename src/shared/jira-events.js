/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SINGLE SOURCE OF TRUTH for the Jira product-event catalogue that CogniRunner
 * Listeners can subscribe to.
 *
 * Imported by BOTH bundles:
 *   - the Forge backend (src/listeners.js) — event matching, payload extraction,
 *     prompt blocks for AI code generation / the AI agent runner
 *   - the admin-panel Custom UI — the event picker, per-event hints, REST docs
 *
 * It MUST stay dependency-free (no @forge/*, no react, no node built-ins).
 *
 * The catalogue mirrors the Forge product-events reference for Jira, Jira
 * Software and Jira Service Management (scraped 2026-09-02 from
 * developer.atlassian.com/platform/forge/events-reference/{jira,jira-software,
 * jira-service-management}/). Every identifier here is ALSO listed under a
 * `trigger` module in manifest.yml — keep the two in lockstep (the offline
 * test-harness/scripts/jira-events.test.mjs asserts it).
 */

export const EVENT_CATEGORIES = [
  { id: "issue", label: "Issues", hue: "#2563eb" },
  { id: "comment", label: "Comments", hue: "#7c3aed" },
  { id: "worklog", label: "Worklogs", hue: "#0d9488" },
  { id: "attachment", label: "Attachments", hue: "#d97706" },
  { id: "issuelink", label: "Issue links", hue: "#db2777" },
  { id: "project", label: "Projects", hue: "#16a34a" },
  { id: "version", label: "Versions", hue: "#0891b2" },
  { id: "component", label: "Components", hue: "#4f46e5" },
  { id: "sprint", label: "Sprints", hue: "#ea580c" },
  { id: "board", label: "Boards", hue: "#9333ea" },
  { id: "user", label: "Users", hue: "#be123c" },
  { id: "field", label: "Custom fields", hue: "#475569" },
  { id: "issuetype", label: "Issue types", hue: "#65a30d" },
  { id: "filter", label: "Filters", hue: "#0284c7" },
  { id: "configuration", label: "Configuration", hue: "#78716c" },
  { id: "jsm", label: "Service Management", hue: "#0f766e" },
];

// entity: the payload property carrying the main object ("issue", "comment",
// "worklog", ...). issueBound: the payload carries an issue (key available
// directly). issueIdOnly: the payload names an issue by numeric id only (the
// trigger resolves the key with one REST read). volume: "high" events fire on
// every view/update — the picker warns about invocation cost.
const E = (id, category, label, description, extra = {}) => ({
  id, category, label, description,
  entity: extra.entity || null,
  issueBound: extra.issueBound === true,
  issueIdOnly: extra.issueIdOnly === true,
  projectScoped: extra.projectScoped !== false,
  volume: extra.volume || "normal",
  scopes: extra.scopes || ["read:jira-work"],
  payloadHint: extra.payloadHint || "",
  filters: extra.filters || [],
});

export const JIRA_EVENTS = [
  // ── Issues ──────────────────────────────────────────────────────────────
  E("avi:jira:created:issue", "issue", "Issue created", "An issue was created.", {
    entity: "issue", issueBound: true, filters: ["projects", "issueTypes", "jql"],
    payloadHint: "event.issue {id,key,fields}, event.atlassianId (actor), event.clonedFrom (when cloned)",
  }),
  E("avi:jira:updated:issue", "issue", "Issue updated", "Any field on an issue changed (includes transitions).", {
    entity: "issue", issueBound: true, volume: "high", filters: ["projects", "issueTypes", "jql", "changedFields"],
    payloadHint: "event.issue, event.changelog.items[{field,fieldId,from,fromString,to,toString}], event.associatedStatuses (transition), event.atlassianId",
  }),
  E("avi:jira:deleted:issue", "issue", "Issue deleted", "An issue was permanently deleted.", {
    entity: "issue", issueBound: true, filters: ["projects", "issueTypes"],
    payloadHint: "event.issue (the deleted issue snapshot — it can no longer be fetched), event.atlassianId",
  }),
  E("avi:jira:assigned:issue", "issue", "Issue assigned", "The assignee of an issue changed.", {
    entity: "issue", issueBound: true, filters: ["projects", "issueTypes", "jql"],
    payloadHint: "event.issue, event.changelog (assignee from/to accountIds), event.atlassianId",
  }),
  E("avi:jira:viewed:issue", "issue", "Issue viewed", "A user opened an issue. VERY high volume — every view invokes the app.", {
    entity: "issue", issueBound: true, volume: "high", filters: ["projects", "issueTypes", "jql"],
    payloadHint: "event.issue, event.atlassianId (viewer)",
  }),
  E("avi:jira:mentioned:issue", "issue", "User mentioned in issue", "A user was @mentioned in an issue field (description etc.).", {
    entity: "issue", issueBound: true, filters: ["projects", "issueTypes", "jql"],
    payloadHint: "event.issue, event.mentionedAccountIds[], event.atlassianId",
  }),
  // ── Comments ────────────────────────────────────────────────────────────
  E("avi:jira:commented:issue", "comment", "Comment added", "A comment was added to an issue.", {
    entity: "comment", issueBound: true, filters: ["projects", "issueTypes", "jql", "commentPattern"],
    payloadHint: "event.issue, event.comment {id,author,body(ADF),created}, event.atlassianId",
  }),
  E("avi:jira:mentioned:comment", "comment", "User mentioned in comment", "A user was @mentioned in a comment.", {
    entity: "comment", issueBound: true, filters: ["projects", "issueTypes", "jql", "commentPattern"],
    payloadHint: "event.issue, event.comment, event.mentionedAccountIds[]",
  }),
  E("avi:jira:deleted:comment", "comment", "Comment deleted", "A comment was deleted from an issue.", {
    entity: "comment", issueBound: true, filters: ["projects", "issueTypes", "jql", "commentPattern"],
    payloadHint: "event.issue, event.comment (deleted snapshot)",
  }),
  // ── Worklogs ────────────────────────────────────────────────────────────
  E("avi:jira:created:worklog", "worklog", "Worklog created", "Time was logged on an issue.", {
    entity: "worklog", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.worklog {id,issueId,author,timeSpentSeconds,started,comment}; event.issueKey is resolved by CogniRunner",
  }),
  E("avi:jira:updated:worklog", "worklog", "Worklog updated", "A worklog entry was edited.", {
    entity: "worklog", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.worklog, event.issueKey (resolved)",
  }),
  E("avi:jira:deleted:worklog", "worklog", "Worklog deleted", "A worklog entry was deleted.", {
    entity: "worklog", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.worklog, event.issueKey (resolved)",
  }),
  // ── Attachments ─────────────────────────────────────────────────────────
  E("avi:jira:created:attachment", "attachment", "Attachment added", "A file was attached to an issue.", {
    entity: "attachment", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.attachment {id,filename,mimeType,size,author}, event.issueKey (resolved when the payload names the issue)",
  }),
  E("avi:jira:deleted:attachment", "attachment", "Attachment deleted", "An attachment was removed from an issue.", {
    entity: "attachment", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.attachment, event.issueKey (resolved when available)",
  }),
  // ── Issue links ─────────────────────────────────────────────────────────
  E("avi:jira:created:issuelink", "issuelink", "Issue link created", "Two issues were linked.", {
    entity: "issueLink", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.sourceIssueId, event.destinationIssueId, event.issueLinkType {id,name,inward,outward}; event.issueKey = source issue (resolved)",
  }),
  E("avi:jira:deleted:issuelink", "issuelink", "Issue link deleted", "A link between two issues was removed.", {
    entity: "issueLink", issueIdOnly: true, filters: ["projects", "jql"],
    payloadHint: "event.sourceIssueId, event.destinationIssueId, event.issueLinkType; event.issueKey = source issue (resolved)",
  }),
  // ── Projects ────────────────────────────────────────────────────────────
  E("avi:jira:created:project", "project", "Project created", "A project was created.", { entity: "project", filters: ["projects"], payloadHint: "event.project {id,key,name,projectTypeKey}" }),
  E("avi:jira:updated:project", "project", "Project updated", "Project details changed.", { entity: "project", filters: ["projects"], payloadHint: "event.project" }),
  E("avi:jira:softdeleted:project", "project", "Project moved to trash", "A project was soft-deleted (trashed).", { entity: "project", filters: ["projects"], payloadHint: "event.project" }),
  E("avi:jira:restored:project", "project", "Project restored from trash", "A trashed project was restored.", { entity: "project", filters: ["projects"], payloadHint: "event.project" }),
  E("avi:jira:deleted:project", "project", "Project permanently deleted", "A project was permanently deleted.", { entity: "project", filters: ["projects"], payloadHint: "event.project" }),
  E("avi:jira:archived:project", "project", "Project archived", "A project was archived.", { entity: "project", filters: ["projects"], payloadHint: "event.project" }),
  E("avi:jira:unarchived:project", "project", "Project unarchived", "An archived project was restored.", { entity: "project", filters: ["projects"], payloadHint: "event.project" }),
  // ── Versions ────────────────────────────────────────────────────────────
  E("avi:jira:created:version", "version", "Version created", "A project version was created.", { entity: "version", filters: ["projects"], payloadHint: "event.version {id,name,projectId,released,archived,releaseDate}" }),
  E("avi:jira:updated:version", "version", "Version updated", "A version's details changed.", { entity: "version", filters: ["projects"], payloadHint: "event.version" }),
  E("avi:jira:released:version", "version", "Version released", "A version was released.", { entity: "version", filters: ["projects"], payloadHint: "event.version" }),
  E("avi:jira:unreleased:version", "version", "Version unreleased", "A released version was reopened.", { entity: "version", filters: ["projects"], payloadHint: "event.version" }),
  E("avi:jira:archived:version", "version", "Version archived", "A version was archived.", { entity: "version", filters: ["projects"], payloadHint: "event.version" }),
  E("avi:jira:unarchived:version", "version", "Version unarchived", "An archived version was restored.", { entity: "version", filters: ["projects"], payloadHint: "event.version" }),
  E("avi:jira:moved:version", "version", "Version reordered", "A version was moved in the project's version order.", { entity: "version", filters: ["projects"], payloadHint: "event.version" }),
  E("avi:jira:merged:version", "version", "Version merged", "A version was merged into another.", { entity: "version", filters: ["projects"], payloadHint: "event.version, event.mergedVersion" }),
  E("avi:jira:deleted:version", "version", "Version deleted", "A version was deleted (with optional replacements).", { entity: "version", filters: ["projects"], payloadHint: "event.version, event.mergedVersion, event.newFixVersion, event.newAffectsVersion, event.customFieldReplacements" }),
  // ── Components ──────────────────────────────────────────────────────────
  E("avi:jira:created:component", "component", "Component created", "A project component was created.", { entity: "component", filters: ["projects"], payloadHint: "event.component {id,name,project,projectId}" }),
  E("avi:jira:updated:component", "component", "Component updated", "A component's details changed.", { entity: "component", filters: ["projects"], payloadHint: "event.component" }),
  E("avi:jira:deleted:component", "component", "Component deleted", "A component was deleted.", { entity: "component", filters: ["projects"], payloadHint: "event.component" }),
  // ── Sprints (Jira Software) ─────────────────────────────────────────────
  E("avi:jira-software:created:sprint", "sprint", "Sprint created", "A sprint was created on a board.", { entity: "sprint", projectScoped: false, payloadHint: "event.sprint {id,name,state,goal,startDate,endDate,originBoardId}" }),
  E("avi:jira-software:started:sprint", "sprint", "Sprint started", "A sprint was started.", { entity: "sprint", projectScoped: false, payloadHint: "event.sprint" }),
  E("avi:jira-software:updated:sprint", "sprint", "Sprint updated", "Sprint name, goal or dates changed.", { entity: "sprint", projectScoped: false, payloadHint: "event.sprint, event.oldValue" }),
  E("avi:jira-software:closed:sprint", "sprint", "Sprint completed", "A sprint was completed.", { entity: "sprint", projectScoped: false, payloadHint: "event.sprint" }),
  E("avi:jira-software:deleted:sprint", "sprint", "Sprint deleted", "A sprint was deleted.", { entity: "sprint", projectScoped: false, payloadHint: "event.sprint" }),
  // ── Boards (Jira Software) ──────────────────────────────────────────────
  E("avi:jira-software:created:board", "board", "Board created", "A board was created.", { entity: "board", projectScoped: false, scopes: ["read:jira-work", "read:jira-user"], payloadHint: "event.board {id,name,type}" }),
  E("avi:jira-software:updated:board", "board", "Board updated", "A board was renamed or its filter changed.", { entity: "board", projectScoped: false, scopes: ["read:jira-work", "read:jira-user"], payloadHint: "event.board" }),
  E("avi:jira-software:deleted:board", "board", "Board deleted", "A board was deleted.", { entity: "board", projectScoped: false, scopes: ["read:jira-work", "read:jira-user"], payloadHint: "event.board" }),
  E("avi:jira-software:configuration-changed:board", "board", "Board configuration changed", "Columns, estimation, ranking or other board settings changed.", { entity: "configuration", projectScoped: false, scopes: ["read:jira-work", "read:jira-user"], payloadHint: "event.configuration {id,name,columnConfig,estimation,ranking}" }),
  // ── Users ───────────────────────────────────────────────────────────────
  E("avi:jira:created:user", "user", "User created", "A user was added to the site.", { entity: "user", projectScoped: false, scopes: ["read:jira-user"], payloadHint: "event.user {accountId,displayName,active}" }),
  E("avi:jira:updated:user", "user", "User updated", "A user's profile changed.", { entity: "user", projectScoped: false, scopes: ["read:jira-user"], payloadHint: "event.user" }),
  E("avi:jira:deleted:user", "user", "User deleted", "A user was deleted.", { entity: "user", projectScoped: false, scopes: ["read:jira-user"], payloadHint: "event.user" }),
  // ── Custom fields ───────────────────────────────────────────────────────
  E("avi:jira:created:field", "field", "Custom field created", "A custom field was created.", { entity: "field", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.field {id,key,type,name,description}" }),
  E("avi:jira:updated:field", "field", "Custom field updated", "A custom field's name/description changed.", { entity: "field", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.field" }),
  E("avi:jira:trashed:field", "field", "Custom field trashed", "A custom field was moved to trash.", { entity: "field", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.field" }),
  E("avi:jira:restored:field", "field", "Custom field restored", "A trashed custom field was restored.", { entity: "field", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.field" }),
  E("avi:jira:deleted:field", "field", "Custom field deleted", "A custom field was permanently deleted.", { entity: "field", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.field" }),
  E("avi:jira:created:field:context", "field", "Field context created", "A custom field context was created.", { entity: "fieldContext", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.fieldId, event.projectIds[], event.issueTypeIds[]" }),
  E("avi:jira:updated:field:context", "field", "Field context updated", "A custom field context changed.", { entity: "fieldContext", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.fieldId, event.projectIds[], event.issueTypeIds[]" }),
  E("avi:jira:deleted:field:context", "field", "Field context deleted", "A custom field context was deleted.", { entity: "fieldContext", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.fieldId, event.projectIds[], event.issueTypeIds[]" }),
  E("avi:jira:updated:field:context:configuration", "field", "Field context configuration updated", "A field context's configuration (options/defaults) changed.", { entity: "fieldContextConfiguration", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.customFieldId, event.configurationId, event.fieldContextId, event.configuration (JSON string)" }),
  // ── Issue types ─────────────────────────────────────────────────────────
  E("avi:jira:created:issuetype", "issuetype", "Issue type created", "An issue type was created.", { entity: "issueType", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.issueType {id,name,description,subtask}" }),
  E("avi:jira:updated:issuetype", "issuetype", "Issue type updated", "An issue type changed.", { entity: "issueType", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.issueType" }),
  E("avi:jira:deleted:issuetype", "issuetype", "Issue type deleted", "An issue type was deleted.", { entity: "issueType", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.issueType" }),
  // ── Filters ─────────────────────────────────────────────────────────────
  E("avi:jira:created:filter", "filter", "Filter created", "A saved filter was created.", { entity: "filter", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.filter {id,name,jql,owner}" }),
  E("avi:jira:updated:filter", "filter", "Filter updated", "A saved filter changed.", { entity: "filter", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.filter" }),
  E("avi:jira:deleted:filter", "filter", "Filter deleted", "A saved filter was deleted.", { entity: "filter", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.filter" }),
  // ── Configuration ───────────────────────────────────────────────────────
  E("avi:jira:changed:configuration", "configuration", "Global configuration changed", "A global setting (sub-tasks, unassigned issues, voting, watching, issue linking) was toggled.", { entity: "property", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.property {key,value}" }),
  E("avi:jira:timetracking:provider:changed", "configuration", "Time tracking provider changed", "The selected time-tracking provider changed.", { entity: "property", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.property {key:'jira.timetracking.selected', value}" }),
  E("avi:jira:failed:expression", "configuration", "Workflow expression failed", "A Jira expression in a workflow condition/validator failed to evaluate.", { entity: "expression", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.extensionId, event.workflowId, event.conditionId, event.validatorId, event.expression, event.errorMessages[]" }),
  // ── Jira Service Management ─────────────────────────────────────────────
  E("avi:jsm-entity:created:request-type", "jsm", "Request type created", "A JSM request type was created.", { entity: "entity", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.entityId, event.entityType ('request-type'), event.activationId" }),
  E("avi:jsm-entity:updated:request-type", "jsm", "Request type updated", "A JSM request type changed.", { entity: "entity", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.entityId, event.entityType, event.activationId" }),
  E("avi:jsm-entity:deleted:request-type", "jsm", "Request type deleted", "A JSM request type was deleted.", { entity: "entity", projectScoped: false, scopes: ["manage:jira-configuration"], payloadHint: "event.entityId, event.entityType, event.activationId" }),
];

export const EVENT_IDS = JIRA_EVENTS.map((e) => e.id);
const BY_ID = new Map(JIRA_EVENTS.map((e) => [e.id, e]));
export const getEvent = (id) => BY_ID.get(id) || null;
export const isKnownEvent = (id) => BY_ID.has(id);

export const eventsByCategory = () =>
  EVENT_CATEGORIES.map((c) => ({ ...c, events: JIRA_EVENTS.filter((e) => e.category === c.id) }));

// Short human label for an event id: "Issue created", falling back to the id.
export const eventLabel = (id) => (BY_ID.get(id) || {}).label || id;

// Filters a listener can carry (the editor shows only the ones relevant to the
// selected events; the matcher ignores irrelevant ones).
export const LISTENER_FILTERS = {
  projects: "Only in these projects",
  issueTypes: "Only these issue types",
  jql: "Only when the issue matches this JQL",
  changedFields: "Only when one of these fields changed",
  commentPattern: "Only when the comment matches this regex",
};

// Union of the filters relevant to a set of events.
export const filtersForEvents = (ids) => {
  const out = new Set();
  for (const id of ids || []) for (const f of (BY_ID.get(id) || {}).filters || []) out.add(f);
  return [...out];
};

// ── Payload helpers (dependency-free; used by the trigger AND the UI) ──────

// Minimal ADF → plain text (comment bodies arrive as ADF documents).
export const adfToPlainText = (node) => {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join("");
  if (typeof node !== "object") return String(node);
  if (typeof node.text === "string") return node.text;
  if (node.type === "mention" && node.attrs) return node.attrs.text || `@${node.attrs.id || ""}`;
  if (node.type === "hardBreak") return "\n";
  const inner = Array.isArray(node.content) ? node.content.map(adfToPlainText).join("") : "";
  const blocky = ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow", "panel"];
  return blocky.includes(node.type) ? inner + "\n" : inner;
};

const num = (v) => (v == null || v === "" ? null : String(v));

/**
 * Pull the identity facts out of a raw Forge event payload. Every field is
 * best-effort (null when the event doesn't carry it):
 *   issueKey / issueId / projectKey / projectId / issueTypeId / issueTypeName /
 *   actorAccountId / entityName (a one-line description for logs).
 */
export const extractEventContext = (eventType, payload) => {
  const p = payload || {};
  const meta = BY_ID.get(eventType) || {};
  const issue = p.issue || null;
  const fields = (issue && issue.fields) || {};
  const project = fields.project || p.project || null;
  const out = {
    eventType,
    issueKey: issue ? issue.key || null : null,
    issueId: issue ? num(issue.id) : null,
    projectKey: project ? project.key || null : null,
    projectId: project ? num(project.id) : null,
    issueTypeId: fields.issuetype ? num(fields.issuetype.id) : null,
    issueTypeName: fields.issuetype ? fields.issuetype.name || null : null,
    actorAccountId: p.atlassianId || (p.user && p.user.accountId) || null,
    selfGenerated: p.selfGenerated === true,
    entityName: null,
  };
  // Key prefix is a reliable project-key fallback when fields.project is absent.
  if (!out.projectKey && out.issueKey && /^[A-Z][A-Z0-9_]*-\d+$/i.test(out.issueKey)) {
    out.projectKey = out.issueKey.split("-")[0];
  }
  switch (meta.entity) {
    case "issue": out.entityName = out.issueKey; break;
    case "comment": out.entityName = out.issueKey ? `${out.issueKey} comment ${p.comment ? p.comment.id || "" : ""}`.trim() : "comment"; break;
    case "worklog": {
      const w = p.worklog || {};
      out.issueId = out.issueId || num(w.issueId);
      out.entityName = `worklog ${w.id || ""}`.trim();
      break;
    }
    case "attachment": {
      const a = p.attachment || {};
      out.issueId = out.issueId || num(a.issueId) || null;
      out.entityName = a.filename ? `attachment ${a.filename}` : "attachment";
      break;
    }
    case "issueLink": {
      const l = p.issueLink || p;
      out.issueId = out.issueId || num(l.sourceIssueId);
      out.projectId = out.projectId || num(l.sourceProjectId);
      out.entityName = `link ${l.sourceIssueId || "?"} → ${l.destinationIssueId || "?"}`;
      break;
    }
    case "project": {
      const pr = p.project || {};
      out.projectKey = out.projectKey || pr.key || null;
      out.projectId = out.projectId || num(pr.id);
      out.entityName = pr.key ? `project ${pr.key}` : "project";
      break;
    }
    case "version": {
      const v = p.version || {};
      out.projectId = out.projectId || num(v.projectId);
      out.entityName = v.name ? `version ${v.name}` : "version";
      break;
    }
    case "component": {
      const c = p.component || {};
      out.projectKey = out.projectKey || (typeof c.project === "string" ? c.project : (c.project && c.project.key) || null);
      out.projectId = out.projectId || num(c.projectId) || num(c.project && c.project.id);
      out.entityName = c.name ? `component ${c.name}` : "component";
      break;
    }
    case "sprint": out.entityName = p.sprint && p.sprint.name ? `sprint ${p.sprint.name}` : "sprint"; break;
    case "board": out.entityName = p.board && p.board.name ? `board ${p.board.name}` : "board"; break;
    case "configuration": out.entityName = "board configuration"; break;
    case "user": out.entityName = p.user && (p.user.displayName || p.user.accountId) ? `user ${p.user.displayName || p.user.accountId}` : "user"; break;
    case "field": { const f = p.field || p; out.entityName = f.name ? `field ${f.name}` : "field"; break; }
    case "fieldContext": out.entityName = `field context ${p.fieldId || ""}`.trim(); break;
    case "fieldContextConfiguration": out.entityName = `field ${p.customFieldId || ""} configuration`.trim(); break;
    case "issueType": { const t = p.issueType || p; out.entityName = t.name ? `issue type ${t.name}` : "issue type"; break; }
    case "filter": { const f = p.filter || p; out.entityName = f.name ? `filter ${f.name}` : "filter"; break; }
    case "property": out.entityName = p.property && p.property.key ? `property ${p.property.key}` : "property"; break;
    case "expression": out.entityName = "workflow expression"; break;
    case "entity": out.entityName = `${p.entityType || "entity"} ${p.entityId || ""}`.trim(); break;
    default: out.entityName = meta.label || eventType;
  }
  return out;
};

// Names/ids of the fields that changed in an updated-issue event.
export const changedFieldsOf = (payload) => {
  const items = (payload && payload.changelog && Array.isArray(payload.changelog.items)) ? payload.changelog.items : [];
  const out = [];
  for (const it of items) {
    if (it && it.field) out.push(String(it.field));
    if (it && it.fieldId) out.push(String(it.fieldId));
  }
  return out;
};

// Plain text of the comment carried by a comment event ("" when none).
export const commentTextOf = (payload) => {
  const c = payload && payload.comment;
  if (!c) return "";
  return adfToPlainText(c.body != null ? c.body : c.renderedBody || "").trim();
};

/**
 * Trim a raw event payload for storage / queue transport: keeps identity +
 * changelog + comment + entity objects, drops bulky issue fields beyond a
 * bounded byte budget. Never throws.
 */
export const trimEventPayload = (payload, maxBytes = 60000) => {
  try {
    const json = JSON.stringify(payload);
    if (json.length <= maxBytes) return payload;
    const slim = { ...payload };
    if (slim.issue && slim.issue.fields) {
      const f = slim.issue.fields;
      const keep = ["summary", "issuetype", "project", "status", "priority", "assignee", "reporter", "creator", "labels", "created", "updated", "resolution", "parent"];
      const fields = {};
      for (const k of keep) if (f[k] !== undefined) fields[k] = f[k];
      slim.issue = { ...slim.issue, fields, _trimmed: true };
    }
    const json2 = JSON.stringify(slim);
    if (json2.length <= maxBytes) return slim;
    return { eventType: payload.eventType, _trimmed: true, _note: `payload of ${json.length} bytes exceeded the ${maxBytes}-byte transport budget` , issue: slim.issue ? { id: slim.issue.id, key: slim.issue.key } : undefined };
  } catch {
    return { _trimmed: true };
  }
};

// Markdown block describing `api.context.event` for the AI code generator.
export const buildEventPromptBlock = (ids) => {
  const rows = (ids || []).map((id) => BY_ID.get(id)).filter(Boolean);
  if (!rows.length) return "";
  return rows.map((e) => `- \`${e.id}\` (${e.label}): ${e.payloadHint || "event payload as delivered by Jira"}`).join("\n");
};
