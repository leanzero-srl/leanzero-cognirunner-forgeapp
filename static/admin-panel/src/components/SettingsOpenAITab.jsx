/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import OpenAIConfig from "./OpenAIConfig";
import ApiAccessPanel from "./ApiAccessPanel";

export default function SettingsOpenAITab({ invoke }) {
  return (
    <div>
      <OpenAIConfig invoke={invoke} />
      <ApiAccessPanel invoke={invoke} />
    </div>
  );
}
