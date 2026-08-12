<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# CogniRunner — Release Notes

---

## 1.1.0 — Rule management, and conditions that actually work

This release is about **control**. CogniRunner could already attach far more rules
to Jira than it could administer, and once you crossed that line there was no way
back: the registry filled up, the panel told you to delete rules it had no button
for, and new rules silently failed to save. At the same time, conditions — a rule
type shipped since the first version — had never done anything at all.

Both are fixed, and every fix is pinned by a test that runs against a real Jira.

### You can now delete a rule, and deleting it means it stops running

The Rules tab has per-row **Delete** and multi-select bulk delete. Until now
`removeConfig` and `removePostFunction` existed in the backend with **no caller
anywhere in the UI** — and even if you reached them, they only deleted the registry
row. The rule stayed attached to its transition and kept executing, now with no
interface left to disable it.

Delete now offers two clearly-labelled outcomes, and does not quietly pick for you:

- **Delete everywhere** (the default) removes the rule from the Jira workflow
  transition, so it stops running.
- **Remove from this list only** says plainly that the rule *keeps running* and
  that you lose the ability to disable, view or explain it.

The dialog also warns before the trap: because a rule's disabled flag lives on the
registry row, removing only that row **re-enables a disabled rule**. It tells you
how many of your selected rules that applies to.

A dry run behind the dialog reports, per rule, whether it can actually be located
on its workflow ("already gone", "more than one identical rule on that transition"),
and flags when a workflow is shared by several projects.

### The registry stops being a dead end

- A usage meter on the Rules tab shows real pressure (`487 / 500 rules · 178 / 200 KB`),
  computed site-wide rather than from whatever your current filter shows.
- **Import** now checks the cap. It previously had no check at all, so at the limit
  it would attach a live workflow rule and then fail to register it — creating
  exactly the unmanageable rule this release exists to eliminate.
- **Register all** reports what it did. It used to discard its own result, so a run
  that silently skipped hundreds of rules at the cap looked like a clean success. It
  now batches, reports skips, and stops early rather than burning calls that can only
  be refused.
- The "registry is full" message finally names a control that exists.

### "My Rules" only shows rules you made

Two things put other people's rules in your list: ownerless rows matched *every*
user, and **Register all** stamped whoever clicked it as the author of every rule it
claimed. Claiming a rule is not authoring it — claimed rules are now recorded as
unowned, with a separate audit trail of who claimed them, and a one-time repair
un-attributes rules that were already mis-stamped. Admins get an Owner column with
an explicit **Unowned** chip, so it is visible *why* a rule is or isn't yours.

### Rules show the transition they're really on

A rule discovered by a workflow scan displayed as `Any status → ZSCALE-pv12` —
the transition's **name** was being rendered where its destination **status**
belongs. Rules now show the transition name and the real status edge separately
(`ZSCALE-pv12 · Backlog → Backlog`).

### A claimed post-function can finally be disabled

Registering a discovered post-function produced a row with a Disable button that
did nothing: the row was keyed by one identity and the runtime looked it up by
another, so the two never met. They meet now — carefully, because this sits on the
path every transition takes. A disabled rule's siblings on the same transition keep
running, and a post-function can never mute a validator.

### Conditions now work — and never use AI

CogniRunner conditions have never gated anything. The module shipped with a fixed
`expression: "true"`, alongside a `function:` key that is not part of Jira's
condition module at all and was silently ignored — which is why the app's own
documentation, and our test suite, believed a lambda was involved.

Two consequences, both now settled by testing rather than assumption:

**An AI condition is impossible.** Jira evaluates a condition itself, as a Jira
expression, in a sandbox with no network access. No app can call a model from one.
That is permanent, and it is not a CogniRunner limitation.

**A deterministic condition works everywhere.** Conditions are back in the Add Rule
wizard, offering ten checks — issue type, resolution, priority, parent status, and
whether the current user is the assignee or reporter. They cost nothing per
transition, add no latency, cannot fail open on a provider outage, and are enforced
on every surface: the issue view, REST, automation and bulk changes.

> The last two are worth calling out: "current user is the assignee/reporter" cannot
> be done as a *validator*, because Forge withholds the acting user from a validator
> function. Jira's expression engine provides it — so those rules work as conditions
> and only as conditions.

**Field-based conditions ("field has a value", "field equals…") are deliberately not
offered yet.** They are greyed out with an explanation. Jira's expression engine
names and types issue fields differently from the field picker, and a mismatch would
**hide** a transition rather than show it — failing closed, in a product whose whole
runtime law is to fail open. They will ship when that mapping is verified per field
type, not before.

Existing conditions are untouched: anything the new logic doesn't recognise is
allowed through, exactly as before. Opening an old condition shows the AI prompt it
was saved with, explains that it never ran, and lets you convert it.

### Also

- Disabling a condition now really disables it. Jira cannot read app storage, so the
  flag is written into the workflow rule itself; if that write fails, the rule is not
  marked disabled — a half-applied disable is worse than a refused one.
- Deleting a rule can no longer detach a *different* rule that another registry row
  owns.
- Adding a rule from the wizard records the workflow rule's identity, so a later
  delete targets exactly that rule instead of inferring which one you meant.
- Every workflow write (add and remove) retries on a version conflict instead of
  failing when someone else edits the workflow at the same time.
- The Rules tab explains all three rule types, not just post-functions.
- A Forge log line that dumped up to 500 account IDs on every Rules-tab load is gone.

### For anyone reading the docs

Harness finding **F3** ("Forge conditions are not enforced on the REST transition
path") was **wrong**, and the claim had spread to roughly sixteen places. Jira does
enforce conditions over REST. The observations behind F3 were real; the explanation
was not — our own manifest was the cause. F3 is now marked re-diagnosed with the
evidence that disproves it, and the docs, listing copy and barrage baseline have been
corrected to tell one story.

### Testing

A new regression gate runs before the main suite and covers each defect above with a
guard named for the finding it defends. It refuses to report a skip as a pass.

| Guard | Proves |
|---|---|
| `reg-delete-detaches` | delete removes the rule from the workflow and the blocked transition then succeeds |
| `reg-conditions-enforce` | every condition type, both directions, on the listing **and** over REST |
| `reg-pf-disable` | a disabled post-function skips while its sibling and a validator keep working |
| `reg-global-validator-e2e` | a validator on `Any status → X` blocks a Spanish summary — the originally reported bug |
| `configs-filter` / `registry-limits` | ownership filtering and the registry caps |

`reg-global-validator-e2e` asserts the execution log, not just the HTTP status: a
validator that fails open lets a transition through exactly like a pass does, so the
verdict must be a genuine AI decision and its reason must not look like an outage.

This release also came out of an adversarial review that raised 22 findings and
confirmed 7 after independent refutation. Five of them were the field-based
condition mistake above — caught before release, not after.
