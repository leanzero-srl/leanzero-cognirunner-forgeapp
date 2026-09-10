# Wolfaenpak organisation showcase plan

Status: planning, 10 September 2026. Bulk rollout paused at the owner's request to expand the original scope. This document is a proposed execution contract, not a claim that the large dataset or app configuration already exists.

## Scope and volume

Revised design: **10–12 projects per included Jira site, with 4,000–20,000 total campaign-owned issues per site across those projects**. The concrete seeded allocation is **90 projects and 80,988 issues across eight sites**. Existing showcase projects and their 48 issues count toward those totals; this means 86 additional projects and 80,940 additional issues, including workflow-created follow-ups. Existing unrelated projects and data remain intact and are outside these totals.

The machine-readable design is [`org-showcase-design.json`](org-showcase-design.json), explicitly marked `DESIGN_ONLY_NOT_APPLIED`. It records every proposed project key/name, exact issue allocation, workflow family, state mix and demo subset. Project keys remain proposed until the execution preflight checks availability; an unrelated collision must be resolved in the manifest before creating anything.

| Site | Projects | Total issues | Project populations |
| --- | ---: | ---: | --- |
| Apex Core Systems | 12 | 17,024 | 232–4,815 |
| Beacon Logistics | 10 | 4,200 | 208–872 |
| Factory Liberation | 12 | 5,985 | 247–906 |
| Krypton Cybersec | 10 | 6,099 | 184–1,539 |
| Solace AI Labs | 12 | 10,688 | 257–1,448 |
| Strata Data Labs | 11 | 20,000 | 350–4,189 |
| Wolfaenpak | 12 | 12,849 | 464–2,869 |
| LeanZero Apps Demo | 11 | 4,143 | 207–585 |

These counts are deliberately uneven: project counts, population weights and status mixes use the recorded seed `wolfaenpak-showcase-design-v2`. Beacon and Strata deliberately anchor a lower-load example and the maximum requested volume. The demo site favours an understandable curated presentation while still exceeding 4,000 issues.

Configuration counting: every project gets one separately named published workflow derived from one of the four families, containing 13 attached CogniRunner rule instances: four premade validators, one AI validator, seven static post-functions and one semantic post-function. Add one project-scoped listener and one project-scoped scheduled job, giving 15 runnable configurations per project. Organisation totals are 90 workflows, 1,170 attached rules, 90 listeners and 90 jobs: 1,350 runnable configurations. Four custom policy documents and four custom skills per site, plus its provider/settings profile, are separate supporting setup and are not included in that total.

The 13 rules are explicit: creation routing (one static rule); Prepare work (description validator plus static marker); Begin execution (owner validator plus static marker); Record manual review (evidence validator plus static marker); Complete reviewed work (evidence validator plus static marker); Reopen (one static rule); AI evidence review (one AI validator); summary publication (one semantic post-function); Escalate (one static post-function). The first-state initialisation fallback replaces creation routing, never adds a fourteenth rule. Any production capability gap that changes these counts must be reflected in the manifest before execution.

The organisation API returned nine Jira sites, with pagination exhausted. Exact allowlist:

| Site | Content direction | Apps in scope |
| --- | --- | --- |
| apex-coresystems.atlassian.net | Platform services, reliability, infrastructure, releases | CogniRunner |
| beacon-logistics.atlassian.net | Shipment visibility, warehouse operations, partner integrations | CogniRunner |
| factory-liberation.atlassian.net | Manufacturing, quality, maintenance, supply chain | CogniRunner |
| krypton-cybersec.atlassian.net | Vulnerability response, security engineering, access reviews | CogniRunner |
| solace-ai-labs.atlassian.net | Research delivery, evaluations, datasets, deployment | CogniRunner |
| strata-datalabs.atlassian.net | Data platforms, pipelines, analytics, quality | CogniRunner |
| wolfaenpak.atlassian.net | Workflow engineering, change control, automation operations | CogniRunner |
| leanzero-apps-demo.atlassian.net | Curated product showcase plus realistic background workload | CogniRunner, LeanZero Management, Sentinel Vault |

Explicit exclusion: **leanzero.atlassian.net**, Jira and Confluence. Other sites visible in Forge installation listings are outside the organisation inventory and are not targets. Never use substring exclusions: `leanzero-apps-demo` is included.

All eight allowed sites passed authenticated Jira identity and administrator/project-creation checks. CogniRunner production installations exist on all eight. LeanZero Management and Sentinel Vault production installations exist on the demo site. Installation presence is not functional proof or proof of parity with the local checkout.

## Data design

The allocation manifest chooses 10, 11 or 12 projects using a recorded random seed per site. Before execution, expand it into a complete issue manifest: stable scenario IDs, expected fields, relationships and expected rule outcomes. The allocation JSON is not yet that per-issue manifest. Stable scenario IDs permit resumption without duplicates.

Each site has a different project mix and vocabulary. Use software delivery, operations, quality, support, research, integration and change-management stories appropriate to that site's theme. Start with company-managed projects for verified workflow attachment. Add other project types only after confirming their product entitlement and rule support.

Use the exact uneven allocations in the JSON: some busy delivery projects, some focused maintenance projects. Include epics, stories/tasks, bugs and subtasks with valid hierarchy; coherent descriptions and acceptance criteria; priorities; available assignees; components; versions; dates; dependencies; and varied workflow states. Do not generate random gibberish or make every project a copy with a different prefix. Suggested issue-type mix is 2% epics, 40% stories, 35% tasks, 15% bugs and 8% subtasks; distribute rounding remainders deterministically and adapt only to verified type availability.

Each project has its own recorded percentage mix for queued, active, review and finished work, translated to that workflow's actual states. Produce status history through real transitions. Creation dates and old activity must not be falsely presented as historical records; where past business events matter, identify them as synthetic scenario context.

Every project reserves four issue slots for real follow-ups created by CogniRunner; these are included in the final total, not extra issues added after hitting 20,000. Its primary population includes any existing campaign issues and twelve named AI scenarios: four rejected evidence examples, four accepted evidence examples and four semantic-summary examples. Across 90 projects this is 1,080 AI scenario issues and 360 follow-up slots. Retries and multi-call model behaviour mean scenario count is not a guaranteed API call or token total.

Validate users, types, fields and allowed values on each site. Do not create fake user accounts, copy field IDs across sites, replace existing schemes, or assume an empty search means a project is absent. Where the platform cannot represent an intended value, record the limitation rather than silently omit it.

## Workflows that actually run CogniRunner

Every new showcase project must use a published workflow containing real CogniRunner rules. A configuration file, a registry row, or an issue label alone does not satisfy this requirement. Verify both Jira attachment and CogniRunner's saved configuration.

| Transition | Actual CogniRunner behaviour | Independent proof |
| --- | --- | --- |
| Start work | Premade validator requires description/assignee or another supported essential field | Invalid issue stays in its prior state; corrected issue advances |
| Submit for review | AI validator checks meaningful acceptance criteria and test evidence | Semantically incomplete example is blocked; complete example advances; explanation is visible |
| Route or triage | Static post-function adds the appropriate classification label/component | Jira reread shows the expected field delta on the original issue |
| Escalate | Static post-function creates and links one bounded follow-up | Child/follow-up exists with correct source link; replay creates no duplicate |
| Approve or close | Semantic post-function writes a concise delivery summary to a supported field or comment | Saved output matches the source facts, appears on the exact issue and has an execution receipt |
| Reopen | Static post-function updates routing/review markers | Issue returns to the intended state with the expected marker changes |

Use the four workflow families assigned in the JSON: delivery/release, incident/defect, change approval and research/data quality. Each family defines its state vocabulary and five effects, with site/project-specific bindings. Attach rules to dedicated workflows and schemes owned by this campaign. Preserve unrelated existing workflows. Reuse the four owned small showcase projects and retain their data; a recorded scheme reassignment to the new campaign workflow is part of their setup, not a reason to delete/recreate them.

The JSON now defines source/destination states for every normal and scenario transition, plus exact integer final-state counts per project. Normal routes perform recorded manual review with deterministic validation; named AI review actions are alternate evidence-review routes. Summary publication and escalation are explicit self-loop actions. AI actions are exercised only on the declared scenario identities. Do not temporarily remove rules, fake execution receipts, or claim that an issue ran AI merely because it reached Done. For each owned issue type, attach a safe routing effect to creation and verify actual invocation. If create-event payload semantics prevent a reliable effect, use an explicit initialisation self-loop on the first state for every issue and record that choice.

The JSON specifies four exact follow-up source scenario IDs per project, their expected target identities, and zero new issues on replay. It also specifies twelve AI scenario identities per project and separate population/scenario transition routes. Cohort restrictions are enforced by the campaign executor; any additional app-side eligibility guard must be supported and live verified before it is claimed. Scenario identities are allocation slots until expanded into actual Jira IDs, not existing records.

Use `api.context.issueKey` and verified supported sandbox methods. Follow-up creation requires durable per-source idempotency and a reconciliation check before replay; a rule that only calls createIssue unconditionally is not acceptable. Preserve unrelated labels/fields. Failed asynchronous effects remain failures even when Jira already completed the transition.

Conditions need a browser proof because Jira REST transitions can bypass UI-only conditions. Validators need both passing and failing real transitions. Post-functions need an independent target reread after asynchronous completion. A dry-run test is a prerequisite, never the final acceptance evidence.

Enable related new-bug listeners and readiness jobs only after the initial import and canary proof. Listener filters and job JQL target campaign projects and explicit scenario markers. Use self-trigger prevention, repeat-safe writes, bounded issue scopes and notification suppression where supported.

## CogniRunner settings and knowledge

Read each installation before writing. Preserve existing provider/key settings. For unconfigured installations, use the supported Atlassian Forge LLM option where available; verify the installed version and an actual AI request. An organisation key, Jira API token, provider API key and CogniRunner Rules API token are four different credentials.

Add site-specific release-readiness documentation, a matching reusable skill, and examples explaining accepted/rejected input. Enable knowledge injection; keep automatic memory capture and per-transition memory injection off initially until their effect and usage are measured. Avoid duplicating seeded builtins or documents on reruns.

Use the app UI for provider/settings, knowledge, workflow import and installation API token management. The Rules REST API can then provision supported listeners/jobs and read their logs. Do not expose a production test hook, write raw KVS, or redeploy the app simply to make provisioning possible. Store any requested installation credentials in gitignored local secret storage, never in manifests, logs or receipts. Do not mint unused keys for demonstration.

## Scale execution and controls

1. Finish the read-only per-site baseline and recover the live harness browser login. Export existing settings and workflow assignments relevant to owned work before changing them.
2. Generate and review the deterministic dataset manifest, workflow mappings and rules pack. Include a secret-free exact target inventory and expected totals.
3. Use the existing small showcase projects as canaries. Fully prove every workflow family and effect against real Jira transitions before multiplying projects or issues.
4. Create the remaining projects, schemes and metadata. Import issues in supported bounded batches with rate-limit handling, exact per-item receipts and restart checkpoints. On uncertain POST completion, reconcile; do not blindly retry.
5. Build hierarchy and links after both endpoints exist. Populate background workflow states with controlled transitions. Deterministic rules run on the intended issue population; execute the 1,080 curated AI scenarios in measured batches. Do not accidentally invoke paid AI for the entire 80,988-issue population.
6. Activate listeners/jobs gradually and run their real triggers. Current local listener brakes are 120 runs per listener and 30 per issue in five minutes; current job scope caps at 100 issues. Verify installed behaviour and pace within those limits. Never disable brakes to force a green load test.
7. Verify full data membership and selected fields against the manifest, then collect browser evidence and real CogniRunner execution outcomes. Retain useful demo data and a resumable, committed evidence summary.

Capture separate counts for attempted, created, readback-verified, rule-tested, rejected-as-expected, failed and pending. Treat HTTP 207/bulk partial success per item. A created project count or log count is not workflow acceptance. Stop advancing a site when an unexplained mismatch appears; preserve its receipts and continue only independent proven work. Read every created issue's expected fields and relationships against the issue manifest; compare exact ID sets, not just search counts. For the deterministic population also compare expected field deltas. For every project collect real pass/fail validator proofs, all four follow-up identities and replay checks, and the semantic summaries. Save time-stamped browser evidence for each workflow family on each site and all three demo apps.

Before raising AI traffic, measure token use, latency and error rate on twelve canary transitions and record the projected cost plus an execution budget. Start with one concurrent AI transition across one site. Allow twelve initial AI transition attempts and at most four diagnostic attempts per project, with automatic retries disabled: 1,440 total transition attempts is the campaign ceiling. This is not a provider-call ceiling because one transition can involve multiple calls. If usage cannot be measured, pause AI scale-up while continuing proven deterministic work. Large population and AI throughput are separate tests.

## Demo site: LeanZero Management

Reserve three of the demo site's projects for a coherent portfolio: COGDEMO2 Product Launch (306 total issues, 180 in the curated plan), COGDEMO3 Platform Upgrade (351 total, 150 curated) and COGDEMO4 Operational Rollout (585 total, 120 curated). The JSON gives an exact membership label and JQL for each plan, and requires an ID list of that exact size including parents and dependency endpoints. These plan members are subsets of the same Jira issues, not extra records. Include epics/tasks/subtasks, real start/due dates, assignees, releases and actual Jira Blocks dependencies. Include delayed chains, completed work, upcoming milestones and overdue tasks.

Discover and configure the demo site's actual Start date and Due date fields before indexing. Duration/buffer fields are optional and require explicit metadata support. Use the New plan flow, index it, wait for terminal progress, and verify exact membership, dates, hierarchy and dependency direction. Keep plan protection off during population so it cannot reverse intended Jira setup writes. Enable additional protection only after the intended final behaviour is tested.

Prove a real scheduling interaction, recalculate, then Apply a bounded owned change and reread Jira. Include Schedule Confidence only with enough coherent durations and dependencies to make its outputs meaningful. Add a separate large plan for measured scale testing only after the curated plans work; do not substitute a 10,000-row import for an understandable product demo.

## Demo site: Sentinel Vault

Create the proposed LZSHOW Confluence space with 18 meaningful operating procedures, release approvals, recovery instructions and evidence documents, and 24 real attachments. The final presentation contains six Draft, six In Review and six Approved pages, with eight sealed attachments. These are separate from the Jira issue totals. Validate the space key before creation and finish content before applying protection.

Use the installed Document Approval workflow to prepare Draft, In Review and Approved examples. Keep some pages editable and some approved/protected. Seal real attachments through the page-context app UI. Verify workflow state, approval history, attachment enumeration and seal records, then prove an allowed edit and a rejected/restored edit against campaign-owned examples.

Jira issue volume does not count as Sentinel data. Real pages, attachment bytes, workflow enforcement and visible product state are required.

## Current receipts and remaining work

The original small run created four owned projects: APEX, BEAC, FACT and COGDEMO, each with 12 issues, three components and one release. All 48 issues passed field readback and have no outstanding POST receipts. The orchestration process was stopped; no seed processes remain. These projects count toward the expanded plan and will be retained.

Committed seeder: `test-harness/scripts/org-demo-seed.mjs`. Local full receipts: `test-harness/results/org-showcase-20260910/`. These receipts describe data creation only: no workflow attachment, CogniRunner configuration, planning-app configuration or Sentinel protection has yet been claimed.

The most recent harness attempt reached Atlassian login, requiring the user's authentication. REST authentication works on every included site. The harness must prove a live authenticated app session before the app-configuration phase can be accepted.

References: Jira project API https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/ ; Confluence space API https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/ . Local implementation evidence: `src/index.js` settings/import/token resolvers, `src/rules-api.js`, `src/listeners.js`, `src/scheduled-jobs.js`, and the live harness target/fixture modules. Recheck production parity during the canary.
