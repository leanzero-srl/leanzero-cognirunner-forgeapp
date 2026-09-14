/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE API-TOKEN LEASE — F-812.
 *
 * WHAT WENT WRONG. `va-shadow-door-live.mjs` minted `createApiToken { role: "admin" }`
 * every run and never revoked it: staging held SEVEN live `shadow-door <ts>` admin
 * bearers, each one a full-power key to the Rules REST API on a shared tenant, marching
 * toward `MAX_TOKENS` while the driver reported 23 pass. The driver even LOOKED fixed —
 * its `finally` called `invoke("deleteApiToken", { id })` under a `.catch(() => null)`,
 * and there is no `deleteApiToken` resolver. The revoke door is `revokeApiToken`
 * (src/index.js), so every one of those calls was an error swallowed by the catch. That
 * is the whole shape of this finding: the mint and the revoke were hand-rolled per
 * driver, so one driver could hold a WRONG resolver name for weeks and answer green.
 *
 * SO THE PAIR HAS ONE HOME. Three drivers mint REST tokens (va-shadow-door,
 * parity-doors, va-purge-carrier) and each hand-rolled mint+revoke its own way. The
 * name of the revoke door, the "did it actually revoke" question and the rule that a
 * minted token is released even on the crash path live HERE, once.
 *
 * TWO SHAPES, BECAUSE THE DRIVERS HAVE TWO SHAPES.
 *
 *   withApiToken(invoke, { name, role }, fn)
 *     The whole life of the token is one scope. `fn({ token, id, role })` runs, the
 *     token is revoked in a `finally` whether fn returned or threw, and the REVOKE
 *     ANSWER comes back to the caller so it can be ASSERTED rather than assumed.
 *
 *   createTokenLease(invoke)
 *     A register, for the drivers whose token is minted mid-run and used across steps
 *     that already own a big `finally`. `lease.mint(...)` mints and remembers;
 *     `lease.track(id)` remembers one minted elsewhere (parity-doors and
 *     va-purge-carrier mint their admin token through the dev hook's `mintApiToken`
 *     action, not the resolver); `lease.revokeAll()` returns one row per token so the
 *     driver's RESTORE block can grade it.
 *
 * NOTHING HERE EVER PRINTS OR RETURNS A TOKEN IN AN ERROR. The plaintext is handed to
 * `fn` and to nobody else; a refused mint is reported by the answer's `error` field
 * only, never by stringifying the mint body — F-646 is that lesson, and `createApiToken`
 * puts the plaintext at the TOP LEVEL of a successful body.
 *
 * INVOKE SHAPES. The three drivers' `invoke` helpers do not agree on where the JSON
 * lands: va-shadow-door returns `{ status, body }`, parity-doors returns `{ json }`.
 * `answerOf` accepts either, plus a bare object, so adopting the lease does not mean
 * rewriting a driver's transport.
 */

/** The resolver names, spelled ONCE. `deleteApiToken` does not exist (F-812). */
export const MINT_RESOLVER = "createApiToken";
export const REVOKE_RESOLVER = "revokeApiToken";
export const LIST_RESOLVER = "getApiTokens";

/** `{body}` / `{json}` / a bare answer -> the answer object (or `null`). */
export function answerOf(r) {
  if (!r || typeof r !== "object") return null;
  if (r.body && typeof r.body === "object") return r.body;
  if (r.json && typeof r.json === "object") return r.json;
  if ("body" in r || "json" in r) return null; // a transport shape whose payload did not parse
  return r;
}

/**
 * Mint one token. Returns `{ token, id, role, row }`.
 * THROWS on refusal with a message that carries the answer's `error` only — never the
 * body, which on the success path holds the plaintext.
 */
export async function mintApiToken(invoke, { name, role } = {}) {
  const r = await invoke(MINT_RESOLVER, { name, ...(role ? { role } : {}) });
  const a = answerOf(r);
  if (!(a && a.success && a.token && a.row && a.row.id)) {
    const why = (a && (a.error || a.message)) || "no token in the answer";
    throw new Error(`${MINT_RESOLVER}(${JSON.stringify(name)}${role ? `, role=${role}` : ""}) refused: ${String(why).slice(0, 200)}`);
  }
  return { token: a.token, id: a.row.id, role: a.row.role || null, row: a.row };
}

/**
 * Revoke one token by id. NEVER throws — a restore block must be able to try every id
 * it holds. Returns `{ id, revoked, error }`, which is the answer the caller grades.
 */
export async function revokeApiToken(invoke, id) {
  try {
    const a = answerOf(await invoke(REVOKE_RESOLVER, { id }));
    if (!a) return { id, revoked: false, error: "no answer from " + REVOKE_RESOLVER };
    /* `revoked: false` is the resolver's word for "no such row" — reported, not hidden:
       a token the driver believes it minted and the app has never heard of is a finding. */
    if (a.success !== true) return { id, revoked: false, error: String(a.error || "refused").slice(0, 200) };
    return { id, revoked: a.revoked === true, error: null };
  } catch (e) {
    return { id, revoked: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/** A register of every token this run minted, and the one call that releases them all. */
export function createTokenLease(invoke) {
  const ids = [];
  return {
    /** Mint and remember. The plaintext is RETURNED, never stored on the lease. */
    async mint(opts) {
      const t = await mintApiToken(invoke, opts);
      ids.push(t.id);
      return t;
    },
    /** Remember a token minted elsewhere (e.g. the dev hook's `mintApiToken` action). */
    track(id) {
      if (id && !ids.includes(id)) ids.push(id);
      return id;
    },
    /** The ids held, in mint order. */
    get ids() { return ids.slice(); },
    /** Revoke everything, newest first. Returns one graded row per token. */
    async revokeAll() {
      const out = [];
      for (const id of ids.slice().reverse()) out.push(await revokeApiToken(invoke, id));
      return out;
    },
  };
}

/**
 * The whole life of one token in one scope. Returns `{ value, revoke }` where `revoke`
 * is the `{ id, revoked, error }` row — the caller asserts it.
 * If `fn` throws, the token is STILL revoked and the error is rethrown with the revoke
 * row attached as `err.tokenRevoke`, so a crash report can still say what was released.
 */
export async function withApiToken(invoke, { name, role } = {}, fn) {
  const t = await mintApiToken(invoke, { name, role });
  let value, thrown = null;
  try {
    value = await fn({ token: t.token, id: t.id, role: t.role, row: t.row });
  } catch (e) {
    thrown = e;
  }
  const revoke = await revokeApiToken(invoke, t.id);
  if (thrown) { try { thrown.tokenRevoke = revoke; } catch { /* frozen error */ } throw thrown; }
  return { value, revoke };
}

/* ── THE SWEEP FILTER (F-812, second half) ───────────────────────────────────────
 *
 * The bearers F-812 counted are already on staging; a rule that stops the NEXT leak does
 * not revoke them. `scripts/api-token-sweep.mjs` does, and the decision of WHICH rows it
 * may touch lives here so it can be tested offline against a recorded `getApiTokens`
 * shape without a live run.
 *
 * THE FILTER IS DELIBERATELY NARROW. It matches a NAME PATTERN and nothing else: an
 * already-revoked row is skipped (revoking it again would be noise, and the second read
 * that proves the sweep worked would not be able to tell the two apart), and a row whose
 * name is not the driver's generated shape is never a candidate. The default pattern is
 * the exact one the shadow door mints — `shadow-door <epoch-ms>` — so the default sweep
 * cannot touch an integration's token that happens to be called "shadow door notes".
 */
export const SHADOW_DOOR_NAME = /^shadow-door \d+$/;

/** `--name-prefix=parity-` -> the anchored pattern for "a generated name starting with it". */
export function namePrefixPattern(prefix) {
  const p = String(prefix == null ? "" : prefix);
  if (!p) throw new Error("namePrefixPattern: an EMPTY prefix matches every token — refuse it rather than sweep the tenant");
  return new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/**
 * The rows a sweep may revoke: name matches, and the row is still LIVE.
 * Input is `getApiTokens().tokens` — public rows, which carry no secret beyond `prefix`
 * (the sweep prints neither).
 */
export function staleTokens(rows, pattern = SHADOW_DOOR_NAME) {
  return (Array.isArray(rows) ? rows : []).filter(
    (t) => t && !t.revokedAt && typeof t.name === "string" && pattern.test(t.name)
  );
}

/** The ONLY fields a sweep may print. `token` and `prefix` are deliberately absent. */
export const SWEEP_FIELDS = Object.freeze(["id", "name", "role", "createdAt", "revokedAt"]);

/** One row, reduced to the printable fields. */
export function sweepRow(t) {
  const out = {};
  for (const k of SWEEP_FIELDS) out[k] = t && t[k] !== undefined ? t[k] : null;
  return out;
}
