/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Imperative success/error toast. DOM-based (no React) so any component can
 * call it without context plumbing; styled by the .mls-toast classes in the
 * app's injected stylesheet (Motion & Loading System block).
 */
export function showToast(message, kind = "success") {
  try {
    document.querySelectorAll(".mls-toast").forEach((el) => el.remove());
    const el = document.createElement("div");
    el.className = "mls-toast" + (kind === "error" ? " mls-toast-error" : "");
    el.textContent = (kind === "error" ? "✕ " : "✓ ") + message;
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add("mls-toast-leaving");
      setTimeout(() => el.remove(), 300);
    }, 2600);
  } catch (e) {
    /* toast is best-effort — never break the caller */
  }
}
