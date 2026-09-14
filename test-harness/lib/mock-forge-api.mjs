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

/*
 * F-669 — THE MOCK `route` MIRRORS `@forge/api`'s safeUrl SEMANTICS, INCLUDING THE THROW.
 *
 * It used to be a plain concatenation: it neither escaped nor refused anything. So every
 * offline assertion on `userSearchRoute(...)` proved STRING SHAPE only — they would have
 * passed identically if the builder had been changed to splice caller text into the
 * trusted slot as `route`${assumeTrustedRoute(path + "?query=" + query)}``, which is
 * exactly the regression `assumeTrustedRoute` newly makes possible. The one thing F-661
 * introduced was the one thing the suite could not see.
 *
 * The real rules, read from node_modules/@forge/api/out/safeUrl.js (escapeParameter /
 * route), reproduced here:
 *   - the tag starts in PATH mode and switches to QUERY mode as soon as a template
 *     FRAGMENT contains `?` or `#` — and the switch happens BEFORE the parameter that
 *     follows that fragment is escaped, which is why `?query=${q}` escapes `q` as a query
 *     value rather than refusing its slashes;
 *   - in PATH mode a `Route` object is spliced in VERBATIM; any other value is stringified
 *     and THROWS if it contains `/`, `\`, `?`, `#` or a `..` sequence (percent-encoded
 *     variants included);
 *   - in QUERY mode a `Route` and a plain value are both encodeURIComponent'd, and a
 *     URLSearchParams is stringified.
 *
 * The returned object carries `value` (what `routeString` reads) and a `toString` (what
 * `requestJira` records), so every existing assertion that compares a path keeps working.
 */
const DOUBLE_DOT = ["..", ".%2e", "%2e.", "%2e%2e", ".%2E", "%2E.", "%2E%2e"];
const DIRECTORY_PATH = ["/", "\\"];
const ENDS_PATH = ["?", "#"];
const containsOneOf = (needles, haystack) => needles.some((n) => haystack.includes(n));

class MockRoute {
  constructor(value) { this.value_ = value; }
  get value() { return this.value_; }
  set value(_) { throw new Error("modification of a Route is not allowed"); }
  toString() { return this.value_; }
}
export const isRoute = (x) => x instanceof MockRoute;

const escapeParameter = (parameter, mode) => {
  if (mode === "path") {
    if (isRoute(parameter)) return parameter.value;
    const p = String(parameter);
    if (containsOneOf(DOUBLE_DOT, p) || containsOneOf(ENDS_PATH, p) || containsOneOf(DIRECTORY_PATH, p)) {
      throw new Error("Disallowing path manipulation attempt. For more information see: https://go.atlassian.com/product-fetch-api-route");
    }
    return p;
  }
  if (isRoute(parameter)) return encodeURIComponent(parameter.value);
  if (parameter instanceof URLSearchParams) return parameter.toString();
  return encodeURIComponent(parameter);
};

export const route = (template, ...parameters) => {
  let mode = "path";
  let result = "";
  for (let i = 0; i < template.length; i++) {
    const fragment = template[i];
    if (containsOneOf(ENDS_PATH, fragment)) mode = "query";
    result += fragment;
    if (i >= parameters.length) break;
    result += escapeParameter(parameters[i], mode);
  }
  return new MockRoute(result);
};

// F-661 — src/jira-routes.js splices the ONE path constant into `route` as a pre-trusted
// Route so the real tag will not throw on its slashes. Same contract here: a Route goes
// into path position verbatim, and ONLY a Route may.
export const assumeTrustedRoute = (r) => new MockRoute(String(r));

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
