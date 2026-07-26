/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Portable DOM-based confirm dialog — a styled in-app modal replacing the
// browser-native confirm(). Self-injects its CSS once (guarded by element id) so
// ANY component can import and call it without depending on App.js injectStyles.
// Returns a Promise resolving true (confirmed) / false (cancelled).
// Esc / backdrop click = cancel, Enter = confirm.
//
// Hard project rule: never use window.confirm / window.alert / window.prompt or a
// native <select> — always custom dialogs + custom dropdowns. Use this for confirms.

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("cr-confirm-styles")) return;
  const style = document.createElement("style");
  style.id = "cr-confirm-styles";
  style.textContent = `
    .cr-confirm-overlay {
      position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
      background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
      animation: crConfirmFade 0.12s ease;
    }
    @keyframes crConfirmFade { from { opacity: 0; } to { opacity: 1; } }
    .cr-confirm {
      width: min(460px, 92vw); background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0;
      border-radius: 12px; padding: 20px 22px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.35);
    }
    html[data-color-mode="dark"] .cr-confirm { background: #1e293b; color: #e2e8f0; border-color: #334155; }
    .cr-confirm-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .cr-confirm-msg { font-size: 13px; line-height: 1.5; color: #475569; white-space: pre-wrap; }
    html[data-color-mode="dark"] .cr-confirm-msg { color: #94a3b8; }
    .cr-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  `;
  document.head.appendChild(style);
}

export function confirmDialog(message, { title = "Please confirm", confirmLabel = "Confirm", danger = true } = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    document.querySelectorAll(".cr-confirm-overlay").forEach((el) => el.remove());
    const overlay = document.createElement("div");
    overlay.className = "cr-confirm-overlay";
    const box = document.createElement("div");
    box.className = "cr-confirm";
    const h = document.createElement("div"); h.className = "cr-confirm-title"; h.textContent = title;
    const p = document.createElement("div"); p.className = "cr-confirm-msg"; p.textContent = message;
    const actions = document.createElement("div"); actions.className = "cr-confirm-actions";
    const cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "btn-small"; cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button"); okBtn.type = "button"; okBtn.className = "btn-small" + (danger ? " btn-danger" : ""); okBtn.textContent = confirmLabel;
    let done = false;
    const close = (val) => { if (done) return; done = true; document.removeEventListener("keydown", onKey); overlay.remove(); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") close(false); else if (e.key === "Enter") close(true); };
    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKey);
    actions.append(cancelBtn, okBtn); box.append(h, p, actions); overlay.append(box); document.body.append(overlay);
    setTimeout(() => okBtn.focus(), 0);
  });
}

export default confirmDialog;
