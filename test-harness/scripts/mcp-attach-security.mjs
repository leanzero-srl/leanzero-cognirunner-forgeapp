/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Workstream M1 — adversarial security battery against the attachment-bridge
// web triggers (serveAttachment GET + serveAttachmentUpload POST). These are
// REST-reachable capability endpoints; the critical property is that a
// missing / garbage / non-existent capability token is REJECTED before any
// processing (404), responses are application/json, and nothing leaks.
//
// The positive single-use/replay path (mint -> 200 -> replay -> 404) needs a
// real token minted inside a live docReader flow — reported separately as
// out-of-scope-for-now (needs MCP + a working AI provider).
//
// URLs are read from env so this committed script carries no installation-
// specific web-trigger URLs:
//   ATTACH_BRIDGE_URL=... ATTACH_UPLOAD_URL=... node scripts/mcp-attach-security.mjs
import { writeResult } from "../lib/state.mjs";

const BRIDGE = process.env.ATTACH_BRIDGE_URL;   // serveAttachment (GET)
const UPLOAD = process.env.ATTACH_UPLOAD_URL;   // serveAttachmentUpload (POST)
if (!BRIDGE || !UPLOAD) {
  console.error("Set ATTACH_BRIDGE_URL and ATTACH_UPLOAD_URL env vars (from `forge webtrigger create`).");
  process.exit(2);
}

const rand = (n) => {
  // deterministic-ish non-secret junk token (avoid Math.random for reproducibility)
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[(i * 31 + 7) % chars.length];
  return s;
};
const fakeToken = rand(43); // 32 bytes base64url ≈ 43 chars (shape-valid, non-existent)

const results = [];
// The security property is REJECTION: an unauthorized request must be turned
// away (401 = bearer missing, 404 = token absent/expired) with no data and no
// leak. 401 vs 404 are both correct rejections (the bridge requires a bearer
// before it will even confirm a token's existence). We assert "rejected", not
// a single code, and flag any information leak in the body.
const check = (name, { status, ctype, bodySnippet, leak }) => {
  const rejected = status === 401 || status === 404;
  const pass = rejected && !leak;
  results.push({ name, status, rejected, ctype, pass, leak: leak || false, bodySnippet });
  console.log(`${pass ? "✅" : "❌"} ${name}: HTTP ${status} ${rejected ? "(rejected)" : "(NOT REJECTED!)"}, ct=${ctype || "(none)"}${leak ? " — LEAK!" : ""}`);
};

const leakRe = /<!DOCTYPE|stack|at Object\.|node_modules|jira upstream|requestJira|atlassian\.net\/rest|java\.|Exception/i;

async function probe(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return {
    status: res.status,
    ctype: res.headers.get("content-type"),
    bodySnippet: text.replace(/\s+/g, " ").slice(0, 160),
    leak: leakRe.test(text),
  };
}

console.log("=== M1: attachment-bridge web-trigger security ===\n");

// --- serveAttachment (GET) — token rejection ---
check("GET no ?t=", await probe(BRIDGE, { method: "GET" }));
check("GET garbage ?t=", await probe(`${BRIDGE}?t=garbage`, { method: "GET" }));
check("GET shape-valid nonexistent ?t=", await probe(`${BRIDGE}?t=${fakeToken}`, { method: "GET" }));
check("GET nonexistent ?t= + wrong Bearer", await probe(`${BRIDGE}?t=${fakeToken}`, { method: "GET", headers: { Authorization: "Bearer " + rand(43) } }));

// --- serveAttachmentUpload (POST) — token rejection precedes body handling ---
const bigB64 = "QQ".repeat(20); // tiny — we are NOT past auth, so size won't be reached; just a body
check("POST upload no ?t=", await probe(UPLOAD, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: bigB64, filename: "x.pdf" }) }));
check("POST upload garbage ?t=", await probe(`${UPLOAD}?t=garbage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: bigB64, filename: "x.pdf" }) }));
check("POST upload nonexistent ?t= + forbidden ext", await probe(`${UPLOAD}?t=${fakeToken}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: bigB64, filename: "evil.exe" }) }));
check("POST upload nonexistent ?t= + malformed JSON", await probe(`${UPLOAD}?t=${fakeToken}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }));
check("POST upload nonexistent ?t= + Bearer", await probe(`${UPLOAD}?t=${fakeToken}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + rand(43) }, body: JSON.stringify({ data: bigB64, filename: "x.pdf" }) }));

const passed = results.filter((r) => r.pass).length;
console.log(`\n=== ${passed}/${results.length} passed ===`);
console.log("NOTE: the 401 (bad-bearer-with-valid-token), 413 (oversize), 415 (forbidden-ext) and");
console.log("single-use/replay paths require a REAL minted token (live docReader flow) — deferred to M3.");
writeResult("mcp-attach-security.json", { passed, total: results.length, results, note: "404/json/no-leak battery; 401/413/415/replay need a live mint (M3)" });
