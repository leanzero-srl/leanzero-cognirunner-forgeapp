/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline stand-in for @forge/api (and the Queue from @forge/events) so modules that
// import them at top level (src/listeners.js, src/scheduled-jobs.js) load in unit tests.
// Every Jira call is recorded; tests can script responses via __respond(fn).
const calls = [];
let responder = null;

const fakeResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, statusText: String(status),
  headers: { get: () => null },
  json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

export const route = (strings, ...vals) => strings.reduce((acc, s, i) => acc + s + (i < vals.length ? String(vals[i]) : ""), "");

const requestJira = async (path, opts = {}) => {
  calls.push({ path: String(path), opts });
  if (responder) return responder(String(path), opts);
  return fakeResponse(404, { errorMessages: ["mock: no responder"] });
};

// Confluence goes through the SAME scripted responder, so a test that wants to drive
// src/confluence-client.js without injecting `deps.request` can. Paths are recorded with
// their product so an assertion can tell a Jira call from a Confluence one.
const requestConfluence = async (path, opts = {}) => {
  calls.push({ path: String(path), opts, product: "confluence" });
  if (responder) return responder(String(path), opts, "confluence");
  return fakeResponse(404, { errorMessages: ["mock: no responder"] });
};

const api = {
  asApp: () => ({ requestJira, requestConfluence }),
  asUser: () => ({ requestJira, requestConfluence }),
  __calls: calls,
  __reset() { calls.length = 0; responder = null; },
  __respond(fn) { responder = fn; },
  __response: fakeResponse,
};

export const fetch = async () => fakeResponse(500, "mock fetch");
export const webTrigger = { getUrl: async (key) => `https://mock.webtrigger/${key}` };
export const getAppContext = () => ({ environmentAri: null });
// authorize() from @forge/api — unused by the offline paths, present so index.js imports resolve.
export const authorize = () => ({ onJira: async () => [], onJiraProject: () => ({}), onJiraIssue: () => ({}) });
export default api;

// @forge/events subset
export const pushed = [];
export class Queue {
  constructor({ key }) { this.key = key; }
  async push(ev) { for (const event of Array.isArray(ev) ? ev : [ev]) pushed.push({ queue: this.key, ...event }); return { jobId: `mockjob-${pushed.length}` }; }
  getJob() { return { cancel: async () => {} }; }
}

export const InvocationErrorCode = { FUNCTION_RETRY_REQUEST: "FUNCTION_RETRY_REQUEST" };
export class InvocationError {
  constructor(retryOptions) { return { _retry: true, retryOptions }; }
}
