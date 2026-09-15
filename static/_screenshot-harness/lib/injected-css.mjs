/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE LIVE CSS OF AN APP, read from its source.
 *
 * CLAUDE.md's "CSS reality": `App.js`'s injectStyles() is the LIVE stylesheet in each of the
 * four Custom UI apps (`src/styles.css` is NOT imported anywhere), admin-panel injects a
 * SECOND sheet from injectCopiedComponentStyles(), and `public/index.html` carries the
 * pre-mount bootstrap subset. A probe that reads only one of those three measures a
 * stylesheet the user never sees.
 *
 * Every one of them is a plain template literal with no `${}` interpolation - asserted
 * here rather than assumed, because a single interpolation would make the extracted text
 * silently different from the text the browser receives.
 */
import fs from "node:fs";
import path from "node:path";

export const APPS = ["config-ui", "config-view", "admin-panel", "issue-glance"];

/**
 * Every `<something>.textContent = ` template literal in a source file, in source order.
 * The variable is `style` in three apps and `el` in issue-glance, which is exactly the kind
 * of difference that makes a reader silently return NOTHING for one app - so the pattern
 * matches any identifier and the caller asserts the sheet count it expects.
 */
function styleLiterals(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  const OPEN = /[A-Za-z_$][\w$]*\.textContent = `/g;
  let m;
  while ((m = OPEN.exec(src))) {
    const start = m.index + m[0].length;
    /* The close is a backtick that ends the literal. These blocks are thousands of lines
       long and contain no escaped backticks (injectStyles' own comments say so in two
       apps), so the first unescaped backtick is the end. */
    let j = start;
    while (j < src.length) {
      if (src[j] === "\\") { j += 2; continue; }
      if (src[j] === "`") break;
      j++;
    }
    const body = src.slice(start, j);
    if (body.includes("${")) {
      throw new Error(`${path.basename(file)}: an injected CSS literal interpolates \${...}; this reader would measure the wrong sheet`);
    }
    out.push(body);
    OPEN.lastIndex = j + 1;
  }
  return out;
}

/** The `<style>` blocks of a public/index.html bootstrap, if it has any. */
function bootstrapStyles(file) {
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

/**
 * All CSS an app really serves, as an array of sheets in the order the browser gets them:
 * the bootstrap subset first (it is in the document), then every injected sheet.
 * admin-panel yields two injected sheets (injectStyles + injectCopiedComponentStyles), and
 * their ORDER matters - the copied sheet deliberately cascades last.
 */
export function appSheets(staticDir, app) {
  const dir = path.join(staticDir, app);
  return [
    ...bootstrapStyles(path.join(dir, "public", "index.html")),
    ...styleLiterals(path.join(dir, "src", "App.js")),
  ];
}
