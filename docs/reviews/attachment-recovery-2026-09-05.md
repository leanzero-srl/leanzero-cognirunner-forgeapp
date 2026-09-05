# Attachment connection recovery and completed acceptance

The previously blocked positive attachment gate now passes against wolfaenpak on unchanged development22.158.0 / applicationd97f90b. No production deployment, manifest, provider, authentication or service source changes were made. This continuation changes only the live acceptance harness and evidence.

## Connection diagnosis and recovery

The document service on workhorse loopback10000 returned healthy version1.0.0 with17tools. The identical HTTPS hostname and `/docproc/healthz` path also returned200 when resolved directly to the workhorse's private Tailscale address. Public Funnel connections completed TCP but reset during TLS; the daemon's ingress counter did not increase. This isolated the observed failure before the service/private HTTPS route. Tailscale's network map included ingress grants; missing service health or blanket missing Funnel permission was not established.

Recovery attempts refreshed the network map, temporarily toggled Funnel advertisement with exact restoration, rebound transport and reconnected the Tailscale client networking state. Public requests initially continued failing, then recovered. The evidence supports recovery after those attempts, but does not isolate which refresh or upstream change caused it. The root daemon was not restarted: sudo required an administrator password, and the web console required login. Neither became necessary once public connectivity recovered.

The complete final Serve/Funnel JSON compared equal to the captured pre-investigation baseline. The configured CogniRunner URL remained `https://worksmacstudio.tailfc4700.ts.net/docproc/mcp`, with existing bearer presence unchanged. The genuine authenticated admin MCP Test then returned success and its tool list. A temporary15-minute thread follow-up was created to retain the blocked gate; it was paused as soon as the positive gate passed.

## Full configured result

The live harness uses a real JT workflow transition and Generate Document rule with Markdown format and `attachComment:true`. Final JT-73 produced attachment11492 (`cgr-attachment-mtondm6c.md`,217bytes,`text/markdown`) and comment16065 with the exact attachment filename. The Jira download contained the unique marker and literal `transport=multipart`, `bytes=verified`, `environment=wolfaenpak` lines. Its SHA256 matched the independently read generated source on the workhorse: `ae39afd9c9b4d88cb4450c8a1a35304bbf8762df419b31cd055d3d11d41397f0`.

A second Jira read confirmed one attachment with the same ID and one comment with the same ID/body. The transition was removed and independently reread absent; deleting JT-73 was followed by an independent404. The harness returned exit0 and sets overall `pass:true` only after both cleanup checks. The corresponding runtime result reports success/GENERATE, the exact filename and the posted-comment trace.

## Failed attempts and harness corrections

JT-71 and JT-72 both created real attachments and comments, but failed the original exact-substring acceptance test. The AI preserved all three requested facts while formatting them as bold labels or a Markdown table. JT-72's actual247-byte Jira download is retained in the failure receipt. The fixture prompt now explicitly requests verbatim equals-sign lines in a fenced code block; the exact content assertions remain unchanged. This clarifies the test input without changing the application's prompts or weakening its output checks. Both failed-run fixtures and transitions were independently confirmed removed.

The independent architect also found that the harness stopped waiting on attachment arrival alone despite requesting a comment, and printed PASS before cleanup. It now waits for the exact requested comment, asserts the empty comment baseline, rereads attachment and comment identity/body, preserves downloaded bytes/content before assertions, and computes overall PASS after cleanup. Independent BREAK found no blocking defect: [nine controls against the actual harness body](evidence/2026-09-05-remaining/attachment-harness-controls.json) cover healthy/late comments, missing/wrong/changed comments, failed deletion, retained issue/transition and invalid content. Every failing case exits1 without PASS while attempting both cleanups.

This positive journey proves Generate Document in Markdown and the shared capability/multipart upload transport. It does not imply every document format or Research and Document was separately exercised. Earlier offline format/envelope coverage and the nine live unauthorized-capability rejection checks retain their separate scope. The three parked platform findings in the parent review remain platform limitations; no confirmed code fix remains scheduled.

Evidence: [successful complete journey](evidence/2026-09-05-remaining/attachment-positive-success.json), [source/download comparison](evidence/2026-09-05-remaining/attachment-source-comparison.json), [formatted-content failure](evidence/2026-09-05-remaining/attachment-formatting-failure.json), [MCP connection recovery](evidence/2026-09-05-remaining/mcp-recovered.json), [runtime success](evidence/2026-09-05-remaining/attachment-success-runtime.txt).
