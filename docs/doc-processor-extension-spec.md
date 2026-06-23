# Spec: extend `read-doc` to accept remote URL input (with auth header)

> **Audience**: the maintainer of [`leanzero-mcp-doc-processor`](https://github.com/leanzero-srl/leanzero-mcp-doc-processor), or an AI assistant tasked with implementing this in that repo.
>
> This document is a complete, self-contained prompt — feed it to your AI tool of choice or use it as a manual implementation guide. It describes a **backward-compatible** extension; existing `filePath`-based callers must continue to work without changes.

---

## Context

This spec describes a backward-compatible extension to `leanzero-mcp-doc-processor`'s
`read-doc` tool so it can process documents that live behind authenticated HTTPS
endpoints (not just local file paths).

The driving use case: **CogniRunner** is a Jira Forge app that runs validators and
post-functions backed by AI. When a user runs CogniRunner with **LM Studio** as the
provider AND has the `doc-reader` MCP enabled in CogniRunner settings, the model
needs to read **Jira attachments** during inference. Today it can't, because:

- Jira attachments live on Atlassian's servers, accessed via authenticated REST API.
- doc-processor runs locally alongside LM Studio.
- doc-processor's `read-doc` tool only accepts `filePath: string` validated with
  `fs.existsSync()`.

CogniRunner has built a **Forge web trigger** (a public HTTPS endpoint) that serves
each attachment behind two short-lived secrets. doc-processor needs to grow the
ability to fetch from that URL with a Bearer header, decode the response, and feed
it into the existing extraction pipeline.

## How CogniRunner authenticates the request (background)

You don't need to implement any of this — but understanding it helps you reason
about the security rules below.

- For each attachment the model needs to see, CogniRunner mints a one-shot
  capability: a random `token` (URL `?t=` parameter) and a separate random `bearer`
  (Authorization header value).
- Both are stored in CogniRunner's KVS and bound to a single `attachmentId` for
  10 minutes.
- The model receives `url` + `authHeader` in its prompt and is instructed to call
  `read-doc` with them.
- When doc-processor (you) GETs the URL with the bearer header, CogniRunner's web
  trigger handler verifies both, deletes the KVS entry (single-use), then calls
  Jira's `/rest/api/3/attachment/content/<id>` endpoint as the installed Forge app
  (`api.asApp()`) and returns the binary base64-encoded.
- **Jira credentials never leave Atlassian's signed envelope.** What you hold is
  a one-shot capability, not a credential — it grants exactly one read of one
  specific attachment.

## API contract — what CogniRunner's web trigger returns

For each Jira attachment the model needs, CogniRunner generates a unique URL and
Bearer token, and includes both in the system prompt. The model then calls
`read-doc` with `url` + `authHeader`.

The web trigger:

- Method: `GET`
- Path: `https://api.atlassian.com/.../webtrigger/<id>?t=<token>` (varies per install)
- Required header: `Authorization: Bearer <bearer>`
- Response on success: HTTP 200, `Content-Type: application/json`, body:
  ```json
  {
    "data": "<base64-encoded file content>",
    "filename": "invoice.pdf",
    "mimeType": "application/pdf",
    "size": 256832
  }
  ```
- Response on failure:
  - `401` — bearer mismatch (token was leaked but not the bearer)
  - `404` — token expired or already consumed (each token is single-use, 10-min TTL)
  - `502` — CogniRunner couldn't fetch from Jira (rare, transient)
  - `500` — unexpected error

doc-processor MUST treat each URL as **single-use**: a 404 on retry means the token
already worked once. Don't auto-retry on 404.

## Security rules for `read-doc` (mandatory)

The `url` and `authHeader` arguments carry a one-shot capability that grants access
to a single Jira attachment for ten minutes. Treat them with the same care as
short-lived API credentials:

- **Do NOT log the `authHeader` value.** If you must log that a fetch happened,
  log only the host and path of the URL, never the `Authorization` header. If you
  log the URL, redact the `t=` query parameter. A safe one-liner:
  `console.log("read-doc URL fetch:", new URL(url).host, "(token redacted)")`.
- **Do NOT cache** the fetched payload, the URL, or the auth header anywhere
  (memory, disk, key-value store, response cache, etc.). Tokens are single-use,
  so caching has no benefit and creates a leak surface.
- **Do NOT auto-retry** on `401` or `404`. A `401` means the bearer was wrong
  (do not retry — surface the error). A `404` means the token already worked
  once or expired (do not retry — the caller must mint a new one).
- **Do NOT follow redirects** that change the host. If the response is `3xx`,
  abort with an error (the legitimate web trigger never redirects).
- **Do NOT downgrade to HTTP.** Reject any URL that isn't `https://` (already
  enforced by the helper below).
- **Do NOT pass `authHeader` to any other tool, helper, or upload path.** It is
  used exactly once by `fetchToTempFile` and then forgotten.
- **Do clean up the temp file** even on processing errors (use `try/finally`).

## Required changes to `read-doc`

### 1. Extend the input schema

The current schema (verified from `src/index.js` in your repo):

```json
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "Local file path..." },
    "action":   { "type": "string", "enum": ["summary", "indepth", "focused"] },
    "query":    { "type": "string", "description": "(focused only) the question" }
  },
  "required": ["filePath", "action"]
}
```

Change to allow EITHER local path OR remote URL:

```json
{
  "type": "object",
  "properties": {
    "filePath":   { "type": "string", "description": "Local file path. Use this OR url+authHeader." },
    "url":        { "type": "string", "description": "HTTPS URL returning {data:base64, filename, mimeType, size} JSON. Use this OR filePath." },
    "authHeader": { "type": "string", "description": "Value for the Authorization header (e.g. 'Bearer abc123'). Required when url is set." },
    "filename":   { "type": "string", "description": "(optional) override filename from the response — used to choose the temp file extension if the response doesn't include one" },
    "action":     { "type": "string", "enum": ["summary", "indepth", "focused"] },
    "query":      { "type": "string", "description": "(focused only) the question" }
  },
  "required": ["action"],
  "anyOf": [
    { "required": ["filePath"] },
    { "required": ["url", "authHeader"] }
  ]
}
```

The `anyOf` enforces that EITHER a local path OR a URL+authHeader is provided.

### 2. New helper: `fetchToTempFile(url, authHeader, suggestedFilename)`

```javascript
async function fetchToTempFile(url, authHeader, suggestedFilename) {
  // Reject non-HTTPS for safety
  if (!/^https:\/\//i.test(url)) {
    throw new Error("read-doc URL must use https://");
  }

  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
    redirect: "error", // Don't follow redirects — legitimate web trigger never 3xx's
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`Attachment fetch failed: HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
  }

  const ct = resp.headers.get("Content-Type") || "";
  if (!/json/i.test(ct)) {
    throw new Error(`Attachment endpoint returned unexpected Content-Type: ${ct}`);
  }

  const payload = await resp.json();
  if (!payload.data || typeof payload.data !== "string") {
    throw new Error("Attachment payload missing required 'data' field (base64)");
  }

  const filename = payload.filename || suggestedFilename || `attachment-${Date.now()}.bin`;
  const buffer = Buffer.from(payload.data, "base64");

  // Enforce a size limit (configurable via env, default 50MB)
  const maxBytes = Number(process.env.READ_DOC_MAX_BYTES) || 50 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error(`Attachment too large: ${buffer.length} bytes (limit ${maxBytes})`);
  }

  // Write to a per-call temp dir so cleanup is simple
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "doc-reader-"));
  const tempPath = path.join(tempDir, filename);
  await fs.promises.writeFile(tempPath, buffer);

  return { tempPath, tempDir, mimeType: payload.mimeType, originalFilename: payload.filename };
}
```

Add the imports for `fs`, `path`, `os` if not already present.

### 3. Update the `read-doc` handler

```javascript
async function handleReadDoc(args) {
  let filePath = args.filePath;
  let cleanup = null;

  if (!filePath && args.url && args.authHeader) {
    const fetched = await fetchToTempFile(args.url, args.authHeader, args.filename);
    filePath = fetched.tempPath;
    cleanup = async () => {
      try {
        await fs.promises.unlink(fetched.tempPath);
        await fs.promises.rmdir(fetched.tempDir);
      } catch { /* best-effort */ }
    };
  }

  if (!filePath) {
    throw new Error("read-doc requires either filePath OR url+authHeader");
  }

  try {
    // EXISTING logic — process the file at filePath
    return await existingReadDocImpl(filePath, args.action, args.query);
  } finally {
    if (cleanup) await cleanup();
  }
}
```

### 4. Configuration

Add an env var:

- `READ_DOC_MAX_BYTES` (default: `52428800` = 50 MB) — caps fetched payload size.

Document it in the README.

### 5. Tests

- **Unit**: `fetchToTempFile` with a mocked `fetch` returning valid JSON, oversized
  payload (rejected), wrong Content-Type (rejected), HTTP 401 (rejected), HTTP 404
  (rejected with non-retry hint).
- **Integration**: spin up an Express test server that returns
  `{data: base64('hello world'), filename: 'test.txt', mimeType: 'text/plain'}`,
  call `read-doc` with the URL, assert the existing `summary` action returns text
  containing `hello world`.
- **Backward compat**: existing `filePath`-based tests must continue to pass
  unchanged.

### 6. README update

Add a section "Reading from remote URLs":

- Explain the URL+authHeader variant.
- Note: response must be JSON of shape `{data: base64, filename, mimeType, size?}`.
- Note: URLs are treated as single-use (no auto-retry on 404).
- Note: the `READ_DOC_MAX_BYTES` env var.
- Example: a CogniRunner-style integration.

### 7. Backward compatibility — non-negotiable

- Existing `filePath`-only callers work without any change.
- The `anyOf` schema means both shapes are valid.
- No changes to other tools (`create-doc`, `edit-doc`, etc.) in this PR — they
  continue to use local paths.

## Out of scope for THIS extension

- Receiving uploads (i.e. `create-doc` writing back to a remote endpoint). Different
  direction, different API contract, different security considerations. Separate
  spec if/when CogniRunner adds the document-creation feature.
- Caching fetched payloads. Tokens are single-use, so caching is pointless. If a
  later use case needs caching, add it then.
- Streaming fetch for very large files. The 50MB default cap covers typical
  Jira attachment sizes. Streaming is a separate concern.
- Other tools (`list-documents`, `dna`, etc.) — they're registry queries, no URL
  needed.

## Acceptance criteria

- [ ] `read-doc` schema accepts the `anyOf` shape above.
- [ ] `fetchToTempFile` validates URL is `https://`, response is JSON, payload size
      is under cap.
- [ ] Single fetched file is written to a unique temp dir, processed, and the temp
      dir is cleaned up regardless of success or error.
- [ ] All existing tests pass unchanged.
- [ ] New tests cover happy path + the four failure modes (oversized, wrong
      content-type, 401, 404).
- [ ] README documents the new variant.
- [ ] One example `mcp.json` snippet showing how to wire CogniRunner-served URLs
      (or pointing to CogniRunner's docs for that wiring).
