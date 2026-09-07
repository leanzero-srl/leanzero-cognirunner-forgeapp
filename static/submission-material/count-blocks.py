#!/usr/bin/env python3
# CogniRunner - AI-powered workflow validation for Jira
# Copyright (C) 2025 LeanZero
# SPDX-License-Identifier: Apache-2.0
"""Verify every limited block in LISTING-COPY.md against the Marketplace char limits (code points)."""
import re, sys, pathlib

LIMITS = {"tagline": 130, "summary": 250, "more": 1000, "rel_summary": 80, "rel_notes": 1000}
for n in (1, 2, 3):
    LIMITS[f"h{n}_title"] = 50; LIMITS[f"h{n}_desc"] = 220; LIMITS[f"h{n}_cap"] = 220
NO_END_PUNCT = {"tagline", "h1_title", "h2_title", "h3_title"}

md = (pathlib.Path(__file__).parent / "LISTING-COPY.md").read_text(encoding="utf-8")
blocks = dict(re.findall(r"<!-- block:(\w+) -->\n(.*?)\n<!-- /block -->", md, re.S))
bad = 0
for name, limit in LIMITS.items():
    text = blocks.get(name)
    if text is None:
        print(f"MISSING {name}"); bad += 1; continue
    n = len(text)
    flags = []
    if n > limit: flags.append("OVER")
    if name in NO_END_PUNCT and text.rstrip()[-1:] in ".!?": flags.append("ENDS WITH PUNCTUATION")
    if flags: bad += 1
    print(f"{name:12s} {n:5d} / {limit:<5d} {' '.join(flags) or 'ok'}")
sys.exit(1 if bad else 0)
