<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CogniRunner — Testing Recipes (reusable runbook)

A catalog of the test-harness "recipes" (what each script tests, when to use it) plus the
**protocols** that keep runs honest and the instance clean. Reuse this for every future test set.

> Companion docs: **[RULE-CATALOG.md](./RULE-CATALOG.md)** (the super-diverse rule corpus to build from),
> **[PROVIDER-BARRAGE.md](./PROVIDER-BARRAGE.md)** (single-provider full barrage), **[FINDINGS.md](./FINDINGS.md)**
> (every finding + fix), **[README.md](./README.md)** (harness architecture).

---

## ⚠️ Ground rules (non-negotiable)

1. **NEVER delete all issues** (or any bulk-destructive data op) unless the human SPECIFICALLY asks.
   Cleanup means stripping **rules / transitions**, not issues. Batteries **reuse a bounded issue pool**
   and label everything (`cogtest-<set>`). `teardown.mjs` (deletes the project) and the issue-delete in
   `_cleanup-cogtest.mjs` are human-request-only.
2. **Black-box only.** The harness asserts via REST + the `cogni-debug` issue property — never reads KVS.
   A rule's verdict/reason on an ALLOW is only visible with `debugTrace:true` (mirrors to `cogni-debug`).
3. **Conditions don't fire via REST** (Forge enforces visibility in the UI). Test a condition by
   **mirroring** its `{fieldId,prompt}` as a temporary validator (same shared `validate()` path).
4. **Provider switch is admin-only** (no REST path). To test a specific provider, ask the human to
   switch it in admin → Settings, wait ~35s (30s config cache), then run.
5. **Commit as `leanzero.srl`**, never credit Claude; AGPL header on every new file.

---

## Pre-run hygiene (ALWAYS)

| When | Recipe | Why |
|---|---|---|
| After ANY lifecycle/mass wave, before a suite | `node scripts/reset-to-hub.mjs` | Seed corpus marches OFF the hub; per-rule self-loops live only on the hub, so off-hub issues record **false BLOCKED** (Jira "Can't move", not `AI Validation failed:`). |
| Switching provider | human switches in admin → wait ~35s | 30s provider-config cache. |
| Confirm provider reachable | `node scripts/_smoke-provider.mjs` | One good + one bad fire; cheap sanity. |

## Post-run cleanup (ALWAYS)

| Recipe | Effect |
|---|---|
| `CLEAN=1 node scripts/audit-rules.mjs` | Removes **transient probe transitions** (`R\d+-`, `AG-`, `CL-`, `CT-?`, `DISCO-`, `CMIRROR-`, `STRESS-`, `R13-`…); health-checks all attached configs (malformed/duplicates). Keeps the durable suite. |
| (issues) | **Do NOT delete.** Reuse the labeled pool next run. |

## Final verification (deterministic, no instance needed)

```bash
node --check src/index.js && node --check src/async-handler.js
for f in _verify-f46 _verify-f47 _verify-f48 _verify-f50 _verify-f51 _verify-f52 _verify-f53; do node scripts/$f.mjs; done
```
Each `_verify-fNN.mjs` copies the FIXED logic from `src/index.js` and runs the exact bug triggers
(the live weak model can't be forced to emit them). 80 checks total; all must pass.

---

## Recipes by purpose

### Setup / inventory
| Recipe | Tests / does |
|---|---|
| `npm run setup` (`setup-testbed.mjs`) | Stand up the COGTEST testbed (project/workflow/fields). |
| `setup-fields-all.mjs` / `field-matrix.mjs` | Create the full custom-field matrix (every output type). |
| `agile-setup.mjs` | Scrum board + sprint over COGTEST (for agile api.* actions). |
| `discover-rules.mjs` / `scan-existing-rules.mjs` / `exercise-discovered.mjs` | Inventory the REAL deployed rules; exercise each so none has zero executions. |
| `_diag-rulecount.mjs` | Independently paginate `/workflows/search` + count attached CogniRunner rules (proves the admin count, no cap). |
| `inspect-rule-shape.mjs` | Dump a rule's stored config shape. |

### Canonical suites
| Recipe | Tests |
|---|---|
| `npm run run` (`run-transitions.mjs`) | The ~782-case suite (baseline **766–770/782**; no-regression bar). |
| `npm run deep` (`run-deep.mjs`) | Graded run (PASS / SOFT / HARD + Bucket A/B/C triage), resumable. |
| `node scripts/barrage.mjs` | Full single-provider barrage: reset → smoke → suite → live MCP e2e → research. See PROVIDER-BARRAGE.md. |
| `npm run coverage` (`coverage-report.mjs`) | Coverage matrix (every rule exercised? system-vs-model split). |

### Creative / qualitative rounds (build NEW rules, check their run, review logs)
| Recipe | Focus |
|---|---|
| `creative-lab.mjs` | 19 canonical diverse rules across ALL three types (validators/conditions/semantic+static PFs). The go-to no-regression smoke. |
| `agentic-lab.mjs` | Agentic validators with **JQL tool-calling** (dup detection; per-run random tokens; confirms project-confinement). |
| `round5-schemas` | Hard output schemas (cascading/datetime/user/url/checkboxes). |
| `round6-flavors` | All semantic PF flavors. |
| `round7-static` | Static-engine depth (generate→test→fix). |
| `round8-edge` | Edge inputs (defang/emoji/huge/empty). |
| `round9-reasoning` | Reasoning + multilingual (incl. CJK). |
| `round11-systemfields` | System fields. |
| `round12-crossfield` | Cross-field source synthesis. |
| `round13-exotic` | Exotic validators + PF composition (PII/tone). |
| `round15-create` | Create-transition validators (`modifiedFields`, `issue.key` null). |
| `exotic-pf.mjs` / `actions-test.mjs` | Exotic sandbox actions / the api.* action suite (13/13). |

### Stress / load / resilience (study load balancing, hunt zombies)
| Recipe | Focus |
|---|---|
| `stress-lmstudio.mjs` | Heavy LM Studio flood (`STRESS_FIRES/CONCURRENCY/ISSUES/DRAIN_WAIT`); worker spread + queue-delay. Reuses a bounded 120-issue pool. |
| `lmstudio-multimodel.mjs` | Multi-model pool proof (`MM_FIRES/CONCURRENCY/EXPECT_MODELS`); model histogram + overlap. |
| `load-graceful.mjs` | Graceful degradation: under throttle, validators must **fail OPEN** (204), not collapse. |
| `throttle-probe.mjs` | Find the transition-API throttle ceiling. |
| `race-same-issue.mjs` | Concurrent PFs on one issue/field (idempotency). |
| `async-flood.mjs` | Async queue + memory-distill behavior under failure variety. |
| `mass-/bulk-transitions`, `seed-bulk`, `mega-issues`, `pack-transitions` | Volume + chalk-full transitions (multiple rules per transition). **Run `reset-to-hub` after.** |

### Security / robustness
| Recipe | Focus |
|---|---|
| `injection-deepdive.mjs` | Prompt-injection in source fields (reads `cogni-debug` to see the AI's reason even on ALLOW). |
| `injection-adversarial-direction.mjs` | Injection pulling AGAINST the correct verdict. |
| `validator-robustness-r2.mjs` | Validator robustness round 2. |
| `mcp-attach-security.mjs` / `mcp-live-e2e.mjs` | MCP bridge security + live gendoc round-trip (new attachment = proof). |
| `gate-verify.mjs` | Authz gates. |

### Diagnostics
| Recipe | Use |
|---|---|
| `_forge-logs.mjs [--review]` | Tail / review backend logs (lm-pool spread, sweeper, errors). |
| `_smoke-provider.mjs` / `_bedrock-probe.mjs` | Provider sanity. |
| `verify-memories.mjs` | Memory system. |

---

## The qualitative loop (the owner's core workflow)

1. **Pick / build** a diverse rule set — start from **[RULE-CATALOG.md](./RULE-CATALOG.md)** (covers the whole app + overlooked scenarios).
2. **Attach + fire** via a round script (reuse the labeled issue pool; `reset-to-hub` if you did a wave).
3. **Review logs qualitatively** (`_forge-logs.mjs --review`) — look for: 5xx/uncaught, malformed-JSON parse stamps, tool-call shape warnings, `[mcp-bridge]`/`[pf-sweeper]` errors, fail-open/transient markers, `[lm-pool]` starvation.
4. **Triage** each non-PASS: **system bug** (fix `src/index.js`) vs **model/expected** (no fix). When in doubt, adversarially verify with a Workflow before trusting a finding.
5. **Fix → `node --check` → rebuild touched frontends (`diff -q` the duplicated components) → `forge deploy` → re-verify the lane.** Record in FINDINGS.md. Commit as `leanzero.srl`.
6. **Cleanup** (`CLEAN=1 audit`) — rules/transitions only, never issues.

## Adversarial review (for code YOU change)

Black-box rounds confirm correct behavior but find ~0 deep bugs; the real bugs come from
**adversarial review** (a Workflow that red-teams each finding / each new code path — "refute this",
"hunt this path", 3 skeptics + majority vote). **Always adversarially review code you wrote on the
critical path before trusting it** — the overnight durability MVP shipped 10 HIGH bugs that only a
self-review caught. See the FINDINGS "hunt" + "verify" entries for the pattern.
