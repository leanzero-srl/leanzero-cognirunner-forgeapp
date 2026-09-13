/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of F-466 — an API token's ROLE actually gates the Rules REST API.
 *
 * Before F-466 every token on this surface was admin-in-effect whatever its `role` said,
 * so the only honest test is a THREE-WAY one on the SAME routes: mint viewer, editor and
 * admin, and show each route answering differently for each. A single token proving a 403
 * proves nothing — it could be broken for everyone.
 *
 * THE FLOORS THIS ASSERTS, read off src/rules-api.js and not guessed:
 *   ?resource=listeners  GET  → viewer   POST → editor
 *   ?resource=agents     GET  → EDITOR   (not viewer: listing Virtual Administrators is
 *                                         an editor floor, which is why the viewer arm
 *                                         below expects 403 and not 200)
 *   ?resource=agents&id=..&part=drafts   → ADMIN
 * Every refusal must be `403 {reason:"no-permission", needsRole:<level>}` — one refusal
 * shape, the same one the resolvers and the admin UI speak.
 *
 * THE PROVEN NEGATIVE. Every 403 here is paired with the SAME request on a stronger
 * token answering 200 on the SAME route. A 403 without that pair is indistinguishable
 * from a broken route.
 *
 * TOKENS ARE MINTED AND REVOKED BY THIS SCRIPT and their secrets never leave memory:
 * they are not printed, not written to the evidence file, and `getApiTokens` is re-read
 * at the end to show all three revoked.
 *
 *   HARNESS_ADMIN_ACCOUNT_ID=... node scripts/rules-api-roles-live.mjs
 */
import fs from "node:fs";
import { testState } from "../lib/rules-api.mjs";

const ACCT = process.env.HARNESS_ADMIN_ACCOUNT_ID;
const OUT = new URL("../results/rules-api-roles", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const evidence = { checks: [] };
const check = (label, ok, data = {}) => {
  if (!ok) failures += 1;
  evidence.checks.push({ label, ok, ...data });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
};
const call = async (functionKey, payload = {}) => {
  const r = await testState.post({ action: "invokeResolver", functionKey, accountId: ACCT, payload });
  if (r.status !== 200) throw new Error(`${functionKey} HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};

const minted = [];   // { role, id, token } — `token` never leaves this process
const req = async (token, path, { method = "GET", body } = {}) => {
  const res = await fetch(`${evidence.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t.slice(0, 200) }; }
  return { status: res.status, body: b };
};
const refusal = (r, level) => r.status === 403 && r.body && r.body.reason === "no-permission" && r.body.needsRole === level;

const main = async () => {
  const u = await testState.get("rulesApiUrl");
  evidence.url = u.body.url;                      // a secret: compared and used, never printed

  for (const role of ["viewer", "editor", "admin"]) {
    const r = await call("createApiToken", { name: `F-466 roles ${role} ${Date.now().toString(36)}`, role });
    check(`a ${role} token was minted and the row records that role`, r.success === true && r.row && r.row.role === role,
      { id: r.row && r.row.id, role: r.row && r.row.role, prefix: r.row && r.row.prefix });
    minted.push({ role, id: r.row && r.row.id, token: r.token });
  }
  const tok = (role) => minted.find((m) => m.role === role).token;

  // ── ?resource=listeners ────────────────────────────────────────────────────
  const vGet = await req(tok("viewer"), "?resource=listeners");
  check("viewer GET ?resource=listeners → 200", vGet.status === 200 && Array.isArray(vGet.body.listeners),
    { status: vGet.status, listeners: vGet.body && (vGet.body.listeners || []).length });

  /* The body IS the item (or `{listeners:[…]}` for a batch), and a single create answers
     201 — src/rules-api.js, `method === "POST"` with no action. */
  const draft = (name) => ({ name, enabled: false, events: ["avi:jira:updated:issue"], mode: "script", functions: [{ id: "fn-1", name: "noop", code: "return true;" }] });
  const vPost = await req(tok("viewer"), "?resource=listeners", { method: "POST", body: draft("F-466 viewer must not create") });
  check('viewer POST ?resource=listeners → 403 {reason:"no-permission", needsRole:"editor"}', refusal(vPost, "editor"),
    { status: vPost.status, reason: vPost.body && vPost.body.reason, needsRole: vPost.body && vPost.body.needsRole, hint: vPost.body && vPost.body.hint });

  const name = `F-466 editor created ${Date.now().toString(36)}`;
  const ePost = await req(tok("editor"), "?resource=listeners", { method: "POST", body: draft(name) });
  check("editor POST ?resource=listeners → 201 created, on the SAME route the viewer was refused on",
    ePost.status === 201 && ePost.body && ePost.body.listener && ePost.body.listener.id != null,
    { status: ePost.status, id: ePost.body && ePost.body.listener && ePost.body.listener.id });
  evidence.createdListener = ePost.body && ePost.body.listener && ePost.body.listener.id;

  // SECOND READ: the row the editor created is really there, seen by a different principal.
  const back = (await call("getListeners")).listeners || [];
  check("the editor's listener is readable back through the admin resolver (it was really written)",
    back.some((l) => l.id === evidence.createdListener && l.name === name),
    { id: evidence.createdListener, savedByRole: (back.find((l) => l.id === evidence.createdListener) || {}).savedByRole });

  const eGet = await req(tok("editor"), "?resource=listeners");
  check("editor GET ?resource=listeners → 200", eGet.status === 200, { status: eGet.status });
  const aGet = await req(tok("admin"), "?resource=listeners");
  check("admin GET ?resource=listeners → 200", aGet.status === 200, { status: aGet.status });

  // ── ?resource=agents ───────────────────────────────────────────────────────
  const vAgents = await req(tok("viewer"), "?resource=agents");
  check('viewer GET ?resource=agents → 403 needsRole:"editor" (listing VAs is an EDITOR floor, not viewer)',
    refusal(vAgents, "editor"), { status: vAgents.status, reason: vAgents.body && vAgents.body.reason, needsRole: vAgents.body && vAgents.body.needsRole });
  const eAgents = await req(tok("editor"), "?resource=agents");
  check("editor GET ?resource=agents → 200 — the same route, so the viewer's 403 is a ROLE answer, not a broken route",
    eAgents.status === 200, { status: eAgents.status, body: JSON.stringify(eAgents.body).slice(0, 160) });
  const aAgents = await req(tok("admin"), "?resource=agents");
  check("admin GET ?resource=agents → 200", aAgents.status === 200, { status: aAgents.status });

  // part=drafts — the ADMIN floor. There is no VA on this instance, so the question asked
  // is precisely the one the floor answers: the EDITOR is refused BEFORE the row is looked
  // up, and the ADMIN gets past the floor (whatever the unknown id then produces).
  const someId = "job_f466_probe";
  const eDrafts = await req(tok("editor"), `?resource=agents&id=${someId}&part=drafts`);
  check('editor GET agents part=drafts → 403 {reason:"no-permission", needsRole:"admin"}', refusal(eDrafts, "admin"),
    { status: eDrafts.status, reason: eDrafts.body && eDrafts.body.reason, needsRole: eDrafts.body && eDrafts.body.needsRole });
  const aDrafts = await req(tok("admin"), `?resource=agents&id=${someId}&part=drafts`);
  check("admin GET agents part=drafts passes the ADMIN floor (not a 403)", aDrafts.status !== 403,
    { status: aDrafts.status, body: JSON.stringify(aDrafts.body).slice(0, 200) });
  const vDrafts = await req(tok("viewer"), `?resource=agents&id=${someId}&part=drafts`);
  check("viewer GET agents part=drafts → 403 needsRole admin", refusal(vDrafts, "admin"),
    { status: vDrafts.status, needsRole: vDrafts.body && vDrafts.body.needsRole });
};

try { await main(); } catch (e) { console.error("THREW", e.stack); failures += 1; }
finally {
  if (evidence.createdListener) {
    try { await call("deleteListener", { id: evidence.createdListener }); } catch (e) { console.error("listener cleanup:", e.message); failures += 1; }
  }
  for (const m of minted) {
    if (!m.id) continue;
    try { await call("revokeApiToken", { id: m.id }); } catch (e) { console.error(`revoke ${m.role}:`, e.message); failures += 1; }
  }
  try {
    const rows = (await call("getApiTokens")).tokens || [];
    const mine = rows.filter((t) => minted.some((m) => m.id === t.id));
    check("all three minted tokens are revoked (present in the list, each with revokedAt set)",
      mine.length === minted.length && mine.every((t) => !!t.revokedAt),
      { rows: mine.map((t) => ({ id: t.id, role: t.role, revokedAt: t.revokedAt })) });
    const live = (await req(minted[0].token, "?resource=listeners"));
    check("a revoked token is refused at the door", live.status === 401 || live.status === 403, { status: live.status });
  } catch (e) { console.error("token verification:", e.message); failures += 1; }
  const { url, ...safe } = evidence;      // the web-trigger URL is a secret: never written out
  fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(safe, null, 2));
  console.log(`\n${failures} failure(s). Evidence: ${OUT}/evidence.json`);
  process.exit(failures ? 1 : 0);
}
