# Voice corpus fixtures

Calibration corpus for `src/shared/voice-lint.js` (post gate 9 and the wizard's live
voice sample).

`human-*.txt` MUST lint clean. `ai-*.txt` MUST be blocked, each one on a different rule,
so a table that goes empty or a rule that stops firing fails the offline suite instead of
quietly letting generated shape through.

These samples are **written for this repo**: plain prose in the register a person uses in
a ticket, no client text, no names, no identifiers. The lint is calibrated on how people
write, never on the agent's own output — a detector calibrated on the thing it detects
only learns that thing's current habits.

`voice-lint.test.mjs` also asserts that **no fixture text appears in the lint result**.
The result travels into receipts, logs, REST answers and the next turn's prompt, so the
linter returns rule ids and sentence indexes, never the sentence.
