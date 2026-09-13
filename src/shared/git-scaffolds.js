/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// GIT SCAFFOLDS — the SINGLE SOURCE of the file trees CogniRunner commits into a
// customer's repository (the Coder's `git_get_scaffold` action, the admin
// "Set up pipeline" resolver) and of the Part 0 offshoot proof app.
//
// Files are held as ARRAYS OF LINES, never template literals: GitHub Actions
// syntax (`${{ secrets.X }}`) is a SyntaxError inside a JS template literal, and
// shell steps carry `$VAR` and backticks. `{{NAME}}` placeholders are substituted
// by renderScaffold; anything else is emitted byte for byte.
//
// Dependency-free: bundles into the backend and into the admin panel (which only
// needs the catalogue metadata, see SCAFFOLD_INDEX).
//
// F-530 — THE INSTALL COMMAND MUST MATCH THE TREE WE ACTUALLY COMMIT. Both pipelines ran
// `npm ci`, and `npm ci` refuses to run without a lockfile ("The `npm ci` command can only
// install with an existing package-lock.json or npm-shrinkwrap.json", npm error EUSAGE) —
// which this scaffold has never shipped. Live on Bitbucket, run #1 of the offshoot died on
// that line before forge register was ever reached, and the README the same scaffold ships
// said `npm install`, so the tree and the pipeline disagreed with each other in writing.
//
// The fix is `npm install`, not a generated lockfile: a package-lock.json is a resolved
// dependency graph with integrity hashes for the whole transitive tree, and this module is
// a dependency-free list of string arrays. It cannot produce one that is true, and a
// lockfile that is not true is worse than none. If a scaffold ever does ship one, the
// command goes back to `npm ci` in the same commit — the invariant is held by
// git-scaffolds.test.mjs: no rendered file may say `npm ci` unless that scaffold's file
// list contains a lockfile.

// F-579 -- THE VERSION IS THE ONLY THING THAT TELLS AN INSTALLED REPO IT IS STALE.
// The files below are COMMITTED INTO A CUSTOMER'S REPOSITORY. Once committed, this module
// has no further contact with them: changing a line array fixes the NEXT install and leaves
// every existing one running the old bytes. F-565 changed the workflow's content without
// touching this constant, so every pipeline installed before it stayed dead while the Code
// tab reported it installed with 6/6 steps done -- the stored row's `scaffoldVersion` was
// written and reported but compared by nobody.
//
// THE RULE: ANY diff to a scaffold line array bumps SCAFFOLD_VERSION, adds its line to
// SCAFFOLD_CHANGELOG (why, not what) and updates SCAFFOLD_CONTENT_HASH. That is not a
// convention -- git-scaffolds.test.mjs hashes the line arrays on every run and fails,
// printing the new hash, when the content moved and the version did not.
export const SCAFFOLD_VERSION = 2;

/**
 * WHY EACH BUMP HAPPENED. One line per version, in the admin's language: the line for the
 * version a repo is STUCK ON is the sentence the Code tab shows as outdatedReason, so it
 * has to say what is wrong with what is committed there, not what changed in this file.
 * Version 1 has no line -- it is the original install, and nothing was wrong with it yet.
 */
export const SCAFFOLD_CHANGELOG = Object.freeze({
  2: "The deploy workflow committed by this pipeline was invalid YAML, so GitHub answered every deploy request with 422 (no workflow_dispatch trigger). Re-run the setup to commit the corrected workflow.",
});

/**
 * The content fingerprint of the line arrays, over paths + lines of every scaffold.
 * NOT computed here: this module is dependency-free and bundles into the admin panel, so
 * the hash is a checked-in constant and git-scaffolds.test.mjs is what computes and
 * compares it. A mismatch is never "update the hash" on its own -- the version and the
 * changelog move in the same commit, or the guard has been defeated rather than satisfied.
 */
export const SCAFFOLD_CONTENT_HASH = "16d4a9cc48ea314fe6da7726dec5b292";

/**
 * The sentence for a row stuck on an older scaffold, or null when it is current.
 *
 * A row with NO recorded version is read as version 1 (the field was written from the
 * first install, so an absent one is old, not unknown) -- the safe reading is "tell the
 * admin to re-run a setup that is idempotent", never "assume it is fine".
 */
export const scaffoldOutdatedReason = (storedVersion) => {
  const n = Number(storedVersion);
  const stored = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  if (stored >= SCAFFOLD_VERSION) return null;
  const lines = [];
  for (let v = stored + 1; v <= SCAFFOLD_VERSION; v++) {
    if (SCAFFOLD_CHANGELOG[v]) lines.push(SCAFFOLD_CHANGELOG[v]);
  }
  if (!lines.length) return "The deploy pipeline committed to this repository is older than the one CogniRunner installs now. Re-run the setup to update it.";
  return lines.join(" ");
};

const PLACEHOLDER_APP_ID = "ari:cloud:ecosystem::app/PLACEHOLDER";

/**
 * F-540 — A LINE ARRAY MAY CARRY A CONDITIONAL BLOCK.
 *
 * The Code tab offers "none" as the Custom UI folder for a backend-only app, and both
 * pipelines emitted the build step unconditionally, so that choice rendered
 * "working-directory: none" (and "cd none") and the job failed there. The UI could only
 * warn about it; the scaffold is where the step lives, so the scaffold is where the choice
 * has to be honoured.
 *
 * A line array entry is therefore either a STRING (emitted verbatim, placeholders
 * substituted) or "{ when, lines }" -- the lines are emitted only when when(vars) is true.
 * Kept deliberately small: a predicate over the rendered variables, no expression language,
 * and renderScaffold throws on any other entry shape so a typo cannot silently drop a
 * step.
 */
const UI_DIR_NONE = "none";

/** True when this render has a Custom UI to build at all. */
export const scaffoldHasCustomUi = (vars) => {
  const dir = String((vars && vars.UI_DIR) || "").trim().toLowerCase();
  // An EMPTY UI_DIR is "no UI", not "a folder called empty string". Both scaffolds declare
  // a default so this is unreachable through renderScaffold, but the predicate is exported
  // and the safe reading of "I do not know where the UI is" is "do not emit a build step
  // pointed at nowhere".
  return dir !== "" && dir !== UI_DIR_NONE;
};

/** A block of lines emitted only when the render has a Custom UI. */
const whenCustomUi = (lines) => ({ when: scaffoldHasCustomUi, lines });

// ---------------------------------------------------------------------------
// Pipeline: GitHub Actions
// ---------------------------------------------------------------------------
// Every run injects the app id into the working-copy manifest, checks the permission
// lock, deploys, and installs on development only. The bootstrap step registers the app
// when there is no id yet -- see F-528 below for what "once" really means here.
//
// F-528 -- THE RUNNER CANNOT STORE THE APP ID, AND THE COPY NOW SAYS SO. The scaffold
// used to claim the bootstrap registers AT MOST ONE TIME and then stores the id as a
// repository variable by itself. It cannot: repository variables are an `administration` resource and
// GITHUB_TOKEN can never hold it, with or without `actions: write` (probed live
// 2026-09-13 -- HTTP 403 "Resource not accessible by integration" on
// POST /repos/:o/:r/actions/variables, while a PAT accepted the identical call on the
// identical repository seconds later). So the step no longer pretends: it registers,
// exports the id for THIS run, and prints a ::notice:: naming the variable a human (or
// CogniRunner, which holds a PAT) must set. Until that variable exists, every run
// registers again -- which is why the product asks the admin to paste the id back.
//
// F-527 — THE BOOTSTRAP MUST NEVER NEED A TTY. `forge register` asks for a Developer
// Space and `-y` does not answer that question, so the space id is passed explicitly
// with `-s "$FORGE_DEVELOPER_SPACE"`. `--personal` is NOT used: a developer space that
// disallows personal apps refuses it outright ("Personal apps are not allowed in this
// developer space"), and the non-personal register is what succeeded headless on the
// offshoot. When the variable is absent the step FAILS LOUD naming it — a prompt in a
// non-TTY runner is an unexplained 41-second timeout, which is the worst of both.
const FORGE_DEPLOY_YML = [
  "name: forge-deploy",
  "",
  "on:",
  "  push:",
  "    branches: [main, master]",
  "  workflow_dispatch:",
  "    inputs:",
  "      environment:",
  "        description: Forge environment",
  "        type: choice",
  "        default: development",
  "        options: [development, staging, production]",
  "",
  "permissions:",
  "  contents: read",
  "",
  "concurrency:",
  "  group: forge-deploy",
  "  cancel-in-progress: false",
  "",
  "env:",
  "  FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}",
  "  FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}",
  "  FORGE_SITE: ${{ vars.FORGE_SITE }}",
  "  FORGE_PRODUCT: ${{ vars.FORGE_PRODUCT || 'Jira' }}",
  "  FORGE_APP_ID: ${{ vars.FORGE_APP_ID }}",
  "  FORGE_DEVELOPER_SPACE: ${{ vars.FORGE_DEVELOPER_SPACE }}",
  "  FORGE_ENV: ${{ inputs.environment || 'development' }}",
  "  FORGE_APP_NAME: {{APP_NAME}}",
  "",
  "jobs:",
  "  deploy:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 22",
  "      - name: Install (backend)",
  "        run: npm install --no-audit --no-fund",
  whenCustomUi([
    "      - name: Install and build (Custom UI)",
    "        run: npm install --no-audit --no-fund && npm run build",
    "        working-directory: {{UI_DIR}}",
  ]),
  "      - name: Forge CLI",
  "        run: npm install --global @forge/cli@13 && forge settings set usage-analytics false",
  "      - name: Bootstrap (register when there is no app id yet)",
  "        if: env.FORGE_APP_ID == ''",
  "        run: |",
  "          set -euo pipefail",
  "          if [ -z \"${FORGE_DEVELOPER_SPACE:-}\" ]; then",
  "            echo \"::error::FORGE_APP_ID is empty and FORGE_DEVELOPER_SPACE is not set. Set the repository variable FORGE_DEVELOPER_SPACE to your Forge developer space id and re-run — forge register cannot ask for it in CI.\"",
  "            exit 1",
  "          fi",
  "          forge register -y -s \"$FORGE_DEVELOPER_SPACE\" \"$FORGE_APP_NAME\"",
  "          APP_ID=$(node -e \"const m=require('fs').readFileSync('manifest.yml','utf8');const r=m.match(/^\\s*id:\\s*(ari:cloud:ecosystem::app\\/[0-9a-f-]+)/m);if(!r){process.exit(2)};console.log(r[1])\")",
  "          echo \"::notice::Registered app id $APP_ID. This runner's token cannot store it (repository variables are an administration resource), so set the repository variable FORGE_APP_ID to $APP_ID -- paste it into CogniRunner's Code tab and it will store it for you. Until then every run registers again.\"",
  "          echo \"FORGE_APP_ID=$APP_ID\" >> \"$GITHUB_ENV\"",
  "      - name: Inject app id",
  "        run: node .cognirunner/inject-app-id.js \"$FORGE_APP_ID\"",
  "      - name: Permission lock",
  "        id: lock",
  "        run: node .cognirunner/check-permissions-lock.js",
  "      - name: Deploy",
  "        run: forge deploy -e \"$FORGE_ENV\" --non-interactive",
  "      - name: Install (development only)",
  "        if: env.FORGE_ENV == 'development' && steps.lock.outputs.locked == 'true'",
  "        run: |",
  "          set -uo pipefail",
  "          if forge install -s \"$FORGE_SITE\" -p \"$FORGE_PRODUCT\" -e development --non-interactive --confirm-scopes; then",
  "            echo \"installed\"",
  "          else",
  "            forge install --upgrade -s \"$FORGE_SITE\" -p \"$FORGE_PRODUCT\" -e development --non-interactive --confirm-scopes",
  "          fi",
  "      - name: Install skipped (permission drift)",
  "        if: env.FORGE_ENV == 'development' && steps.lock.outputs.locked != 'true'",
  // F-565 -- THIS `run:` IS A BLOCK SCALAR AND MUST STAY ONE. A plain (unquoted) YAML
  // scalar may not contain ": " (colon-space); the warning text does, twice ("drift: ",
  // "this far: "), and a plain scalar carrying it is read as a nested mapping inside a
  // compact mapping. The whole workflow file then fails to parse -- and GitHub does not
  // say so: it lists the workflow by its PATH instead of its name and answers every
  // dispatch with `422 Workflow does not have 'workflow_dispatch' trigger`, so an
  // installed pipeline is simply dead while CogniRunner reports it as ready (observed
  // live on leanzero-srl/cognirunner-forge-offshoot, 2026-09-13). Prose goes in a `|`
  // block; never inline it back into the mapping value.
  "        run: |",
  "          echo \"::warning::manifest permissions differ from .cognirunner/forge-permissions.lock (drift: ${{ steps.lock.outputs.drift }}) — deployed, NOT installed. A SCOPE change never gets this far: the Permission lock step fails the job before the deploy. Re-run pipeline setup in CogniRunner to approve the change.\"",
];

// ---------------------------------------------------------------------------
// Pipeline: Bitbucket Pipelines (custom pipeline `forge-deploy`, no manifest push-back)
// ---------------------------------------------------------------------------
// F-531 — THE TRIGGER BRANCH IS NOT THE SAME WORD ON BOTH HOSTS. A repository CogniRunner
// creates on Bitbucket comes back with `mainbranch.name = "master"` (live, the offshoot's
// `-bb` repo), while a new GitHub repository defaults to `main` — which is why this was
// invisible until Bitbucket was exercised. The branch pipeline of a CogniRunner-provisioned
// Bitbucket repo therefore never fired: only the `custom:` entry could be started, and only
// by an explicit trigger.
//
// Both scaffolds now trigger on BOTH names on BOTH hosts. The alternative — rendering the
// repository's own `mainbranch.name` into the YAML — makes the committed pipeline depend on
// a value read at setup time, so a repo whose default branch is renamed afterwards silently
// stops deploying, and the scaffold stops being a deterministic render. Naming both costs
// one extra key and is true whatever the repo does. A repo cannot have both branches as its
// default, so this never double-fires on one push.
const BITBUCKET_PIPELINES_YML = [
  "image: node:22",
  "",
  "definitions:",
  "  steps:",
  "    - step: &forge-deploy",
  "        name: Forge deploy",
  "        caches: [node]",
  "        script:",
  "          - npm install --no-audit --no-fund",
  whenCustomUi([
    "          - cd {{UI_DIR}} && npm install --no-audit --no-fund && npm run build && cd -",
  ]),
  "          - npm install --global @forge/cli@13",
  "          - forge settings set usage-analytics false",
  "          - export FORGE_ENV=\"${ENVIRONMENT:-development}\"",
  "          - |",
  "            if [ -z \"${FORGE_APP_ID:-}\" ]; then",
  "              if [ -z \"${FORGE_DEVELOPER_SPACE:-}\" ]; then",
  "                echo \"ERROR: FORGE_APP_ID is empty and FORGE_DEVELOPER_SPACE is not set. Add the repository variable FORGE_DEVELOPER_SPACE (your Forge developer space id) and re-run — forge register cannot ask for it in CI.\"",
  "                exit 1",
  "              fi",
  "              forge register -y -s \"$FORGE_DEVELOPER_SPACE\" \"{{APP_NAME}}\"",
  "              APP_ID=$(node -e \"const m=require('fs').readFileSync('manifest.yml','utf8');const r=m.match(/^\\s*id:\\s*(ari:cloud:ecosystem::app\\/[0-9a-f-]+)/m);if(!r){process.exit(2)};console.log(r[1])\")",
  "              echo \"Registered app id: $APP_ID\"",
  "              if ! curl -sf -u \"x-bitbucket-api-token-auth:${BB_API_TOKEN:-}\" -X POST \"https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pipelines_config/variables/\" -H 'Content-Type: application/json' -d \"{\\\"key\\\":\\\"FORGE_APP_ID\\\",\\\"value\\\":\\\"$APP_ID\\\",\\\"secured\\\":false}\" > /dev/null; then",
  "                echo \"Registered app id $APP_ID but could not store it: set the repository variable FORGE_APP_ID to $APP_ID (or paste it into CogniRunner's Code tab). Until then every run registers again.\"",
  "              fi",
  "              export FORGE_APP_ID=\"$APP_ID\"",
  "            fi",
  "          - node .cognirunner/inject-app-id.js \"$FORGE_APP_ID\"",
  "          - node .cognirunner/check-permissions-lock.js > .lock-result || { cat .lock-result; exit 1; }",
  "          - cat .lock-result",
  "          - forge deploy -e \"$FORGE_ENV\" --non-interactive",
  "          - |",
  "            if [ \"$FORGE_ENV\" = \"development\" ] && grep -q 'locked=true' .lock-result; then",
  "              forge install -s \"$FORGE_SITE\" -p \"${FORGE_PRODUCT:-Jira}\" -e development --non-interactive --confirm-scopes || forge install --upgrade -s \"$FORGE_SITE\" -p \"${FORGE_PRODUCT:-Jira}\" -e development --non-interactive --confirm-scopes",
  "            fi",
  "",
  "pipelines:",
  "  branches:",
  "    main:",
  "      - step: *forge-deploy",
  "    master:",
  "      - step: *forge-deploy",
  "  custom:",
  "    forge-deploy:",
  "      - variables:",
  "          - name: ENVIRONMENT",
  "            default: development",
  "      - step: *forge-deploy",
];

// ---------------------------------------------------------------------------
// .cognirunner helpers committed with the pipeline (plain Node, no deps)
// ---------------------------------------------------------------------------
const INJECT_APP_ID_JS = [
  "// Injects the Forge app id into the working-copy manifest before deploy.",
  "// The committed manifest keeps the placeholder so registration happens once, in CI.",
  "const fs = require('fs');",
  "const id = process.argv[2];",
  "if (!id || !/^ari:cloud:ecosystem::app\\/[0-9a-f-]+$/.test(id)) {",
  "  console.error('inject-app-id: FORGE_APP_ID is missing or malformed: ' + JSON.stringify(id));",
  "  process.exit(1);",
  "}",
  "const m = fs.readFileSync('manifest.yml', 'utf8');",
  "const out = m.replace(/^(\\s*id:\\s*)ari:cloud:ecosystem::app\\/[A-Za-z0-9-]+/m, '$1' + id);",
  "if (out === m && !m.includes(id)) { console.error('inject-app-id: no app id line found'); process.exit(1); }",
  "fs.writeFileSync('manifest.yml', out);",
  "console.log('manifest app id = ' + id);",
];

const CHECK_PERMISSIONS_LOCK_JS = [
  "// Compares the manifest's permissions block against the lock CogniRunner approved.",
  "//",
  "// F-529 - TWO DRIFT CLASSES, TWO OUTCOMES, AND THE LOCK GETS TO SPEAK FIRST.",
  "//",
  "//   scopes   This script EXITS 1 and the job stops HERE, before forge deploy. It has to:",
  "//            forge deploy --non-interactive refuses a scope widening on its own with",
  "//            MAJOR_VERSION_RULE, so the job used to die with Forge's message about",
  "//            approvals while this step's correct verdict, computed one step earlier, was",
  "//            thrown away with the job. The admin got a red run and the wrong reason.",
  "//   other    A permissions change that names no scope (content:/styles:) does not trip",
  "//            MAJOR_VERSION_RULE, so the deploy really does happen and only the INSTALL is",
  "//            withheld. That is the 'deployed, NOT installed' warning, and this is now the",
  "//            only class that reaches it.",
  "//   missing  No lock committed. Treated as 'other': deploy, do not install.",
  "//",
  "// The install is still the human consent gate. A SCOPE change must be re-approved in",
  "// CogniRunner (which rewrites the lock) before this pipeline deploys at all.",
  "const fs = require('fs');",
  "const lockPath = '.cognirunner/forge-permissions.lock';",
  "const extract = (yaml) => {",
  "  const lines = yaml.split(/\\r?\\n/);",
  "  const out = [];",
  "  let inPerm = false;",
  "  for (const raw of lines) {",
  "    const line = raw.replace(/\\s+#.*$/, '');",
  "    if (/^permissions:\\s*$/.test(line)) { inPerm = true; continue; }",
  "    if (inPerm && /^\\S/.test(line) && line.trim()) { inPerm = false; }",
  "    if (inPerm && line.trim()) out.push(line.trim());",
  "  }",
  "  return out.sort();",
  "};",
  "// The SAME rule as scopeOfLockLine in src/git-pipeline.js: a permissions line either",
  "// names a scope or it is structure. It is restated here because this file is standalone",
  "// in a customer's repository and can import nothing; git-scaffolds.test.mjs holds the two",
  "// regex literals byte-equal so the two homes cannot drift apart.",
  "const scopeOfLine = (line) => {",
  "  const m = /^-\\s*\"?([A-Za-z][A-Za-z0-9_.-]*(?::[A-Za-z0-9_.:-]+)+)\"?\\s*$/.exec(String(line || '').trim());",
  "  return m ? m[1] : null;",
  "};",
  "const scopesOf = (lines) => [...new Set(lines.map(scopeOfLine).filter(Boolean))].sort();",
  "const current = extract(fs.readFileSync('manifest.yml', 'utf8'));",
  "let locked = false;",
  "let drift = 'none';",
  "let added = [];",
  "let removed = [];",
  "if (fs.existsSync(lockPath)) {",
  "  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));",
  "  const approved = (lock.permissions || []).slice().sort();",
  "  locked = JSON.stringify(approved) === JSON.stringify(current);",
  "  if (!locked) {",
  "    const a = scopesOf(approved);",
  "    const b = scopesOf(current);",
  "    added = b.filter((s) => a.indexOf(s) === -1);",
  "    removed = a.filter((s) => b.indexOf(s) === -1);",
  "    drift = (added.length || removed.length) ? 'scopes' : 'other';",
  "    console.log('permission lock: DRIFT (' + drift + ')');",
  "    console.log('approved: ' + JSON.stringify(approved));",
  "    console.log('current:  ' + JSON.stringify(current));",
  "  } else {",
  "    console.log('permission lock: OK (' + current.length + ' lines)');",
  "  }",
  "} else {",
  "  drift = 'missing';",
  "  console.log('permission lock: MISSING - install refused until CogniRunner writes ' + lockPath);",
  "}",
  "console.log('locked=' + (locked ? 'true' : 'false'));",
  "console.log('drift=' + drift);",
  "if (process.env.GITHUB_OUTPUT) {",
  "  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'locked=' + (locked ? 'true' : 'false') + '\\n' + 'drift=' + drift + '\\n');",
  "}",
  "if (drift === 'scopes') {",
  "  console.log('::error::permission lock: DRIFT (scopes) - added ' + (added.join(', ') || 'none') + ', removed ' + (removed.join(', ') || 'none') + '. Nothing was deployed. Re-approve these permissions in CogniRunner, which rewrites ' + lockPath + ', then re-run.');",
  "  process.exit(1);",
  "}",
];

// ---------------------------------------------------------------------------
// The Forge Custom UI app: "Next Steps"
// ---------------------------------------------------------------------------
const MANIFEST_YML = [
  "modules:",
  "  jira:globalPage:",
  "    - key: {{MODULE_KEY}}",
  "      resource: main",
  "      resolver:",
  "        function: resolver",
  "      title: {{PAGE_TITLE}}",
  "  llm:",
  "    - key: {{LLM_KEY}}",
  "      model:",
  "        - claude",
  "  function:",
  "    - key: resolver",
  "      handler: index.handler",
  "resources:",
  "  - key: main",
  "    path: {{UI_DIR}}/build",
  "    tunnel:",
  "      port: 3000",
  "permissions:",
  "  scopes:",
  "    - read:jira-work",
  "    - read:jira-user",
  "    - storage:app",
  "  content:",
  "    styles:",
  "      - unsafe-inline",
  "app:",
  "  runtime:",
  "    name: nodejs22.x",
  "  id: " + PLACEHOLDER_APP_ID,
];

const ROOT_PACKAGE_JSON = [
  "{",
  "  \"name\": \"{{PACKAGE_NAME}}\",",
  "  \"version\": \"0.1.0\",",
  "  \"private\": true,",
  "  \"license\": \"Apache-2.0\",",
  "  \"main\": \"src/index.js\",",
  "  \"scripts\": {",
  "    \"check\": \"node --check src/index.js\",",
  "    \"build\": \"npm --prefix {{UI_DIR}} run build\"",
  "  },",
  "  \"dependencies\": {",
  "    \"@forge/api\": \"^7.2.2\",",
  "    \"@forge/kvs\": \"^1.6.1\",",
  "    \"@forge/llm\": \"^0.6.7\",",
  "    \"@forge/resolver\": \"^1.6.0\"",
  "  }",
  "}",
];

const SRC_INDEX_JS = [
  "/*",
  " * {{APP_NAME}} - a CogniRunner offshoot",
  " * Copyright (C) 2025 LeanZero",
  " *",
  " * SPDX-License-Identifier: Apache-2.0",
  " */",
  "",
  "// Next Steps: the current user's open issues with a one-line AI \"next step\" each.",
  "// Jira reads run as the USER (they see what the user sees); the AI line is cached in",
  "// KVS per issue+updated so Refresh never re-bills; one LLM call covers every uncached",
  "// issue; any AI failure degrades to the list without lines (never an error page).",
  "import Resolver from \"@forge/resolver\";",
  "import api, { route } from \"@forge/api\";",
  "import { kvs } from \"@forge/kvs\";",
  "import { chat } from \"@forge/llm\";",
  "",
  "const resolver = new Resolver();",
  "const MODEL = \"claude-haiku-4-5-20251001\";",
  "const MAX_ISSUES = 25;",
  "const CACHE_TTL_DAYS = 30;",
  "",
  "const cacheKey = (issue) => \"nextstep:\" + issue.key + \":\" + String(issue.updated || \"\").replace(/[^0-9]/g, \"\").slice(0, 14);",
  "",
  "const compact = (issue) => ({",
  "  key: issue.key,",
  "  summary: String(issue.fields.summary || \"\").slice(0, 200),",
  "  status: issue.fields.status && issue.fields.status.name,",
  "  statusCategory: issue.fields.status && issue.fields.status.statusCategory && issue.fields.status.statusCategory.key,",
  "  type: issue.fields.issuetype && issue.fields.issuetype.name,",
  "  priority: issue.fields.priority && issue.fields.priority.name,",
  "  project: issue.fields.project && issue.fields.project.key,",
  "  projectName: issue.fields.project && issue.fields.project.name,",
  "  updated: issue.fields.updated,",
  "  dueDate: issue.fields.duedate || null,",
  "});",
  "",
  "const parseJsonObject = (text) => {",
  "  const s = String(text || \"\");",
  "  const start = s.indexOf(\"{\");",
  "  const end = s.lastIndexOf(\"}\");",
  "  if (start < 0 || end <= start) return {};",
  "  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return {}; }",
  "};",
  "",
  "const nextStepsFor = async (issues) => {",
  "  if (issues.length === 0) return {};",
  "  const lines = issues.map((i) => i.key + \" | \" + i.type + \" | \" + i.status + \" | \" + (i.priority || \"-\") + \" | due \" + (i.dueDate || \"-\") + \" | \" + i.summary.replace(/\\s+/g, \" \"));",
  "  const system = \"You write ONE short next step (max 18 words, plain, imperative, no markdown) for each Jira issue. Answer ONLY a JSON object mapping issue key to the sentence.\";",
  "  const user = \"Issues (key | type | status | priority | due | summary):\\n\" + lines.join(\"\\n\");",
  "  const res = await chat({ model: MODEL, messages: [{ role: \"system\", content: system }, { role: \"user\", content: user }], max_completion_tokens: 1200 });",
  "  const text = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;",
  "  const raw = Array.isArray(text) ? text.map((p) => (p && p.text) || \"\").join(\"\") : text;",
  "  const obj = parseJsonObject(raw);",
  "  const out = {};",
  "  for (const i of issues) { const v = obj[i.key]; if (typeof v === \"string\" && v.trim()) out[i.key] = v.trim().slice(0, 160); }",
  "  return out;",
  "};",
  "",
  "resolver.define(\"getProjects\", async () => {",
  "  const r = await api.asUser().requestJira(route`/rest/api/3/project/search?maxResults=50&orderBy=name`);",
  "  if (!r.ok) return { success: false, error: \"Jira returned \" + r.status };",
  "  const data = await r.json();",
  "  return { success: true, projects: (data.values || []).map((p) => ({ key: p.key, name: p.name })) };",
  "});",
  "",
  "resolver.define(\"getNextSteps\", async ({ payload }) => {",
  "  const projectKey = payload && typeof payload.projectKey === \"string\" && /^[A-Z][A-Z0-9_]*$/.test(payload.projectKey) ? payload.projectKey : null;",
  "  const jql = \"assignee = currentUser() AND resolution = EMPTY\" + (projectKey ? \" AND project = \" + projectKey : \"\") + \" ORDER BY updated DESC\";",
  "  const r = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {",
  "    method: \"POST\",",
  "    headers: { \"Content-Type\": \"application/json\", Accept: \"application/json\" },",
  "    body: JSON.stringify({ jql, maxResults: MAX_ISSUES, fields: [\"summary\", \"status\", \"issuetype\", \"priority\", \"project\", \"updated\", \"duedate\"] }),",
  "  });",
  "  if (!r.ok) return { success: false, error: \"Jira search returned \" + r.status };",
  "  const data = await r.json();",
  "  const issues = (data.issues || []).map(compact);",
  "  const steps = {};",
  "  const uncached = [];",
  "  for (const i of issues) {",
  "    const hit = await kvs.get(cacheKey(i)).catch(() => null);",
  "    if (typeof hit === \"string\" && hit) steps[i.key] = hit; else uncached.push(i);",
  "  }",
  "  let aiError = null;",
  "  if (uncached.length > 0) {",
  "    try {",
  "      const fresh = await nextStepsFor(uncached);",
  "      for (const i of uncached) {",
  "        if (fresh[i.key]) {",
  "          steps[i.key] = fresh[i.key];",
  "          await kvs.set(cacheKey(i), fresh[i.key], { ttl: { value: CACHE_TTL_DAYS, unit: \"DAYS\" } }).catch(() => {});",
  "        }",
  "      }",
  "    } catch (e) {",
  "      aiError = String((e && e.message) || e).slice(0, 200);",
  "    }",
  "  }",
  "  return { success: true, issues: issues.map((i) => ({ ...i, nextStep: steps[i.key] || null })), aiError, cached: issues.length - uncached.length, generated: uncached.length };",
  "});",
  "",
  "export const handler = resolver.getDefinitions();",
];

const UI_PACKAGE_JSON = [
  "{",
  "  \"name\": \"next-steps-ui\",",
  "  \"version\": \"0.1.0\",",
  "  \"private\": true,",
  "  \"license\": \"Apache-2.0\",",
  "  \"dependencies\": {",
  "    \"@forge/bridge\": \"^4.0.0\",",
  "    \"react\": \"^18.2.0\",",
  "    \"react-dom\": \"^18.2.0\"",
  "  },",
  "  \"devDependencies\": {",
  "    \"@babel/core\": \"^7.23.0\",",
  "    \"@babel/preset-env\": \"^7.23.0\",",
  "    \"@babel/preset-react\": \"^7.23.0\",",
  "    \"babel-loader\": \"^9.1.0\",",
  "    \"css-loader\": \"^6.8.0\",",
  "    \"html-webpack-plugin\": \"^5.5.0\",",
  "    \"style-loader\": \"^3.3.0\",",
  "    \"webpack\": \"^5.89.0\",",
  "    \"webpack-cli\": \"^5.1.0\"",
  "  },",
  "  \"scripts\": {",
  "    \"build\": \"webpack --mode production\",",
  "    \"start\": \"webpack --mode development --watch\"",
  "  }",
  "}",
];

const UI_WEBPACK_CONFIG_JS = [
  "const path = require(\"path\");",
  "const HtmlWebpackPlugin = require(\"html-webpack-plugin\");",
  "",
  "module.exports = {",
  "  entry: \"./src/index.js\",",
  "  output: { path: path.resolve(__dirname, \"build\"), filename: \"bundle.[contenthash:8].js\", publicPath: \"./\", clean: true },",
  "  module: {",
  "    rules: [",
  "      { test: /\\.(js|jsx)$/, exclude: /node_modules/, use: { loader: \"babel-loader\", options: { presets: [\"@babel/preset-env\", \"@babel/preset-react\"] } } },",
  "      { test: /\\.css$/, use: [\"style-loader\", \"css-loader\"] },",
  "    ],",
  "  },",
  "  plugins: [new HtmlWebpackPlugin({ template: \"./public/index.html\" })],",
  "  resolve: { extensions: [\".js\", \".jsx\"] },",
  "};",
];

const UI_PUBLIC_INDEX_HTML = [
  "<!DOCTYPE html>",
  "<html lang=\"en\">",
  "  <head>",
  "    <meta charset=\"utf-8\" />",
  "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
  "    <title>{{PAGE_TITLE}}</title>",
  "  </head>",
  "  <body>",
  "    <div id=\"root\"></div>",
  "  </body>",
  "</html>",
];

const UI_SRC_INDEX_JS = [
  "/*",
  " * {{APP_NAME}} - a CogniRunner offshoot",
  " * Copyright (C) 2025 LeanZero",
  " *",
  " * SPDX-License-Identifier: Apache-2.0",
  " */",
  "import React from \"react\";",
  "import { createRoot } from \"react-dom/client\";",
  "import { view } from \"@forge/bridge\";",
  "import App from \"./App.jsx\";",
  "import \"./styles.css\";",
  "",
  "view.theme.enable().catch(() => {});",
  "createRoot(document.getElementById(\"root\")).render(<App />);",
];

const UI_SRC_APP_JSX = [
  "/*",
  " * {{APP_NAME}} - a CogniRunner offshoot",
  " * Copyright (C) 2025 LeanZero",
  " *",
  " * SPDX-License-Identifier: Apache-2.0",
  " */",
  "import React, { useEffect, useRef, useState } from \"react\";",
  "import { invoke } from \"@forge/bridge\";",
  "",
  "// Custom dropdown — no native <select>. Keyboard: Enter/Space opens, arrows move, Esc closes.",
  "function Dropdown({ value, options, onChange, label }) {",
  "  const [open, setOpen] = useState(false);",
  "  const [hi, setHi] = useState(0);",
  "  const ref = useRef(null);",
  "  useEffect(() => {",
  "    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };",
  "    document.addEventListener(\"mousedown\", onDoc);",
  "    return () => document.removeEventListener(\"mousedown\", onDoc);",
  "  }, []);",
  "  const current = options.find((o) => o.value === value) || options[0];",
  "  const onKey = (e) => {",
  "    if (e.key === \"Escape\") { setOpen(false); return; }",
  "    if (!open && (e.key === \"Enter\" || e.key === \" \" || e.key === \"ArrowDown\")) { e.preventDefault(); setOpen(true); setHi(Math.max(0, options.findIndex((o) => o.value === value))); return; }",
  "    if (!open) return;",
  "    if (e.key === \"ArrowDown\") { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }",
  "    if (e.key === \"ArrowUp\") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }",
  "    if (e.key === \"Enter\") { e.preventDefault(); onChange(options[hi].value); setOpen(false); }",
  "  };",
  "  return (",
  "    <div className=\"dd\" ref={ref}>",
  "      <button type=\"button\" className=\"dd-trigger\" aria-haspopup=\"listbox\" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} onKeyDown={onKey}>",
  "        <span>{current ? current.label : \"\"}</span>",
  "        <span className=\"dd-caret\" aria-hidden=\"true\">▾</span>",
  "      </button>",
  "      {open && (",
  "        <ul className=\"dd-menu\" role=\"listbox\">",
  "          {options.map((o, i) => (",
  "            <li key={o.value} role=\"option\" aria-selected={o.value === value} className={\"dd-item\" + (i === hi ? \" dd-item-hi\" : \"\") + (o.value === value ? \" dd-item-sel\" : \"\")} onMouseEnter={() => setHi(i)} onClick={() => { onChange(o.value); setOpen(false); }}>",
  "              {o.label}",
  "            </li>",
  "          ))}",
  "        </ul>",
  "      )}",
  "    </div>",
  "  );",
  "}",
  "",
  "const catClass = (c) => (c === \"done\" ? \"chip chip-done\" : c === \"indeterminate\" ? \"chip chip-progress\" : \"chip chip-todo\");",
  "",
  "export default function App() {",
  "  const [projects, setProjects] = useState([]);",
  "  const [project, setProject] = useState(\"\");",
  "  const [issues, setIssues] = useState([]);",
  "  const [meta, setMeta] = useState({ cached: 0, generated: 0, aiError: null });",
  "  const [loading, setLoading] = useState(true);",
  "  const [error, setError] = useState(null);",
  "  const token = useRef(0);",
  "",
  "  const load = async (projectKey) => {",
  "    const my = ++token.current;",
  "    setLoading(true); setError(null);",
  "    try {",
  "      const r = await invoke(\"getNextSteps\", { projectKey: projectKey || null });",
  "      if (my !== token.current) return;",
  "      if (!r || !r.success) { setError((r && r.error) || \"Could not load issues\"); setIssues([]); }",
  "      else { setIssues(r.issues || []); setMeta({ cached: r.cached, generated: r.generated, aiError: r.aiError }); }",
  "    } catch (e) { if (my === token.current) setError(String((e && e.message) || e)); }",
  "    finally { if (my === token.current) setLoading(false); }",
  "  };",
  "",
  "  useEffect(() => {",
  "    invoke(\"getProjects\").then((r) => { if (r && r.success) setProjects(r.projects || []); }).catch(() => {});",
  "    load(\"\");",
  "  }, []);",
  "",
  "  const options = [{ value: \"\", label: \"All projects\" }].concat(projects.map((p) => ({ value: p.key, label: p.name + \" (\" + p.key + \")\" })));",
  "",
  "  return (",
  "    <div className=\"ns-page\">",
  "      <header className=\"ns-header\">",
  "        <div>",
  "          <h1 className=\"ns-title\">{{PAGE_TITLE}}</h1>",
  "          <p className=\"ns-sub\">Your open issues, each with one suggested next step.</p>",
  "        </div>",
  "        <div className=\"ns-controls\">",
  "          <Dropdown label=\"Project\" value={project} options={options} onChange={(v) => { setProject(v); load(v); }} />",
  "          <button type=\"button\" className=\"btn btn-primary\" onClick={() => load(project)} disabled={loading}>{loading ? \"Loading…\" : \"Refresh\"}</button>",
  "        </div>",
  "      </header>",
  "      {error && <div className=\"banner banner-error\">{error}</div>}",
  "      {!error && meta.aiError && <div className=\"banner banner-warn\">Next steps unavailable right now ({meta.aiError}). Showing your issues without suggestions.</div>}",
  "      {loading && issues.length === 0 && <div className=\"ns-empty\">Loading your issues…</div>}",
  "      {!loading && !error && issues.length === 0 && <div className=\"ns-empty\">Nothing open is assigned to you{project ? \" in this project\" : \"\"}. Enjoy it.</div>}",
  "      <ul className=\"ns-list\">",
  "        {issues.map((i) => (",
  "          <li key={i.key} className=\"ns-card\">",
  "            <div className=\"ns-card-head\">",
  "              <span className=\"ns-key\">{i.key}</span>",
  "              <span className={catClass(i.statusCategory)}>{i.status}</span>",
  "              {i.priority && <span className=\"chip chip-neutral\">{i.priority}</span>}",
  "              {i.dueDate && <span className=\"chip chip-due\">due {i.dueDate}</span>}",
  "            </div>",
  "            <div className=\"ns-summary\">{i.summary}</div>",
  "            <div className=\"ns-next\">{i.nextStep ? i.nextStep : <span className=\"ns-next-none\">No suggestion yet.</span>}</div>",
  "          </li>",
  "        ))}",
  "      </ul>",
  "      {issues.length > 0 && <footer className=\"ns-foot\">{issues.length} issue{issues.length === 1 ? \"\" : \"s\"} · {meta.generated} suggestion{meta.generated === 1 ? \"\" : \"s\"} generated now, {meta.cached} from cache</footer>}",
  "    </div>",
  "  );",
  "}",
];

const UI_SRC_STYLES_CSS = [
  "/*",
  " * {{APP_NAME}} - a CogniRunner offshoot",
  " * Copyright (C) 2025 LeanZero",
  " *",
  " * SPDX-License-Identifier: Apache-2.0",
  " */",
  ":root {",
  "  --bg: #ffffff; --surface: #f4f5f7; --text: #172b4d; --muted: #5e6c84; --border: #dfe1e6;",
  "  --primary: #2563eb; --todo: #2563eb; --progress: #d97706; --done: #16a34a; --neutral: #475569; --due: #dc2626; --warn: #b45309; --error: #dc2626;",
  "}",
  "html[data-color-mode=\"dark\"] {",
  "  --bg: #1d2125; --surface: #22272b; --text: #b6c2cf; --muted: #8c9bab; --border: #38414a;",
  "  --primary: #3b82f6; --todo: #3b82f6; --progress: #f59e0b; --done: #22c55e; --neutral: #64748b; --due: #ef4444; --warn: #f59e0b; --error: #ef4444;",
  "}",
  "body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; }",
  ".ns-page { max-width: 960px; margin: 0 auto; padding: 24px 20px 40px; }",
  ".ns-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }",
  ".ns-title { margin: 0; font-size: 24px; font-weight: 700; }",
  ".ns-sub { margin: 4px 0 0; color: var(--muted); }",
  ".ns-controls { display: flex; gap: 10px; align-items: center; }",
  ".btn { border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 700; cursor: pointer; }",
  ".btn-primary { background: var(--primary); color: #fff; }",
  ".btn-primary:disabled { opacity: 0.6; cursor: default; }",
  ".dd { position: relative; }",
  ".dd-trigger { display: inline-flex; align-items: center; gap: 10px; min-width: 200px; justify-content: space-between; border: 2px solid var(--border); background: var(--surface); color: var(--text); border-radius: 6px; padding: 7px 12px; font-weight: 600; cursor: pointer; }",
  ".dd-trigger:focus { outline: 2px solid var(--primary); outline-offset: 1px; }",
  ".dd-menu { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; min-width: 100%; max-height: 260px; overflow: auto; list-style: none; margin: 0; padding: 4px; background: var(--bg); border: 2px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); }",
  ".dd-item { padding: 7px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }",
  ".dd-item-hi { background: var(--surface); }",
  ".dd-item-sel { font-weight: 700; color: var(--primary); }",
  ".banner { border-radius: 6px; padding: 10px 12px; font-weight: 600; color: #fff; margin-bottom: 12px; }",
  ".banner-error { background: var(--error); }",
  ".banner-warn { background: var(--warn); }",
  ".ns-empty { padding: 32px; text-align: center; color: var(--muted); background: var(--surface); border-radius: 8px; }",
  ".ns-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }",
  ".ns-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }",
  ".ns-card-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }",
  ".ns-key { font-weight: 700; color: var(--primary); }",
  ".chip { display: inline-block; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: #fff; }",
  ".chip-todo { background: var(--todo); } .chip-progress { background: var(--progress); } .chip-done { background: var(--done); } .chip-neutral { background: var(--neutral); } .chip-due { background: var(--due); text-transform: none; }",
  ".ns-summary { font-weight: 600; margin-bottom: 4px; }",
  ".ns-next { color: var(--text); }",
  ".ns-next-none { color: var(--muted); font-style: italic; }",
  ".ns-foot { margin-top: 14px; color: var(--muted); font-size: 12px; }",
];

const README_MD = [
  "# {{APP_NAME}}",
  "",
  "A small Atlassian Forge app (Jira global page) that lists the current user's open issues and adds one",
  "AI-generated next step per issue, using Atlassian-hosted Claude through `@forge/llm`.",
  "",
  "It exists as the proof target for CogniRunner Coder: the repository, the pipeline and the first pull",
  "request were created the way CogniRunner automates them.",
  "",
  "## How it deploys",
  "",
  "The committed `manifest.yml` keeps a placeholder app id. The pipeline registers the app when",
  "`FORGE_APP_ID` is empty and `FORGE_DEVELOPER_SPACE` is set, and prints the id it got: the runner's own",
  "token cannot create a repository variable, so set `FORGE_APP_ID` yourself (or paste it into",
  "CogniRunner) and registration stops happening. On",
  "every run injects the id into the working copy, checks `.cognirunner/forge-permissions.lock`, deploys,",
  "and installs on the development environment only. A change to the manifest's permissions deploys but is",
  "not installed until the lock is re-approved.",
  "",
  "Secrets and variables the pipeline needs: `FORGE_EMAIL`, `FORGE_API_TOKEN` (an Atlassian API token",
  "with scopes, app = Forge), `FORGE_SITE` (for example `your-site.atlassian.net`), optional `FORGE_PRODUCT`,",
  "and `FORGE_DEVELOPER_SPACE` (your Forge developer space id) until `FORGE_APP_ID` is set.",
  "",
  "## Local development",
  "",
  "```",
  "npm install && (cd {{UI_DIR}} && npm install && npm run build)",
  "forge deploy -e development && forge install -e development",
  "```",
  "",
  "License: Apache-2.0.",
];

const GITIGNORE = [
  "node_modules/",
  "{{UI_DIR}}/build/",
  ".forge/",
  "*.log",
  ".DS_Store",
];

const LICENSE = [
  "Copyright 2025 LeanZero",
  "",
  "Licensed under the Apache License, Version 2.0 (the \"License\"); you may not use this file except",
  "in compliance with the License. You may obtain a copy of the License at",
  "",
  "    http://www.apache.org/licenses/LICENSE-2.0",
  "",
  "Unless required by applicable law or agreed to in writing, software distributed under the License",
  "is distributed on an \"AS IS\" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or",
  "implied. See the License for the specific language governing permissions and limitations under the License.",
];

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export const SCAFFOLDS = {
  "forge-custom-ui": {
    label: "Forge app with a Custom UI global page",
    description: "Jira global page (React 18 + webpack), resolver, @forge/llm, KVS cache, GitHub Actions and Bitbucket Pipelines deploy pipeline with a permission lock.",
    vars: {
      APP_NAME: "Next Steps",
      PACKAGE_NAME: "next-steps-forge-app",
      MODULE_KEY: "next-steps-page",
      LLM_KEY: "next-steps-llm",
      PAGE_TITLE: "Next Steps",
      UI_DIR: "static/next-steps",
    },
    files: [
      { path: "manifest.yml", lines: MANIFEST_YML },
      { path: "package.json", lines: ROOT_PACKAGE_JSON },
      { path: "src/index.js", lines: SRC_INDEX_JS },
      { path: "{{UI_DIR}}/package.json", lines: UI_PACKAGE_JSON },
      { path: "{{UI_DIR}}/webpack.config.js", lines: UI_WEBPACK_CONFIG_JS },
      { path: "{{UI_DIR}}/public/index.html", lines: UI_PUBLIC_INDEX_HTML },
      { path: "{{UI_DIR}}/src/index.js", lines: UI_SRC_INDEX_JS },
      { path: "{{UI_DIR}}/src/App.jsx", lines: UI_SRC_APP_JSX },
      { path: "{{UI_DIR}}/src/styles.css", lines: UI_SRC_STYLES_CSS },
      { path: ".github/workflows/forge-deploy.yml", lines: FORGE_DEPLOY_YML },
      { path: "bitbucket-pipelines.yml", lines: BITBUCKET_PIPELINES_YML },
      { path: ".cognirunner/inject-app-id.js", lines: INJECT_APP_ID_JS },
      { path: ".cognirunner/check-permissions-lock.js", lines: CHECK_PERMISSIONS_LOCK_JS },
      { path: "README.md", lines: README_MD },
      { path: ".gitignore", lines: GITIGNORE },
      { path: "LICENSE", lines: LICENSE },
    ],
  },
  // Pipeline-only: what `setupPipeline(repo)` commits into an EXISTING Forge app repo.
  "forge-pipeline": {
    label: "Deploy pipeline for an existing Forge app",
    description: "GitHub Actions + Bitbucket Pipelines workflow, app-id injection and the permission lock helpers.",
    vars: { APP_NAME: "Forge app", UI_DIR: "static/app" },
    files: [
      { path: ".github/workflows/forge-deploy.yml", lines: FORGE_DEPLOY_YML },
      { path: "bitbucket-pipelines.yml", lines: BITBUCKET_PIPELINES_YML },
      { path: ".cognirunner/inject-app-id.js", lines: INJECT_APP_ID_JS },
      { path: ".cognirunner/check-permissions-lock.js", lines: CHECK_PERMISSIONS_LOCK_JS },
    ],
  },
};

/** Metadata-only view for UIs (no file bodies). */
export const SCAFFOLD_INDEX = Object.entries(SCAFFOLDS).map(([id, s]) => ({ id, label: s.label, description: s.description, files: s.files.map((f) => f.path), vars: Object.keys(s.vars) }));

const substitute = (text, vars) => String(text).replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

const SAFE_VAR_CHARS = /^[A-Za-z0-9 ._\/-]+$/;

/**
 * F-541 — THE ONE RULE FOR "IS THIS SCAFFOLD VARIABLE USABLE", AND ITS ONE HOME.
 *
 * A scaffold variable is substituted into shell words, YAML values and FILE PATHS, so the
 * character set was never the whole question: "." and "/" are both legal and both needed
 * (static/app), which means ".." and a leading "/" are reachable and neither belongs in a
 * path relative to a checkout. The backend's old SAFE_VAR allowed both, so a traversing
 * UI_DIR was refused only by the admin panel's own copy of the rule -- that is, only in the
 * browser, and only for the one caller that happens to be a form.
 *
 * This is the rule, and both the renderer and the setup resolver call it. The admin panel
 * imports it too, instead of keeping the copy it grew.
 *
 * Returns null when the value is usable, otherwise the sentence to show a human.
 */
export const SCAFFOLD_VAR_LABELS = Object.freeze({
  APP_NAME: "The app name",
  UI_DIR: "The Custom UI folder",
});

export const scaffoldVarError = (name, value, label) => {
  const what = label || SCAFFOLD_VAR_LABELS[name] || String(name || "That value");
  const v = String(value == null ? "" : value).trim();
  if (!v) return what + " cannot be empty.";
  if (v.length > 80) return what + " must be 80 characters or fewer.";
  if (!SAFE_VAR_CHARS.test(v)) return what + " may only contain letters, numbers, spaces and . _ - /";
  // Path traversal is refused on EVERY value, not only the folder: the character set has to
  // allow dots and slashes, so "does this climb out of the checkout" is the real question,
  // and an app name has no business climbing either.
  if (v.split("/").some((seg) => seg === "..") || v.startsWith("/")) {
    return what + " cannot contain .. or start with /";
  }
  return null;
};

/**
 * Render a scaffold into [{ path, content }]. Variables are validated to a safe
 * character set so a model-chosen name can never inject YAML/JS structure.
 */
export const renderScaffold = (kind, overrides = {}) => {
  const s = SCAFFOLDS[kind];
  if (!s) throw new Error("Unknown scaffold: " + kind);
  const vars = { ...s.vars };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
    const err = scaffoldVarError(k, v);
    if (err) throw new Error("Scaffold variable " + k + " is not usable: " + err);
    vars[k] = String(v).trim();
  }
  return s.files.map((f) => ({
    path: substitute(f.path, vars).replace(/^\/+/, ""),
    content: expandLines(f.lines, vars).map((l) => substitute(l, vars)).join("\n") + "\n",
  }));
};

/**
 * Flatten a file's line array, dropping "{ when, lines }" blocks whose predicate is false.
 * An entry that is neither a string nor such a block THROWS: a scaffold line silently
 * vanishing because of a typo is the failure mode this shape must not have (F-540).
 */
const expandLines = (entries, vars) => {
  const out = [];
  for (const entry of entries || []) {
    if (typeof entry === "string") { out.push(entry); continue; }
    if (entry && typeof entry === "object" && Array.isArray(entry.lines) && typeof entry.when === "function") {
      if (entry.when(vars)) out.push(...entry.lines);
      continue;
    }
    throw new Error("Scaffold line entry must be a string or a { when, lines } block");
  }
  return out;
};

/** The permission lock CogniRunner writes when an admin approves a repo's pipeline. */
/**
 * The permission lock. ITS IDENTITY IS ITS SCOPE SET — "permissions" and nothing
 * else. "approvedBy" / "approvedAt" are provenance siblings that no comparison
 * may read (git-pipeline.js "hashLock" hashes "permissions" only; the generated
 * CI check compares "lock.permissions" only).
 *
 * F-343: "approvedAt" used to be stamped with "new Date()" here, so two renders
 * of ONE manifest were never byte-equal and any whole-lock comparison would have
 * been wrong by construction (refusing every re-run with a lock_mismatch). It is
 * now a PARAMETER defaulting to the fixed sentinel "null" — a render is
 * deterministic; a caller that wants a timestamp on the row passes one.
 */
export const buildPermissionLock = (manifestYaml, { approvedBy = null, source = "cognirunner", approvedAt = null } = {}) => {
  const lines = String(manifestYaml || "").split(/\r?\n/);
  const out = [];
  let inPerm = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^permissions:\s*$/.test(line)) { inPerm = true; continue; }
    if (inPerm && /^\S/.test(line) && line.trim()) inPerm = false;
    if (inPerm && line.trim()) out.push(line.trim());
  }
  return { version: 1, source, approvedBy, approvedAt, permissions: out.sort() };
};

export const PLACEHOLDER_FORGE_APP_ID = PLACEHOLDER_APP_ID;
export default SCAFFOLDS;
