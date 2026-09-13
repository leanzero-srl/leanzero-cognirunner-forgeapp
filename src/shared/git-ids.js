/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The storage keys that identify ONE git webhook delivery — the single home of the
 * shapes (F-335). The webhook (src/index.js `gitWebhook`) takes the claim at ACCEPT
 * time and the consumer (src/async-handler.js `executeGitEvent`) is what makes it mean
 * COMPLETION: it releases the claim when a dispatch throws, so the provider's Redeliver
 * button is not answered `duplicate` for a delivery that never ran.
 *
 * Two writers on one key shape means the shape may not live inline in either of them.
 * Dependency-free on purpose: it bundles into the backend and any test.
 */

/** The 24 h idempotency claim: taken at accept, released when a dispatch throws. */
export const gitDeliveryClaimKey = (connectionId, deliveryId) => `git_delivery:${connectionId}:${deliveryId}`;

/** The dispatch-attempt counter, so a poison delivery cannot retry forever. */
export const gitDeliveryAttemptKey = (connectionId, deliveryId) => `git_delivery_try:${connectionId}:${deliveryId}`;

/**
 * The platform retries a thrown consumer event up to four times. A delivery that has
 * thrown this many times is DROPPED loudly rather than redelivered forever.
 */
export const GIT_DISPATCH_MAX_ATTEMPTS = 4;
