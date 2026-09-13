<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# Hand-written replacements for the re-authored tiers

Tiers C, D and E of `knowledge/sources.json` are marked `reauthor: true`. Their content is
**never copied** — not into `knowledge/raw/`, not into a pack, not at any stage. They carry
tenant hosts, app UUIDs, account ids, client e-mails, desk names and quoted corpus lines,
and the value in them is the FACT, which has to be re-stated as a neutral sentence anyway.

So each one has a replacement **written in our own words** in this directory, and the bake
**refuses to run** until it exists:

```
bake-knowledge: source "administrator-practice" is marked reauthor:true and has no
hand-written replacement at knowledge/authored/administrator-practice.md.
```

Both halves of that are load-bearing. Without the refusal the pack ships silently empty
and nobody notices for a release. Without the "never copied" half the original prose
travels into the bundle behind a boolean that the next person reads as a formality.

Expected files (the `covers` list in `sources.json` says what each must address):

| file | pack | tier |
|---|---|---|
| `forge-platform-facts.md` | `forge-platform-facts` | C — the laptop and workhorse fact memories |
| `administrator-practice.md` | `administrator-practice` | D — the practice notes |
| `voice-rules.md` | `voice-rules` | D — the BLOCK/WARN tables, as DATA |
| `automation-semantics.md` | `automation-semantics` | E — smart values, loops, JSM examples |

Two contradictions in tier C must be **reconciled before** `forge-platform-facts.md` is
written, not carried into the pack as two facts that disagree:

1. Function-backed workflow **conditions are a no-op**, while **expression-backed
   conditions ARE enforced** over REST.
2. Cloud Automation has **no public create API — drive the UI**. The earlier
   cloned-payload note is dropped, not footnoted.

What goes in a replacement: the fact, stated plainly, with the shape of the evidence
("a 404 here can mean you cannot see it, not that it is absent"). What never goes in: a
host, a UUID, an account id, an e-mail, a client or desk name, a ticket key, or a quoted
line from anyone's corpus. The leak scanner reads this directory on every bake, and it is
the last check, not the first one.
