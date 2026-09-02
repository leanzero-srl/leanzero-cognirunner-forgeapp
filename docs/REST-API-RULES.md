<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# Attaching CogniRunner rules over the REST API

The admin panel is not the only way to create a rule. Because CogniRunner rules are
ordinary Forge workflow rules, you can attach them with Jira's own workflow REST
API — using **your** Jira credentials, not an API of ours. That is how you bulk-provision
rules across many projects, migrate them between sites, or keep them in version control.

This page documents the exact shapes. Every payload here was executed against a live
Jira Cloud instance.

> **Read [Making a REST-attached rule manageable](#5-make-the-rule-manageable) before you
> use this in anger.** A rule attached this way *runs* immediately but is invisible to the
> admin panel until you claim it — and until then you cannot disable it from the UI.

---

## Contents

1. [What you're actually calling](#1-what-youre-actually-calling)
2. [Find your app's extension ARI](#2-find-your-apps-extension-ari)
3. [The rule object](#3-the-rule-object)
4. [Attach it to a transition](#4-attach-it-to-a-transition)
5. [Make the rule manageable](#5-make-the-rule-manageable)
6. [Config reference, per rule type](#6-config-reference-per-rule-type)
7. [Limits and failure modes](#7-limits-and-failure-modes)
8. [Worked example](#8-worked-example)

---

## 1. What you're actually calling

There is no CogniRunner REST API. You are calling **Jira's** workflow API and placing a
rule that names CogniRunner's Forge module:

| Step | Endpoint |
|---|---|
| Read the workflow | `GET /rest/api/3/workflows/search?queryString={name}&expand=values.transitions` |
| Write it back | `POST /rest/api/3/workflows/update` |
| Discover the module ARI | `GET /rest/api/3/workflows/capabilities?projectId={id}&issueTypeId={id}` |

Authenticate as a Jira admin (Basic auth with an API token, or OAuth 2.0 3LO). The
account needs permission to administer the workflow.

`/workflows/update` is **read-modify-write on the whole workflow**. You fetch every
transition, change the one you care about, and post all of them back with the version
you read. There is no per-rule endpoint.

---

## 2. Find your app's extension ARI

Every rule must name the module it belongs to, as an ARI:

```
ari:cloud:ecosystem::extension/{appId}/{environmentId}/static/{moduleKey}
```

`appId` is fixed for CogniRunner: `36415848-6868-4697-9554-3c3ad87b8da9`.
`environmentId` is **specific to your installation** — production and development
installs have different ones. Do not hardcode it from an example.

Ask Jira for it:

```bash
curl -s -u "$EMAIL:$TOKEN" \
  "$SITE/rest/api/3/workflows/capabilities?projectId=10014&issueTypeId=10013" \
  | jq '.forgeRules[] | select(.name | startswith("CogniRunner"))'
```

```json
{
  "ruleKey": "forge:expression-validator",
  "ruleType": "Validator",
  "name": "CogniRunner Field Validator",
  "description": "Validates a text field value against a custom AI prompt on workflow transition.",
  "id": "ari:cloud:ecosystem::extension/36415848-.../989ecaa0-.../static/ai-text-field-validator"
}
```

The `id` is the ARI to copy, and `ruleKey` is the one to use — both come straight from
the response, so you never have to guess either.

> If this returns **two** entries per rule type, you have two installs of CogniRunner on
> the site (e.g. production *and* development). Pick the ARI of the one you actually use;
> they have separate app storage and will not see each other's rules.

### Module keys

| Rule type | `ruleKey` | `moduleKey` |
|---|---|---|
| Validator | `forge:expression-validator` | `ai-text-field-validator` |
| Condition | `forge:expression-condition` | `ai-text-field-condition` |
| Semantic post-function *(and doc/research/comment/subtask/link flavours)* | `forge:workflow-post-function` | `ai-semantic-post-function` |
| Static post-function | `forge:workflow-post-function` | `ai-static-post-function` |

All post-function flavours share one `ruleKey`; the flavour is decided by `config.type`,
not by the module. Using the semantic module's ARI for any non-static flavour is correct.

---

## 3. The rule object

```json
{
  "ruleKey": "forge:expression-validator",
  "parameters": {
    "key": "ari:cloud:ecosystem::extension/{appId}/{envId}/static/ai-text-field-validator",
    "config": "{\"id\":\"my-rule-1\",\"type\":\"validator\",\"fieldId\":\"summary\",\"prompt\":\"…\"}",
    "id": "0f4b2c1e-8a3d-4e2b-9c11-7d5a6f0b2e34",
    "disabled": "false"
  },
  "id": "0f4b2c1e-8a3d-4e2b-9c11-7d5a6f0b2e34"
}
```

Four things worth knowing:

- **`parameters.config` is a JSON *string*, not an object.** Stringify it.
- **`parameters.id` and the top-level `id`** are the workflow rule's instance id. Mint a
  UUID and use the same value for both. This is what identifies the rule inside the
  transition.
- **`disabled` is the string `"false"`**, not a boolean. This is Jira's own flag and is
  separate from CogniRunner's — see §5.
- **Put an `id` inside `config`.** It is optional to Jira and essential to you: it is the
  identity CogniRunner's runtime uses to find the rule's registry row. A rule with no
  embedded `id` can be claimed into the admin table but **can never be disabled from
  there** — the only way to stop it is to remove it from the workflow.

Use a stable, meaningful `config.id` (e.g. `acme-dod-check-v1`), not a random UUID, so
re-running your provisioning script updates the same rule rather than creating a second.

---

## 4. Attach it to a transition

Rules live in three different places on a transition, depending on type:

```js
transition.validators.push(rule);   // validator
transition.actions.push(rule);      // any post-function
// condition: a recursive group tree, NOT a flat array
transition.conditions = {
  operation: "ALL",                 // REQUIRED by the update DTO
  conditions: [rule],
  conditionGroups: [],
};
```

If a transition already has a conditions tree, push into its `conditions` array and leave
`operation` alone. If it has a legacy flat array, wrap it — don't discard it.

### The update payload

```json
{
  "statuses": [ { "id": "10003", "name": "Backlog", "statusCategory": "TODO", "statusReference": "10003" } ],
  "workflows": [ {
    "id": "<workflow id>",
    "version": { "id": "<version id>", "versionNumber": 3 },
    "statuses": [ { "statusReference": "10003" } ],
    "transitions": [ /* ALL transitions, including the one you modified */ ]
  } ]
}
```

**The subtle part.** The top-level `statuses` needs full objects *with names*. In the
search response, `workflow.statuses` is reference-only (no `name`, no `statusCategory`)
while the complete objects sit at the **top level** of the response. Build the payload's
top-level `statuses` from `response.statuses`, and the per-workflow `statuses` from just
the references. Getting this backwards produces a validation error about a missing status
name.

Send **every** transition back, not just the changed one. Omitted transitions are deleted.

---

## 5. Make the rule manageable

This is the step people miss, and it is why the admin panel has a "rules not in registry"
section at all.

CogniRunner keeps a **registry** — a record of every rule it manages, used for the admin
table, execution-log filtering and the Disable switch. Attaching a rule over REST writes
it into the *workflow* but not into that registry. The consequence:

> A REST-attached rule **runs on every matching transition**, but does not appear under
> Configured Rules, cannot be disabled from the panel, and does not show execution history
> there.

To fix that, after attaching:

1. Open **Apps → CogniRunner → Rules**.
2. Click **Scan workflows**. It sweeps every workflow on the site and lists what is
   attached but unregistered.
3. Click **Register all**.

Claimed rules are recorded as **unowned** — claiming is not authoring, so they will not
appear in anyone's "My Rules".

Two things to know before you rely on it:

- **A rule with no `config.id` can be claimed but still not disabled.** The panel flags
  these with a "can't disable" chip. Always embed an id (§3).
- **The registry is capped** (§7). If you attach more rules than it can hold, Register all
  will claim what fits and tell you how many it skipped.

There is no way to register a rule without the admin panel — the registry is app storage,
reachable only through the app's own UI.

---

## 6. Config reference, per rule type

All examples omit the `workflow` block for brevity; include it in every rule:

```json
"workflow": { "workflowName": "Software Simplified Workflow for Project ACME", "transitionId": "31" }
```

It is what lets the panel show which transition a rule belongs to, and what the runtime
falls back to when matching a rule with no embedded id.

### AI validator

```json
{
  "id": "acme-english-summary",
  "type": "validator",
  "fieldId": "summary",
  "prompt": "FAIL if the summary is NOT written primarily in English. PASS English summaries.",
  "enableTools": false
}
```

`enableTools: true` lets the validator search Jira with JQL before deciding (duplicate
detection and similar). It costs more per transition.

### Premade validator — deterministic, no AI, no cost

```json
{
  "id": "acme-ticket-ref",
  "type": "validator",
  "ruleKind": "premade",
  "ruleType": "field-regex",
  "premadeRuleType": "field-regex",
  "fieldId": "summary",
  "fieldName": "Summary",
  "fieldType": "string",
  "regex": "^\\[[A-Z]+-\\d+\\]",
  "errorMessage": "Summary must start with a ticket reference."
}
```

`ruleKind: "premade"` and `ruleType` are what route it away from the AI path. See
`src/shared/premade-rules-catalog.js` for every available `ruleType` and its parameters.

### Condition — deterministic only

```json
{
  "id": "acme-only-highest",
  "type": "condition",
  "conditionKind": "deterministic",
  "ruleType": "priority-is",
  "priorityName": "Highest"
}
```

**`conditionKind: "deterministic"` is mandatory.** Without it the condition allows every
transition. That is deliberate: Jira evaluates conditions as a Jira expression, and
anything the expression does not recognise must fail *open*, because an unresolvable
condition would block the transition for everyone.

**Conditions cannot use AI.** A Jira expression has no network access, so a prompt on a
condition does nothing. Supported `ruleType` values are exactly:

`issue-type-is` · `issue-is-resolved` · `resolution-is` · `priority-is` ·
`parent-status-is` · `current-user-is-assignee` · `current-user-is-reporter` ·
`field-has-value` · `field-empty` · `field-equals`

Any other value allows the transition.

### Field conditions — custom fields only, and the config carries the strategy

The three field types work on **custom fields of verified kinds only**, and their configs
must carry two extra keys the admin UI normally resolves for you: `exprProp` (the
`customfield_NNNNN` id — the expression indexes the issue with this, and anything that
isn't a `customfield_` id makes the condition allow everything) and `exprKind` (which
comparison strategy the expression runs). Number equals also needs `valueNum` as a JSON
**number**, not a string.

```json
{
  "id": "acme-severity-set",
  "type": "condition",
  "conditionKind": "deterministic",
  "ruleType": "field-has-value",
  "fieldId": "customfield_10050",
  "fieldName": "Severity",
  "exprProp": "customfield_10050",
  "exprKind": "nul"
}
```

| Custom field kind | has-value / empty (`exprKind`) | equals (`exprKind`) |
|---|---|---|
| text (single line), URL, date | `nul` | `str` (case-insensitive; date as `YYYY-MM-DD`) |
| number | `nul` | `num` (+ `valueNum` as a JSON number) |
| select, radio buttons | `nul` | `opt` (compares the option's value, case-insensitive) |
| paragraph, datetime, user, group, cascading, version, project | `nul` | — |
| labels, multi-select, checkboxes, multi-user, multi-group, multi-version | `arr` | — |

> ⚠️ **`exprKind` must match the field's real kind per this table.** Jira expressions are
> strictly typed: a mismatched kind (say `str` on a number field) is an evaluation error,
> and an erroring condition **hides the transition** — the one way a hand-crafted config
> can fail closed. The admin UI can never produce this; copy its configs (§5's claim flow,
> then Export) rather than hand-writing `exprKind` if in doubt.

Two behaviors to design around: a field hidden by a field configuration (or deleted, or
whose context doesn't cover the project) reads as **empty**; and an **empty field never
hides an equals check** — combine with `field-has-value` when it should. Use a validator
when you want a block with a message instead of a hidden button.

### Semantic post-function

```json
{
  "id": "acme-release-notes",
  "type": "postfunction-semantic",
  "fieldId": "description",
  "actionFieldId": "customfield_10050",
  "conditionPrompt": "Does the description describe a user-facing change?",
  "actionPrompt": "Write a one-sentence release note in the past tense."
}
```

Other flavours use the same module with a different `type`:
`postfunction-generate-doc`, `postfunction-research`, `postfunction-research-doc`,
`postfunction-comment`, `postfunction-subtask`, `postfunction-link`.

### Static post-function — sandboxed JavaScript, no AI at runtime

```json
{
  "id": "acme-label-stamp",
  "type": "postfunction-static",
  "functions": [
    { "id": "s1", "name": "Stamp label", "operationType": "custom",
      "variableName": "res", "code": "await api.addLabels(['reviewed']);" }
  ]
}
```

The `api.*` surface available to `code` is documented in
`src/shared/sandbox-api-spec.js` — that file is the single source of truth for it.

---

## 7. Limits and failure modes

| Limit | Value | What happens |
|---|---|---|
| Rule config size | **32,768 bytes** | Jira rejects the update. Move static-PF code into fewer/shorter steps. |
| Registry rows | **500** | Register all claims what fits and reports the rest as skipped. |
| Registry size | **240 KB total**, new rules refused above **200 KB** | Same. Delete rules to reclaim space; the Rules tab shows a meter. |

**Version conflicts.** `/workflows/update` fails if the workflow changed since your read
(HTTP 409, or a 400 whose body mentions the version). Re-read the workflow and rebuild
your change — do not retry the same payload, its version is stale. Retry 2–3 times with a
short backoff.

**Drafts.** `/workflows/search` returns **published** workflows only. A rule that exists
solely in an unpublished draft is invisible to this API and to Scan workflows.

**Deleting a rule.** Remove it from the transition's slot and post the workflow back. If
the rule is also in the registry, delete it from the admin panel instead — the panel's
Delete removes it from *both*, whereas a REST-only removal leaves an orphaned registry row
until the panel's next sweep.

---

## 8. Worked example

Attach a deterministic validator to transition `31` and verify it blocks. Node 18+, no
dependencies.

```js
import crypto from "node:crypto";

const SITE = process.env.JIRA_BASE_URL;               // https://your-site.atlassian.net
const AUTH = "Basic " + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_TOKEN}`).toString("base64");
const WORKFLOW = "Software Simplified Workflow for Project ACME";
const TRANSITION_ID = "31";
const APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";

const api = async (path, init = {}) => {
  const r = await fetch(SITE + path, {
    ...init,
    headers: { Authorization: AUTH, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
  });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

// 1. Discover the extension ARI for THIS install (never hardcode the environment id).
const caps = await api("/rest/api/3/workflows/capabilities?projectId=10014&issueTypeId=10013");
const validator = caps.forgeRules.find((r) => r.name === "CogniRunner Field Validator" && r.id.includes(APP_ID));
if (!validator) throw new Error("CogniRunner is not installed on this site");

// 2. Read the workflow.
const search = await api(`/rest/api/3/workflows/search?queryString=${encodeURIComponent(WORKFLOW)}&expand=values.transitions`);
const wf = search.values.find((w) => w.name === WORKFLOW);
const transition = wf.transitions.find((t) => String(t.id) === TRANSITION_ID);
if (!transition) throw new Error(`transition ${TRANSITION_ID} not found`);

// 3. Build the rule. A stable config.id makes this script idempotent AND makes the
//    rule disable-able from the admin panel once claimed.
const instanceId = crypto.randomUUID();
const config = {
  id: "acme-ticket-ref",
  type: "validator",
  ruleKind: "premade",
  ruleType: "field-regex",
  premadeRuleType: "field-regex",
  fieldId: "summary",
  fieldName: "Summary",
  fieldType: "string",
  regex: "^\\\\[[A-Z]+-\\\\d+\\\\]",
  errorMessage: "Summary must start with a ticket reference, e.g. [ACME-12].",
  workflow: { workflowName: WORKFLOW, transitionId: TRANSITION_ID },
};

// Replace our own previous version rather than stacking duplicates.
transition.validators = (transition.validators || []).filter((r) => {
  try { return JSON.parse(r.parameters?.config || "{}").id !== config.id; } catch { return true; }
});
transition.validators.push({
  ruleKey: validator.ruleKey,
  parameters: { key: validator.id, config: JSON.stringify(config), id: instanceId, disabled: "false" },
  id: instanceId,
});

// 4. Post the WHOLE workflow back. Top-level statuses need names; per-workflow
//    statuses need only references.
await api("/rest/api/3/workflows/update", {
  method: "POST",
  body: JSON.stringify({
    statuses: search.statuses.map((s) => ({ id: s.id, name: s.name, statusCategory: s.statusCategory, statusReference: s.statusReference })),
    workflows: [{
      id: wf.id,
      version: { id: wf.version.id, versionNumber: wf.version.versionNumber },
      statuses: search.statuses.map((s) => ({ statusReference: s.statusReference })),
      transitions: wf.transitions,
    }],
  }),
});

console.log(`Attached. Now open Apps → CogniRunner → Rules → Scan workflows → Register all
so the rule appears in the admin table and can be disabled from there.`);
```

Verify it took effect by attempting the transition on an issue whose summary does not
match — Jira should reject it with your `errorMessage`:

```bash
curl -si -u "$EMAIL:$TOKEN" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"transition":{"id":"31"}}' \
  "$SITE/rest/api/3/issue/ACME-1/transitions"
```

---

## See also

- `docs/FEATURES.md` — what each rule type does and when to use it
- `docs/PERMISSIONS.md` — the roles that gate rule management in the panel
- `src/shared/premade-rules-catalog.js` — every deterministic rule type and its parameters
- `src/shared/sandbox-api-spec.js` — the `api.*` surface available to static post-functions
- `test-harness/lib/workflow.mjs` — a working implementation of everything on this page
