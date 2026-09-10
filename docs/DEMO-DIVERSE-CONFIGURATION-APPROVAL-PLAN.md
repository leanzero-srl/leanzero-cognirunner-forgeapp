# LeanZero Apps Demo — content and configuration approval plan

Status: PROPOSED — awaiting user approval. Prepared 2026-09-10.

Target: https://leanzero-apps-demo.atlassian.net only. This revision supersedes the uniform 13-rules-per-project approach in the earlier demo plan. It does not authorise changes to any other site. KAN remains outside this campaign. No tenant writes, new fields, app configuration, source changes or deployments were performed while preparing this revision.

## What exists, and what needs improving

The previous verified content pass produced 450 portfolio issues, 24 additional CogniRunner scenarios, 18 Confluence pages and 24 text attachments. Together with the original 12 COGDEMO issues, the campaign has 486 Jira issues. Fresh read-only Jira inspection confirms four company-managed campaign projects: COGDEMO (10033), LAUNCH (10066), UPGRADE (10067), ROLLOUT (10068). KAN is a separate team-managed project.

The live samples LAUNCH-30, UPGRADE-60 and ROLLOUT-80 expose repeated acceptance prose and generic work-package descriptions. The data is populated but does not yet meet the requested realism. The next pass must improve these existing records as well as add new ones, preserving their issue IDs, useful hierarchy and links. Replace a generated field only when it still matches the saved receipt; preserve intervening human edits for explicit reconciliation. Keep generation and expected-test-result metadata out of the normal business narrative, in the execution manifest and issue properties instead. Retain a clear synthetic-demo notice at project/space level.

## Proposed inventory

The target remains 4,143 campaign issues across 11 projects, including existing content. There are 3,657 remaining issue slots: 3,645 seeded records and 12 reserved for verified CogniRunner-generated children/follow-ups. Never seed the reserved records and then create them again during demonstrations.

| Key | Project/business focus | Final issues | New custom fields | Jira workflows | CogniRunner configurations |
| --- | --- | ---: | ---: | ---: | ---: |
| COGDEMO | Workflow decision and exception cases | 384 | 6 | 1 | 4 |
| LAUNCH | Customer workspace launch: entitlement, billing, accessibility and regional release | 306 | 5 | 1 | 4 |
| UPGRADE | Platform renewal: compatibility, data migration, cutover and recovery | 351 | 6 | 1 | 3 |
| ROLLOUT | Regional operations: pilot cohorts, training and service handover | 585 | 5 | 1 | 3 |
| SERVICE | Service Reliability: interruptions, requests and operational follow-up | 222 | 5 | 1 | 2 |
| RELQA | Release Assurance: regression, exploratory testing and release evidence | 549 | 5 | 1 | 3 |
| CONNECT | Partner Integrations: contracts, event delivery and reconciliation | 353 | 5 | 1 | 2 |
| DQ | Data Quality: duplicates, freshness, completeness and reconciliation | 428 | 5 | 1 | 2 |
| SECREV | Security Review: access boundaries, mitigation and residual risk | 207 | 6 | 1 | 2 |
| ONBOARD | Customer Enablement: role-specific setup, access and readiness | 228 | 4 | 1 | 2 |
| LAB | Product Experiments: hypotheses, instrumentation and inconclusive results | 530 | 5 | 1 | 2 |
| Total | | 4,143 | 57 | 11 | 29 |

Seven projects are new. COGDEMO retains its existing key in this proposal: no incidental rename or recreation. The 29 configurations are actual saved instances, not bundles or a multiplier template. They comprise 23 workflow rules, three listeners and three scheduled jobs; two of the latter six use agent mode. Workflow schemes and create/edit/transition screens are dedicated to campaign projects, avoiding changes to KAN through shared configuration. SERVICE is a company-managed software project in this baseline; this does not promise a JSM portal, Assets catalogue or SLA setup.

## Realistic content design

Use one coherent fictional software business, Harbourline, with a customer workspace product, a shared identity/billing platform and partner integrations. Invent organisations, datasets and endpoints; use reserved example domains. Existing assignable accounts remain the actual owners. Do not invent users, backdate Jira audit events or attribute generated comments to people who did not write them.

Vary structure by work type: bugs contain reproduction steps, expected/actual results, build and environment; stories contain a user outcome and measurable acceptance; changes contain impact, implementation and rollback; operational issues contain symptoms, investigation and recovery; experiments contain hypothesis, method, observations and decision. Some work is blocked, rejected, reopened, duplicate, deferred or inconclusive. Missing evidence is deliberate only in named negative fixtures, not random empty fields throughout finished work.

Examples of the intended writing:

- LAUNCH: “Prorated seat charge is duplicated when a trial converts on the billing cutoff.” Include invoice lines, rounding behaviour and an acceptance example showing a single EUR 18.40 adjustment.
- UPGRADE: “Cutover rehearsal leaves 37 inactive accounts in the legacy entitlement table.” Describe the reconciliation query, why active accounts are unaffected and the rollback checkpoint still required.
- ROLLOUT: “French-language supervisors cannot complete the incident handover exercise.” Link the missing training section and the corrected pilot result; avoid claiming the whole region is blocked.
- CONNECT: “A retried shipment event creates a second fulfilment record.” Include an example event ID, idempotency key and before/after record counts.
- LAB: “Progressive disclosure reduces setup abandonment, but the mobile cohort is inconclusive.” Include cohort sizes, the chosen metric and the condition for stopping or continuing.

Keep descriptions unequal in length and layout; avoid serial suffixes, repeating the summary as the first paragraph, universal acceptance paragraphs or a fixed status cycle. Use business-specific components, release names and owner distributions. Dates must agree with the story: completed work has completion evidence, cutover precedes verification, and blocked successors explain the dependency. Native original/remaining estimates support capacity; schedule duration is not effort. Preserve small unestimated/unassigned cohorts where the scenario explicitly needs them.

Create 120 named presenter scenarios within the total: 80 normal/rework business journeys and 40 negative or boundary cases. Their exact issue IDs and expected changes are recorded before any rule is enabled. Each remaining issue receives domain-specific facts and appropriate fields. Automated duplicate detection flags repeated long body paragraphs and near-identical summaries; editorial review covers at least ten issues per project and all 120 presenter scenarios. Fixed policy text may repeat, business evidence may not.

Expand Confluence from 18 to 60 pages and from 24 to 96 attachments. Preserve the existing LZSHOW library; add DELIVERY (18 pages) and CONTROLS (24 pages), giving three independently scoped Sentinel examples. The 72 new attachments comprise 28 PDF evidence packs, 12 CSV result datasets, 12 JSON contract/log samples, 10 text runbooks and 10 SVG architecture/process diagrams. Every attachment must contain relevant data, open successfully and have a recorded content hash. Jira records link to specific document/evidence IDs, and documents link back to their work. A link alone is not a cross-app approval integration.

## Custom fields: 57 new definitions, project-specific contexts

Prefix display names with their project key, for example “LAUNCH Release Brief”. The following are separate new fields. Single-select option values are specified in parentheses. Date and date-time types are deliberately distinct. IDs are discovered after creation and saved in the execution manifest; no guessed customfield IDs. Standard assignee, priority, components, versions, due date and time tracking remain native fields.

| Project | New fields and types |
| --- | --- |
| COGDEMO (6) | Review Evidence — paragraph; Expected Decision — select (Accept, Return for evidence, Reject, Manual review); Scenario Reference — short text; Review Cycle — number; Business Domain — select (Delivery, Operations, Data, Security); Decision Notes — paragraph |
| LAUNCH (5) | Target Segment — select (Self-service, Mid-market, Enterprise); Commercial Commitment — date; Acceptance Evidence — paragraph; Release Brief — paragraph; Launch Readiness — select (Discovery, Evidence pending, Ready, Hold) |
| UPGRADE (6) | Change Window — date-time; Change Owner — single user; Rollback Evidence — paragraph; Rehearsal Readiness — select (Not run, Partial, Passed, Failed); Cutover Start — date; Cutover Finish — date |
| ROLLOUT (5) | Rollout Region — select (UK and Ireland, DACH, France, Nordics, North America); Wave Code — short text; Acceptance Evidence — paragraph; Risk Band — select (Low, Medium, High, Unassessed); Training Completion — number, percentage |
| SERVICE (5) | Customer Impact — select (Single user, Team, Multiple customers, Service-wide); Resolution Evidence — paragraph; Escalation Reason — paragraph; Service Owner — single user; Recovery Minutes — number |
| RELQA (5) | Test Build — short text; Coverage Percent — number; Evidence Reference — URL; Release Risk — select (Low, Medium, High, Unknown); Escaped Defect Count — number |
| CONNECT (5) | Contract Reference — short text; Integration Endpoint — URL; Error Category — select (Authentication, Contract mismatch, Timeout, Duplicate delivery, Unknown); Correlation Reference — short text; Retry Count — number |
| DQ (5) | Dataset Reference — short text; Exception Category — select (Duplicate, Missing, Invalid, Stale, Reconciliation); Affected Record Count — number; Aging Band — select (Fresh, 8–30 days, Over 30 days); Detection Date — date |
| SECREV (6) | Control Reference — short text; Mitigation Evidence — paragraph; Review Owner — single user; Residual Risk — select (Low, Medium, High, Unassessed); Data Classification — select (Public, Internal, Confidential, Restricted); Review Due — date |
| ONBOARD (4) | Role Profile — select (Administrator, Analyst, Operator, Read-only); Start Date — date; Sponsor — single user; Readiness Notes — paragraph |
| LAB (5) | Experiment Hypothesis — paragraph; Success Threshold — number; Observation End — date; Experiment Conclusion — paragraph; Outcome — select (Positive, Negative, Inconclusive, Stopped) |

Each context is restricted to its named project and applicable issue types. Remove an automatically created global context before proceeding. Add fields to the intended screens, verify create/edit metadata, then populate relevant existing and new issues. Do not make every field globally required: require evidence at the relevant transition. Add native field-required validators for RELQA Coverage Percent and CONNECT Contract Reference before their CogniRunner comparison/regex rules so a missing input cannot be treated as a passing check. These two native validators are not counted among the 29 CogniRunner configurations.

Jira field/context/option/screen behaviour is grounded in Atlassian's [field API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/), [project-scoped contexts](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-custom-field-contexts/) and [issue edit metadata](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/). A field existing in the global catalogue is not evidence that a user can edit it on the target project.

## CogniRunner: distinct configurations with observable effects

Current source supports premade and AI validators, deterministic workflow conditions, generated/static JavaScript post-functions, semantic field updates, AI comments/subtasks, scoped listeners, scheduled jobs, agent actions, docs/skills/memories and an app-token REST surface. Conditions in manifest.yml run Jira expressions; this plan does not label them AI runtime conditions. Research/document-generation variants need a proven processor and are outside this baseline. No new external processor or provider credentials are assumed.

| ID / project | Saved configuration | Trigger/type | Required visible result |
| --- | --- | --- | --- |
| CR01 LAUNCH | Market promise readiness | AI validator, Submit for launch review | Reject unsupported launch promise; accept measurable audience/outcome/exclusions |
| CR02 LAUNCH | Launch owner handoff | Assignee condition, Accept ownership | Action visible to the actual assignee, hidden to another tested account |
| CR03 LAUNCH | Executive release brief | Semantic PF, Approve launch | Write LAUNCH Release Brief from evidence without inventing readiness |
| CR04 LAUNCH | Commitment drift watch | Script job, weekday 09:10 Europe/Bucharest | Flag only selected overdue unfinished commitments; unchanged repeat adds nothing |
| CR05 UPGRADE | Rollback rehearsal gate | AI validator, Authorise cutover | Require concrete reversal/checkpoint/evidence; unsupported promise fails |
| CR06 UPGRADE | Cutover ownership package | Static PF, Schedule cutover | Create three owned checklist subtasks, copy change owner/window, zero duplicates on replay |
| CR07 UPGRADE | Rehearsal result propagation | Changed-field listener | Recompute parent readiness from the complete relevant child set; reopen reverses readiness |
| CR08 ROLLOUT | Wave acceptance completeness | Required-field validator, Submit acceptance | Blank ROLLOUT Acceptance Evidence blocks transition |
| CR09 ROLLOUT | Regional risk routing | Semantic PF, Assess wave | Set only one declared ROLLOUT Risk Band value from the supplied risk narrative |
| CR10 ROLLOUT | Wave exception digest | Read-only agent job, weekday 16:10 Europe/Bucharest | Start from one coordination issue referencing five selected cases; retain an evidence-linked digest in the execution result |
| CR11 COGDEMO | Contradictory evidence review | AI validator, Submit review | Reject contradictory claim while accepting corrected evidence |
| CR12 COGDEMO | Review cycle comment | Comment-required validator, Request changes | Comment required on a dedicated transition screen; accepted comment persists |
| CR13 COGDEMO | Replay-safe review stamp | Static PF, Record review | Set one owned issue property and label; preserve unrelated values |
| CR14 COGDEMO | Decision rationale draft | AI comment PF, Record decision | Add a factual rationale reflecting limitations; no claim that a draft grants approval |
| CR15 SERVICE | Escalation meaning detector | AI-gated comment listener | Actual escalation sets marker/reason; informational update does not |
| CR16 SERVICE | Resolution evidence gate | AI validator, Resolve | Assess symptoms/intervention/verification/caveats; an unverified workaround is returned |
| CR17 RELQA | Test coverage threshold | Numeric comparison validator, Ready for release | Coverage must be at least 85; paired with CR29 and the native required-field validator |
| CR18 RELQA | Defect evidence handoff | Static PF, Escalate escaped defect | Create exactly one linked SERVICE follow-up with build and evidence references |
| CR19 CONNECT | Contract identifier check | Regex validator, Validate contract | Enforce ^CTR-[A-Z]{3}-[0-9]{4}$, with missing input required separately |
| CR20 CONNECT | Integration failure triage | Read-only agent issue listener | Retain a supported error-category recommendation and diagnostic explanation in the execution result; no Jira write |
| CR21 DQ | Quality exception classification | Semantic PF, Classify exception | Set one declared DQ Exception Category from supplied evidence |
| CR22 DQ | Unresolved exception aging | Script job, daily 08:10 Europe/Bucharest | Set Aging Band from Detection Date on unfinished cohort; write only when changed |
| CR23 SECREV | Review evidence presence | Attachment-required validator, Submit review | Missing attachment blocks; attachment existence does not imply trustworthy evidence |
| CR24 SECREV | Remediation acceptance | AI validator, Verify mitigation | Distinguish implemented mitigation and residual risk from a future promise |
| CR25 ONBOARD | Owner assignment visibility | Assignee condition, Accept onboarding | Only actual assignee sees the action in the tested role matrix |
| CR26 ONBOARD | Role-specific onboarding checklist | Static PF, Begin onboarding | Create three Administrator or two Analyst subtasks on two named sources; replay adds zero |
| CR27 LAB | Hypothesis quality | AI validator, Start experiment | Check falsifiable claim, measurement and stopping rule |
| CR28 LAB | Experiment readout | Semantic PF, Conclude experiment | Write Experiment Conclusion retaining negative/inconclusive observations |
| CR29 RELQA | Coverage sanity ceiling | Numeric comparison validator, Ready for release | Coverage above 100 fails; 85 and 100 pass the complete gate |

CR06 runs on two designated source issues (six UPGRADE children); CR18 produces one SERVICE follow-up; CR26 produces five ONBOARD children. These 12 slots are included in the project totals. Other creation-capable paths remain scoped to these source IDs until an amended allocation is recorded. CR17 and CR29 are two separately counted saved comparisons, implementing the inclusive 85–100 range; the native required-field validator handles missing input.

Eleven separate workflows provide different lifecycle graphs: COGDEMO Submitted → Review → Changes requested/Decision recorded; LAUNCH Discovery → Delivery → Launch review → Approved → Released; UPGRADE Assessment → Rehearsal → Cutover authorised → Scheduled → Verification → Completed, with rollback/rework; ROLLOUT Planned → Pilot → Acceptance → Expansion → Handed over; SERVICE New → Investigation → Mitigation → Verification → Resolved, with reopen; RELQA Planned → Execution → Defect review → Release ready; CONNECT Draft → Contract validation → Integration test → Operating, with failure triage; DQ Detected → Classified → Remediation → Reconciled; SECREV Intake → Review → Remediation → Verified; ONBOARD Requested → Accepted → Setup → Readiness → Completed; LAB Proposed → Running → Analysis → Concluded/Stopped. Each named transition above must have a mapped edge and recovery path. Terminal states have explicit reopen paths where needed; creation does not invoke expensive AI.

Configure eight distinct business policy documents, six reusable code skills and eight manually verified instance facts in CogniRunner. Document counts do not include built-in content; confirm total capacity first. Preserve the current provider and prove one request before enabling AI rules. Do not reuse the org/Jira token as a model credential. Runtime memory injection and auto-capture remain off initially. Exercise export/import as a dry-run portability check and the Rules API with a separate app token; neither is counted as an extra runnable rule or a duplicate enabled instance.

All listeners use project/type/field/cohort filters, ignoreSelf and stable replay markers. The two agent configurations allow only get_issue and implicit finish, with search and every write/comment/notification action disabled. Their outputs are recommendations in the app execution results, not Jira field changes. Current allowedActions restricts action type but does not enforce exact destination issue/field parameters, so agent-driven writes are excluded from this baseline. Script jobs process at most 20 issues. The agent job starts with one coordination issue referencing five selected cases; five is its input example size, not a claimed hard cap on model-selected reads. Audit actual calls and the existing eight-round runtime limit. The real scheduler uses a five-minute tick, so cron is not an exact-minute guarantee. The setup runner records AI calls and token usage and pauses after 240 provider requests or 500,000 reported tokens, whichever comes first; two requests maximum per named AI acceptance attempt, concurrency one. These are proposed runner limits, not a claim of a universal built-in CogniRunner budget. Recurring jobs remain disabled after demonstration until the final enabled schedule inventory is verified.

AI validators fail open on provider/configuration errors in the current implementation: they are quality demonstrations, not guaranteed security controls. The listener AI gate fails closed. A semantic SKIP may report success, so validation requires the actual expected field update/comment/child/link rather than a green log entry. Preserve failures in the report. No source/deployment changes to alter these contracts are approved by this plan.

## LeanZero Management: three different planning stories

Create three curated plans with exact membership labels, initially LAUNCH 180, UPGRADE 150 and ROLLOUT 120. The larger project backlogs remain outside these plans until explicitly added; project-wide JQL would silently change the demonstration. Add native remaining estimates and realistic assignments to these 450 members, with documented unestimated exceptions.

| Plan | Distinct configuration and content | Acceptance |
| --- | --- | --- |
| Customer Workspace Launch | Existing Start date/native due date; Mon–Fri calendar; three launch milestones; one retained baseline; two saved alternatives (scope reduction and delayed dependency) | Baseline deltas, critical dependency chain and a bounded Apply independently match Jira |
| Platform Cutover | UPGRADE Cutover Start/Finish per-plan mapping; a dedicated seven-day cutover calendar; recovery buffer; three checkpoints; one baseline and two alternatives (extra rehearsal and shifted window) | Only mapped dates change; the window field stays separate; rollback scenario is visibly distinct |
| Regional Operations | Existing Start date/native due date; Mon–Thu working calendar representing the synthetic rollout team's availability; three wave milestones; one baseline and two alternatives (fewer regions and training delay) | Calendar affects the schedule; a fixed named scope survives reopen and scenario reload |

Use the capacity workspace across the three plans with three real assignable people, distinct personal capacity profiles and explicit leave. Verify native remaining effort and deduplication of any overlapping issue membership; do not infer workload from the custom Training Completion or schedule duration. Settings are personal in the current implementation, not a new organisation-wide capacity policy. Show Schedule Confidence with inspected duration assumptions and fixed target scopes. The target inventory is three plans, three calendars, three baselines, six scenario alternatives, nine milestones and one capacity workspace; these are configuration objects of different kinds, not an invented combined feature count.

## Sentinel Vault: three different document-control stories

LZSHOW remains the editable showcase and policy library (18 pages). DELIVERY contains delivery decisions and release/runbook evidence (18 new pages). CONTROLS contains risk reviews, access procedures and controlled evidence (24 new pages). Use per-space policy where supported; report any required site-wide setting separately within this demo site. Do not imply that every global toggle can vary per space.

Configure one workflow per space: LZSHOW uses a simple author/reviewer process, DELIVERY uses two named reviewers with all-approve mode, CONTROLS uses three named reviewers with minimum-two approval. Use actual available Confluence accounts; multi-user decisions and denied-edit tests require those authenticated actors. Do not impersonate them through the API. If only one account is available, those acceptance cases remain pending rather than being simulated as successful.

Target retained distribution across 60 pages: 18 Draft, 18 In Review and 24 Approved, with denial/resubmission history on six of them. No fabricated backdated approvals or “Expired” records. Demonstrate a short real expiry on a designated sample only if the supported duration allows it. Configure three space validation policies with distinct required headings/tables/labels; basic validation is post-save, not a pre-publish intercept.

Seal 18 of the 96 attachments and six named page sections; leave others editable. Demonstrate four edit-request journeys (approved, denied, cancelled, expired where a real clock permits), no-op saves, section-edit restoration, and sanctioned edits. Attachment protection and section protection have different enforcement paths and must each be tested. Produce read confirmations on six controlled pages with actual authenticated readers. Run six on-demand AI reviews: two complete, two incomplete, two misleading documents, preserving findings and false-positive handling. AI review is not a claim of legal compliance. Device-bound signatures remain outside the baseline unless a user enrols the necessary device through the real UI.

## Delivery sequence after approval

1. Capture current demo app/version/settings, field contexts and workflow/screen sharing; compare installed capabilities with this source-based design. Resolve login before app UI configuration. An unavailable capability is reported as a specific blocker; do not silently deploy a new app version.
2. Author a single versioned execution manifest containing project/field/option IDs, workflow edges, every rule predicate and effect, exact presenter issue IDs, reserved creation sources, expected results and hashes. Validate totals and scopes before any seed/configuration write.
3. Create seven projects and project-scoped fields/screens; enrich the 486 existing records and populate the approved issue/page/file inventory while listeners/jobs are disabled. Preserve existing edits through receipt comparison; never purge/reseed to manufacture success.
4. Configure each app through its supported UI/API. Attach/publish the 11 workflows only to the campaign projects. Populate knowledge and field mappings; run deterministic checks before the bounded AI demonstrations.
5. Prove all 29 CogniRunner configurations using real transitions/events/jobs, including refuse/skip paths and creation replay. Re-read exact affected Jira objects. Prove Management Apply on named issue/date sets and Sentinel enforcement with the appropriate users, page histories and downloaded hashes.
6. Review all business-facing content and settings in the live apps. Produce exact applied counts, enabled configuration inventory, screenshots, result matrix and outstanding limitations. Commit scripts/manifests/receipts without secrets. Leave pending approval-dependent or unverified features clearly identified.

## Capability evidence and confidence

Read-only source evidence: CogniRunner manifest.yml (conditions and scheduler), src/shared/premade-rules-catalog.js (validators/conditions), src/shared/sandbox-api-spec.js, src/shared/builtin-recipes.js, src/index.js (validator and semantic dispatch), src/listeners.js, src/scheduled-jobs.js, src/shared/agent-actions.js, src/shared/registry-limits.js and src/rules-api.js. The workflow registry has both row and byte limits; importing the proposed count is not automatic proof that it fits alongside existing rules.

Management: src/services/plan-fields.mjs confirms only start/due date overrides; duration/buffer fields are app-owned. src/services/capacity-fields.mjs and capacity-service.js establish native remaining effort and personal settings. src/services/scenario-variant.mjs and src/resolvers/{scenario,baseline}-resolvers.js establish saved calendar/scope/dependency alternatives and retained baselines.

Sentinel: src/server/capsules/workflow/{logic,approvals}.js establishes state graphs, any/all/min approvals, pinned review versions, review clocks and read confirmations. docs/features/{content-sealing,conditions-validations,semantic-ai-validations}.md and docs/settings-reference.md describe section restoration, post-save validation, AI review and setting inheritance. These documents are checked against current source; older “shipped” version statements are not used as demo deployment proof.

Confidence is high in this local capability mapping and the field/content design. Confidence is lower in installed-demo parity, authenticated multi-user paths and exact workflow-editor field support until the post-approval live checks. Approval of this plan authorises the described demo-only data and configuration work, not changes to other sites or app deployments.

## Pre-approval review outcome

Arithmetic checks passed for all 11 project rows, all 57 field definitions and 29 unique configuration IDs. Independent review identified that action allowlists cannot enforce an exact agent write target. CR10 and CR20 were revised to read-only recommendations, with no model-selected writes enabled. Numeric coverage uses two actual comparison instances plus a native presence gate; missing-field fail-open behaviour is not hidden. These corrections are part of this approval version.
