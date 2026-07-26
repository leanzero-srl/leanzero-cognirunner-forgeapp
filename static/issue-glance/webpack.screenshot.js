/*
 * UNTRACKED screenshot harness webpack config. Builds the app standalone with
 * @forge/bridge aliased to the local mock, output to build-shot/.
 *   npx webpack --config webpack.screenshot.js --mode production
 */
const path = require("path");
const base = require("./webpack.config.js");

module.exports = {
  ...base,
  mode: "production",
  output: { ...base.output, path: path.resolve(__dirname, "build-shot"), clean: true },
  resolve: {
    ...base.resolve,
    alias: {
      ...(base.resolve && base.resolve.alias),
      "@forge/bridge$": path.resolve(__dirname, "../_screenshot-harness/bridge.js"),
      "@forge/jira-bridge$": path.resolve(__dirname, "../_screenshot-harness/jira-bridge.js"),
    },
  },
};
