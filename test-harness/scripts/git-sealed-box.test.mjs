/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: the GitHub Actions sealed box in src/git-providers.js.
//
// Why this file exists separately from git-providers.test.mjs: a wrong BLAKE2b
// or a wrong nonce produces ciphertext that looks perfectly fine, PUTs to
// GitHub with a 201, and then silently fails to decrypt inside the customer's
// Actions runner — a defect nobody sees until a pipeline run. So the digest is
// checked against vectors from an INDEPENDENT implementation (CPython's
// hashlib.blake2b, which wraps the reference C code) and the whole box is
// checked to round-trip against the crypto_box_seal LAYOUT (epk ‖ box, nonce =
// BLAKE2b-24(epk ‖ rpk)) computed here from primitives, not from the code
// under test.
//
// Run: node scripts/git-sealed-box.test.mjs   (auto-discovered by run-offline.mjs)

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { blake2b, sealBox, sealSecretForGithub } = await import(
  path.join(here, "..", "..", "src", "git-providers.js")
);
const nacl = (await import("tweetnacl")).default;

let checks = 0;
const eq = (a, b, msg) => { checks++; assert.deepEqual(a, b, msg); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };

const hex = (u8) => Buffer.from(u8).toString("hex");
const bytes = (s) => new Uint8Array(Buffer.from(s, "utf8"));

/* ---- 1. BLAKE2b vectors (CPython hashlib.blake2b, digest_size=N) ---- */
eq(hex(blake2b(bytes(""), 64)),
  "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419" +
  "d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
  "blake2b-512 of the empty string");
eq(hex(blake2b(bytes("abc"), 64)),
  "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1" +
  "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
  "blake2b-512 of 'abc' (RFC 7693 appendix A)");
eq(hex(blake2b(bytes("abc"), 32)),
  "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
  "blake2b-256 of 'abc'");
eq(hex(blake2b(bytes("abc"), 48)),
  "6f56a82c8e7ef526dfe182eb5212f7db9df1317e57815dbda46083fc30f54ee6" +
  "c66ba83be64b302d7cba6ce15bb556f4",
  "blake2b-384 of 'abc'");
eq(hex(blake2b(bytes("abc"), 1)), "6b", "blake2b-8 of 'abc'");
// THE one that matters: digest length is part of the parameter block, so a
// 24-byte digest is NOT a truncated 64-byte digest. If anyone ever "optimises"
// this to crypto.createHash('blake2b512').slice(0,24), this assertion fails.
eq(hex(blake2b(bytes("abc"), 24)), "56a17e38cc371a46b12c32f18e0c61de2a84e9c2555b114e",
  "blake2b-192 of 'abc' — the sealed-box nonce length");
ok(hex(blake2b(bytes("abc"), 64)).slice(0, 48) !== hex(blake2b(bytes("abc"), 24)),
  "a 24-byte digest is not the 64-byte digest truncated");
// Multi-block input (768 bytes = 6 compressions + the final block).
const long = new Uint8Array(768);
for (let i = 0; i < 768; i++) long[i] = i % 256;
eq(hex(blake2b(long, 32)), "b8007121274217790e2923e0ad7027986e5a99d5531ef6ae7d294140fc81615d",
  "blake2b-256 over 768 bytes (multi-block path)");
// Exactly one block boundary (128 bytes) — the classic off-by-one in the loop.
eq(hex(blake2b(long.slice(0, 128), 32)),
  hex(blake2b(new Uint8Array(long.buffer, 0, 128), 32)), "128-byte input is stable");
assert.throws(() => blake2b(bytes("x"), 0), /outlen/, "outlen 0 is refused");
assert.throws(() => blake2b(bytes("x"), 65), /outlen/, "outlen 65 is refused");
checks += 2;

/* ---- 2. crypto_box_seal layout and round-trip ---- */
const kp = nacl.box.keyPair();
const msg = bytes("a-forge-api-token-value");
const sealed = sealBox(msg, kp.publicKey);
eq(sealed.length, 32 + msg.length + 16, "sealed = 32-byte epk + box (+16 MAC)");

// Open it the way libsodium's crypto_box_seal_open does, from primitives.
const epk = sealed.slice(0, 32);
const pre = new Uint8Array(64);
pre.set(epk, 0);
pre.set(kp.publicKey, 32);
const opened = nacl.box.open(sealed.slice(32), blake2b(pre, 24), epk, kp.secretKey);
eq(opened && Buffer.from(opened).toString("utf8"), "a-forge-api-token-value",
  "the recipient's secret key opens the box");

// A DIFFERENT recipient cannot open it.
const other = nacl.box.keyPair();
ok(!nacl.box.open(sealed.slice(32), blake2b(pre, 24), epk, other.secretKey),
  "another key cannot open the box");

// The ephemeral key is fresh every time — identical plaintext, different bytes.
const a = sealBox(msg, kp.publicKey);
const b = sealBox(msg, kp.publicKey);
ok(hex(a) !== hex(b), "every seal uses a FRESH ephemeral key (no nonce reuse)");

// Deterministic vector: with a pinned ephemeral key the output is reproducible,
// which is what makes a future refactor diffable.
const fixedSeed = new Uint8Array(32).fill(7);
const fixedEph = nacl.box.keyPair.fromSecretKey(fixedSeed);
const det1 = sealBox(msg, kp.publicKey, fixedEph);
const det2 = sealBox(msg, kp.publicKey, fixedEph);
eq(hex(det1), hex(det2), "a pinned ephemeral key gives a deterministic box");
eq(hex(det1.slice(0, 32)), hex(fixedEph.publicKey), "the box carries the ephemeral PUBLIC key");

/* ---- 3. the base64 wrapper GitHub is actually handed ---- */
const b64 = sealSecretForGithub("plaintext", Buffer.from(kp.publicKey).toString("base64"));
ok(!b64.includes("plaintext"), "the base64 payload is not the plaintext");
const raw = new Uint8Array(Buffer.from(b64, "base64"));
const epk2 = raw.slice(0, 32);
const pre2 = new Uint8Array(64);
pre2.set(epk2, 0);
pre2.set(kp.publicKey, 32);
eq(Buffer.from(nacl.box.open(raw.slice(32), blake2b(pre2, 24), epk2, kp.secretKey)).toString("utf8"),
  "plaintext", "sealSecretForGithub round-trips");
assert.throws(() => sealBox(msg, new Uint8Array(31)), /32 bytes/, "a short public key is refused");
checks++;

console.log(`git-sealed-box: ${checks} assertions passed`);
