/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Rich, realistic, LARGE issue content so the AI receives big, challenging
// issue objects (not thin one-liners). Produces ADF descriptions with repro
// steps, an environment table, a stack trace, impact panel and acceptance
// criteria — roughly 1.5–2.5 KB of text each, varied by seed.

import { doc, p } from "./adf.mjs";

const AREAS = ["checkout", "authentication", "search", "notifications", "billing", "import/export", "dashboard", "API gateway"];
const BROWSERS = ["Safari 17.4 (macOS 14.4)", "Chrome 124 (Windows 11)", "Firefox 125 (Ubuntu 22.04)", "Edge 124 (Windows 10)"];
const SERVICES = ["payments-svc", "auth-svc", "search-indexer", "webhook-dispatcher", "billing-worker"];

const bullet = (items) => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });
const ordered = (items) => ({ type: "orderedList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });
const heading = (text, level = 3) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const code = (text, lang = "text") => ({ type: "codeBlock", attrs: { language: lang }, content: [{ type: "text", text }] });
const panel = (text, panelType = "warning") => ({ type: "panel", attrs: { panelType }, content: [p(text)] });
function table(rows) {
  return {
    type: "table", attrs: {},
    content: rows.map((r, i) => ({
      type: "tableRow",
      content: r.map((c) => ({ type: i === 0 ? "tableHeader" : "tableCell", content: [p(String(c))] })),
    })),
  };
}

const pick = (arr, n) => arr[n % arr.length];

/** A large, realistic incident/bug report ADF document. */
export function richIncidentAdf(seed = 0) {
  const area = pick(AREAS, seed);
  const browser = pick(BROWSERS, seed + 1);
  const svc = pick(SERVICES, seed + 2);
  const code5xx = 500 + (seed % 4) * 2; // 500/502/504/506-ish
  const pctImpact = 2 + (seed % 9);
  const stack = `${svc}.handleRequest (/${svc}/src/handler.js:142)
  at processTransaction (/${svc}/src/tx.js:88)
  at async Router.dispatch (/${svc}/node_modules/router/index.js:55)
TypeError: Cannot read properties of undefined (reading 'token')
  at validateSession (/${svc}/src/session.js:31)
  at ${svc}.handleRequest (/${svc}/src/handler.js:139)`;

  return doc(
    heading(`Incident: intermittent HTTP ${code5xx} in ${area}`, 2),
    p(`Multiple customers report intermittent failures in the ${area} flow over the last 36 hours. The error surfaces as an HTTP ${code5xx} returned by ${svc} and appears correlated with the v2.3 rollout. Estimated ${pctImpact}% of affected-flow requests fail. This was first noticed by the on-call engineer after a spike in 5xx alerts and confirmed via customer support tickets.`),
    heading("Steps to reproduce"),
    ordered([
      `Sign in as a returning user on ${browser}.`,
      `Navigate to the ${area} screen and begin the primary action.`,
      "Use a saved payment method / cached credential (fresh sessions do not reproduce).",
      "Submit; observe the request hang ~8s then fail.",
      "Retrying immediately succeeds ~60% of the time, which is why it slipped past QA.",
    ]),
    heading("Environment"),
    table([
      ["Attribute", "Value"],
      ["Service", svc],
      ["Version", "2.3.0 (rolled out 36h ago)"],
      ["Browser/OS", browser],
      ["Region", pick(["us-east-1", "eu-west-1", "ap-southeast-2"], seed)],
      ["Feature flag", `${area}-new-pipeline = ON`],
    ]),
    heading("Observed error / stack trace"),
    code(stack, "text"),
    p("The null `token` strongly suggests a session-refresh race introduced when the new pipeline began reading the session before the refresh middleware completed under load."),
    heading("Impact"),
    panel(`Customer-facing: ~${pctImpact}% of ${area} attempts fail intermittently. Revenue and trust impact is material; support volume is climbing. Severity assessed as High.`, "error"),
    heading("Hypotheses considered"),
    bullet([
      "Session-refresh race in the v2.3 pipeline (most likely).",
      "Connection-pool exhaustion in " + svc + " under burst load.",
      "Stale CDN cache serving a mismatched client bundle.",
    ]),
    heading("Acceptance criteria"),
    bullet([
      `No HTTP ${code5xx} from ${svc} for the ${area} flow over a 24h soak at 2x peak.`,
      "Root cause documented with a regression test that fails on the current build.",
      "Roll-forward fix behind the existing feature flag with a tested rollback.",
    ]),
    p("Notes: please attach HAR captures and correlation IDs to this ticket. Prior related incidents in this area were resolved by serializing the refresh; that mitigation may apply here as well."),
  );
}

/** A large plain-text body (for text custom fields / non-ADF contexts). */
export function richPlainText(seed = 0) {
  const area = pick(AREAS, seed);
  return [
    `Detailed report for the ${area} regression. `,
    `Customers on ${pick(BROWSERS, seed)} hit intermittent failures using saved credentials after the v2.3 rollout. `,
    "Repro: sign in as a returning user, start the primary action with a cached credential, submit, observe an ~8s hang then failure; immediate retry often succeeds. ",
    `Impact ~${2 + (seed % 9)}% of attempts. Suspected session-refresh race. `,
    "Acceptance: zero 5xx over a 24h soak at 2x peak, documented root cause with a failing regression test, and a flag-gated roll-forward with tested rollback. ",
    "Please attach HAR captures and correlation IDs. Related prior incidents were fixed by serializing the refresh.",
  ].join("");
}
