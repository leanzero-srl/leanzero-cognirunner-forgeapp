import { post, getTransitions } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";
const s = loadState();
const NAME = "PROBE-cond-field-equals";
// idempotent
{ const { top, wf } = await readWorkflow(s.workflowName); const b = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t)=>!String(t.name||"").startsWith("PROBE-"));
  if (wf.transitions.length!==b) await updateWorkflow(top, wf); }
await attachSelfLoopRules(s.workflowName, s.hubStatusRef,
  [{ name: NAME, type: "condition", config: { ruleKind:"premade", ruleType:"field-equals", fieldId:"summary", value:"VISIBLEPROBE" }}], 9401);
const mk = async (sum) => (await post("/rest/api/3/issue", { fields:{ project:{key:s.projectKey}, issuetype:{id:"10005"}, summary:sum }})).key;
const a = await mk("VISIBLEPROBE"); const b = await mk("hidden one");
await new Promise(r=>setTimeout(r,2500));
for (const [label,k] of [["should-SHOW",a],["should-HIDE",b]]) {
  const tr = await getTransitions(k);
  const present = (tr.transitions||[]).some(t=>t.name===NAME);
  console.log(`${label} ${k}: condition transition ${present?"PRESENT":"ABSENT"} in getTransitions  (all: ${(tr.transitions||[]).map(t=>t.name).filter(n=>n.startsWith("PROBE")||!n.startsWith("CT")).slice(0,8).join("|")})`);
}
console.log("issues:", a, b);
