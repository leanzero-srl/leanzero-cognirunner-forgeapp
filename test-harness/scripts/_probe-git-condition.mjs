// Coder plan Part 0 probe (b): can the ONE existing condition expression read an issue entity
// property (issue.properties["cognirunner.git"]) — and does it still evaluate with N such
// conditions on N transitions of one workflow (the ≤10 expensive-ops question)?
// Uses the dev-manifest branch `probe-git-build` (missing property → TRUE, "success" → TRUE,
// anything else → FALSE). Cleans its PROBE- transitions and properties up afterwards.
import { post, getTransitions } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";
import { readFileSync } from "node:fs";

const s = loadState();
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const hook = async (body) => (await fetch(env.TESTSTATE_URL, { method: "POST", headers: { Authorization: `Bearer ${env.HARNESS_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const N = Number(process.argv[2] || 6);
const NAMES = Array.from({ length: N }, (_, i) => `PROBE-git-${i + 1}`);

const cleanup = async () => {
  const { top, wf } = await readWorkflow(s.workflowName);
  const b = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("PROBE-"));
  if (wf.transitions.length !== b) await updateWorkflow(top, wf);
};
await cleanup();
await attachSelfLoopRules(s.workflowName, s.hubStatusRef,
  NAMES.map((name) => ({ name, type: "condition", config: { ruleKind: "premade", conditionKind: "deterministic", ruleType: "probe-git-build" } })), 9501);

const mk = async (sum) => (await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: "10005" }, summary: sum } })).key;
const none = await mk("probe git: no property");
const good = await mk("probe git: build success");
const bad = await mk("probe git: build failure");
console.log("property writes:", JSON.stringify(await hook({ action: "probeProperty", issueKey: good, value: { build: { conclusion: "success", url: "https://example.com/run/1" }, pr: { approvals: 1 } } })).slice(0, 160),
  JSON.stringify(await hook({ action: "probeProperty", issueKey: bad, value: { build: { conclusion: "failure" } } })).slice(0, 120));
await new Promise((r) => setTimeout(r, 3000));
const verdicts = {};
for (const [label, key, expect] of [["no-property→SHOW", none, true], ["success→SHOW", good, true], ["failure→HIDE", bad, false]]) {
  const tr = await getTransitions(key);
  const names = (tr.transitions || []).map((t) => t.name);
  const present = NAMES.filter((n) => names.includes(n)).length;
  const ok = expect ? present === N : present === 0;
  verdicts[label] = { key, present: `${present}/${N}`, ok };
  console.log(`${ok ? "PASS" : "FAIL"} ${label} ${key}: ${present}/${N} probe transitions present`);
}
await hook({ action: "probeProperty", issueKey: good, remove: true });
await hook({ action: "probeProperty", issueKey: bad, remove: true });
await cleanup();
console.log(JSON.stringify({ N, verdicts, issues: [none, good, bad] }));
process.exit(Object.values(verdicts).every((v) => v.ok) ? 0 : 1);
