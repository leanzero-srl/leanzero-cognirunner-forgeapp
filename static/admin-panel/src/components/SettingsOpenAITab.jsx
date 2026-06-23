/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React from "react";
import OpenAIConfig from "./OpenAIConfig";

export default function SettingsOpenAITab({ invoke }) {
  return (
    <div>
      <OpenAIConfig invoke={invoke} />
    </div>
  );
}
