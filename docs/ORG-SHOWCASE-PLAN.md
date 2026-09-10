# Wolfaenpak organisation showcase plan

Status: planning, 10 September 2026. Bulk rollout paused at the owner's request to expand the original scope. This document is a proposed execution contract, not a claim that the large dataset or app configuration already exists.

## Scope and volume

Interpretation to confirm before the large run: **10–12 projects per included Jira site, with at least 10,000 issues total per site across those projects**, not 10,000 per project. Eight sites gives 80–96 showcase projects and at least 80,000 issues. Existing showcase projects count toward those totals. Existing unrelated projects and data remain intact.

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

Choose 10, 11 or 12 projects from a recorded random seed per site. Store the complete generated manifest before any writes: project names/keys, issue identities, expected fields, relationships and expected rule outcomes. Stable scenario IDs permit resumption without duplicates.

Each site has a different project mix and vocabulary. Use software delivery, operations, quality, support, research, integration and change-management stories appropriate to that site's theme. Start with company-managed projects for verified workflow attachment. Add other project types only after confirming their product entitlement and rule support.

Allocate uneven issue populations across projects, summing to 10,000–12,000 per site: some busy delivery projects, some focused maintenance projects. Include epics, stories/tasks, bugs and subtasks with valid hierarchy; coherent descriptions and acceptance criteria; priorities; available assignees; components; versions; dates; dependencies; and varied workflow states. Do not generate random gibberish or make every project a copy with a different prefix.

Suggested state distribution: 35% backlog/to do, 30% active, 15% review/blocked, 20% completed. These are targets subject to the actual workflow model. Produce status history through real transitions. Creation dates and old activity must not be falsely presented as historical records; where past business events matter, identify them as synthetic scenario context.

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

Use 3–4 workflow families with project-specific bindings rather than one enormous universal workflow. Examples: delivery/release, incident/defect, change approval, research/data quality. Attach rules to dedicated workflows and schemes owned by this campaign. Keep existing workflows untouched.

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
5. Build hierarchy and links after both endpoints exist. Populate background workflow states with controlled transitions. Deterministic rules can run broadly; tag a curated AI cohort and run it in measured batches. Do not accidentally invoke paid AI for all 80,000 issues.
6. Activate listeners/jobs gradually and run their real triggers. Current local listener brakes are 120 runs per listener and 30 per issue in five minutes; current job scope caps at 100 issues. Verify installed behaviour and pace within those limits. Never disable brakes to force a green load test.
7. Verify full data membership and selected fields against the manifest, then collect browser evidence and real CogniRunner execution outcomes. Retain useful demo data and a resumable, committed evidence summary.

Capture separate counts for attempted, created, readback-verified, rule-tested, rejected-as-expected, failed and pending. Treat HTTP 207/bulk partial success per item. A created project count or log count is not workflow acceptance. Stop advancing a site when an unexplained mismatch appears; preserve its receipts and continue only independent proven work.

Before raising AI traffic, measure token use, latency and error rate on the canary. Set explicit cohort and concurrency limits from that evidence. Large population and AI throughput are separate tests.

## Demo site: LeanZero Management

Reserve 2–3 of the demo site's projects for a coherent portfolio: a product launch, a platform upgrade and an operational rollout. Curate plans of approximately 100–300 issues each within the larger dataset. Include epics/tasks/subtasks, real start/due dates, assignees, releases and actual Jira Blocks dependencies. Include delayed chains, completed work, upcoming milestones and overdue tasks.

Discover and configure the demo site's actual Start date and Due date fields before indexing. Duration/buffer fields are optional and require explicit metadata support. Use the New plan flow, index it, wait for terminal progress, and verify exact membership, dates, hierarchy and dependency direction. Keep plan protection off during population so it cannot reverse intended Jira setup writes. Enable additional protection only after the intended final behaviour is tested.

Prove a real scheduling interaction, recalculate, then Apply a bounded owned change and reread Jira. Include Schedule Confidence only with enough coherent durations and dependencies to make its outputs meaningful. Add a separate large plan for measured scale testing only after the curated plans work; do not substitute a 10,000-row import for an understandable product demo.

## Demo site: Sentinel Vault

Create a dedicated Confluence showcase space containing 12–20 meaningful operating procedures, release approvals, recovery instructions and evidence documents. Add 1–3 real attachments to selected pages. Finish content before applying protection.

Use the installed Document Approval workflow to prepare Draft, In Review and Approved examples. Keep some pages editable and some approved/protected. Seal real attachments through the page-context app UI. Verify workflow state, approval history, attachment enumeration and seal records, then prove an allowed edit and a rejected/restored edit against campaign-owned examples.

Jira issue volume does not count as Sentinel data. Real pages, attachment bytes, workflow enforcement and visible product state are required.

## Current receipts and remaining work

The original small run created four owned projects: APEX, BEAC, FACT and COGDEMO, each with 12 issues, three components and one release. All 48 issues passed field readback and have no outstanding POST receipts. The orchestration process was stopped; no seed processes remain. These projects count toward the expanded plan and will be retained.

Committed seeder: `test-harness/scripts/org-demo-seed.mjs`. Local full receipts: `test-harness/results/org-showcase-20260910/`. These receipts describe data creation only: no workflow attachment, CogniRunner configuration, planning-app configuration or Sentinel protection has yet been claimed.

The most recent harness attempt reached Atlassian login, requiring the user's authentication. REST authentication works on every included site. The harness must prove a live authenticated app session before the app-configuration phase can be accepted.

References: Jira project API https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/ ; Confluence space API https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/ . Local implementation evidence: `src/index.js` settings/import/token resolvers, `src/rules-api.js`, `src/listeners.js`, `src/scheduled-jobs.js`, and the live harness target/fixture modules. Recheck production parity during the canary.
