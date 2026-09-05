/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "../../static/_screenshot-harness/node_modules/playwright/index.mjs";
import { get, post, put, del, getIssue, getMyself, BASE } from "../lib/jira.mjs";
assert.equal(new URL(BASE).hostname, "wolfaenpak.atlassian.net");
const out = new URL("../results/workflow-simulation/", import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const tag = "cgr-workflow-" + Date.now().toString(36), evidence = { tag, checks: [], cleanup: [] };
let browser, key;
try {
  const types = await get("/rest/api/3/issue/createmeta/JT/issuetypes?maxResults=100");
  const type = (types.issueTypes || types.values).find(t => !t.subtask);
  key = (await post("/rest/api/3/issue", { fields: { project: { key: "JT" }, issuetype: { id: type.id }, summary: tag, labels: [tag] } })).key;
  await put(`/rest/api/3/issue/${key}/properties/${tag}`, { exists: true });
  const fields = ["summary", "labels", "assignee", "comment", "status"];
  const before = await getIssue(key, fields), me = await getMyself();
  const transitions = (await get(`/rest/api/3/issue/${key}/transitions`)).transitions;
  assert.ok(transitions.length);
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: new URL("../../../forge-live-harness/.auth/storage-state.json", import.meta.url).pathname, viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-261b-406e-b444-78c01c0d7772`, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator('iframe').first();
  await frame.getByRole("button", { name: "+ Add Rule", exact: true }).click({ timeout: 60000 });
  await frame.getByRole("button").filter({ hasText: /JT$/ }).click();
  await frame.locator("label", { hasText: /^Workflow$/ }).locator("..").getByRole("button").first().click();
  await frame.locator("label", { hasText: /^Transition$/ }).locator("..").getByRole("button").first().click();
  await frame.getByRole("button", { name: /Static Post Function/ }).click();
  await frame.locator(".recipe-bar-toggle").click();
  await frame.locator(".recipe-bar-body .dropdown-trigger").click();
  await frame.getByRole("option", { name: "Add / remove labels", exact: false }).click();
  await frame.getByText("Insert recipe", { exact: true }).click();
  const editor = frame.locator(".cm-content").first();
  await editor.fill("return api.context.issueKey;");
  await frame.locator(".btn-test-run").click();
  const run = async (name, code, success, expected, target = "") => {
    await editor.fill(code);
    await frame.locator(".test-panel input").fill(target);
    const verifyPointer = name === "created and cloned targets remain distinct";
    if (verifyPointer) {
      // Re-focusing the previously validated key reopens cached suggestions.
      // This is the real precondition that used to move Run Test during a click.
      await frame.locator(".issue-picker-dropdown").waitFor({ state: "visible" });
      await frame.locator(".test-panel").evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
      await frame.locator("body").evaluate(body => {
        body.__cgrPointer = [];
        for (const type of ["mousedown", "mouseup", "click"]) {
          body.addEventListener(type, event => {
            const button = body.querySelector(".btn-run-test");
            const panel = body.querySelector(".test-panel");
            body.__cgrPointer.push({
              type,
              target: event.target.closest("button")?.className || event.target.className,
              buttonTop: button.getBoundingClientRect().top,
              panelScrollTop: panel.scrollTop,
              dropdownOpen: !!body.querySelector(".issue-picker-dropdown"),
            });
          }, { once: true, capture: true });
        }
      });
    }
    const responsePromise = page.waitForResponse(r => (r.request().postData() || "").includes('"testPostFunction"'), { timeout: 40000 });
    await frame.locator(".btn-run-test").click();
    const response = await responsePromise;
    const data = (await response.json()).data?.invokeExtension?.response?.body;
    assert.equal(data.success, success, JSON.stringify(data));
    const request = response.request().postData();
    assert.ok(!request.includes('"runtime":"job"') && !request.includes('"runtime":"listener"'), "actual workflow runtime");
    await frame.locator(`.test-result.${success ? "test-pass" : "test-fail"}`).waitFor({ timeout: 40000 });
    const text = await frame.locator(".test-result").innerText();
    assert.match(text, expected, name + ": " + text);
    assert.doesNotMatch(text, /MOCK-1|Mock data/, name);
    if (verifyPointer) {
      const pointer = await frame.locator("body").evaluate(body => body.__cgrPointer);
      const down = pointer.find(e => e.type === "mousedown");
      const up = pointer.find(e => e.type === "mouseup");
      const click = pointer.find(e => e.type === "click");
      assert.ok(down.dropdownOpen && down.panelScrollTop > 0,
        "positive control: dropdown open and inner test panel scrolled at mouse down");
      assert.equal(down.target, "btn-run-test");
      assert.equal(up.target, "btn-run-test");
      assert.equal(click.target, "btn-run-test");
      assert.equal(down.buttonTop, up.buttonTop, "button stays under pointer through mouseup");
      evidence.pointer = pointer;
    }
    evidence.checks.push({ name, text, response: data });
    console.log("PASS", name);
  };
  await run("null context remains null", "if (api.context.issueKey !== null) throw Error('invented issue'); return 'null context retained';", true, /null context retained/);
  await run("null issue-bound action fails", "await api.addComment('must never write');", false, /needs a current issue/);
  await run("failed live read is visible", "await api.getIssue('JT-999999999');", false, /404|not found|does not exist/i);
  await run("invalid context JQL fails", "return 'must not run';", false, /JQL|400|Error/i, "this is invalid JQL (");
  await run("empty context JQL fails", "return 'must not run';", false, /no results/i, "project = JT AND key = JT-999999999");
  await run("empty transition rejected", "await api.transitionIssue('');", false, /transition.*id|non-empty/i, key);
  await run("real property gate", `const value = await api.getProperty('${tag}'); if (!value?.exists) throw Error('property missing'); return 'property gate retained';`, true, /property gate retained/, key);
  await run("full API stages writes", `await api.forIssue('${key}').setAssignee('${me.accountId}'); await api.forIssue('${key}').addLabels('${tag}-sim'); await api.forIssue('${key}').addComment('never written'); await api.forIssue('${key}').setProperty('${tag}',{exists:false}); return 'all writes staged';`, true, /all writes staged/);
  const transition = transitions[0];
  await run("transition name lookup and extra fields", `await api.transitionByName(${JSON.stringify(transition.name)}); await api.transitionIssue('${transition.id}',{fields:{summary:'never written'},update:{labels:[{add:'never-written'}]}}); return 'transitions staged';`, true, /transitions staged/, key);
  await run("created and cloned targets remain distinct", `const a=await api.createIssue({project:{key:'JT'},issuetype:{id:'${type.id}'},summary:'staged child'}); const b=await api.cloneIssue(); if(!a.key||!b.key||a.key===b.key||a.key===api.context.issueKey) throw Error('wrong staged identity'); await api.updateIssue(a.key,{labels:['child']}); await api.forIssue(b.key).addLabels('clone'); return 'distinct staged targets';`, true, /distinct staged targets/, key);
  for (const theme of ["light", "dark"]) {
    await frame.locator("html").evaluate((html, theme) => { html.setAttribute("data-color-mode", theme); html.setAttribute("data-theme", `${theme}:${theme}`); }, theme);
    await frame.locator(".test-panel").screenshot({ path: out + `workflow-${theme}.png`, animations: "disabled" });
  }
  assert.deepEqual((await getIssue(key, fields)).fields, before.fields);
  assert.deepEqual((await get(`/rest/api/3/issue/${key}/properties/${tag}`)).value, { exists: true });
  evidence.zeroWrites = { issue: key, fields, propertyUnchanged: true };
  evidence.pass = true;
} catch (e) { evidence.error = e.stack; console.error(e.stack); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (key) try {
    await del(`/rest/api/3/issue/${key}?deleteSubtasks=true`);
    await assert.rejects(() => getIssue(key, ["summary"]), e => e.status === 404);
    evidence.cleanup.push({ key, absent: true });
  } catch (e) { evidence.cleanup.push({ key, error: e.message }); process.exitCode = 1; }
  fs.writeFileSync(out + "evidence.json", JSON.stringify(evidence, null, 2));
}
