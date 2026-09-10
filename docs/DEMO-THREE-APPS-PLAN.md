# LeanZero Apps Demo — connected content and app setup

Target: **https://leanzero-apps-demo.atlassian.net only**. This content expansion does not authorise or start changes on any other site. In particular, https://leanzero.atlassian.net remains excluded. The broader organisation design remains a separate, unapplied plan.

## Content created and verified in this pass

| Area | Persistent content | Purpose |
| --- | --- | --- |
| LAUNCH — Product Launch | 180 issues, including six epics and 42 subtasks | Customer journey, delivery readiness and schedule-impact demonstrations |
| UPGRADE — Platform Upgrade | 150 issues, including six epics and 36 subtasks | Platform compatibility, migration, cutover and recovery demonstrations |
| ROLLOUT — Operational Rollout | 120 issues, including six epics and 24 subtasks | Pilot, training, service readiness and operational-control demonstrations |
| Existing COGDEMO — CogniRunner Workflow Showcase | 24 additional scenarios, extending the initial 12 to 36 | Complete/incomplete evidence, routing, escalation, summaries, replay and scheduled-check input |
| LZSHOW — LeanZero Product Showcase | 18 authored pages under three app-specific hubs, with 24 downloadable text evidence files | Business context, review policies and real content for approval/attachment protection |

This pass added and independently verified 474 Jira issues, bringing campaign content on this site to 486 issues across four projects including the initial 12 COGDEMO issues. These are curated subsets of the proposed 4,143-issue, 11-project demo site, not a claim that the full bulk design has been populated. The three portfolio projects added 18 components, nine releases and 72 Blocks links. Existing KAN content is outside the campaign and preserved.

LAUNCH, UPGRADE and ROLLOUT have meaningful owners drawn from the site's actual assignable users, priorities, descriptions, start/due dates, parent relationships, components, releases and varied workflow states. Status diversity comes from real Jira transitions. Overlapping dependency dates intentionally provide a schedule-adjustment scenario; the imported schedule is not claimed to be conflict-free.

COGDEMO is retained under its current live key during this content pass. COG remains its proposed later key. The old and new identities must be reconciled by project ID if that rename is executed; do not recreate its issues.

## One connected demonstration

The launch team depends on platform compatibility and operational readiness. LeanZero Management explains the schedule and the dependency consequences. CogniRunner evaluates the issue's review evidence and performs bounded workflow effects. Sentinel Vault controls the evidence document and attachment considered in the approval decision.

A presenter should be able to follow a selected Jira issue into its programme plan and accompanying Confluence document, see its evidence checked by the workflow, and inspect the protected evidence record. All records are synthetic. No page or issue description is presented as proof that an app action happened.

## LeanZero Management setup plan

Create three plans through the installed app's New plan flow after configuring this site's actual date fields. Start date was discovered as customfield_10015; verify it again when configuring. Due date is the native duedate field. Do not copy the field map from Wolfaenpak or create fields merely to match that site's setup.

| Plan | Source JQL | Exact initial membership |
| --- | --- | ---: |
| Product Launch | project = LAUNCH AND labels = lz-showcase-launch ORDER BY Rank ASC | 180 |
| Platform Upgrade | project = UPGRADE AND labels = lz-showcase-upgrade ORDER BY Rank ASC | 150 |
| Operational Rollout | project = ROLLOUT AND labels = lz-showcase-rollout ORDER BY Rank ASC | 120 |

Index each plan and verify its exact issue IDs, dates, ownership, hierarchy and dependency direction. Keep protection off while content is being populated. The product demonstration includes a Gantt dependency chain, a bounded drag/date change, recalculation, the exact changed set and Apply followed by a Jira reread. Capture the original values so the chosen demonstration can be repeated or restored deliberately.

Use the portfolio review document when explaining forecast uncertainty. Only demonstrate Schedule Confidence after the duration/dependency inputs have been inspected and the displayed results are understood. A broad task-date range is not by itself proof of influence on the programme finish.

## CogniRunner setup plan

Use the 36 explicit workflow examples plus the portfolio's richer issue descriptions. Import the review, routing, escalation and summary policies into CogniRunner's knowledge library as four distinct documents, with matching reusable skills. The Confluence copies provide presentation context; they do not automatically populate the app's knowledge store.

Read provider and knowledge settings first. Preserve a configured provider; otherwise verify the installed Atlassian Forge LLM option and one real request. The org token and Jira token are not provider credentials. Keep memory auto-capture and per-transition memory injection off initially until their benefit and usage are measured.

For this four-project content layer, plan four project-specific published workflows derived from the existing delivery, incident and change families. Each carries the documented 13 rules, plus one scoped listener and one scheduled job per project: 52 workflow rules and eight non-workflow configurations, 60 runnable configurations in total. The later 11-project design remains 165 runnable configurations; do not count these 60 twice.

Every rule needs a real transition proof on the actual source issue. The validator examples must include an accepted case and a refusal that leaves status unchanged. Classification must preserve unrelated labels. Escalation must create one linked follow-up and produce zero new issues on replay. Semantic summaries must retain known limitations and avoid inventing results. Reopening must change the intended state and marker. Scheduled checks must distinguish overdue unfinished work, completed work and records outside the cohort.

The 24 added scenarios include expected behaviours in their descriptions. Their current issue state is content preparation, not a completed test. Before the scheduled-job acceptance run, place the designated completed example in Done and assign the readiness cohort labels explicitly; verify these prerequisites before interpreting the job result.

## Sentinel Vault setup plan

Use the 18 real LZSHOW pages and 24 real evidence files. The library has a Management hub and five supporting documents, a CogniRunner hub and five policies, and a Sentinel Vault hub and five controlled-document examples.

Finish content before enabling approval enforcement. Configure the installed Document Approval workflow for this space with automatic assignment of new pages off during setup. Explicitly prepare six Draft, six In Review and six Approved examples. Record the selected page IDs, current workflow state and approval history; page text or Confluence's current/draft storage status does not substitute for Sentinel's workflow state.

Seal eight selected attachments through their page-context Sentinel controls, leaving the remainder editable. Verify the exact attachment ID, original byte hash, seal metadata and lock duration. Show an allowed edit on an unprotected example and a rejected or restored edit on a controlled one. Inspect the resulting content and history, rather than treating a notification as enforcement proof.

The recovery, release-evidence and change-record documents connect the library to LAUNCH, UPGRADE and ROLLOUT. Keep one changes-requested/resubmission example and one pending review available for the presenter after the verification run. No unsolicited messages, external invitations or organisation-level permission changes are part of this setup.

## Verification and actual progress

Content acceptance requires every new Jira issue's fields and hierarchy to match its receipt, every Blocks link to match its expected direction, every Confluence page's complete authored structure and parent to match its catalog, and every attachment's downloaded bytes to match its generated source hash. Verification is rerun separately without content writes.

The Jira portfolio evidence is recorded in [demo-portfolio-receipt.md](demo-portfolio-receipt.md). Its separate verification completed at 2026-09-10T13:00:57.127Z with 1,076 GET requests and zero mutation requests, matching all 450 issues and 72 directed links. The Confluence/CogniRunner-content evidence is recorded in [demo-content-receipt.md](demo-content-receipt.md); its separate verification completed at 2026-09-10T12:46:47.623Z, matching all 18 pages, 24 downloaded attachment hashes and 24 new tasks. Full local receipts remain in the gitignored test-harness/results/demo-portfolio-v1 and test-harness/results/demo-three-apps-content directories. No secrets are committed.

The harness browser currently reaches Atlassian account login. REST access works, so content creation and independent REST checks can continue. App plan creation, workflow attachment, provider settings, approval and sealing remain pending until an authenticated app session is available and their real user paths have passed. No app deployment or manifest change is required by this content plan.

## Seeder review findings

The content seeder's pre-apply review found that comparing only paragraph text could overwrite manually added formatting or links during an attachment-link append. The guard now compares the complete ADF structure, tolerating only node-local Confluence IDs, and preserves any other edit. Live canary discovery also showed that attachment download links beginning with /rest are relative to Confluence's /wiki context; the downloader now resolves that context before comparing the downloaded bytes. Neither issue required a change to an app's production code.
