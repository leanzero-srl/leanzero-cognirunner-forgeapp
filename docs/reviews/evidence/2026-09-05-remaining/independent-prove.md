# Independent verification — remaining CogniRunner fixes

VERDICT: PASS for the bounded gates and outcomes below; first concurrent AI run FAIL with a Forge per-minute 429, followed by a clean sequential retry. Platform request-type delivery remains NOT VERIFIED. Final source892ef33 is deployed22.155.0; final structured live repeat passed20/20.

GATE:
- Full `node --check` gate (index, async handler, listeners, jobs, agent runner, rules API, skills, memories, premade, test hook, every shared module): exit 0 at 58ec8f2 and 892ef33.
- `npm run test:offline`: 46/46 at 58ec8f2; 47/47 at 892ef33, including actual agent simulation identity and scoped result serialized-byte caps.
- `npm run test:rules-offline`: exit 0, runtime 115/115; agent references 155/155; event catalogue 362/362, cron50/50, listener74/74.
- FunctionBlock byte duplication `diff -q`: exit0. Bundles built by coordinator in7d1dd83; this tester did not rebuild unchanged UI.
- `forge lint`: exit0 no issues. Forge CLI upgrade recommendation only.
- `forge deploy -e development`:22.154.0 at58ec8f2. No production deployment. Final892ef33 redeployed successfully as22.155.0.

EVIDENCE (22.154.0):
- Full `jobs-e2e.mjs`, no QUICK:19 passed,0 failed. LZPT-278 scoped agent label `crjobk27yd-agent` and comment16049 text `crjobk27yd agent ran` verified in independent GET. Scoped task and perIssue log both have identical `agentOutcome:done` and action-specific summary. Manual unscoped comment16050 verified in later issue GET. Actual scheduler scheduledFor15:50Z produced comment16057 `crjobk27yd tick 2026-09-05T15:50:00.000Z (scheduled)`, independently read at15:51:39Z. All3owned jobs individually reread absent; issue GET200→DELETE204→GET404.
- `resolvers-live.mjs`:23 passed,0 failed. Actual admin resolver principal/gates/drafts/run-now/token flow. Exact job label read from LZPT-280. Saved listener/job each reread not found after cleanup; issue200→204→404.
- `jsm-assets-e2e.mjs`:27 passed,0 failed,2 platform skips, WITH an explicit manual retry after a first429. JT-53 Assets field customfield_11081 retained exact workspaceId be9cca2f-5f41-446f-8f5c-76cda0be8417, id workspaceId:71, objectId71. Real listener copied exact same three fields into issue property. Portal API verified script internal note16053 public:false and public reply16054 public:true. First agent wrote internal note16055 then encountered429; first run is not runtime-clean. Same-object retry after minute reset added NEW internal note16059 public:false, `agentOutcome:done`, exact meaningful summary. New-note delta asserted against the BEFORE portal API list; presence of16055 alone was never used as retry proof. All5owned listeners reread absent; JT-52/JT-53 each200→204→404.
- Structured scratch proof initial listener attempt failed at first AI call429, stored outcome failed, summary empty, no toolcalls. Owned fixture/listener removed. Sequential retry on LZPT-282:20/20 assertions: real async listener exact done/summary, scoped task result and perIssue persisted log exact done/summary, unscoped task+persisted log exact done/summary. All3distinct labels independently GET-read. All3rules read before deletion and404 after; issue independently deleted/reread.
- Token lifecycle: SIX owned tokens (jobs,resolver,JSM,failed structured,successful22.154 structured,successful22.155 structured) independently inventoried revokedAt after completion. An initial scratch wrapper erroneously counted revoked tombstones as active, then a concurrent active token from a different suite as a leak. These scratch-only false alarms caused wrapper exit1 although core suites passed. The separate exact-token revocation receipt resolves them; production harness ownership cleanup is correct. Original outputs retained honestly.

LOGS:
- Pulled `forge logs -e development -n100` after deploy, resolvers, fulljobs, JSM retry, JSM final, failed structured and successful structured.
- Predeploy DEP0040 entries end15:28Z; no DEP0040 from new22.154 runtime invocations.
- Postdeploy getConfigs one bounded orphan summary checked455 retained455 workflows5, then one bounded filter line; no per-row flood.
- First concurrent AI attempts15:50:16 and15:50:20 show Forge LLM429 per-minute token limit. No retry or recovery is hidden.
- JSM clean retry15:54:51–55 and all structured consumers15:56:00–20 execute/complete without429, exception or recovery. Root was running separate workflow/attachment probes; logs are shared environment-wide and must be attributed by invocation/rule IDs.

UNPROVEN:
- JSM request-type created/deleted events did not reach captureSample; update cannot be triggered via public REST. Earlier coordinator UI-origin proof is outside this tester's own evidence.
- UI light/dark/real Workflow Test Run and attachment bytes are coordinator-owned; do not infer a PASS from these backend suites.
- No remaining unverified branch in the assigned structured result scope. Final serialized-size worst cases are proved offline through the production serializer, not with100 real AI issues.

Receipts are `/tmp/cgr-independent-remaining-*-evidence.json`, `*-token-read.json`, `*-logs-*.txt`, and command logs under the same prefix. No production files were edited by this tester.

FINAL VERSION EVIDENCE (22.155.0 /892ef33):
- Structured20/20 onLZPT-283, exact labels and exact summaries across listener/scoped+unscoped jobs. All3rules readable-before and404-after; issue deleted and404 independently. Token tok_mtoklqiodc9a23 independently revokedAt16:02:57.749Z.
- Forge logs16:02:12–48 show all3actual consumers execute/complete with no exception, throttling, AI recovery or DEP0040. Receipt: `/tmp/cgr-independent-remaining-logs-22-155-structured.txt`.
- Final full gate: `/tmp/cgr-independent-remaining-offline-892ef33.log`47/47; `/tmp/cgr-independent-remaining-rules-892ef33.log`; lint/deploy receipts use same892ef33 suffix.
