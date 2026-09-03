/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline stand-in for @forge/resolver. Mirrors the invocation shape src/test-hook.js uses:
//   handler({ call: { functionKey, payload }, context }, { principal: { accountId } })
// and the callback shape the resolvers expect: ({ payload, context }).
export default class Resolver {
  constructor() { this.defs = new Map(); }
  define(key, fn) { this.defs.set(key, fn); return this; }
  getDefinitions() {
    const defs = this.defs;
    return async (event = {}, ctx = {}) => {
      const call = event.call || {};
      const fn = defs.get(call.functionKey);
      if (!fn) throw new Error(`mock resolver: no definition for "${call.functionKey}"`);
      return fn({ payload: call.payload || {}, context: { ...(event.context || {}), accountId: ctx && ctx.principal ? ctx.principal.accountId : undefined } });
    };
  }
}
