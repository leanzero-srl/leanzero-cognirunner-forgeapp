# Demo portfolio content receipt

Target: https://leanzero-apps-demo.atlassian.net only. Source: `test-harness/scripts/demo-portfolio-seed.mjs`.

This is the curated Jira content layer for LeanZero Management and CogniRunner demonstrations. It does not configure either app, install apps, change shared schemes, or publish workflows. Existing COGDEMO and KAN content is preserved. No other site is targeted.

## Intended content

| Project | Issues including epics/subtasks | Epics | Subtasks | Blocks dependencies |
| --- | ---: | ---: | ---: | ---: |
| LAUNCH — Product Launch | 180 | 6 | 42 | 24 |
| UPGRADE — Platform Upgrade | 150 | 6 | 36 | 24 |
| ROLLOUT — Operational Rollout | 120 | 6 | 24 | 24 |
| Total | 450 | 18 | 102 | 72 |

Each project has six domain-specific components and three releases. Stories and tasks belong to epics; subtasks belong to their immediate standard-issue parent. Each issue has a substantive ADF description, acceptance criteria, Start date, due date, priority, component, release, active assignable owner, and membership labels. The content has To Do, In Progress and Done examples achieved through actual Jira transitions. Successive dependency dates overlap deliberately so cascade and schedule-impact demonstrations have meaningful work to move; no claim is made that the initial schedule has no dependency conflicts.

Management source queries: `project = LAUNCH AND labels = lz-showcase-launch`; `project = UPGRADE AND labels = lz-showcase-upgrade`; `project = ROLLOUT AND labels = lz-showcase-rollout`.

## Verification protocol

The seeder independently rereads every created issue and compares summary, full ADF description, project, issue type, owner, priority, labels, components, releases, parent, both dates and planned status category. Every Blocks link is reread from its predecessor. A separate `verify` invocation repeats all checks with no writes. Actual unique field discovered on this site: Start date `customfield_10015`.

An atomic gitignored receipt preserves successful creates and pending ambiguous operations. Failed mutation requests are never automatically retried. An initial ADF comparison rejected identical objects with different key order; the comparison now uses deep structural equality, retaining exact content and array-order checks.

Status: live apply and separate read-only verification completed 2026-09-10T13:00:57.127Z. The separate pass exited 0 after 1,076 GET requests and zero mutation requests. All 450 distinct issues and all 72 directed Blocks links matched. LAUNCH-1 through LAUNCH-180, UPGRADE-1 through UPGRADE-150 and ROLLOUT-1 through ROLLOUT-120 are the exact created issue ranges. Each project uses three existing active assignable owners. Across the fixture: 270 To Do, 108 In Progress and 72 Done issues.

ROLLOUT-1 also produced one immediate description readback mismatch during apply; a subsequent direct read matched the exact expected structure. The additive resume reread the preceding projects, then completed without creating duplicate issues. The final independent pass found no mismatches.

Confidence: high in the persisted Jira content and hierarchy. Application plans, settings, published CogniRunner workflow effects and Sentinel approval/protection state are not established by this receipt.
