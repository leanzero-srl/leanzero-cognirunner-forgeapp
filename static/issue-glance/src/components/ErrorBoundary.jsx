/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE ONE ERROR BOUNDARY IN issue-glance (F-374).
 *
 * The panel this wraps asks a user to authorise a WRITE. Before this file existed, a single
 * bad render anywhere inside it (F-374: an object handed to React as a child) unmounted the
 * whole subtree to a blank right rail, leaving a pending consent ticket live for 24 h with
 * no Confirm, no Skip and no Change on screen. A blank iframe is the worst possible way to
 * say "something went wrong" on a surface whose entire job is consent.
 *
 * It renders a NAMED failure instead: the solid red treatment the app already uses for
 * errors (no rail, no tint, white text on a saturated fill), what it means for anything
 * that was pending, and one button that reloads. `componentDidCatch` logs, because the
 * console is the only place a deployed Custom UI iframe can leave a trace.
 */
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[CogniRunner] the panel failed to render", error, info && info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="coder-error cr-boundary" role="alert">
        <p className="cr-boundary-p">{this.props.message || "This panel couldn't be displayed."}</p>
        <p className="cr-boundary-p">Nothing was run and nothing was confirmed. Reload to try again.</p>
        <button
          type="button"
          className="cr-boundary-btn"
          onClick={() => { try { window.location.reload(); } catch (e) { /* nothing else to offer */ } }}
        >
          Reload
        </button>
      </div>
    );
  }
}
