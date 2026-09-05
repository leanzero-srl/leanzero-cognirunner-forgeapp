# Independent final BREAK — F037/F038/F039

Target d97f90b (F0378f029ab, F03842495b6, F039d97f90b), deployed development22.158.0.
VERDICT: CLEAN — zero new confirmed/high-confidence defects in these three bounded cuts.

Six lenses and refutation:
- Untrusted content: F038 preserves HTTP/JSON-RPC/MCP isError as error envelopes; long denial text can no longer be accepted as research output. F037 parses JSON and requires literal success/upload booleans, integer2xx status and positive attachment ID; malformed/empty/plaintext/local-only results fail. Capability values are redacted from displayed failure message. Raw parsed response is not read by either generate-doc/research-doc caller; no new prompt/permission surface.
- Failing path: independently executed document-upload-result.test.mjs and mcp-bridge-errors.test.mjs, exit0. All5formats reject local success with failed upload; both bridge transports retain HTTP403,JSON-RPC error,HTTP200 isError; ordinary text still returns normally. Both document callers return failure before Attached trace, linking comment and optional library persistence. Runtime endpoint/attachment-byte positive proof remains coordinator-owned.
- Blast radius: no new endpoint, retry or write introduced. Existing mcpRpc gives write creators exactly1attempt; read retries remain bounded. F039 outside dismissal now executes on document click after target handler; selection/clear/keyboard guards unchanged. No stopPropagation in FunctionBlock or IssuePicker suppresses this outside handler.
- Caps/clamps: F037 displayed failure message remains400chars, capability strings removed before slicing. Timeout and title/content limits unchanged. F038 adds no unbounded persistent data or extra AI calls.
- One-rule lens: both actual document attachment callers share callDocProcessorCreate. All callBridgeTool users share new error classification, including stateful/stateless. Both IssuePicker copies exact diff-q; no divergent fix.
- Boundary: no manifest/dependency/sandbox permission changes in these cuts. F039 ordinary click remains ordinary; no mousedown action invocation or forced pointer workaround. Same-source syntax check passes.

F039 real regression proof22.158.0:
/tmp/cgr-workflow-pointer-final/evidence.json:10/10 workflow simulation outcomes + all expected exact issue/property second reads unchanged. Mouse positive control reproduces original state: dropdown open, test-panel scrollTop36/client175/scroll211. mousedown/mouseup/click all target BUTTON.btn-run-test at unchanged top483.5625. No keyboard,force,dispatchEvent or retry. JT-68 cleanup verified404. Both-theme artifacts available; initial light capture is mid-entry-animation, so coordinator should persist screenshots with animations disabled.

Logs pulled after final live run: /tmp/cgr-workflow-pointer-final-forge-logs.txt. Existing shared environment attachment502 warnings belong to coordinator endpoint probes; no new error attributable to deterministic workflow simulation calls. Do not present shared endpoint errors as absent.

No source edits were made by this reviewer/tester. Root is integrating permanent pointer regression; review assumes same production source d97f90b.
