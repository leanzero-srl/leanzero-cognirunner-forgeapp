/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-896 - THE ONE HOME FOR "HOW BIG IS THIS DOCUMENT", FOR EVERY SURFACE THAT ASKS.
 *
 * There are two Add-Document forms in this app and they measured different things.
 * `DocRepository.jsx` (both copies) measures UTF-8 BYTES with `utf8Bytes`, the same
 * helper `saveContextDoc` gates on, shows the too-large clause and disables Save over
 * the cap. `DocsTab.jsx` in admin-panel had its own two-line `formatSize` fed with
 * `newContent.length` - UTF-16 CODE UNITS - with no cap gate at all. Measured live in
 * dev: 100 rocket emoji is 200 characters and 400 UTF-8 bytes, and that form said
 * "200 B". An admin could paste a document the backend would refuse and read an
 * encouraging number the whole way to the refusal, which names a limit they were never
 * shown.
 *
 * F-836 already fixed exactly this class of bug once, in the OTHER form. It came back
 * because the fix lived in a component rather than in a shared home, and the second
 * form never imported it. So the measure, the wording, the cap and the ELEMENT are all
 * here now, and both forms render this. There is nothing left to keep in sync by hand.
 *
 * Kept self-contained (no App.js imports) so the file stays byte-copyable between
 * config-ui and admin-panel, per the duplication convention. The `.doc-size-hint` and
 * `.doc-size-hint.is-over` classes live in each app's own injectStyles()/
 * injectCopiedComponentStyles(), which are the only homes that render.
 */

import React, { useMemo } from "react";
import { DOC_CONTENT_MAX_BYTES, DOC_CONTENT_MAX_LABEL, utf8Bytes } from "../../../../src/shared/registry-limits.js";

/**
 * Bytes, spoken. The argument is ALWAYS UTF-8 bytes: doc rows carry a byte
 * `contentLength` (src/index.js writes `utf8Bytes(content)` on every doc writer), and
 * the editors measure the draft with `utf8Bytes` below. Never hand it `.length`.
 *
 * THE DIVISOR IS 1000, NOT 1024, AND THAT IS THE WHOLE POINT OF PUTTING IT HERE.
 * `DOC_CONTENT_MAX_LABEL` is `DOC_CONTENT_MAX_BYTES / 1000` = "200 KB". The old
 * `formatSize` divided by 1024, so a draft one byte over the cap rendered
 * "195.3 KB (too large, max 200 KB)" - a refusal that contradicts itself and reads as a
 * bug in the app rather than a limit. Two units in one sentence is not a rounding
 * detail; the reader cannot act on it. One unit, and it is the cap's.
 */
export const formatSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1000) return `${n} B`;
  return `${(n / 1000).toFixed(1)} KB`;
};

/** UTF-8 bytes of a draft document body. The ONE measure every doc gate uses. */
export const docContentBytes = (content) => utf8Bytes(content || "");

/**
 * Is this draft over the cap `saveContextDoc` enforces? Every Save button that can
 * create a document asks THIS, so a button can never disagree with the hint beside it.
 */
export const isDocContentTooLarge = (content) => docContentBytes(content) > DOC_CONTENT_MAX_BYTES;

/**
 * The hint itself. Blank body renders an empty hint rather than "0 B", which is the
 * behaviour both forms already had and the reason the element is always present.
 *
 * Over the cap the hint turns SOLID and 700, because it has stopped being a readout and
 * become a refusal: it is the only thing on screen that explains why Save went dead.
 */
export default function DocSizeHint({ content }) {
  const bytes = useMemo(() => docContentBytes(content), [content]);
  const over = bytes > DOC_CONTENT_MAX_BYTES;
  return (
    <span className={`doc-size-hint${over ? " is-over" : ""}`}>
      {bytes > 0 ? formatSize(bytes) : ""}
      {over ? ` (too large, max ${DOC_CONTENT_MAX_LABEL})` : ""}
    </span>
  );
}
