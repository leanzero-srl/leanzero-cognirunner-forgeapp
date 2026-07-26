import { getTransitions, doTransition, searchJql } from "../lib/jira.mjs";
const pool = await searchJql(`project=COGTEST AND labels=cogtest-k AND status="Selected for Development" ORDER BY created ASC`, ["status"], 2);
for (const iss of pool) {
  console.log(`\n=== ${iss.key} [${iss.fields.status.name}] — full forward march, single-shot ===`);
  for (const want of ["In Progress","Done"]) {
    const tr = await getTransitions(iss.key);
    const t = (tr.transitions||[]).find(x=>x.name===want);
    if (!t) { console.log(`  ${want}: not available`); continue; }
    const r = await doTransition(iss.key, t.id);
    console.log(`  -> ${want}(${t.id}): HTTP ${r.status}`);
    if (r.status >= 400) console.log("     BODY:", JSON.stringify(r.body || r.text || {}).slice(0, 700));
  }
}
