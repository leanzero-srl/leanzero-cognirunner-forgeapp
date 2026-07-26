/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Fast bulk-seed a large batch of tickets (default 1000) via POST /issue/bulk
// (50 per call). Used to load the project before a mass-transition wave through
// the chalk-full lifecycle. Tagged labels: cogtest-harness, cogtest-k.

import { post, mapLimit } from "../lib/jira.mjs";
import { richIncidentAdf } from "../fixtures/rich.mjs";
import { loadState } from "../lib/state.mjs";

const COUNT = parseInt(process.env.COGTEST_K_COUNT || "1000", 10);
const BATCH = 50;

async function main() {
  const s = loadState();
  if (!s.projectKey) throw new Error("Run setup-testbed first.");
  const taskType = s.primaryIssueType.id;
  const bugType = (s.issueTypes.find((t) => t.name === "Bug") || s.primaryIssueType).id;
  const areas = ["checkout", "auth", "search", "billing", "notifications", "dashboard", "API gateway", "import/export"];

  const all = [];
  for (let i = 0; i < COUNT; i++) {
    const fields = {
      project: { key: s.projectKey },
      issuetype: { id: i % 4 === 0 ? bugType : taskType },
      summary: `[K-${i + 1}] ${areas[i % areas.length]} regression after v2.3 — batch load`,
      labels: ["cogtest-harness", "cogtest-k"],
    };
    // every 5th gets a rich (multi-KB) description so the AI sees big objects
    if (i % 5 === 0) fields.description = richIncidentAdf(i);
    all.push({ fields });
  }

  const batches = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  console.log(`Bulk-creating ${COUNT} issues in ${batches.length} batches of ${BATCH}...`);

  let created = 0, failed = 0;
  await mapLimit(batches, 4, async (batch, bi) => {
    try {
      const res = await post("/rest/api/3/issue/bulk", { issueUpdates: batch });
      created += (res.issues || []).length;
      failed += (res.errors || []).length;
    } catch (e) {
      failed += batch.length;
      console.log(`  batch ${bi} failed: ${e.message.slice(0, 120)}`);
    }
    if ((bi + 1) % 5 === 0) console.log(`  ${created} created...`);
  });

  console.log(`\nBulk seed complete: ${created} created, ${failed} failed (labelled cogtest-k).`);
}

main().catch((e) => { console.error("SEED-BULK FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
