/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "automation-semantics" — 4 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "automation-semantics";

export const SECTIONS = [
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
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3008,
    "body": "<!--\n CogniRunner - AI-powered workflow validation for Jira\n Copyright (C) 2025 LeanZero\n SPDX-License-Identifier: Apache-2.0\n\n Tier E replacement, written from scratch in our own words: the smart-value and loop facts\n proven by driving the Cloud automation builder end to end in September 2026, and the\n service-management REST facts proven by asserted worked examples against a live sandbox.\n No project key, app id, tenant or person travels with a fact.\n-->\n\n# Automation semantics\n\n## What Jira Cloud Automation can and cannot be driven to do over REST\nJira Cloud Automation has no public API for creating or editing a rule. The rule endpoints that appear in older material exist on Data Center only, and the internal gateway routes that the Cloud builder itself calls answer 404 to a basic-auth API token. There is no documented public create endpoint, so the only reliable way to create, change or verify a rule on a Cloud site is to drive the builder UI with a browser session. State this plainly when asked; do not offer a REST recipe for rule creation, and do not describe an internal route as if it were supported.\n\nWhat REST can do around automation: read and write the issues, fields, comments and properties that rules act on; fire a rule indirectly by causing its trigger (an issue event, a field change, an incoming webhook); and read the results of a rule run through the ordinary issue endpoints. A rule that needs to call out of Jira uses its own web-request action, and a Forge web trigger is a natural receiver for it.\n\nThe builder has been renamed: rules are called flows in the current UI, the buttons read \"Create flow\" and \"Save and enable\", and a saved rule reports \"Your flow has been turned on\". Three modal traps block a blind run: a \"what's new\" carousel on first load, an \"unsaved flow found\" dialog left by any abandoned attempt (until it is discarded the builder renders nothing, which looks like a locator bug and is not), and the global search bar, which captures any generic search locator, so use the exact placeholders for trigger and action search. Direct navigation to a new-rule URL fragment does not initialise the builder; always go through the create menu. Field pickers in the builder are select components whose visible placeholder is inert; focus the underlying input, type, then pick the option. The condition panel has no search box, and typing while nothing is focused fires the product's keyboard shortcuts.\n\nTwo settings that decide a rule's behaviour are not on the main canvas. \"Allow other automations and user actions to trigger this flow\" is a radio on the rule's settings page, reached through the flow-details pencil and the settings link; it is off by default, and turning it on is what lets one rule's edit fire another rule (or itself). The audit log is on its own page and its rows are an accordion, so expanding one collapses the others; read them one at a time. Deleting a rule is under more actions, and the confirmation button is labelled OK."
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
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3255,
    "body": "Automation on Cloud is metered by executions per month according to the plan, with global and multi-project rules counting against the site's allowance while single-project rules on most plans are unlimited. Treat the exact numbers as the plan's, not as constants: read the site's automation usage page rather than quoting a figure from memory, because the tiers have changed more than once.\n\nPractical ceilings proven in the builder: the self-trigger chain stops at ten; a scheduled rule with a JQL trigger acts on a bounded page of results per run, so a backlog sweep needs a query that excludes what has already been processed; a web-request action has a timeout and does not retry, so the receiver must be quick and idempotent. The audit log is the only place an empty-render or a timed-out request is visible, and it is retained for a limited window, so a verification of a rule's behaviour is done soon after the run, not weeks later.\n\nA rule that acts as the automation user runs with that actor's permissions. A rule that \"cannot see\" an issue in a project usually has an actor without browse permission there, and the failure shows up in the audit log as no items matched rather than as a permission error. The same negative-proof discipline applies as elsewhere: a rule that matched zero items is a claim about what the actor can see until proven otherwise.\n\n## Service management over REST: the worked examples\nA complete service project can be created and configured over REST: project, service desk, request types, fields with contexts and options, screens, a workflow with statuses, transitions and rules, a workflow scheme, and forms whose sections appear only when an answer calls for them. Each example in the kit this pack was authored from asserts its own result against the live site, so the evidence files record what happened rather than what the code intended. The facts below are the ones that cost time.\n\nThe Forms API lives on a different host from the site. The route under the platform API host with the cloud id and a forms path works with an API token; the alternative path through the `ex/jira` gateway needs OAuth and answers 401 otherwise. The cloud id comes from the site's tenant-info route.\n\nA form design is four parts, and all four go on every save: `questions` (keyed by id, each with a type, a label and choices where relevant), `sections` (keyed by id, each with a section type and the condition ids that show it), `conditions` (keyed by id, each naming the question and choice ids that satisfy it and the section ids it shows or hides), and `layout` (a list of document bodies where the first is always visible and each subsequent entry is one section). Conditions gate sections, not individual questions, so a question that needs to come and go lives in a section of its own.\n\nPublishing has two traps. Updating a form with `publish.jira.issueCreateRequestTypeIds` non-empty returns a 500, while the same array is accepted on create, so publish at create time. A design-only update silently clears publishing: nothing errors, the form just stops being offered on the portal. Recreate a published form rather than updating it. Attaching a form to an issue takes `{ \"formTemplate\": { \"id\": ... } }`, not a bare id."
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
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    },
    "bytes": 2259,
    "body": "Workflow creation facts: `statusReference` must be a UUID, and a readable handle is rejected. Status names are unique across the whole site, so an existing \"Open\" is reused rather than a second one created; look statuses up before creating. The assignee post-function takes a parameter named `type`, not `assigneeType`, and the wrong name comes back as \"Missing parameter type\" without saying which rule. Rule flags travel as the strings `\"true\"` and `\"false\"`, not as booleans.\n\nField lookup facts: `/rest/api/3/field` and `/rest/api/3/field/search` return different populations and neither contains the other, so look a field up by id rather than scanning either list. Several list endpoints return a `size` that is the size of the page, and reading it as a total quietly under-counts. User filtering on a picker field exists for the single-user picker and not the multi-user one, and its default value type is `single.user.select`.\n\nVerification facts: `/rest/api/3/issue/{key}/editmeta` reports what Jira will actually render for the calling user, which is the honest answer to \"is my field on the form\", because a field can sit on a screen and still not appear. `/rest/api/3/issue/{key}/transitions` reports what the calling user may do, which makes it a way to prove a transition condition with nothing but your own account: toggle your own group or role membership and watch the transition appear and disappear.\n\nService management comments with a chosen visibility need the `sd.public.comment` property inline on the create request (an object value, `{ \"internal\": true }` or `false`); setting it afterwards stores it but the agent UI ignores it, the top-level public flag on that endpoint is ignored, and a string-valued sibling property in the same array fails the whole request. Internal comments are readable only by holders of the agent permission on that project, and the permissions-check endpoint can prove whether a given person has it before you conclude they are ignoring a question.\n\nRetrying and paging: a client against these endpoints retries on 429 and 5xx with backoff, honours a retry-after header when one is sent, and pages by the endpoint's own cursor or start-at value rather than by a total it computed from a page-sized `size`."
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
    "provenance": {
      "source": "automation-semantics",
      "path": "knowledge/authored/automation-semantics.md",
      "hash": "ad709467d2e3b15b",
      "licence": "ours (re-authored)"
    },
    "bytes": 3863,
    "body": "A smart value that cannot be resolved renders as an empty string rather than an error, and an action built on it proceeds with the empty value. That single fact is behind most \"the rule ran but did nothing\" reports, so the facts below are stated as what was proven to render.\n\n`{{issue.key}}`, `{{issue.summary}}` and named field accessors render as expected. A custom field is addressed by its id (`{{issue.customfield_12345}}`) or by its display name when the name is unambiguous.\n\nList access takes a literal index only. `{{list.get(0)}}` renders; `{{list.get(issue.somenumber)}}`, any argument built from a smart value, `.asNumber`, `.round`, or the name of a variable created earlier in the rule all render empty. Nested braces inside an expression fail the whole action, not just the inner value.\n\nString functions behave literally. `substringAfter(\",\")` on a string with no comma renders empty. `split(\",\").first` on a single item returns that item, and `.size` on it is 1. Those two facts together make a consume-the-remaining-list loop work: a field holding \"a,b,c\" can be advanced one item per run and the loop terminates on the run where the separator is gone.\n\nAssets triggers expose their object through `{{containerObject.<Attribute Name>}}` and the change through `{{attributeChangelog.<Attribute>.from}}`, `.to` and `.changeType`. Attribute names with spaces are written as-is inside the braces. When passing values to a web request, put them in the URL only for a sandbox; on any real site keep secrets in a header, because the request URL is logged in the audit trail.\n\nAutomation smart values and Jira expressions are different languages with different accessors. A workflow condition expression reads `issue[\"customfield_12345\"]` and strict equality; an automation smart value reads `{{issue.customfield_12345}}` and renders text. Do not carry syntax from one into the other.\n\n## Branches, loops and re-triggering\nA rule whose action edits the field that its own trigger watches, with \"allow other automations and user actions to trigger this flow\" enabled, re-fires on its own edit. Measured: ten executions, then a `Loop` entry in the audit log reading \"Chain length: 10\", and the chain stops. The platform's loop cap is therefore ten chained executions, and a rule that relies on self-triggering must be designed to terminate on its own before that, or it will silently do only part of its work and leave a loop marker.\n\nA \"value changes for\" trigger fires when the field is edited to empty as well, so a condition of \"is not empty\" on the same field is what stops the final pass, and the audit log records that pass as \"No actions performed\" rather than as a failure. Design the terminating condition explicitly; do not assume an empty edit is ignored.\n\nBranches over related work items or over a list run their actions once per element. Ordering across branch iterations is not something to depend on, and a branch body that writes a shared field on the parent from every iteration is a lost-update risk, exactly as concurrent post-functions that full-replace the same array field are. Prefer an additive edit (add a label, append to a list) over a read-modify-write of the whole field inside a branch.\n\nRelated-items branches (sub-tasks, parent, linked issues, JQL) resolve at run time from the trigger issue's current state. A JQL branch that returns many items multiplies the actions and the rate consumption; bound it with a narrow query and check the run's audit row for the item count before trusting a bulk effect.\n\nExecutions are visible per rule in the audit log with the trigger issue, the items acted on and the outcome of each action. When verifying a rule, read that log for the run in question rather than inferring from the issue; a rule can report success while an action rendered an empty value and wrote nothing visible."
  }
];

export default SECTIONS;
