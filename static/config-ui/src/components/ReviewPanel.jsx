/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";
import AILoadingState from "./AILoadingState";

const VERDICT_STYLES = {
  good: { color: "var(--success-color)", bg: "rgba(22, 163, 106, 0.06)", border: "var(--success-color)", icon: "\u2705" },
  needs_attention: { color: "#d97706", bg: "rgba(217, 119, 6, 0.06)", border: "#d97706", icon: "\u26A0\uFE0F" },
  has_issues: { color: "var(--error-color)", bg: "rgba(220, 38, 38, 0.06)", border: "var(--error-color)", icon: "\u274C" },
};

const ITEM_ICONS = { success: "\u2705", warning: "\u26A0\uFE0F", error: "\u274C", tip: "\uD83D\uDCA1" };

export default function ReviewPanel({ configType, config }) {
  const [reviewing, setReviewing] = useState(false);
  // True only while the initial reviewConfig call is in flight — the button
  // stays visible with a busy spinner until the task is actually queued.
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [statusText, setStatusText] = useState("");
  const pollRef = useRef(null);
  // Guards setState after unmount — the polling chain outlives fast navigations.
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const pollForResult = useCallback((taskId) => {
    let attempts = 0;
    const maxAttempts = 40; // 40 * 3s = 120s max

    const poll = async () => {
      attempts++;
      try {
        const res = await invoke("getAsyncTaskResult", { taskId });
        if (!mountedRef.current) return;
        if (res.success) {
          if (res.status === "done") {
            setResult(res.result);
            setReviewing(false);
            setStatusText("");
            return;
          }
          if (res.status === "error") {
            setResult({ success: false, error: res.error });
            setReviewing(false);
            setStatusText("");
            return;
          }
          // Still processing
          setStatusText(res.status === "processing" ? "AI is reviewing..." : "Queued...");
          if (attempts < maxAttempts) {
            pollRef.current = setTimeout(poll, 3000);
          } else {
            setResult({ success: false, error: "Review timed out. Try again." });
            setReviewing(false);
            setStatusText("");
          }
        } else {
          // Poll itself failed — stop, surface the error, restore the button
          // (leaving reviewing=true here would spin forever with no way out).
          setResult({ success: false, error: res.error || "Failed to poll review status" });
          setReviewing(false);
          setStatusText("");
        }
      } catch (e) {
        if (!mountedRef.current) return;
        setResult({ success: false, error: e.message });
        setReviewing(false);
        setStatusText("");
      }
    };

    poll();
  }, []);

  const handleReview = async () => {
    setReviewing(true);
    setSubmitting(true);
    setResult(null);
    setStatusText("Submitting...");

    // Clear any existing poll
    if (pollRef.current) clearTimeout(pollRef.current);

    try {
      const res = await invoke("reviewConfig", { configType, config });
      if (!mountedRef.current) return;
      setSubmitting(false);

      if (res.async && res.taskId) {
        // Async mode — start polling
        setStatusText("Queued...");
        pollForResult(res.taskId);
      } else {
        // Sync fallback (shouldn't happen but handle gracefully)
        setResult(res);
        setReviewing(false);
        setStatusText("");
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setSubmitting(false);
      setResult({ success: false, error: e.message });
      setReviewing(false);
      setStatusText("");
    }
  };

  return (
    <div className="review-panel">
      {(!reviewing || submitting) && (
        <button
          className={`btn-review${submitting ? " is-busy" : ""}`}
          onClick={handleReview}
          disabled={reviewing}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <span>AI Review</span>
        </button>
      )}

      {reviewing && !submitting && (
        <AILoadingState type="review" statusOverride={statusText || null} />
      )}

      {result && (
        <div className="review-result anim-rise">
          {result.success && result.review ? (
            <>
              <div
                className="review-verdict"
                style={{
                  background: VERDICT_STYLES[result.review.verdict]?.bg || VERDICT_STYLES.good.bg,
                  borderColor: VERDICT_STYLES[result.review.verdict]?.border || VERDICT_STYLES.good.border,
                }}
              >
                <span className="review-verdict-icon">
                  {VERDICT_STYLES[result.review.verdict]?.icon || "\u2705"}
                </span>
                <span className="review-verdict-text">{result.review.summary}</span>
                <button className="test-dismiss" onClick={() => setResult(null)}>&times;</button>
              </div>
              {result.review.items && result.review.items.length > 0 && (
                <div className="review-items">
                  {result.review.items.map((item, i) => (
                    <div key={i} className={`review-item review-item-${item.type}`}>
                      <span className="review-item-icon">{ITEM_ICONS[item.type] || ""}</span>
                      <span>{item.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.tokens && (
                <div className="review-meta">{result.tokens} tokens used</div>
              )}
            </>
          ) : (
            <div className="review-verdict" style={{ background: VERDICT_STYLES.has_issues.bg, borderColor: VERDICT_STYLES.has_issues.border }}>
              <span className="review-verdict-icon">{"\u274C"}</span>
              <span className="review-verdict-text">{result.error || "Review failed"}</span>
              <button className="test-dismiss" onClick={() => setResult(null)}>&times;</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
