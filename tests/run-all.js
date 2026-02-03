const { execSync } = require("child_process");
const path = require("path");

const casesDir = path.join(__dirname, "cases");
const tests = [
  "speed-apply",
  "indicator-logic",
  "popup-detection",
  "keyboard-shortcuts",
  "save-speed-reload",
  "spa-navigation",
  "iframe-article",
  "tab-visibility",
];

for (const t of tests) {
  console.log(`\nRunning ${t}...\n`);
  execSync(`node "${path.join(casesDir, t + ".test.js")}"`, { stdio: "inherit" });
}

console.log("\nAll tests completed.\n");
