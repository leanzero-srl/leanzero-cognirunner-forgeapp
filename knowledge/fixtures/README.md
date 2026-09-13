<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# Leak-scanner guard fixtures

Guard discipline for `scripts/leak-scan.mjs`. A scanner nobody has watched fire is an
assumption, not a guard.

- `leak-<kind>.md` — a **positive control**: it MUST be caught, and it MUST be caught as
  the kind its filename names (`leak-credential-github-pat.md` → `credential.github-pat`).
- `clean-*.md` — a **negative control**: ordinary field-guide prose that MUST produce no
  fatal finding. These are what stop the scanner from being tightened into uselessness.

**Every value in every `leak-*.md` file is synthetic and invented.** There is no real
credential, tenant, ticket or person in this directory, and none may ever be added — a
positive control made from a real secret is a leak with a test around it.

The two `denylist.*` fixtures are matched against `FIXTURE_DENYLIST` inside the scanner,
not against `knowledge/denylist.local`, so they work on a fresh clone where the real
denylist does not exist and never will.

Run: `npm run leak:scan` (guards run first, before anything real is scanned) or
`node test-harness/scripts/leak-scan.test.mjs`.
