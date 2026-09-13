#!/usr/bin/env bash
#
# CogniRunner - AI-powered workflow validation for Jira
# Copyright (C) 2025 LeanZero
#
# SPDX-License-Identifier: Apache-2.0
#
# Copy the ALLOW-LISTED knowledge sources into the gitignored knowledge/raw/.
#
# knowledge/raw/ is a verbatim, UNSCRUBBED copy of the owner's own corpus. It is
# gitignored and must stay that way: the scrubbing and the leak scan happen in
# scripts/bake-knowledge.mjs, downstream of this script, and the raw tree is the input
# they are protecting the repo from — not an artefact.
#
# What is copied is decided by knowledge/sources.json and NOTHING ELSE. This script
# re-reads that file every run (via node) rather than carrying its own list, because two
# lists is how a client desk ends up in the corpus: one of them gets edited and the other
# does not. Entries marked `reauthor: true` are NEVER copied — their replacement is
# hand-written in knowledge/authored/.
#
# Workhorse sources (tier D/E, per the global notes) come over rsync from
# workhorse:~/Projects/... . The SSH alias `workhorse` with IdentitiesOnly is the
# documented way in; nothing here logs in interactively.
#
# Usage:
#   scripts/sync-knowledge-sources.sh              # every local source
#   scripts/sync-knowledge-sources.sh --workhorse  # local + rsync the workhorse sources
#   scripts/sync-knowledge-sources.sh --dry-run
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_DIR="$REPO_ROOT/knowledge/raw"
SOURCES="$REPO_ROOT/knowledge/sources.json"

DRY_RUN=0
WITH_WORKHORSE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --workhorse) WITH_WORKHORSE=1 ;;
    *) echo "sync-knowledge-sources: unknown flag $arg" >&2; exit 2 ;;
  esac
done

[ -f "$SOURCES" ] || { echo "sync-knowledge-sources: $SOURCES is missing" >&2; exit 2; }

# One line per file to copy: "<absolute source path>\t<path under knowledge/raw>".
# node does the JSON reading so the allow-list has exactly one parser.
PLAN="$(node -e '
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const expand = (p) => p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
for (const s of cfg.sources || []) {
  if (s.reauthor) continue;                       // never copied, by design
  for (const f of s.files || []) {
    process.stdout.write(`${path.join(expand(s.root), f.path)}\t${path.join(s.raw, f.path)}\t${s.sync || "local"}\n`);
  }
}
' "$SOURCES")"

copied=0; missing=0; skipped=0
while IFS=$'\t' read -r src dest sync; do
  [ -n "${src:-}" ] || continue
  if [ "$sync" = "workhorse" ] && [ "$WITH_WORKHORSE" -eq 0 ]; then
    skipped=$((skipped + 1)); continue
  fi
  target="$RAW_DIR/$dest"
  if [ "$sync" = "workhorse" ]; then
    echo "rsync workhorse:$src -> knowledge/raw/$dest"
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$(dirname "$target")"
      rsync -a "workhorse:$src" "$target" || { echo "  MISSING on the workhorse"; missing=$((missing + 1)); continue; }
    fi
    copied=$((copied + 1)); continue
  fi
  if [ ! -f "$src" ]; then
    echo "MISSING  $src"
    missing=$((missing + 1)); continue
  fi
  echo "copy     $src -> knowledge/raw/$dest"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname "$target")"
    cp "$src" "$target"
  fi
  copied=$((copied + 1))
done <<< "$PLAN"

echo
echo "sync-knowledge-sources: $copied copied, $missing missing, $skipped workhorse entries skipped (pass --workhorse)"
# A MISSING source is a failure, not a warning: baking from a corpus that silently lost a
# file produces a pack that is quietly smaller than the manifest says it is.
[ "$missing" -eq 0 ] || exit 1
