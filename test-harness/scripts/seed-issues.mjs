/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Seed the adversarial corpus into COGTEST. Individual creates with bounded
// concurrency (robust for diverse/huge payloads), then a pass to move the
// "gate-release" done-bugs to Done. Idempotent via stored state + ctid labels.

import { post, getIssue, getTransitions, doTransition, mapLimit } from "../lib/jira.mjs";
import { buildCorpus } from "../fixtures/corpus.mjs";
import { loadState, patchState } from "../lib/state.mjs";

const TARGET = parseInt(process.env.COGTEST_ISSUE_COUNT || "0", 10);

async function createIssue(spec, projectKey, customFields) {
  const fields = {
    project: { key: projectKey },
    issuetype: { id: spec.issueType },
    summary: spec.summary,
    labels: [...(spec.labels || []), `ctid-${spec.id}`],
  };
  if (spec.description) fields.description = spec.description;
  // Populate custom fields from the spec's `cf` map (role -> value), so issue
  // objects carry realistic, dense data.
  if (spec.cf && customFields) {
    for (const [role, val] of Object.entries(spec.cf)) {
      const f = customFields[role];
      if (!f) continue;
      if (role === "select") fields[f.id] = { value: val };
      else if (role === "number") fields[f.id] = val;
      else if (role === "user") fields[f.id] = { accountId: val };
      else fields[f.id] = val; // text, date (string)
    }
  }
  const res = await post("/rest/api/3/issue", { fields });
  return res.key;
}

async function moveToDone(key) {
  const tr = await getTransitions(key);
  const done = (tr.transitions || []).find((t) => /done/i.test(t.name) || /done/i.test(t.to?.name || ""));
  if (!done) return false;
  const res = await doTransition(key, done.id);
  return res.status < 400;
}

async function main() {
  const s = loadState();
  if (!s.projectKey) throw new Error("Run setup-testbed.mjs first.");
  const corpus = buildCorpus(s, TARGET);
  console.log(`Corpus size: ${corpus.length} issues`);

  // Idempotency: merge-missing. Reuse already-created ids (verify a sample),
  // and only create corpus ids not yet present.
  const existing = (s.issues && typeof s.issues === "object") ? s.issues : {};
  let toCreate = corpus;
  if (Object.keys(existing).length) {
    const sample = Object.values(existing)[0];
    try {
      await getIssue(sample.key, "summary");
      toCreate = corpus.filter((c) => !existing[c.id]);
      console.log(`${Object.keys(existing).length} already seeded; creating ${toCreate.length} missing.`);
    } catch {
      console.log("Stored issues no longer exist; reseeding all.");
      toCreate = corpus;
    }
  }
  if (toCreate.length === 0) {
    console.log("Nothing to create. Corpus fully seeded.");
    return;
  }

  let created = 0, failed = 0;
  const results = await mapLimit(toCreate, 5, async (spec) => {
    try {
      const key = await createIssue(spec, s.projectKey, s.customFields);
      created++;
      if (created % 25 === 0) console.log(`  created ${created}/${toCreate.length}...`);
      return { id: spec.id, key, cls: spec.cls, toDone: !!spec.toDone };
    } catch (e) {
      failed++;
      console.log(`  FAILED ${spec.id}: ${e.message.slice(0, 140)}`);
      return { id: spec.id, error: e.message };
    }
  });

  const map = { ...existing };
  for (const r of results) if (r.key) map[r.id] = { key: r.key, cls: r.cls };
  patchState({ issues: map });
  console.log(`Created ${created}, failed ${failed}. Total seeded: ${Object.keys(map).length}.`);

  // Move gate done-bugs to Done
  const doneBugs = results.filter((r) => r.key && r.toDone);
  let moved = 0;
  for (const r of doneBugs) {
    if (await moveToDone(r.key)) moved++;
  }
  console.log(`Moved ${moved}/${doneBugs.length} gate bugs to Done.`);
  console.log("Seeding complete.");
}

main().catch((e) => {
  console.error("SEED FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
