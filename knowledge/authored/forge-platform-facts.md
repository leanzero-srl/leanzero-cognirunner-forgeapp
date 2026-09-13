<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0

 Tier C replacement, written from scratch in our own words. The facts below were each
 verified on a live site or against the published SDK types at the time they were learned;
 the dates in the text say when. Nothing here is copied from a memory file, and no tenant,
 account, e-mail, ticket key or client travels with a fact.
-->

# Forge platform facts

## Workflow conditions: which kind is enforced

There are two ways a Forge app can put a condition on a Jira workflow transition, and they behave differently at runtime. Treat this as one reconciled rule, because earlier notes disagreed with each other.

A `jira:workflowCondition` module is expression-only. The module has no working `function` property: if a manifest declares both a function and an expression, the function is never invoked and only the expression decides. A condition whose expression is the literal `true` therefore always passes, whatever the backing function was meant to do. The reason this matters is that a condition looks configured in the workflow editor while enforcing nothing, and the failure is silent on every transition.

An expression-backed condition, on the other hand, is enforced everywhere, including the REST transition path. When the expression evaluates to false the transition is absent from `GET /rest/api/3/issue/{key}/transitions` and a `POST` to the same transition is rejected with a 4xx. So "conditions are a no-op over REST" is true only of the function-backed shape; a deterministic Jira expression is a real gate. Bulk operations and automation are subject to it too, because the platform evaluates the expression, not the app.

Jira expression facts that were proven live and shape how a condition should be written: a custom field is read by its REST id (`issue["customfield_12345"]`), and that accessor works for every standard custom-field kind. An unset field reads as `null`, never as an empty string or an empty array, so guard with a null check before calling anything on the value. The `==` operator is strict: comparing a Number to a String is an evaluation error, and an evaluation error hides the transition, which is the fail-closed direction. A `null == "x"` comparison is a safe false. Numbers written into the module configuration arrive typed into the expression, a multi-line text value is a rich object rather than a plain String, and `.match()` with a regular expression works as a guard. System-field accessors do not share the REST id naming (`issue.dueDate` versus `duedate`), and a mismatch there is a fail-closed surprise, so prefer custom fields or a per-field verified whitelist. A condition expression can also read `issue.properties?.["key"]`, and a handful of such reads per transition is well within budget.

Rule shape when writing a defensive expression: gate each branch behind a check that the configured property looks like a custom-field id, resolve every unknown case to `true` (default-allow), and keep evaluation errors branch-local. Hiding a transition on a healthy issue is the outcome a condition must never produce.

## Workflow rules over REST and the workflows API

The Jira Cloud v3 workflows API attaches rules at the top level of a transition: `validators[]`, `actions[]` (post-functions), and `conditions` as a recursive tree of `{operation, conditions[], conditionGroups[]}`. There is no `rules` wrapper, and `operation` is required on an update. Forge rule keys are `forge:expression-validator`, `forge:expression-condition` and `forge:workflow-post-function`; `parameters.key` carries the app's extension identifier and `parameters.config` a stringified, self-contained configuration. Post-function flavours from one app share the single post-function rule key and are routed by a field inside the config, not by distinct keys.

Rules attached this way run even when the app's own registry has no record of them, so an app must treat "no registry entry" as an ordinary state and decide deliberately whether that means fail-open or fail-closed. Validators attached over REST are enforced on the REST transition path: the transition is refused with a 4xx and the validator's message appears in `errorMessages`.

Reading rules back through `POST /rest/api/3/workflows` returns them in the same `{ruleKey, parameters}` shape that the write endpoints accept, so copying between sites needs no key translation. Facts that cost real time on that path: rules from other vendors' apps require their `parameters.id`, and stripping it makes the validation endpoint return a 500; an initial transition rejects any `conditions` object, even an empty one; the bulk read returns 404 if any requested workflow name is missing, so enumerate first and request the intersection; system workflows marked `isEditable:false` cannot be updated; Jira regenerates rule ids on every read, so they are not stable references. Unresolved entity ids inside a rule must pass through unchanged rather than be dropped, because an emptied group list turns "allow these groups" into "block everyone".

Jira applies transition field values only when the transition has a screen. A transition with no screen silently ignores `fields` in the transition request.

## Async events, queues and post-function timing

Async events are delivered at least once and there is no dead-letter queue. An application-level throw inside a consumer does not trigger an automatic retry on its own; the retry contract is the SDK's error type. Payload limits are around 200 KB per push and 100 KB per event for consumers that run longer than 55 seconds, and a consumer may declare a timeout of up to 900 seconds.

A `jira:workflowPostFunction` cannot raise its timeout: the manifest linter rejects `timeoutSeconds` on it and the hard cap is 25 seconds. Post-function invocations are not exactly-once either. The pattern that follows from both facts is to enqueue heavy work to a consumer and claim each execution with an atomic key-value write using `FAIL_IF_EXISTS`, so a redelivery finds the claim and stops.

The `@forge/events` package changed shape at major version 2: the consumer is a plain exported handler, and the manifest declares `consumer: [{ key, queue, function }]` with no resolver block. Mixing the older resolver-style consumer with the v2 package makes `queue.push()` fail with a 400, because the platform validates the consumer definition when it accepts the push. Check the installed major version before writing a consumer; some documentation still shows the older shape.

User-triggered invocations (resolvers, UI-initiated calls) are capped at 25 seconds and `timeoutSeconds` does not apply to them; it only lengthens scheduled triggers and queue consumers. Anything that pages through group membership or a permission list belongs on a queue. A resolver that dies mid-read looks to the frontend like an empty result, which is how a "does this space exist" panel once offered to create a space that already held thousands of people.

## Key-value storage facts

The TTL option on a key-value write is `{ ttl: { value, unit } }`; a `ttlSeconds` argument is accepted and silently ignored. `set(key, value, { keyPolicy: "FAIL_IF_EXISTS" })` is the atomic claim primitive. `query()` is eventually consistent, supports only a begins-with filter, pages at most 100 results, and its result order is undocumented, so always sort on the client. `batchDelete` accepts at most 25 keys and a single value may be at most 240 KiB.

Storage is siloed per product installation. A cross-product app installed on both Jira and Confluence has two separate stores, and rows written from one product are invisible to functions running in the other. Cross-product features must either re-derive the state they need from the product REST APIs or rely on a signal that crosses the boundary, such as the user's actual group membership.

Forge SQL is backed by a MySQL-compatible engine with its own wrapper rules: one statement per query, no foreign keys, a 20-second DDL timeout, and `LIMIT`/`OFFSET` cannot be bound as `?` parameters (the driver answers with an incorrect-arguments error). Interpolate only constants the code owns into a limit clause, never user input. Verify every DDL statement against the platform's documented restrictions and the engine's statement reference before deploying a migration; a standalone `CREATE INDEX` that is ordinary elsewhere failed on the live platform, and the `ALTER TABLE ... ADD INDEX` form was the one accepted.

## Forge LLM contract and cost

Through `@forge/llm` (around version 0.6) the usage fields are plural (`input_tokens`), a tool call's `function.arguments` arrives as an object rather than the JSON string other providers send, `list()` returns `{ models: [{ model, status }] }`, and tool-result messages carry a `name` plus content parts. Some documentation still shows singular usage field names; the SDK types are the authority. When sending a tool call back to the model in the OpenAI-style shape, serialise the arguments as a string, or the request fails to deserialise.

Adding the `llm` module to a manifest is a major version change that an administrator must approve on upgrade. Tokens are billed to the app vendor, input is text only, and the per-installation cap is about 50,000 tokens per minute per model, enforced only after a minute has already exceeded it. Hosted MCP tools still reach a Forge LLM call when the app proxies them from its own backend, because the proxy runs in the app, not at the inference endpoint.

Forge is consumption-billed to the developer, not to the customer, and a free Marketplace listing gives no shelter. What is billed is function duration in GB-seconds (invocation count is free) and key-value bytes transferred, where a write costs roughly twenty times a read and even an empty read is charged as one kilobyte. Async events, scheduled triggers and product events cost only the duration they cause. Design any background work with the question "what does this cost at a thousand of them a day" answered before it ships.

## Installation, licensing and product scope

A single `forge install` registers the app with one product. A cross-product app must be installed on each product separately; modules for a product that is not installed stay in the manifest and simply never appear. `forge deploy` updates existing installations only and never installs to a new product. After a fresh install, list the installations and confirm every expected product is present. Cross-product apps are not accepted on the Marketplace.

With `app.compatibility.confluence.required: false` declared and a Confluence install added, `asApp().requestConfluence` works from Jira-triggered functions. The service management API (desks, queues, queue issues) is readable as the app with the request read scope.

The licence object exposed to functions carries `capabilitySet` as a camel-case value (for example `"capabilityAdvanced"`) alongside a `state`, and it is present in web triggers and in the async consumer via the app context. It is null on installs made without a licence flag, and `forge install --upgrade --license X` does not re-apply to an install that is already current; a fresh install does.

Assets (CMDB) reads from an app: measured recently, `POST /jsm/assets/workspace/{id}/v1/object/aql` returns 200 as the app from a web trigger with no user context, provided the app is installed on the relevant products, declares the compatibility block, holds the CMDB read scopes and has been granted access inside Assets. Earlier reports of a 401 in every context most likely lacked one of those. Keep the Assets call off any render path regardless: do the work in a scheduled job or through the supported import-type module and have the UI read local state. The deprecated `GET .../aql/objects` route is explicitly closed to apps; use the POST form with pagination in the body. The AQL response returns attribute names in a top-level `objectTypeAttributes` array rather than inline on each attribute; reading them inline makes every value resolve to nothing while the run reports success.

## Custom UI, Jira expressions in the wild, and the route helper

A Custom UI app renders in a single, non-nested iframe; UI Kit renders natively into the host DOM with no iframe. The iframe source hostname is served from a CDN and is not stable, so never hardcode it. Global pages, project pages and full pages have deep-link URLs built from the bare app id and the environment id; an issue panel and a macro are not deep-linkable and must be reached by driving the host UI.

The `route` template tag escapes every interpolated value. Interpolating `limit=250&cursor=X` as one string transmits the separators percent-encoded, the server ignores the whole query and returns page one at the default size on every iteration, and a paging loop that counts results then reports duplicates as volume. Interpolate values only, never separators: `route\`/spaces?limit=250&cursor=${cursor}\``. The failure is silent and directional, which is the worst kind for a compliance figure.

Display conditions on Confluence modules can read only entity properties, never key-value storage or custom entities, so a display-driven feature must keep its state in a space, page or user property. `entityPropertyEqualTo` on a space entity works and tracks changes; `entityPropertyExists` gives a zero-cost unconfigured state. A Forge app cannot block a Confluence publish, because no pre-publish validator module exists. The paired-control method makes such work trustworthy: every gated module gets a twin with no condition, so "condition false" can be told apart from "module not rendering".

Classic-transform React apps require `import React` in every file that contains JSX, or the component throws at render and the iframe goes blank. A screenshot harness that mocks the bridge module and aliases it through the bundler is the way to verify Custom UI components outside a live site; the live CSS source in such apps is whatever function injects it at mount, not an unimported stylesheet.

## Identity, permissions and what an endpoint quietly excludes

Global administration does not grant project-level edit permission in Jira Cloud. A site admin can receive an empty `editmeta` and a 400 "not on the appropriate screen" on every update, because project permissions come from the permission scheme through project roles. Before any bulk field write, check `GET /rest/api/3/mypermissions?issueKey=...&permissions=EDIT_ISSUES` on a sample issue from every project in scope. The `overrideScreenSecurity` and `overrideEditableFlag` query flags work only for apps, not for a basic-auth token, and 403 even for global admins.

Mentions are indexed by account id, not display name. There is no mention-aware JQL function; `comment ~ "Surname"` does not find a mention node, while `text ~ "<accountId>"` does, and the match is precise because real account ids are high-entropy. Confluence CQL has a native `mention = "<accountId>"` operator that likewise needs an id. The notification inbox endpoint is OAuth-only and answers 401 to an API token.

`GET /rest/api/3/user/search` returns active users only. A directory that is mostly deactivated accounts is mostly invisible to it, so an "exists on the target" check built on that endpoint is blind to most of the population. Use `/rest/api/3/users/search` paged in full or `/user/bulk`, both of which return inactive users, and prove any absence by a direct id lookup. Account ids are global for ordinary accounts, but portal-only customer ids are site-scoped: a 404 for one of those on another site is guaranteed by construction and carries no information.

`POST /rest/api/3/permissions/check` reads another user's project and global permissions and returns a genuine empty list when the user holds none. It disproves the belief that Jira cannot answer that question, and it is the endpoint that settles "can this person see the internal comment I left".

Groups and users are organisation-scoped and shared by every site in the organisation, including a customer's own sandbox. Creating a group in a sandbox writes to the shared directory and appears in the production audit log, which is immutable. Projects, schemes, security levels, fields and workflows are site-scoped. A guard that names one production host does not fence a shared directory; name the tenant where writes are allowed positively, and never create groups or users anywhere but a separate organisation.

The Teams API lives on the platform API host, not the site, takes a plain user API token with basic auth (apps and OAuth clients are explicitly excluded), returns members as account ids only, and repeats its cursor on the last page.

## Service management comments and visibility

Creating a service management comment with a chosen visibility requires the `sd.public.comment` property inline on the create request: `properties: [{ key: "sd.public.comment", value: { internal: true } }]` on `POST /rest/api/3/issue/{key}/comment`. Setting the property afterwards through the comment-properties endpoint stores it, and it reads back, but the agent UI ignores it and the comment keeps its original visibility. The top-level `jsdPublic` field on that endpoint is silently ignored.

The inline properties array accepts only object values. Including a string-valued sibling property makes the whole request fail with a 400 whose message names the visibility property rather than the real culprit. Put object-valued properties inline at creation and set primitive-valued tags afterwards with a separate property write.

The portal-side comment endpoint under `/rest/servicedeskapi/request/{key}/comment` returns 404 unless the calling user is a participant on that specific request, so it is not a route for agent-driven bulk work.

An internal comment is readable only by someone who holds the agent permission on that project. A licensed agent tenant-wide can still be a portal-only customer on one project and will never see an internal question left there. Before concluding that a person is ignoring a question, prove they can see it with the permissions check above, and re-ask publicly if they cannot.

Descriptions and comment bodies are capped at 32,767 characters, measured on the serialised document JSON, not on the visible text. Heavy formatting can push a 20,000-character description over the cap. Detection must be client-side after fetching the body, because JQL has no length operator.

## Issue links, migrations and the Connect timeline

`POST /rest/api/3/issueLink` treats the body's `inwardIssue` as the subject that performs the outward verb: `{ type, inwardIssue: X, outwardIssue: Y }` renders as "X <outward verb> Y". That is the inverse of how links read back on an issue, where an entry with `outwardIssue: P` means "this issue <outward verb> P". To recreate a link read from a source, swap the slots, and read the created link back from both ends before trusting direction. A dry run that only logs intent cannot catch this.

Data classification in Jira, Confluence and service management Cloud requires a separate premium security add-on, not a product plan tier. The hierarchy is organisation default, space default, per-content; the visible artefact is a byline badge on pages, and nothing renders at space level. Endpoints under `/wiki/api/v2/classification-levels` and per-space and per-page classification routes take the numeric space id, not the key.

Moving third-party CMDB data to Cloud Assets is one hop: extract, transform to the Cloud model, load through the Assets API. Staging through the bundled Data Center Assets pays twice for one transformation and inherits every migration-tool limit. Migrate all schemas before projects or linking silently fails; per-object limits apply to name and description length and to objects per work item per field. Measure the issue-to-object link count before choosing, because a large number is the one thing that justifies the double hop.

The Connect end-of-support timeline has three phases: new Marketplace apps must be Forge-only since September 2025, existing Connect descriptors froze in March 2026, and end of support arrives at the end of 2026 as a gradual "use at your own risk" decay rather than a switch-off. Forge is the successor platform, not the thing being retired; customers of Marketplace apps take no action, and only self-built Connect apps put the migration clock on the customer.

## Automation, the browser, and REST first

Jira Cloud Automation has no public API to create or edit a rule. The internal gateway routes answer 404 to an API token, and the documented rule endpoints exist for Data Center only. When a task needs an automation rule on Cloud, drive the builder UI with a browser session; keep any secret for a web-request action in a header rather than the URL, because the URL is logged. Smart-value facts proven in that builder belong in the automation pack.

The order of attack for any configuration job is REST first, then REST proven on a sandbox, then the browser, and never browser-first. Probe the REST surface before writing a line of browser automation; a browser is for things that genuinely have no API, and that has to be verified rather than assumed. When a write returns a 400, do not conclude "unsupported": for an undocumented route the accepted schema is whatever the server just handed back on a read. Prototype writes on a sandbox tenant, not on production, and port the proven call.

Browser automation against Atlassian stays expensive: an API token cannot mint a browser session, a headless profile can trip device-verification e-mail, sessions idle out after weeks, and the UI reshapes between loads. Run headed with a persistent profile on the same machine, or automate a second factor for headless work.

A Forge app's health dashboard can itself be a major API consumer: several pollers at a few seconds each, every one starting with a paged group-membership walk, add up to dozens of resolver calls a minute from one browser tab. A module-scope cache mostly misses because containers are not reliably reused; keep a durable verdict cache with a short TTL, and back off pollers exponentially on a refusal, because a client that keeps firing at the same rate after a denial is the outage.
