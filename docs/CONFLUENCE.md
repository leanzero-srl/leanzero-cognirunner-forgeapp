<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# Confluence

Release 1.5 gives CogniRunner a reach into Confluence: one client, an endpoint catalogue, a
validator that searches Confluence live on a transition, a condition branch over an
advisory issue property, two post-functions, and five agent actions a Virtual Administrator
can hold. This page describes what is on `main`: how to install it, what it can do, and
exactly what happens when Confluence is not there. The agent that uses these actions is in
[`VIRTUAL-ADMINISTRATOR.md`](VIRTUAL-ADMINISTRATOR.md).

Everything below was read from the code. Where a claim names a file, the file is the
authority; where the 1.5 FRAME and the code disagree, the code wins and the difference is
called out.

---

## Contents

1. [Installing on Confluence](#1-installing-on-confluence)
2. [Scopes](#2-scopes)
3. [The one client](#3-the-one-client)
4. [When Confluence is not there](#4-when-confluence-is-not-there)
5. [The validator](#5-the-validator)
6. [The condition](#6-the-condition)
7. [The post-functions](#7-the-post-functions)
8. [The agent actions](#8-the-agent-actions)
9. [The endpoint catalogue](#9-the-endpoint-catalogue)
10. [Known limits](#10-known-limits)
11. [Testing](#11-testing)

---

## 1. Installing on Confluence

CogniRunner stays a Jira app. Confluence is an optional product in the manifest
(`compatibility.jira.required: true`, `compatibility.confluence.required: false`), so
nothing on this page runs until an admin also installs the app on the site's Confluence:

```bash
forge install -p Confluence
```

The 1.5 scopes are a **major version** change: after `forge deploy`, every site needs
`forge install --upgrade` and the admin must re-consent. Until that upgrade lands, and until
the app is also installed on Confluence, every Confluence rule fails open with the reason
named (section 4). The workflow condition's expression change rides the same bump; there is
no second upgrade to ask for.

"Is the app installed on Confluence?" is answered by one probe, `GET /wiki/api/v2/spaces?limit=1`
(`probeInstalled` in `src/confluence-client.js`), memoised for 5 minutes in one place. The
space picker in the rule editor warms the same memo: a successful listing is a positive
probe and a `confluence_unavailable` fault is a negative one. There is no second copy of
the memo; the offline suite fails the build if one reappears in `src/index.js`.

## 2. Scopes

`manifest.yml` carries six Confluence scopes. Three shipped with the earlier probes and three
are the 1.5 delta:

| Scope | Since | Used by |
|---|---|---|
| `read:space:confluence` | probes | the install probe, the space picker, resolving a space key to its id |
| `read:page:confluence` | probes | `getPage`, `getPageByTitle` |
| `search:confluence` | probes | `searchCql` |
| `write:page:confluence` | 1.5 | `createPage`, `updatePage` |
| `read:comment:confluence` | 1.5 | the client's comment surface (catalogue entries; no rule reads comments today) |
| `write:comment:confluence` | 1.5 | `addComment` |

No new egress: Confluence is reached through `asApp().requestConfluence`, never through
`fetch`.

## 3. The one client

`src/confluence-client.js` is the single home of every call the app makes to Confluence.
The sandbox, the agent actions, the validator and the post-functions all come through it,
and a second `requestConfluence` call site anywhere is a finding. What it enforces:

- **One error type**, `ConfluenceError`, with a closed code set: `confluence_unavailable`,
  `auth`, `not_found`, `conflict`, `rate_limited`, `network`, `invalid`. The status table is
  `statusToCode`: 400 / 405 / 415 / 422 are `invalid`, 401 / 403 `auth`, 404 `not_found`,
  409 / 412 `conflict`, 429 `rate_limited`, and everything else (5xx, 3xx, 0, an HTML body
  where JSON was promised) is `confluence_unavailable`. On the install probe **every**
  non-2xx is `confluence_unavailable`, 404 included.
- **An error message carries no remote text.** The message is the operation, the HTTP
  status and a short allow-listed reason (`CONFLUENCE_ERROR_REASONS`); what Confluence said
  rides on `error.detail`, clamped to 300 characters and flagged `detailUntrusted`.
- **Writes are never retried.** A retried POST is a duplicate page or a duplicate comment.
  Reads retry at most once, only on `network` or `rate_limited`, and only if the operation
  budget can still pay for it.
- **10 s per logical operation and 10 s per call**, the budget carried by a token down the
  call chain so two concurrent operations cannot restore each other's deadline.
- **`updatePage` is version-checked.** The caller passes the version it read; the write
  goes out as `version + 1`, a stale number answers `conflict`, and when no title is
  supplied the page is read first and refused before the write if the version moved. A
  conflict is never retried.
- **Bounded, not sanitised.** Response bodies are clamped to 1 MB before parsing, the
  storage body and the plain text handed to a caller are clamped to 60 KB each
  (`storageToText`, the one html-to-text reducer), search results to 25 per call, a comment
  body to 32 KB. Nothing is fenced or defanged here; a caller that puts page text in a prompt
  fences and defangs it itself.

Public surface: `probeInstalled`, `listSpaces` (at most 100, for a picker), `searchCql`,
`getPage`, `getPageByTitle` (exact title in one space; `null` is not proof of absence when
the app cannot see the space, which is why `auth` throws instead), `createPage`,
`updatePage`, `addComment` (a footer comment).

## 4. When Confluence is not there

The install-state direction is **fail open, deliberately**. Nobody has captured what a
Cloud site answers when the app is not installed on Confluence, only the success path is
proven, so the client sends any status it does not positively recognise to
`confluence_unavailable`. Over-broad "unavailable" lets a validator through with an
explanation; an over-broad "not found" would read as "the page does not exist" and block,
which is the proven-negative trap. Narrow it only when the real not-installed response has
been captured (FRAME probe P2, still open on the text).

Per surface:

| Surface | Confluence unavailable, auth, network, timeout | Misconfiguration |
|---|---|---|
| Validator, Strict off (default) | ALLOW, with a banner and the reason in the log row | BLOCK |
| Validator, Strict on | BLOCK, the message names the cause | BLOCK |
| Condition | never calls Confluence; a missing property shows the transition | no parameters |
| Post-functions | reported as a **skip** in `stepResults[]`, named | reported as an **error** |
| Agent action | a named refusal the model can read, never an empty result | `invalid_args` refusal |

The log banner id is one value, `confluence_unavailable`; which fault it was rides
`confluenceReason` (`confluence-unavailable`, `auth`, `unreachable`, `timeout`,
`judge-unavailable`) and the log row's sentence. The read-only config view renders it as
"Confluence could not be checked: this rule could not search Confluence, so the transition
was allowed. Turn Strict on to block instead. An incomplete rule, with no space or no query,
blocks either way."

## 5. The validator

**`confluence-page-exists`** (category Confluence, `network: true`, `requiresProduct:
"confluence"`), executed by `runConfluenceValidator` in `src/premade-rules.js` under an 8 s
ceiling (`CONFLUENCE_VALIDATOR_BUDGET_MS`), the same placement as the git validators. It
searches Confluence **live on every transition** and never reads the advisory property.

Configuration (`params.confluence`; the clamp is in `src/index.js` beside the git group):

| Key | Meaning |
|---|---|
| `spaceKey` | required; the space the page must be in, picked from the space picker. Missing is misconfiguration. |
| `mode` | `cql` (default): a matching page must exist, no AI, no token cost. `semantic`: the top 3 matching pages are read and the AI judges them against `prompt`. |
| `cqlTemplate` | a CQL fragment with placeholders, at most 2000 characters. |
| `prompt` | semantic mode only; what the page must say. Missing in semantic mode is misconfiguration. |
| `strict` | boolean, default false; what an unreachable Confluence does. Misconfiguration ignores it. |
| `errorMessage` | optional; replaces the block message. |

**The CQL template.** The administrator's template is trusted as query syntax; the values
substituted into it are untrusted issue content and are quoted by one escaper, `cqlQuote`
in `src/shared/confluence-rules.js`. The placeholders are `{issueKey}`, `{summary}` and
`{field:<fieldId>}`, each replaced by a complete quoted literal, so write `title ~ {summary}`
and never `title ~ "{summary}"`. A brace that is not one of those placeholders in the
template is misconfiguration; a brace that arrives inside an issue summary is data, inside
the literal, and is not scanned. An empty field substitutes `""`, which matches nothing
rather than widening the query. The final query is
`space = "<key>" AND type = page AND (<rendered template>)`, at most 2000 characters, and the
screen's modified fields win over the persisted ones, so a rule can check the summary the
user is typing.

**Semantic mode** reads at most 3 pages (`SEMANTIC_MAX_PAGES`), defangs and fences each as
`<<<CONFLUENCE_PAGE ... CONFLUENCE_PAGE>>>` with a guard sentence, and hands them to the
existing validator engine (`deps.judge`, the one validator prompt); a `transientError` from
the engine is a degradation that Strict decides, not a pass.

**The degradation table** (`runConfluenceValidator`):

| Cause | Strict off | Strict on |
|---|---|---|
| `confluence_unavailable` (not installed, or any unrecognised fault) | ALLOW, banner | BLOCK, naming the cause |
| `auth` (scope not consented, no access) | ALLOW, banner | BLOCK, naming the cause |
| `network`, `rate_limited`, timeout | ALLOW, banner | BLOCK, naming the cause |
| the AI judge could not run (semantic) | ALLOW, banner | BLOCK, naming the cause |
| misconfiguration: no space, no template, no prompt in semantic mode, a space that does not exist (`not_found`), CQL Confluence rejects (`invalid`), an unfillable placeholder | BLOCK | BLOCK |
| no page matched (a determinate answer) | BLOCK | BLOCK |

Misconfiguration blocks in both columns because a rule that cannot say what it is checking
must not read as a pass. When the 5-minute install memo is a known negative the search is
short-circuited with the same verdict; a cold memo never short-circuits anything.

On a pass the validator writes the advisory `cognirunner.confluence` property for the
first matching page (`writeConfluenceIssueProperty`, best effort, one writer shared with the
page post-function). `validate()` returns exactly `{ result, errorMessage? }`; the banner and
reason ride the execution log row.

## 6. The condition

**`confluence-page-linked`** takes no parameters and calls nothing. It is one more
null-guarded branch of the single Jira expression in `manifest.yml`, over the advisory
`cognirunner.confluence` issue property:

- a missing property, a property with no `version`, or any version other than 1 evaluates
  **TRUE** (the transition shows);
- only then is `pageId` read, and `pageId != null` is the whole answer.

Missing means TRUE, and that is load-bearing: a missing property means "CogniRunner has
never checked this issue", never "there is no page", so an issue nobody has run the validator
on still shows the transition. The one state that hides is a version-1 property that names
no page. The property is advisory and forgeable by anyone who can edit the issue; the worst an
issue editor achieves is hiding a transition on their own issue, never granting one. One
residual is structural: a forged `version` that is the string `"1"` is a cross-type compare,
which is an evaluation error, which is FALSE, which hides. Use the validator to actually
require a page.

The property value is built by one builder, `confluencePropertyValue`: `{ version: 1,
pageId, title, url, checkedAt }`, each field clamped, the whole under 2048 bytes.

## 7. The post-functions

Two rules, two execution paths (`src/index.js`, the Confluence post-functions block):

**`postfunction-confluence-page`**, "create or update a page for this issue". **Queued**:
`isHeavyPf` names it explicitly, it runs on the async consumer, and the transition completes
immediately. The steps, each a `stepResults[]` row:

1. Author the body with the existing doc generator (`generateDocContent`, the same author
   the generate-doc post-function uses) from `fieldId` (default `description`) and the
   optional `instructions`; the Markdown is converted to storage format by
   `markdownToStorage`, with every piece of model text escaped before any markup is added.
2. Find an existing page by exact title in the space, which is what makes the rule
   idempotent: the tenth run updates one page rather than creating a tenth.
3. Create it, or update it with the version just read.
4. Add a remote link on the issue with a deterministic `globalId`, so a re-run updates the
   link instead of adding a second one.
5. Write the advisory property.

Configuration: `spaceKey` (required), `titleTemplate` (the same placeholders, substituted
raw, at most 200 characters; the default is `CONFLUENCE_DEFAULT_TITLE_TEMPLATE`, the issue
key, a dash and the summary), `parentId` (digits only), `instructions`, `fieldId`,
`selectedDocIds`. No `strict`, no `cqlTemplate`, no `prompt`: a post-function runs after the
transition and finds its page by title, never by query.

**`postfunction-confluence-comment`**, "comment on the linked page". **Inline** and
deterministic: the admin's `commentTemplate` (at most 2000 characters, the same
placeholders) with the issue's values substituted, escaped, one Confluence call, no AI. It
chooses the page from the advisory property; no property means nothing to comment on, a
skip, not a fault. That the property is forgeable is a stated residual: the worst outcome is
a misdirected note in the admin's own words, written as the app, on a page in the same site.

The fail-open / fail-closed table for both (there is no Strict after a transition):

| Cause | Verdict |
|---|---|
| Confluence unavailable, auth, network | OPEN: skipped, named in `stepResults[]` |
| a version conflict on the update | OPEN: skipped, named, never retried; the other edit wins |
| the AI could not author the body | OPEN: skipped; no empty page |
| misconfiguration: no space (page), no template (comment) | CLOSED: an error in the execution log |
| no page linked yet (comment) | OPEN: skipped |

Simulation mode intercepts both writes and reports what would have happened.

## 8. The agent actions

The `confluence` namespace of the action catalogue (`src/shared/agent-actions.js`),
executed by `src/confluence-actions.js` over the one client. Five actions:

| Action | Kind | Arguments | Notes |
|---|---|---|---|
| `confluence_search` | read | `query` (words, at most 300 chars), `spaceKey?`, `limit?` (1 to 25, default 10) | The CQL is built here from escaped parts: `type = "page" AND text ~ "<words>"`, plus `AND space = "<key>"`. The model never supplies CQL. |
| `confluence_get_page` | read | `pageId`, or `spaceKey` and `title` together | Returns the title, the version number, the link, and the text fenced as `<<<CONFLUENCE_PAGE ... CONFLUENCE_PAGE>>>`, defanged, at most 8 KB. "No page with that title" is a real answer with `found: false`, distinct from "Confluence could not be reached". |
| `confluence_create_page` | write, `confirm` | `spaceKey`, `title`, `body` (plain text), `parentId?` | The body is escaped and wrapped into paragraphs; the model cannot write storage XHTML. |
| `confluence_update_page` | write, `confirm` | `pageId`, `version`, `body`, `title?` | `version` must be the number read with `confluence_get_page`; a moved page is refused with `conflict` rather than overwritten. |
| `confluence_add_comment` | write, `confirm` | `pageId`, `body` | A footer comment, plain text. |

**The space allow-list bounds every write.** A page create names its space; an update or a
comment has its space resolved from a read of the page (the numeric `spaceId`, matched
against the space listing), never from the model's argument, and a page whose space cannot
be resolved is refused. An empty allow-list means no writes, never all writes, and the
refusal says so in words the model can act on. The read happens even in simulation, so a
simulated write cannot report as allowed a write the real run refuses.

**The install probe runs first**, before any argument work. When the app is not installed
on Confluence the refusal is `confluence_unavailable` with the sentence "This is NOT 'the
page does not exist', nothing was checked", and a `banner` field. Every other client error
becomes a sentence naming the cause and a next step (`errorText`), and the executor never
throws; every failure is `{ success: false, code, error }`. Results are capped at 12 KB and
every string in them is defanged.

**All three writes carry `confirm: true`**, which on the headless surfaces (listeners,
scheduled jobs) means only an admin-saved rule may hold them; the comment is outward speech
under the organisation's name on a page whose readers are often customers. The Virtual
Administrator does not apply `confirm`: its tools come from its powers, `confluenceRead`
buys the two reads, `confluenceWrite` implies read and adds the three writes bounded by
`powers.confluenceSpaces`, and the operator who ticked the power is the confirmation. A VA
that holds any Confluence power runs its item turns on the 900 s long consumer.

The namespace carries `requiresProduct: "confluence"` and no capability. On listeners,
scheduled jobs and the Coder the gate context is built with the default product list
(`["jira"]`), so the five actions are refused at save time there with
`missing-product:confluence`; today the Virtual Administrator is the only surface that holds
them (see [`VIRTUAL-ADMINISTRATOR.md`](VIRTUAL-ADMINISTRATOR.md#15-known-limits)).

## 9. The endpoint catalogue

`src/shared/confluence-endpoints.js` is the single source of truth for the Confluence
endpoints the app uses, in exactly the shape of `src/shared/jira-endpoints.js` (a parity
test asserts it), consumed by the endpoint picker and by `buildConfluenceEndpointPromptBlock`
for AI prompts. Every path starts with `/wiki/`. Listing an endpoint is not a permission
statement.

| Category | Method and path | Purpose |
|---|---|---|
| Pages | `GET /wiki/api/v2/pages/{id}?body-format=storage` | one page; `storage` is the editable XHTML, `atlas_doc_format` is ADF |
| Pages | `GET /wiki/api/v2/spaces/{spaceId}/pages?title=&limit=` | exact-title lookup in a space |
| Pages | `POST /wiki/api/v2/pages` | create; needs the numeric `spaceId`, not the key |
| Pages | `PUT /wiki/api/v2/pages/{id}` | update; `version.number` must be current + 1, a stale number answers 409 |
| Search (CQL) | `GET /wiki/rest/api/search?cql=&limit=` | CQL has no v2 equivalent; three catalogue entries show text, exact-title and issue-key searches |
| Spaces | `GET /wiki/api/v2/spaces?limit=1` | the install probe |
| Spaces | `GET /wiki/api/v2/spaces?keys=&limit=1` | resolve a key to its id |
| Spaces | `GET /wiki/api/v2/spaces/{id}` | one space |
| Comments | `GET /wiki/api/v2/pages/{id}/footer-comments` | list footer comments |
| Comments | `POST /wiki/api/v2/footer-comments` | add a footer comment; never retried |
| Attachments | `GET /wiki/api/v2/pages/{id}/attachments` | metadata only |
| Attachments | `GET /wiki/api/v2/attachments/{id}` | one attachment's metadata; read `fileSize` before any content |

## 10. Known limits

- **The not-installed response is uncaptured.** The mapping is over-broad on purpose and
  fails open; the sites this was proven on have the app installed on Confluence, so the
  negative shape has never been observed.
- **No `api.confluence.*` in the sandbox.** The FRAME planned one nested entry in
  `src/shared/sandbox-api-spec.js`; the spec on `main` has no Confluence entry and
  `createApi` exposes no Confluence methods, so static post-functions and code steps cannot
  call Confluence. The `confluence_api` operation type in the code generator predates 1.5
  and is a prompt hint, not a sandbox namespace.
- **Comments are never read by a rule.** `read:comment:confluence` is held and catalogued,
  but no rule or action lists a page's comments.
- **One space per rule, one page per issue.** The validator names one space; the property
  records one page; the comment post-function comments on that one page.
- **The property is advisory** everywhere it is read (the condition, the comment
  post-function). Only the validator verifies live, and it never reads the property.
- **Page text is bounded, not sanitised**, and is untrusted at every seam: the validator's
  semantic mode, the agent's `confluence_get_page` and the memory all fence and defang it
  before a prompt.

## 11. Testing

Offline, no Forge runtime (auto-discovered by `npm run test:offline` in `test-harness/`):
`confluence-client.test.mjs` (mocked fetch: every code in the status table, the no-retry
rule on writes, the budget token, the version check, the clamps),
`confluence-endpoints.test.mjs` (catalogue shape parity with the Jira catalogue, the
`/wiki/` prefix), `confluence-actions.test.mjs` (the space allow-list from a read,
simulation, the install refusal, the fence, the single install memo), and
`premade-confluence.test.mjs` (every row of both degradation tables, the CQL escaper against
hostile summaries, the condition expression's shapes). `npm run test:parity` keeps the
catalogue rows and the executors agreeing, including the queued / inline `execution` field.
