# Event sample BREAK — 2026-09-05

Final reviewed production source: d242532, merged as 5f377e0. Final reviewed live harness: 86b9af7, including preceding 41833a7. No repository source, tracked state, deployment or live tenant data was changed by this reviewer.

## Findings delivered and corrected

FILE: test-harness/scripts/campaign-sample-live.mjs:25 and :59 · A failed redaction assertion persisted the actual context token in AssertionError.stack.
SCENARIO: sample.payload.contextToken still contains an opaque token → assert.equal(token, undefined) throws with actual token in its message → catch writes error.stack into sample-live.json.
VERDICT: CONFIRMED. Blast radius: the two sample token assertions only.
REFUTATION ATTEMPTED: ran a synthetic-token assertion and checked the resulting stack; the sentinel was included. Checked the catch path; it persists the stack. Rechecked 41833a7's boolean own-property assertions; both reject token presence without including its value.
STATUS: source-corrected in 41833a7; coordinator owns canonical ledger integration.

FILE: test-harness/scripts/campaign-sample-live.mjs:26 and :34 · The harness read attachment identity at the event root instead of event.attachment.
SCENARIO: the known Forge event contains attachment.fileName/issueId; initial legacy baseline omitted both incorrectly read top-level fields, so undefined===undefined falsely marked identity preserved. Fresh runtime code produced no fileName and issueId:'undefined', rejecting a functioning app.
VERDICT: CONFIRMED. Blast radius: sanitized legacy identity capture and these harness property reads only.
REFUTATION ATTEMPTED: checked successful L13/L14 campaign code and observed fixture baseline field names. Executed the original expressions with the real schema and confirmed the vacuous legacy pass and incorrect fresh effect. 86b9af7 now asserts nonempty baseline identity and reads nested attachment fields. Extracted and executed its actual generated listener code; output matches expected identity and contains only tokenPresent:boolean.
STATUS: source-corrected in 86b9af7; coordinator owns canonical ledger integration.

## Six-lens result

Untrusted content: the single cloning sanitizer drops exact contextToken keys recursively, including JSON unicode-escaped keys, arrays and prototype-named ordinary JSON properties. Other identity and text placeholders survive. Captured and legacy returned samples both use it; direct public and UI paths were exercised. No new model prompt path was added.

Failing path: unauthorized public access returns 401 without sample content. Unsupported/missing samples preserve null/404 contracts. Legacy redacted:true does not bypass sanitation. Failed harness assertions no longer echo token values. Missing legacy identity now fails a positive control.

Blast radius: the raw trigger input, queue event and actual sandbox api.context.event remain unchanged. Real engine execution confirms token presence without logging or storing its value. No rule matching, simulation, write brakes, claims, counters or schedule behavior changed.

Caps: capture retains its existing trim/storage bounds. Read sanitation only removes fields from bounded cached data; no model output or registry cap changes. Runtime payload is not altered by the sample-only sanitizer.

One-rule: capture and cached reads share one JSON-cloning sanitizer. All public/UI/test sample consumers call getEventSample. Rich-text redaction is not reapplied on reads, preserving existing placeholders and idempotence.

Boundary: production change is confined to listeners.js, with no manifest/scopes/dependencies/provider/resolver permission changes. JSON handling is synchronous over cached sample data; no new async or frontend execution surface. UI viewer permission and public token authentication remain in place.

## Verification and bounded verdict

Independent source-controls.mjs: five grouped controls cover actual public REST, actual UI resolver, raw legacy storage preservation, nested/Unicode/prototype JSON fields, real trigger/capture/queue and actual sandbox execution. Passed.
Author suite: six cases independently rerun, all passed.
Independent harness-fixed-control.mjs: extracted actual script, nested identity, only token-present boolean, missing legacy identity negative control, and safe failed assertion stacks. Passed.

No remaining confirmed defect in this source/harness scope. Development deployment, same-capturedAt legacy verification, actual attachment bytes/event delivery, fresh sanitized sample, UI verification and cleanup remain the live acceptance gates.
