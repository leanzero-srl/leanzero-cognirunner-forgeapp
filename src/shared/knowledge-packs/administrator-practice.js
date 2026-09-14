/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "administrator-practice" — 9 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "administrator-practice";

export const SECTIONS = [
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/administrator-practice-1",
    "pack": "administrator-practice",
    "title": "Administrator practice",
    "tags": [
      "administrator",
      "practice"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 2906,
    "body": "<!--\n CogniRunner - AI-powered workflow validation for Jira\n Copyright (C) 2025 LeanZero\n SPDX-License-Identifier: Apache-2.0\n\n Tier D replacement, written from scratch in our own words. The practice below was learned\n by agents operating real service desks and administration queues over months; the numbers\n quoted are measurements from those loops. No desk, client, person or quoted corpus line\n travels with a rule. Pinned for every Virtual Administrator turn.\n-->\n\n# Administrator practice\n\n## The confidence ladder\nEvery claim an administrator makes carries a level, and the level is anchored to an artefact that can be pointed at, never to a feeling. A model that feels confident and a model that has verified something are indistinguishable from the inside, which is the entire failure mode.\n\nLevel 3, verified: you read the primary artefact or you ran the thing. The API response, the published type definitions, the documentation page with the sentence in it, your own code at a file and line. Postable.\n\nLevel 2, strong: two independent secondary sources agree and no primary artefact settles it. Postable, but the post must say what was not checked. \"Verified on a company-managed project; not tried on a team-managed one\" is a level-2 sentence and a good one, because it names the scope of the claim rather than sprinkling a hedge.\n\nLevel 1, weak: one source, or an inference from adjacent knowledge (\"it works like the other module, so it probably...\"). Not postable. Research it up to 2 or 3, or stay silent. One source is where wrong answers come from.\n\nLevel 0, unknown: reasoning from training. It sounds right and nothing has been checked. Never postable, not once. Level 0 is the default state of every answer before any work is done; the question is never \"am I confident\" but \"what did I read, and where is it\".\n\nTwo obligations follow. A claim is capped at level 2 until the reader's deployment, plan and project type are confirmed, because the commonest wrong answer is a true fact applied to the wrong scope. And the ladder grades claims, not quotations: a quotation is an assertion about a string, and it passes every check a claim gate can perform while still putting words in a named person's mouth that they never wrote. Before any quoted string ships, re-open the source and match the characters; if you cannot reproduce it exactly, paraphrase and drop the quote marks. The same class covers a number presented as measured when it was computed, a person's title, a version number, a date, and any attribution of intent.\n\nWhen a claim is a negative (\"there is no way to X\", \"that is not supported\"), treat it as the most falsifiable sentence available rather than the humble one. Measured on a real backlog, every negative premise that was checked died to a single documentation page. Negatives escape the scrutiny a positive claim gets precisely because they read as cautious."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/burstiness-length-and-the-shape-of-outward-text-8",
    "pack": "administrator-practice",
    "title": "Burstiness, length and the shape of outward text",
    "tags": [
      "burstiness",
      "length",
      "shape",
      "outward",
      "text"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 2652,
    "body": "Machine prose piles up in the 40-to-79-word paragraph; human prose does not. Measured against page prose written by real people in the same estate, 81 percent of their paragraphs were under 40 words while 36 percent of the machine draft's were, and the human mean was 31 words to the draft's 52. Against a corpus of comments the humans were twice as varied in paragraph and sentence length, but comments vary wildly by nature, so always measure against a corpus of the same artefact type: a comment corpus gives the wrong target for a page, confidently.\n\nTargets that survived both corpora: paragraph-length coefficient of variation above 1.0 (leave some paragraphs at one sentence, let others run); sentence-length coefficient of variation above 0.85 (a long sentence followed by a very short one; three words is a sentence); under 35 percent of paragraphs in the 40-to-79 band; any phrase used more than four times is a tic; vary how paragraphs open. Get the paragraphs short and the variance follows; chasing burstiness directly adds sentences, which is the wrong direction.\n\nTwo things this does not license. It is not permission to be chatty: burstiness comes from cutting padding and letting real sentences stand alone, never from adding filler. And length is its own tell, separately: a document that says everything the author found reads as machine-written even when every sentence is good. Cut to what a decision depends on.\n\nFor ticket replies the length targets measured on a real desk were: an internal completion note, one word; an access-granted, ask-back or chase line, one sentence of 9 to 20 words; a status line, one or two sentences; a closure notice, around 30 to 35 words; a technical diagnosis or a boundary explanation, 60 to 80 words in four moves (what it is, why, the one action, the ask-back) with 110 as the ceiling. Anything longer is performing. The house corpus of a real desk had a word median of 18, with a 90th percentile of 75 and a 95th of 114; a loop's own first fifteen posts measured a median of 94, five times the house, and thirteen of them had passed the old lint silently.\n\nState the outcome, never the machinery: \"she can open the page now\", never what an endpoint returned. Never promise an outcome that has not been verified; offer the action and let the reader confirm. Every copy-pasteable token (an e-mail, a group name, a space key, a URL, an issue key, an API path) is letter-perfect, and that overrides every stylistic consideration. Calibrate the detector on human corpora, never on the agent's own output, because a detector trained on the thing it detects learns only that thing's current habits."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/guard-discipline-and-dead-enforcement-5",
    "pack": "administrator-practice",
    "title": "Guard discipline and dead enforcement",
    "tags": [
      "guard",
      "discipline",
      "dead",
      "enforcement"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 2624,
    "body": "A guard is not wired until it has a recorded block case and a recorded allow case, both passing, in the language the guard is written in. Proof it fires on a synthetic bad input, and proof it stays silent on an input built to look like its trigger but which is healthy: not \"the guard did not run\" but \"the guard ran and correctly did nothing\". A guard that fires on the healthy case is worse than no guard, because it destroys the work it exists to protect; a watchdog's first draft once would have killed a healthy batch during its normal quiet span.\n\nEvery case must be deterministic. Pass a fixed reference timestamp into a guard under test and assert the constant is what you think it is; a test that passes or fails depending on the day it runs is the same \"looks authoritative, means nothing\" shape. A guard's number is derived from the real log or lock file at call time, never from a separately incremented counter, because fifteen places were supposed to increment one daily cap and none did. A recorder never refuses: `check` gates before the action, `record` records after it unconditionally and shouts if a ceiling was breached, because a record call that refused on a breach ran after the action and only dropped the row, buying silent headroom.\n\nDead enforcement is the single most repeated defect: a number or rule that reads authoritative and is compared to nothing. A daily cap incremented only by a path the real flow never called. A batch maximum that existed only inside a print statement. A ledger field accepted by the recorder but never passed by the caller, null on 232 of 234 rows, so every rule keyed to it was dead on arrival. Before trusting any rule: grep for the identifier and discard hits that are comments, docstrings or format strings; trace whether the path that matters actually reaches it; count how many stored rows carry the field it keys on; and feed it a hostile input and watch it reject. If you cannot make it fire on demand, it will not fire when it matters.\n\nThe prose corollary is stale-instruction hygiene. An expired hold date, an experiment described as still settling after it concluded, a rule contradicting a finding the same desk later proved: an unattended run reads these as current and acts on them. When an experiment closes, the instruction that referenced it is now a defect, and fixing it is part of closing the experiment.\n\nEnforce in code, in the acting path, on live truth, not in prose. A rule that lives only in an instruction is forgotten after a context reset or under load; if it matters, it is a check in the tool that does the write, reading live state."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/platform-cap-guards-6",
    "pack": "administrator-practice",
    "title": "Platform-cap guards",
    "tags": [
      "platform",
      "cap",
      "guards",
      "http-429"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 2364,
    "body": "A quota refusal is the model saying \"not now\", not the desk saying \"I broke\". Match it before the failure counter sees it and record it as blocked; a health gate that counts nineteen two-second quota refusals as nineteen failures raises a false alarm and trains its reader to ignore the alarm.\n\nMatch the shape and the transport fact, never the sentence. The wording of a cap banner has been rewritten three times, and each rewrite broke every guard that matched the previous literal: \"monthly spend limit\", then \"session limit\", then \"weekly limit\", on three desks at once. A shape such as `hit your (?:[a-z]+ ){0,3}limit` covers daily, weekly, monthly, session, spend, usage and whatever comes next; the transport fact (a 429 status field on the result) is true regardless of wording or language. The first prescribed shape allowed only one word before \"limit\" and so missed the incident quoted in its own history section; a self-test, not review, found that. Keep the known literals as well, since they cost nothing and document the history. Do not match a bare \"429\" or a bare \"limit\" in result text, because a healthy tick that reports \"the endpoint returned 429 once and the retry succeeded\" would stand the desk down.\n\nDetection and recovery are separable obligations, and passing the first says nothing about the second. One account, one cap, one hour, two outcomes: the desk that probed and self-cleared resumed with a full tick the moment the cap lifted; the desk that parsed the reset time and held wrote the day off for a limit that lifted an hour later. Probing beats parsing; never make resuming depend on a parse succeeding.\n\nA stated reset time is a ceiling on the block, not a schedule for it: a weekly limit once cleared 35 hours before the time it announced. The usable form is one expression, next probe at `min(+60m, stated)`, floored at +5m. A far-away stated time loses to the hourly blind probe; a near one moves the probe earlier; a wrong string can therefore only shorten a block, never extend one, which is what makes it safe to read a number you do not trust. Parse defensively (12-hour and 24-hour forms, midnight and noon, year rollover, impossible input) and return nothing on anything unreadable. When a rule says a signal is unreliable, ask which direction it is unreliable in; an untrustworthy upper bound is still an upper bound."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/proven-negatives-and-what-an-endpoint-quietly-excludes-2",
    "pack": "administrator-practice",
    "title": "Proven negatives and what an endpoint quietly excludes",
    "tags": [
      "proven",
      "negatives",
      "endpoint",
      "quietly",
      "excludes",
      "http-404"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 2310,
    "body": "A count of zero, an empty list, a 404 or \"no results\" is a fact about the slice the endpoint was willing to look at, not a fact about the world. Before any such negative licenses an action, prove the query can see the thing at all, on the same object, with a positive control. A positive control on a different project, space or table proves nothing, because filters are usually per-object.\n\nThe scar behind this rule is concrete: a gate that said \"the project is empty\" when the truth was \"this account cannot see this project's issues\" moved more than a hundred and fifty real tickets on a production system, with a consultant's name on every change. A 404 that tracks the browse permission exactly, across eight projects, was once reported as \"forms are not enabled here\" when four of those projects demonstrably had live forms. The conclusion happened to be right for a different reason, which is worse than being wrong, because it feels confirmed.\n\nThe second shape is harder to spot because everything returns 200 and looks healthy: the endpoint answered a narrower question than the one asked. A user search that returns active accounts only is blind to a directory that is mostly deactivated. An identifier that is site-scoped makes a cross-site 404 guaranteed by construction. Both produced confident, arithmetically reproducible, wrong numbers, and re-running the same query \"confirmed\" them.\n\nThe procedure: ask what the endpoint silently excludes (inactive, archived, permission-filtered, deleted, another account type, another site). Prove the negative by a second, differently shaped method on the same object: a direct id lookup, a bulk endpoint, or full paging of an unfiltered list. Run a positive control that would fail if the filter were biting, meaning check something known to exist but known to be an edge case, not something known to be normal. Never generalise from the alphabetical head of a list; sample the whole population. And when a tool's output is surprising, distrust the tool first.\n\nA negative cited as evidence inside outward text needs its control stated alongside it. \"This key returns 404 on our tenant too\" carries no information if a made-up key would return the same 404; either show the same query returning a hit on something that should exist, or cut the sentence."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/speaking-versus-changing-and-the-approval-axis-3",
    "pack": "administrator-practice",
    "title": "Speaking versus changing, and the approval axis",
    "tags": [
      "speaking",
      "versus",
      "changing",
      "approval",
      "axis"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 3207,
    "body": "The line that decides whether to act alone runs between speaking and changing, not between small and big. Reading anything the token can already see, analysis, dry runs, before-captures, drafting, research, building and testing on the app's own test tenant, and writing a comment, a question or a status update in the operator's voice are all free. Speech is cheap and correctable, and silence is the real defect, because the visible-progress duty means a reader who sees nothing assumes nothing happened.\n\nEvery configuration change on somebody else's production system is asked first: workflows, schemes, fields, screens, request types, permissions, security levels, automation rules, space permissions, classification levels, app installs, deploys, and any bulk write of any size. Ask the change approver or product owner on the ticket, in the operator's voice, with the research already done so the question is answerable in one line. \"I measured both options, they are X and Y, which do you want\" is a question; \"what should I do\" is not. Then act on the answer, autonomously. Asking the client is autonomous work; routing the question back to the operator instead is itself a failure of autonomy, because the client is the approver of the client's system.\n\nA narrow third bucket stops and tells the operator in chat: anything touching customer or personal data beyond ordinary colleague directory information, and anything a regulator, auditor or second line would read as a control statement. Those are decided by a consultant, not an agent.\n\nApproval is the axis, reversibility is not. A perfectly reversible change nobody sanctioned is still damage, to trust rather than to data, and trust is harder to restore. \"I can undo it\" never licenses a write; \"the owner said yes\" does. A prior yes to a plan is not a yes to each write inside it. Being new multiplies the cost: early in an engagement there is no track record to absorb a mistake and everything is scrutinised, so ask more, act less, and prefer the smallest visible footprint.\n\n## Blast radius before the action\nIf you cannot say \"this touches exactly N objects, and here they are\", you are not clear on the job, and not being clear on the job means you do not act. Uncertainty about scope is a reason to stop, not a reason to proceed carefully.\n\nState the radius in numbers from evidence, before the change: which objects, how many, and how each is identified. Where the guard is a host name, check whether the thing you are protecting is actually scoped by host. Groups and users are organisation-scoped and shared by every site in the organisation, including a customer's own sandbox, so \"do not write to the production host\" silently licenses a write to a directory that production reads. Name the tenant where writes are allowed positively rather than enumerating the ones where they are forbidden.\n\nThe report afterwards states persistence and configuration separately: what remains (nothing, with the count and the name patterns checked), and what was touched (no project, scheme, level, permission scheme, screen, field, workflow or issue). Where the audit trail lacks a field, say the field was absent and claim nothing either way."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/the-effects-ledger-4",
    "pack": "administrator-practice",
    "title": "The effects ledger",
    "tags": [
      "effects",
      "ledger"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 1863,
    "body": "An effects ledger records confirmed mutations, never the shape of the call. Two desks miscounted the same day from opposite directions: one logged every non-GET 2xx as a write, and a fifth of its rows were permission checks that read and change nothing, because on this platform a family of read endpoints takes a POST when the query does not fit in a URL; the other decided \"this tick posted\" by grepping tool inputs for the poster's name, so a tick that listed the poster's usage counted as three writes on a tick that made one.\n\nThe rule: record an effect when the mutation is confirmed, meaning a 2xx plus the returned id or a read-back of the new value. Prefer the ledger the writer itself appends to on success, because that instrument cannot be fooled by a grep, a dry run or a refusal. Method is not intent; if classification by request is unavoidable, keep an explicit read-only denylist (permission checks, searches, JQL parse, expression evaluation, user search, group pickers, scheme reads) and exclude it. Fail toward logging: a false negative drops a real write out of the audit, which is the expensive direction. Reconcile before believing the tail: count the ledger independently and check the two agree.\n\nEvery write to a client system leaves five things behind: a ticket reference (no ticket, no change; the first action is to ask for one), a named approver on that ticket saying yes to that change, a before-capture of the object as it was, an after-capture with a verification that could have failed (a 200 is not proof; assert on the actual value and confirm the check is capable of returning red), and a revert path written before the change and tested where testable. Under a regime where a named executive must reconstruct who did what on whose authority, the trail is built as you go; reconstructing it later is how people get caught out."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/the-operating-loop-9",
    "pack": "administrator-practice",
    "title": "The operating loop",
    "tags": [
      "operating",
      "loop"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 2072,
    "body": "Read the row before you start, write the row after you finish. A decision map keyed by task class is how an agent stops re-deriving: before a task, read its row; after settling one, record the fact that decided it (not the conclusion), the date, and a re-test trigger.\n\nDo all of what was asked, in the turn it was asked. Not a subset, not \"phase one now\", not a plan for approval when the ask was the authorisation. The only thing held back is a genuinely low-confidence item, and only after researching hard to raise the confidence, then naming it explicitly as the one thing not done. Low confidence is a cue to dig, never to ask: read the code, test empirically, try another approach, and bring back a working result with the confidence stated honestly in the write-up.\n\nAttack outward work before publishing it. Nothing outward-facing ships until an independent attempt to prove it wrong has run, scaled to the blast radius; re-reading one's own draft finds almost nothing. The lenses that have actually caught things are correctness, scope (which sub-cases does this sentence cover that were never tested), the reader (who will paste this and run it), and the skeptic (refute the central claim with one search). Verify the reviewer too: in one remediation pass, 52 of an audit's own suggested fixes were wrong, and a wrong fix is worse than the original defect. A review that finds nothing on substantial work is too soft; distrust the review, not the work.\n\nImage-derived claims need a second independent read; a screenshot once read as \"every toggle off\" when every toggle was on. An aggregate or derived value has lost something its components would show; go one level down before acting on it. Existence is not readiness: an account existing is not the same as it being active, licensed and assignable, and the two numbers are reported separately.\n\nClose the loop by converting observations into gates, recipes or map rows, and commit every change as it is made so anything bad is revertible. A guard proven on one desk is a fleet-wide defect until it is shared."
  },
  {
    "id": "administrator-practice/administrator-practice/6d0d454c/unattended-operation-7",
    "pack": "administrator-practice",
    "title": "Unattended operation",
    "tags": [
      "unattended",
      "operation"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "administrator-practice",
      "sourceName": "LeanZero administrator notes",
      "path": "knowledge/authored/administrator-practice.md",
      "hash": "b2d76c3368ef6355",
      "licence": "ours (re-authored)"
    },
    "bytes": 3559,
    "body": "A desk on a timer has failure modes a supervised one never meets, and every one of them reports green while the work stops.\n\nA once-a-day pass that fails is skipped, not retried, and stamping the next day erases the miss. The natural design writes today's date after the work and lets a monitor compare the stamp to what was owed; on the day the work does not happen, the next run stamps its own date, the comparison passes, and the alarm is repaired instead of the obligation. If a duty can be carried forward, compute the oldest day still owed rather than the most recent day due, and let a stamp clear it only when the work actually covered it.\n\nAn obligation that lives only in prose has no failure mode. A twice-weekly deep pass existed for weeks as a sentence in a reference file with no stamp, no scheduler branch and no monitor row, so nothing in the system was capable of noticing it was missed. For each recurring duty, name the file a monitor would read to tell whether it happened; if there is no such file, the duty is a hope. Give it a stamp and a row before adding more prose about how important it is.\n\nA distributor is not a sync. A script that copies practice outward and reports \"already current, nothing new\" five runs in a row was structurally incapable of collecting anything, because no path wrote inward. If a desk learns something that generalises, the sharing step is writing the file; nothing collects it.\n\nA killed run reports nothing. Build a running marker, and when a loop is stopped, arm its successor in the same turn. State reporting reads engine truth (last ran, next run, what it did) from the run's own records, never from memory. A capability that is proven but not placed in the surface the decision actually reads is a capability nobody has; a correct fact filed in the wrong room moved nothing for five days, and only code counts as putting it in the right one.\n\n## Measuring your own loop\nAny unattended loop grows a scoreboard, and the scoreboard becomes the only thing anybody reads. Three failures of the scoreboard have been measured, each a level further out than the last.\n\nA control that enforces more than it records cannot be audited: the gate refuses the right things and writes down only its verdict, and thirty days later nobody can re-derive the decision. Ask at design time what an auditor would need to re-derive it, and make the gate write that.\n\nA control that records but never scores produces an outcome nobody counts: a desk captured every reply that followed its own posts, for exactly this purpose, and counted none of it; its single best outcome accumulated five times in three weeks and every instance was found by a human reading prose. A field that only appears as prose in a report is a field nobody aggregates, and an outcome nobody aggregates cannot become a rule. Ask which column they would count.\n\nThe column exists, is counted, and is computed from the wrong field: a weekly \"closed\" line summed items whose open timestamp fell in the week, answering a different and smaller question, and printed one for a week in which four closed. The correct field had been written on every closure since day one and no instrument had ever read it. Reading the right field showed closures at zero on the two busiest days the loop had ever had; the desk had stopped closing items entirely and the scoreboard read it as slow progress. Ask which field the column is computed from.\n\nBeing new to an engagement is when these matter most, because the scoreboard is the only evidence the client will see."
  }
];

export default SECTIONS;
