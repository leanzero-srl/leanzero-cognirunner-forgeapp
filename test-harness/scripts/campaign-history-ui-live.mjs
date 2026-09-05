/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '../../static/_screenshot-harness/node_modules/playwright/index.mjs';
const dir = new URL('../results/listeners-jobs-campaign/', import.meta.url);
const state = JSON.parse(fs.readFileSync(new URL('state.json', dir)));
const out = new URL('ui-final/', dir).pathname; fs.mkdirSync(out, { recursive: true });
const evidence = { checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: '/Users/mihaiperdum/Projects/forge-live-harness/.auth/storage-state.json', viewport: { width: 1024, height: 1100 }, reducedMotion: 'reduce' });
const page = await context.newPage(), frame = page.frameLocator('iframe').first();
page.on('pageerror', error => evidence.errors.push(error.message));
try {
  await page.goto('https://wolfaenpak.atlassian.net/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-261b-406e-b444-78c01c0d7772');
  await frame.locator('.tab-btn').filter({ hasText: /^Scheduled Jobs$/ }).waitFor({ timeout: 60000 });
  for (const theme of ['light', 'dark']) {
    await frame.locator('html').evaluate((node, theme) => { node.setAttribute('data-color-mode', theme); node.setAttribute('data-theme', `${theme}:${theme}`); }, theme);
    await frame.locator('.tab-btn').filter({ hasText: /^Scheduled Jobs$/ }).click();
    for (const code of ['J02','J03','J06','J09']) {
      const item = state.jobs.find(item => item.code === code);
      await frame.getByRole('textbox', { name: 'Search jobs', exact: true }).fill(`${state.tag} ${code} `);
      const row = frame.locator('.lst-name').filter({ hasText: new RegExp('^'+state.tag+' '+code+' ') }).locator('..').locator('..');
      await row.waitFor();
      if (await row.locator('.rule-expand-btn').getAttribute('aria-expanded') === 'true') await row.locator('.rule-expand-btn').click();
      const responsePromise = page.waitForResponse(response => {
        const body = response.request().postData() || ''; return body.includes('"getLogs"') && body.includes(item.id);
      });
      await row.locator('.rule-expand-btn').click();
      const response = await responsePromise;
      const logs = (await response.json()).data.invokeExtension.response.body.logs;
      assert.ok(logs.length >= 2, `${code}: manual and scheduled history`);
      const cards = frame.locator('.recent-logs .runres'); await cards.first().waitFor();
      assert.equal(await cards.count(), logs.length);
      const records = [];
      for (let i=0; i<logs.length; i++) {
        const log = logs[i], card = cards.nth(i);
        assert.equal(await card.locator('.runres-badge').innerText(), log.isValid ? 'PASS' : 'FAILED');
        assert.equal(await card.locator('.runres-reason').innerText(), log.reason);
        const chips = await card.locator('.runres-issue').evaluateAll(nodes => nodes.map(node => ({ key: node.textContent, failed: node.classList.contains('err'), reason: node.title, color: getComputedStyle(node).color })));
        assert.deepEqual(chips.map(({ color, ...chip }) => chip), log.perIssue.map(issue => ({ key: issue.key, failed: !issue.success, reason: issue.reason })));
        assert.ok(chips.every(chip => chip.color === 'rgb(255, 255, 255)'));
        records.push({ logId: log.id, timestamp: log.timestamp, chips });
      }
      const geometry = await row.evaluate(node => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, pageX: scrollX, cardOverflow: getComputedStyle(node.closest('.card')).overflowX }));
      assert.equal(geometry.width, 624); assert.equal(geometry.documentWidth, 624); assert.equal(geometry.pageX, 0); assert.equal(geometry.cardOverflow, 'auto');
      await cards.first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/history-${code}-${theme}.png` });
      if (code === 'J06') {
        await row.getByRole('button', { name: 'Delete', exact: true }).click();
        await frame.locator('.cr-confirm').waitFor(); await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await frame.locator('.cr-confirm').count(), 0);
        const navigation = await frame.locator('.tab-bar').evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth, buttons: [...node.querySelectorAll('.tab-btn')].map(button => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })) }));
        assert.equal(navigation.width, navigation.scrollWidth); assert.ok(navigation.buttons.every(button => button.left>=0 && button.right<=624));
        evidence.checks.push({ theme, code, navigation, normalPointerDeleteCancelled: true });
      }
      evidence.checks.push({ theme, code, geometry, records });
    }
    await frame.locator('.tab-btn').filter({ hasText: /^Settings$/ }).click();
    assert.equal(await frame.locator('.tab-active').innerText(), 'Settings');
    await frame.locator('.tab-btn').filter({ hasText: /^Listeners$/ }).click();
    await frame.getByRole('textbox', { name: 'Search listeners', exact: true }).fill(`${state.tag} L20 `);
    const row = frame.locator('.lst-name').filter({ hasText: new RegExp('^'+state.tag+' L20 ') }).locator('..').locator('..');
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await frame.locator('.function-builder').waitFor();
    assert.ok((await frame.locator('.lst-editor').innerText()).includes('If a step fails, later steps can still run; completed changes are not rolled back.'));
    await page.screenshot({ path: `${out}/continuation-${theme}.png` });
    await frame.getByRole('button', { name: '← Back to listeners', exact: true }).click();
  }
  assert.deepEqual(evidence.errors, []); evidence.pass = true; console.log('PASS real scoped history, narrow-frame pointer actions, navigation and continuation hint in both themes');
} catch (error) { evidence.pass = false; evidence.error = error.stack; process.exitCode = 1; console.error(error.stack); }
finally { await browser.close(); fs.writeFileSync(out+'history.json', JSON.stringify(evidence, null, 2)); }
