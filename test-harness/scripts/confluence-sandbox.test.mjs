/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OFFLINE test for `api.confluence.*` in the static-PF sandbox (1.5 commit 6b, F-495).
 *
 * The four things that must be true, with a MOCK client standing in for
 * src/confluence-client.js (which has its own suite):
 *
 *   1. The surface IS the spec's member table — no second list in createApi().
 *   2. SIMULATION INTERCEPTS EVERY WRITE: createPage/updatePage/addComment never reach
 *      the client, they land on the SAME `changes` ledger and `executionLogs` as the Jira
 *      writes, and the READS stay live. A dry run that writes to Confluence is the whole
 *      reason this arm exists.
 *   3. NOT INSTALLED IS A LOUD STEP FAILURE, never a silent success — and it is the
 *      client's `confluence_unavailable` code that says so, through the ONE install memo.
 *   4. A real write records a real ledger row (so the write brake and the log agree).
 *
 * Run: node --import ../lib/register-mocks-index.mjs scripts/confluence-sandbox.test.mjs
 */
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";

const { createSandboxSession } = await import("../../src/index.js");
const { CONFLUENCE_API_MEMBERS, CONFLUENCE_WRITE_MEMBERS } = await import("../../src/shared/sandbox-api-spec.js");
const { ConfluenceError, resetConfluenceInstallMemo } = await import("../../src/confluence-client.js");

/** A client that records calls and answers whatever the arm wants. */
const mockClient = (answer) => {
  const calls = [];
  const client = { calls };
  for (const name of CONFLUENCE_API_MEMBERS) {
    client[name] = async (args) => {
      calls.push({ name, args });
      return answer(name, args);
    };
  }
  return client;
};

const session = (opts, client) =>
  createSandboxSession({ issueKey: "ABC-1", confluenceClient: client, ...opts });

// --- 1. the surface is the spec's ------------------------------------------
{
  resetConfluenceInstallMemo();
  const api = session({}, mockClient(() => ({ id: "1" }))).createApi();
  assert.ok(api.confluence && typeof api.confluence === "object", "api.confluence exists");
  for (const name of CONFLUENCE_API_MEMBERS) {
    assert.equal(typeof api.confluence[name], "function", `api.confluence.${name} is callable`);
  }
  assert.deepEqual(Object.keys(api.confluence).sort(), [...CONFLUENCE_API_MEMBERS].sort(),
    "the namespace has exactly the documented members — no undocumented extras");
  // api.forIssue() re-binds the issue surface; the Confluence namespace comes along.
  assert.equal(typeof api.forIssue("ABC-2").confluence.getPage, "function");
}

// --- 2. simulation intercepts every write; reads stay live ------------------
{
  resetConfluenceInstallMemo();
  const client = mockClient((name) => (name === "getPageByTitle" ? { id: "99", version: 3, title: "T", storage: "<p/>" } : { id: "99", version: 4 }));
  const s = session({ config: { simulationMode: true } }, client);
  const api = s.createApi();

  const read = await api.confluence.getPageByTitle({ spaceKey: "DOCS", title: "T" });
  assert.equal(read.id, "99", "reads stay LIVE in simulation");

  for (const name of CONFLUENCE_WRITE_MEMBERS) {
    const out = await api.confluence[name]({ id: "99", pageId: "99", version: 3, spaceKey: "DOCS", title: "T", storage: "<p>x</p>", body: "<p>c</p>" });
    assert.equal(out.simulated, true, `${name} returns a staged result in simulation`);
  }
  assert.deepEqual(client.calls.map((c) => c.name), ["getPageByTitle"],
    "NO write reached the Confluence client in simulation mode");
  assert.deepEqual(s.changes.map((c) => c.action), CONFLUENCE_WRITE_MEMBERS.map((n) => `confluence.${n}`),
    "every simulated write is on the SAME change ledger the Jira writes use");
  assert.ok(s.changes.every((c) => c.simulated === true && c.namespace === "confluence"), "staged rows are flagged simulated");
  assert.equal(s.executionLogs.filter((l) => l.startsWith("[SIMULATION] api.confluence.")).length, CONFLUENCE_WRITE_MEMBERS.length,
    "every simulated write is logged the way the Jira ones are");
}

// --- 3. not installed = a loud step failure --------------------------------
{
  resetConfluenceInstallMemo();
  const client = mockClient(() => { throw new ConfluenceError("confluence_unavailable", "probe: not installed"); });
  const s = session({}, client);
  const api = s.createApi();
  await assert.rejects(() => api.confluence.getPage({ id: "1" }), /confluence_unavailable/,
    "a not-installed site FAILS the step instead of returning nothing");
  // The memo took the answer, so the next call refuses without spending a second call.
  const before = client.calls.length;
  await assert.rejects(() => api.confluence.createPage({ spaceKey: "DOCS", title: "T", storage: "<p/>" }), /confluence_unavailable/);
  assert.equal(client.calls.length, before, "the ONE install memo short-circuits the second call");
  assert.equal(s.changes.length, 0, "a failed Confluence write records NO change");

  // Simulation must not paper over it either: a Test Run has to predict the failure.
  const sim = session({ config: { simulationMode: true } }, client).createApi();
  await assert.rejects(() => sim.confluence.addComment({ pageId: "1", body: "<p/>" }), /confluence_unavailable/,
    "simulation reports the not-installed failure rather than staging a write that can never land");
}

// --- 3b. the remote's own words never reach the step's error ---------------
{
  resetConfluenceInstallMemo();
  const client = mockClient(() => { throw new ConfluenceError("auth", "getPage: forbidden", { detail: "<html>SECRET-REMOTE-BODY</html>" }); });
  const api = session({}, client).createApi();
  await assert.rejects(() => api.confluence.getPage({ id: "1" }), (e) => {
    assert.match(e.message, /\(auth\)/, "the error names the code");
    assert.equal(e.confluenceCode, "auth");
    assert.ok(!/SECRET-REMOTE-BODY/.test(e.message), "untrusted remote bytes are NOT re-thrown into the step error");
    return true;
  });
}

// --- 4. a real write records a real ledger row -----------------------------
{
  resetConfluenceInstallMemo();
  const client = mockClient(() => ({ id: "555", title: "T", version: 1, url: "/wiki/x" }));
  const s = session({}, client);
  const page = await s.createApi().confluence.createPage({ spaceKey: "DOCS", title: "T", storage: "<p>x</p>" });
  assert.equal(page.id, "555", "the client's result is returned unchanged");
  assert.deepEqual(s.changes, [{ action: "confluence.createPage", namespace: "confluence", target: "555" }],
    "a real write is on the ledger the write brake counts");
  assert.equal(s.changes.length, 1);
}

// --- 4b. the write brake and the step budget both bite BEFORE the call -----
{
  resetConfluenceInstallMemo();
  const client = mockClient(() => ({ id: "1" }));
  const s = session({ maxWrites: 0 }, client);
  await assert.rejects(() => s.createApi().confluence.createPage({ spaceKey: "DOCS", title: "T", storage: "<p/>" }), /brake|limit|cap/i,
    "the write brake refuses a Confluence write like any other write");
  assert.equal(client.calls.length, 0, "the brake refuses BEFORE the side effect");

  const tight = session({ deadline: Date.now() + 1000 }, client);
  await assert.rejects(() => tight.createApi().confluence.getPage({ id: "1" }), /budget/i,
    "a call that cannot finish inside the remaining budget fails loudly instead of half-running");
  assert.equal(client.calls.length, 0, "no call is started without the budget to finish it");
}

resetConfluenceInstallMemo();
console.log("✓ confluence sandbox: surface, simulation intercept, not-installed failure, ledger, brake and budget passed");
