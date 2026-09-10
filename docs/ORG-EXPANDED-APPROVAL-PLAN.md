# Wolfaenpak organisation — expanded approval plan

Status: APPROVED by the user's “let's start please let's do it” on 10 September 2026. Execution and verification receipts are tracked separately; approval does not mean the planned objects already exist. No tenant mutations were made while preparing this revision.

This is the controlling revision for the eight included sites. It supersedes the older uniform org allocation and the subsequently narrowed demo-only configuration proposal. **leanzero.atlassian.net remains excluded.** Existing unrelated projects, including KAN and Wolfaenpak test beds, remain outside the campaign. CogniRunner is in scope on all eight sites; additional LeanZero Management and Sentinel Vault setup applies only to leanzero-apps-demo.

## Proposed scale

**90 projects, 80,988 campaign issues, 544 workflows, 1,084 new project-scoped custom fields and 3,300 CogniRunner saved configurations.** This replaces the prior 90-workflow/1,350-configuration organisation design, and the 11-workflow/29-configuration demo revision.

Issue-type catalogues contain 19–25 types per site: the five standard types plus 138 proposed custom definitions across eight sites, including two specialised subtask types per site. The summed catalogue total is 178 site-local type entries; it is not 178 globally different semantic names. Reuse an existing exact compatible type rather than duplicate it.

| Instance | Projects | Final issues | Types in site catalogue | New custom fields | Workflows | Workflow rules | Listeners | Jobs | All CR configurations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| apex-coresystems.atlassian.net | 12 | 17,024 | 20 | 151 | 71 | 370 | 34 | 25 | 429 |
| beacon-logistics.atlassian.net | 10 | 4,200 | 19 | 122 | 59 | 310 | 27 | 22 | 359 |
| factory-liberation.atlassian.net | 12 | 5,985 | 22 | 137 | 74 | 382 | 42 | 27 | 451 |
| krypton-cybersec.atlassian.net | 10 | 6,099 | 23 | 123 | 66 | 349 | 30 | 17 | 396 |
| solace-ai-labs.atlassian.net | 12 | 10,688 | 24 | 149 | 76 | 395 | 38 | 25 | 458 |
| strata-datalabs.atlassian.net | 11 | 20,000 | 21 | 128 | 61 | 310 | 37 | 25 | 372 |
| wolfaenpak.atlassian.net | 12 | 12,849 | 25 | 147 | 70 | 361 | 38 | 30 | 429 |
| leanzero-apps-demo.atlassian.net | 11 | 4,143 | 24 | 127 | 67 | 348 | 36 | 22 | 406 |
| Total | 90 | 80,988 | 178 | 1,084 | 544 | 2,825 | 282 | 193 | 3,300 |

Counts mean separately saved workflow/rule instances. The 3,300 bindings use **34 supported behaviour archetypes** and 15 different lifecycle families; they are not 3,300 distinct algorithms. Field-presence prerequisites are separately counted. Listeners and jobs are counted once even when using agent mode. Knowledge docs, skills, memories, tokens and native Jira schemes are separate supporting objects.

Each project receives its own workflow scheme, issue-type scheme and issue-type screen scheme. Types map explicitly to 5–7 workflows rather than every issue sharing one generic process. Custom types use ordinary or subtask hierarchy levels; no premium hierarchy or JSM portal/Assets capability is assumed. Issue and project counts describe campaign content, not a limit on unrelated pre-existing site content.

## Inventory and preservation

The organisation inventory captured earlier today contained nine Jira sites. A fresh authenticated read of project inventories on all eight allowed hosts succeeded during this revision. Existing campaign content comprises APEX 12, BEAC 12, FACT 12, and demo COGDEMO 36, LAUNCH 180, UPGRADE 150, ROLLOUT 120: **522 issues in seven existing projects**. Hence 83 projects remain new, and 80,466 issue slots remain: 80,175 seed-created records plus 291 deliberately reserved for live CogniRunner creation effects.

COGDEMO keeps its live key. No project rename is included. Existing standard issue-type populations are allocation floors, preserving the 102 demo portfolio subtasks rather than converting them into unrelated standard issues to fit a prettier distribution. Existing IDs, hierarchy, evidence and unrelated edits remain intact. Full membership and before/after field maps will be recorded before enrichment.

## Each instance and each project

The tables below give the project-specific allocation. “Types” is the number actually assigned in that project. The JSON manifest contains every type-to-workflow mapping, exact per-type and per-workflow-state population, every field name/type/options, all 3,300 named rule bindings, transition placement, positive/negative/replay fixture identities and reserved creation slots. IDs are symbolic until the approved live preflight resolves actual Jira IDs.

### apex-coresystems.atlassian.net

Platform engineering. API compatibility exceptions, identity ownership reviews, failed deployment rollbacks and inaccurate billing adjustments. Evidence includes request/response contracts, reconciliation results and recovery checkpoints.

Domain types: Verification Step, Recovery Step, Platform Change, Compatibility Review, Service Interruption, Reliability Problem, Release Candidate, Access Review, Control Evidence, Platform Risk, Technical Spike, Maintenance Window, API Contract, Migration Batch, Acceptance Check.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| APEX — Apex Platform Delivery | 432 | 12 | 14 | 7 | 38 | change, evidence, migration, release |
| GATE — API Gateway | 1225 | 10 | 13 | 6 | 33 | release, maintenance, incident |
| IAM — Identity Services | 281 | 11 | 12 | 7 | 47 | risk, quality, access, contract |
| CLOUD — Cloud Foundations | 1510 | 10 | 14 | 6 | 35 | contract, problem, experiment |
| DEVPORT — Developer Portal | 2390 | 11 | 13 | 6 | 36 | change, evidence, migration |
| SRE — Service Reliability | 357 | 11 | 12 | 7 | 44 | release, maintenance, incident, risk |
| BILL — Billing Engine | 4815 | 9 | 13 | 5 | 34 | risk, quality |
| INTHUB — Integration Hub | 1317 | 9 | 14 | 5 | 30 | contract, problem |
| EDGE — Edge Services | 2225 | 10 | 11 | 5 | 29 | change, evidence |
| RELENG — Release Engineering | 232 | 11 | 13 | 7 | 43 | release, maintenance, incident, risk |
| OBS — Observability | 438 | 9 | 12 | 5 | 32 | risk, quality |
| PSEC — Platform Security | 1802 | 9 | 10 | 5 | 28 | contract, problem |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### beacon-logistics.atlassian.net

Logistics operations. Cold-chain excursions, depot handover failures, customs holds, duplicate carrier events and recurring missed delivery windows. Shipment references, temperature evidence and actual recovery actions distinguish cases.

Domain types: Verification Step, Recovery Step, Route Change, Shipment Exception, Recurring Delay, Carrier Release, Depot Access Review, Customs Evidence, Delivery Risk, Routing Trial, Fleet Service, Carrier Contract, Warehouse Transfer, Inspection Finding.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| BEAC — Beacon Logistics Delivery | 872 | 9 | 14 | 5 | 33 | incident, risk |
| TRACK — Shipment Tracking | 534 | 9 | 11 | 5 | 29 | access, contract |
| WHOPS — Warehouse Operations | 209 | 10 | 11 | 6 | 36 | experiment, change, evidence |
| CARRIER — Carrier Integrations | 436 | 11 | 11 | 7 | 40 | migration, release, maintenance, incident |
| ROUTE — Route Planning | 212 | 11 | 14 | 7 | 46 | incident, risk, quality, access |
| FLEET — Fleet Maintenance | 427 | 10 | 14 | 6 | 35 | access, contract, problem |
| CUSTOPS — Customer Operations | 208 | 10 | 12 | 6 | 35 | experiment, change, evidence |
| CUSTOMS — Customs Compliance | 464 | 11 | 10 | 7 | 39 | migration, release, maintenance, incident |
| EXCEPT — Delivery Exceptions | 333 | 9 | 12 | 5 | 35 | incident, risk |
| DEMAND — Demand Forecasting | 505 | 9 | 13 | 5 | 31 | access, contract |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### factory-liberation.atlassian.net

Manufacturing operations. Batch nonconformances, calibration drift, line stoppages, supplier containment, packaging defects and traceability gaps. Material lots, measurements and verification records support the decisions.

Domain types: Verification Step, Recovery Step, Process Change, Line Interruption, Root Cause Investigation, Calibration Request, Production Release, Operator Access Review, Traceability Record, Containment Action, Safety Risk, Process Trial, Maintenance Order, Tooling Change, Supplier Agreement, Stock Migration, Nonconformance.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| FACT — Factory Operations Delivery | 247 | 13 | 13 | 7 | 41 | problem, experiment, change, evidence |
| PROD — Production Planning | 663 | 10 | 14 | 5 | 29 | evidence, migration |
| QA — Quality Assurance | 445 | 11 | 11 | 6 | 39 | maintenance, incident, risk |
| EQUIP — Equipment Maintenance | 692 | 9 | 10 | 5 | 32 | quality, access |
| SUPPLY — Supplier Integration | 533 | 13 | 11 | 7 | 41 | problem, experiment, change, evidence |
| STOCK — Inventory Control | 906 | 11 | 12 | 6 | 35 | evidence, migration, release |
| SAFETY — Safety Improvements | 426 | 11 | 10 | 6 | 38 | maintenance, incident, risk |
| FLOOR — Shop Floor Systems | 289 | 10 | 11 | 6 | 39 | quality, access, contract |
| ENERGY — Energy Monitoring | 575 | 11 | 13 | 6 | 36 | problem, experiment, change |
| PENG — Product Engineering | 414 | 13 | 10 | 7 | 42 | evidence, migration, release, maintenance |
| PACK — Packaging Automation | 318 | 11 | 12 | 6 | 37 | maintenance, incident, risk |
| TRACE — Traceability | 477 | 12 | 10 | 7 | 42 | quality, access, contract, problem |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### krypton-cybersec.atlassian.net

Security engineering. Unverified mitigations, permission-boundary failures, stale entitlement reviews, detection gaps and evidence exceptions. Distinguish future remediation promises from implemented controls without treating AI as a security guarantee.

Domain types: Verification Step, Recovery Step, Security Change, Detection Gap, Security Incident, Threat Investigation, Detection Release, Threat Hunt, Entitlement Review, Audit Evidence, Risk Acceptance, Exception Request, Detection Experiment, Hardening Task, Control Contract, Exposure Assessment, Credential Rotation, Mitigation Verification.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| SEC — Security Delivery | 362 | 11 | 14 | 6 | 37 | release, maintenance, incident |
| VULN — Vulnerability Response | 644 | 10 | 10 | 5 | 32 | risk, quality |
| THREAT — Threat Detection | 916 | 11 | 13 | 6 | 34 | contract, problem, experiment |
| RECOVER — Incident Recovery | 310 | 13 | 13 | 7 | 38 | change, evidence, migration, release |
| IDASSURE — Identity Assurance | 340 | 13 | 12 | 7 | 44 | release, maintenance, incident, risk |
| APPSEC — Application Security | 1539 | 13 | 14 | 7 | 45 | risk, quality, access, contract |
| POSTURE — Cloud Posture | 541 | 13 | 11 | 7 | 39 | contract, problem, experiment, change |
| SECR — Security Research | 184 | 13 | 11 | 7 | 39 | change, evidence, migration, release |
| EVIDENCE — Compliance Evidence | 913 | 13 | 11 | 7 | 43 | release, maintenance, incident, risk |
| ENDPOINT — Endpoint Defence | 350 | 13 | 14 | 7 | 45 | risk, quality, access, contract |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### solace-ai-labs.atlassian.net

AI research and delivery. Negative and inconclusive experiments, evaluation-slice regressions, annotation disagreements, reproducibility gaps and resource contention. Include datasets, metrics, hypotheses and stopping rules; no invented claims about model capability.

Domain types: Verification Step, Recovery Step, Model Change, Inference Incident, Replication Study, Evaluation Investigation, Model Release, Dataset Access Review, Ablation Study, Compute Allocation, Reproducibility Record, Model Risk, Research Experiment, Benchmark Run, Compute Maintenance, Evaluation Contract, Dataset Migration, Dataset Proposal, Annotation Finding.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| RESEARCH — Research Delivery | 1448 | 12 | 10 | 6 | 35 | access, contract, problem |
| EVAL — Evaluation Platform | 1381 | 13 | 13 | 7 | 41 | experiment, change, evidence, migration |
| DATASET — Dataset Curation | 1052 | 13 | 11 | 7 | 40 | migration, release, maintenance, incident |
| INFER — Inference Services | 1313 | 11 | 13 | 6 | 40 | incident, risk, quality |
| EXPERIMENT — Experiment Tracking | 816 | 14 | 14 | 7 | 43 | access, contract, problem, experiment |
| AIEVAL — Safety Evaluation | 1053 | 13 | 14 | 7 | 40 | experiment, change, evidence, migration |
| RINFRA — Research Infrastructure | 357 | 13 | 10 | 7 | 40 | migration, release, maintenance, incident |
| ANNOTATE — Annotation Operations | 1282 | 11 | 13 | 6 | 41 | incident, risk, quality |
| MODEL — Model Deployment | 398 | 12 | 14 | 6 | 37 | access, contract, problem |
| RETRIEVAL — Retrieval Quality | 668 | 11 | 11 | 6 | 35 | experiment, change, evidence |
| RTOOLS — Research Tooling | 663 | 10 | 14 | 5 | 28 | migration, release |
| COMPUTE — Compute Operations | 257 | 11 | 12 | 6 | 38 | incident, risk, quality |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### strata-datalabs.atlassian.net

Data platforms and analytics. Duplicate records, late-arriving events, schema incompatibility, missing lineage, stale aggregates and reconciliation failures. Evidence includes concrete record counts, data-contract examples and consumer impact.

Domain types: Verification Step, Recovery Step, Schema Change, Pipeline Incident, Data Investigation, Dataset Release, Data Access Review, Lineage Evidence, Reconciliation Run, Privacy Risk, Analytics Experiment, Storage Maintenance, Retention Request, Data Contract, Backfill Batch, Quality Exception.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| DATA — Data Delivery | 1124 | 12 | 12 | 7 | 39 | evidence, migration, release, change |
| INGEST — Ingestion Pipelines | 2794 | 10 | 11 | 5 | 32 | maintenance, incident |
| DWH — Data Warehouse | 350 | 9 | 14 | 5 | 30 | quality, access |
| ANALYTICS — Analytics Products | 4189 | 9 | 13 | 5 | 29 | problem, experiment |
| DQUAL — Data Quality | 498 | 10 | 13 | 5 | 30 | evidence, migration |
| CATALOG — Catalog Governance | 2075 | 10 | 10 | 5 | 31 | maintenance, incident |
| STREAM — Streaming Platform | 1786 | 10 | 11 | 6 | 39 | quality, access, contract |
| PRIVACY — Privacy Engineering | 1787 | 9 | 12 | 5 | 30 | problem, experiment |
| REPORT — Reporting Services | 1753 | 10 | 10 | 5 | 30 | evidence, migration |
| STORAGE — Storage Optimisation | 2045 | 11 | 11 | 6 | 39 | maintenance, incident, risk |
| CONTRACT — Data Contracts | 1599 | 11 | 11 | 7 | 43 | quality, access, contract, problem |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### wolfaenpak.atlassian.net

Automation engineering. Workflow changes, replay investigations, missing-field handling, provider failures, scheduling boundaries, import compatibility and permission probes. Keep test metadata separate from the business narrative and protect unrelated harness fixtures.

Domain types: Verification Step, Recovery Step, Workflow Change, Replay Investigation, Automation Incident, Rule Investigation, Automation Release, Import Review, Permission Review, Execution Evidence, Automation Risk, Rule Proposal, Provider Evaluation, Rule Experiment, Runner Maintenance, Integration Contract, Compatibility Probe, Schedule Review, Configuration Migration, Regression Finding.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| FLOW — Scenario Showcase | 734 | 11 | 14 | 5 | 35 | risk, quality |
| RELEASE — Release Operations | 2311 | 11 | 12 | 5 | 29 | contract, problem |
| CHANGE — Change Control | 542 | 10 | 10 | 5 | 32 | change, evidence |
| WFENG — Workflow Engineering | 777 | 14 | 14 | 7 | 43 | release, maintenance, incident, risk |
| RELIAB — Service Reliability | 1104 | 12 | 14 | 6 | 39 | risk, quality, access |
| INTEGRATE — Integration Delivery | 2869 | 11 | 11 | 5 | 31 | contract, problem |
| QENG — Quality Engineering | 973 | 13 | 10 | 7 | 41 | change, evidence, migration, release |
| AUTOGOV — Automation Governance | 600 | 10 | 13 | 5 | 30 | release, maintenance |
| KNOWLEDGE — Knowledge Operations | 464 | 15 | 10 | 7 | 44 | risk, quality, access, contract |
| SUPPORT — Support Engineering | 588 | 14 | 12 | 7 | 41 | contract, problem, experiment, change |
| DEVEX — Developer Experience | 1322 | 11 | 13 | 6 | 35 | change, evidence, migration |
| RENEWAL — Infrastructure Renewal | 565 | 10 | 14 | 5 | 29 | release, maintenance |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

### leanzero-apps-demo.atlassian.net

Three-app product demonstration. Connected delivery, service, integration, data-quality and experiment work feeding all three app demonstrations. Show a release decision, its Jira scheduling consequences and its specific controlled Confluence evidence without pretending a link is an automatic cross-app approval gate.

Domain types: Verification Step, Recovery Step, Delivery Change, Service Incident, Training Session, Problem Investigation, Release Candidate, Access Review, Readiness Review, Approval Evidence, Delivery Risk, Product Experiment, Approval Exception, Review Decision, Maintenance Task, Integration Contract, Migration Batch, Schedule Scenario, Quality Finding.

| Key / project | Issues | Types | Fields | Workflows | CR configurations | Specialised lifecycle families |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| COGDEMO — CogniRunner Workflow Showcase | 384 | 12 | 13 | 6 | 38 | experiment, change, evidence |
| LAUNCH — Product Launch | 306 | 11 | 13 | 6 | 32 | migration, release, maintenance |
| UPGRADE — Platform Upgrade | 351 | 13 | 10 | 7 | 47 | incident, risk, quality, access |
| ROLLOUT — Operational Rollout | 585 | 14 | 10 | 7 | 40 | access, contract, problem, experiment |
| SERVICE — Service Operations | 222 | 11 | 13 | 5 | 30 | experiment, change |
| RELQA — Release Assurance | 549 | 11 | 11 | 6 | 35 | migration, release, maintenance |
| CONNECT — Integration Delivery | 353 | 11 | 12 | 6 | 41 | incident, risk, quality |
| DQ — Data Quality | 428 | 11 | 10 | 6 | 36 | access, contract, problem |
| SECREV — Security Review | 207 | 12 | 11 | 6 | 34 | experiment, change, evidence |
| ONBOARD — Customer Onboarding | 228 | 11 | 11 | 6 | 35 | migration, release, maintenance |
| LAB — Research Delivery | 530 | 11 | 13 | 6 | 38 | incident, risk, quality |

Every row also includes separate delivery, defect and work-step workflows. Each specialised family has its own graph, fields and rule selection.

## Workflow and configuration design

The 15 lifecycle families are delivery, defect, work step, change, incident, problem, release, access, evidence, risk, experiment, maintenance, contract, migration and quality. They have separate initial/review/terminal states and explicit rework/reopen paths. Parent-readiness and heightened-review conditions sit on dedicated self-loops; they must not deadlock the normal execution route for other parent types or contradict an allowed-value validator.

| Supported archetypes | What will actually be demonstrated |
| --- | --- |
| 11 premade validators | Required and changed fields, numeric thresholds, reference regex, allowed dispositions, evidence length, date windows, completed subtasks, attachments, new transition comments and value cardinality |
| 4 deterministic conditions | Assignee-only action, parent readiness, evidence presence and a disposition-specific review path |
| 3 AI validators | Acceptance quality, recovery credibility and related-work readiness with Jira reads |
| 6 static post-functions | Parent-context inheritance, bounded checklist creation, child numeric rollup, native due date plus seven UTC calendar days (blank source is an explicit no-op), linked remediation and stale-result reset on reopen |
| 4 semantic/AI post-functions | Select classification, factual brief, decision comment and one deliberately single-shot investigation subtask |
| 3 listener patterns | Changed-field routing, AI-gated escalation and read-only agent diagnosis |
| 3 job patterns | Overdue commitments, missing-evidence sweep and read-only agent audit |

Each binding includes its project, workflow family, relevant issue types, field reference, transition/event/JQL, expected effect and acceptance identities. Rules are adapted through the site vocabulary, project evidence, available owners, components/options and business policy. Repeated bindings are explicitly called reuse, never unique inventions. Twelve policy documents, ten reusable skills and sixteen verified instance facts are planned per site: 96 documents, 80 skills and 128 facts across the org, subject to existing knowledge capacity.

Generated JavaScript must enforce the allowed source and destination project/issue IDs before every mutation, preserve unrelated values and reconcile partial creates. S02 reserves two Verification Step children per named source; S05 reserves one same-project remediation Task; M04 provisionally reserves one Sub-task. The app currently selects the first available subtask type, not a configured type ID: before seed writes, inspect the exact createmeta ordering and reallocate that reserved slot to the actual offered subtype if necessary, within the same project/work-step total. Freeze the concrete type map and recheck it before activation. Every reserved identity is included in issue-type/state totals. The AI-subtask mode is not inherently replay-safe: run once on its designated source, reconcile uncertain completion and retain its config disabled after the demonstration. It is not represented as a persistently enabled idempotent creator.

All other listeners/jobs remain disabled during bulk population. Temporary native Jira administrator-only bootstrap edges populate initial statuses without paid AI or creation post-functions, then are removed before final workflow acceptance. Each saved rule must subsequently be invoked through the real intended transition/event/job on its own named cohort. A populated status or registry row does not prove a rule ran.

## Custom fields and realistic data

Every project receives 10–14 new fields, separately named and context-scoped to that project. Eight core fields support the actual rules: Evidence (paragraph), Decision Brief (paragraph), Reference (short text), Impact Score (number), Review Due (date), Disposition (select), Responsible Owner (single user) and Actual Outcome (paragraph). Two to six additional domain fields differ by site: shipment mode/temperature/carrier; production line/material/containment; attack surface/control/exposure; evaluation slice/reproducibility; data freshness/reconciliation; or rule surface/failure policy/replay state. UPGRADE on the demo uses two dedicated cutover dates instead of generic domain fields.

The manifest gives domain-specific options such as Road/Rail/Air/Sea, Ambient/Chilled/Frozen, or Not replicated/Partially replicated/Replicated. Existing assignee, dates, estimates, priority, components and versions remain native. New field contexts and dedicated screens must agree; validate create/edit metadata and every new value through an independent reread. Default-global contexts must be removed or restricted before content writes. No field IDs or user IDs are copied across instances.

Content is synthetic but business-specific: bugs have reproducible observations, changes have impact and reversal steps, exceptions have evidence and decision rationale, experiments have negative/inconclusive outcomes, and operations have recovery/handover details. Do not rotate a generic paragraph across 80,988 records. Use variable lengths, tables, code/log excerpts and relevant attachments. Include blocked, disputed, reopened, rejected and deferred cases with consistent status, dates and evidence. Never fabricate historic Jira timestamps, user authorship, signatures or approval events.

Author and review 24 representative business stories per project (2,160 total), including difficult and successful cases. These are within the population, not extra issues. The complete population still needs concrete, type-appropriate facts; the curated set is the editorial minimum, not permission to leave the remainder as filler. Duplicate/near-duplicate checks flag repeated body passages and summary suffix patterns. Preserve a clear synthetic notice at project/space level, with detailed expected outcomes stored in receipts rather than every business description.

## Additional three-app scope on LeanZero Apps Demo only

The demo now has 67 Jira workflows, 348 workflow rule bindings, 36 listeners, 22 jobs, 24 issue types and 127 new fields. This replaces the small demo configuration count; the business scenarios and source-informed limitations of the previous demo plan remain applicable.

LeanZero Management expands to **six plans**: the existing curated LAUNCH 180, UPGRADE 150 and ROLLOUT 120 scopes, plus cross-project release readiness (240), service/recovery (90) and research/data-quality (160). Plan membership may overlap and is never added to the Jira issue total. Define exact ID membership, include required hierarchy/dependency endpoints and deduplicate overlapping membership in capacity. Configure six calendars/profiles, six retained baselines, twelve saved scenario alternatives and eighteen milestone targets; use native remaining effort and actual assignees for the capacity workspace. Three approved viewer/editor/owner journeys and six bounded Apply checks use the real UI and Jira rereads. UPGRADE uses its proposed Cutover Start and Cutover Finish date fields as per-plan overrides; other plans use the verified existing Start date and native due date. These two cutover fields replace the two generic domain fields in UPGRADE, keeping the field count unchanged. Per-plan scheduling overrides support start/due dates only; do not present arbitrary custom fields as scheduling inputs.

Sentinel Vault expands to **five spaces, 120 pages and 180 real attachments**: existing LZSHOW 18 pages/24 files; DELIVERY 24/40; CONTROLS 30/48; OPERATIONS 28/44; RESEARCH 20/24. The 102 new pages and 156 new files have authored evidence content, not empty placeholders. File mix across the final180: 48 PDF evidence packs, 36 CSV datasets, 24 JSON contract/log examples, 48 text runbooks (including existing24) and 24 SVG diagrams.

Configure five space workflows with distinct draft/review/rework/approved paths; five validation policies (18 individual required-heading/table/label/length rules in total); 36 attachment seals; 15 section seals; twelve edit-request journeys; fifteen read-confirmation examples; and ten on-demand AI-review cases. Retain 36 Draft, 36 In Review and 48 Approved pages after real transitions. Use actual approver accounts for single, all-of-two and two-of-three approvals; no impersonation. Pending multi-user authentication remains a pending test, not a fabricated approval. Exact review/expiry examples require real clocks; signatures require actual device enrolment and are outside the baseline.

Global-only settings are explicitly identified before changing them; per-space settings do not pretend to override every global policy. Protection is configured after content is complete. Verify attachment bytes, section restoration, allowed edits, no-op saves and actual approval histories. No Management/Sentinel expansion is planned on the other seven sites.

## Capacity, confidence and implementation gates

**This is a substantial allocation, not a claim that current installations can already store all of it.** Current CogniRunner source caps workflow registry rows at500 and refuses new rows above200000 serialized bytes; listeners/jobs have separate200-item caps. These limits include existing app configuration. The proposed per-site workflow rules range310–395, but payload size or existing rules can still block them—especially on the already-used Wolfaenpak site. Exact current registry usage and the serialized, fully compiled candidate pack must be measured before attachment. Do not delete existing rules, bypass caps, deploy a changed app or quietly reduce the promised inventory to fit. If the pack does not fit, report the measured shortfall and a separate capacity remedy before dependent writes.

Confidence is high in the arithmetic, type mappings and local feature catalogue. Confidence is lower in simultaneous installed capacity, deployment parity and authenticated multi-user paths until those live gates pass. Project REST access has been freshly checked; installed app functionality has not been inferred from that access.

AI validators can fail open on provider/configuration failure, and must not be sold as guaranteed security/compliance gates. Listener AI failures skip. Conditions are deterministic Jira expressions. Semantic SKIP does not equal a field write. Agent patterns are read-only get_issue plus implicit finish: exact write destinations are not enforced by action-type allowlisting, so no agent-selected writes/comments are authorised. Related-work read limits are measured behaviour, not a promised security boundary.

Script jobs cap their input at15–20 records; agent audit seed input is one coordinator issue. The scheduler rides a five-minute tick. Use one AI request at a time and twelve initial canary calls per site, with a proposed runner ceiling of600 provider calls and1.2million reported tokens per site. There is no automatic retry of costly or ambiguous mutations. These are runner budgets, not built-in global app limits. If proving every configured AI binding needs more usage, report the actual remaining cases and obtain a revised budget; do not substitute a sampled green result for all bindings.

## What approval leads to

1. Capture current settings, app capacity and scheme sharing for all eight targets; compile actual IDs, scripts/prompts, state migration maps and byte budgets against this allocation.
2. Prove one representative canary per lifecycle and capability before scaling, including rejected input, changed-field events, replay and provider failure reporting.
3. Create/reuse project/type/screen/field objects in resumable batches; enrich existing content and populate exact issue/type/state counts with creation slots reserved.
4. Attach and publish the mapped workflows; configure site-specific knowledge/settings, then prove every saved rule on its named fixtures.
5. Complete the additional Management/Sentinel setup only on the demo, with live browser paths and independent API readback.
6. Deliver per-site created/configured/verified/failed/pending counts, real evidence, and the final enabled/disabled inventory. No staged or disabled single-shot rule is reported as enabled.

Approval authorises this org-wide campaign except Leanzero; it does not authorise production app deployments or deleting unrelated tenant data. No bulk execution starts from this planning turn.

## Supporting artifacts and references

- [Complete allocation and symbolic bindings](org-expanded-approval-plan.json): all90 project inventories,544 workflows,3300 configuration instances and1084 field definitions. This is an approval manifest, not an executable seeder payload.
- [Previous demo content receipt](demo-content-receipt.md) and [portfolio receipt](demo-portfolio-receipt.md): actual applied content, distinct from proposed expansion.
- Atlassian [issue types](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-types/), [issue-type schemes](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-type-schemes/) and [workflow mappings](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-schemes/).
- Current source: CogniRunner manifest.yml, src/shared/premade-rules-catalog.js, sandbox-api-spec.js, registry-limits.js, src/agent-runner.js and src/scheduled-jobs.js. Management per-plan field/scenario/capacity services and Sentinel workflow/approval/sealing sources were reviewed in the preceding capability pass.

## Independent plan review and validation

Review corrected four concrete issues: the AI-subtask type reservation now has an actual createmeta ordering gate; all 179 deadline bindings explicitly use native duedate plus seven UTC calendar days with blank-source no-op; active lifecycle states have semantic Jira categories; all 190 separately counted prerequisite bindings now have present/missing/repeat fixtures. Allocation validation also corrected a reserved initial-state shortage in SECR without changing its project or workflow totals. Registry byte capacity and real app acceptance remain pending; static allocation checks do not establish those.
