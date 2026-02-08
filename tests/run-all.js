const path = require("path");
const { startFixtureServer, stopFixtureServer } = require("./fixtureServer");

const casesDir = path.join(__dirname, "cases");

const L1 = [
  "L1-single-video",
  "L1-multi-video",
  "L1-delayed-video",
  "L1-remove-video",
  "L1-article-no-video",
];
const L2 = ["L2-youtube", "L2-article"];
const L3 = ["L3-popup-ui", "L3-keyboard", "L3-save-speed-off"];
const L4 = ["L4-spa-navigation", "L4-tab-visibility", "L4-reload-behavior"];

async function runOne(name) {
  const mod = require(path.join(casesDir, name + ".test.js"));
  await mod.run();
}

(async () => {
  console.log("\n--- Fixture server starting ---\n");
  await startFixtureServer();
  process.env.FIXTURE_BASE_URL = "http://127.0.0.1:8765";

  try {
    console.log("\n=== L1 — Deterministic DOM ===\n");
    for (const t of L1) {
      console.log(`Running ${t}...\n`);
      await runOne(t);
    }
    console.log("\n=== L2 — Real site integration ===\n");
    for (const t of L2) {
      console.log(`Running ${t}...\n`);
      await runOne(t);
    }
    console.log("\n=== L3 — Extension architecture ===\n");
    for (const t of L3) {
      console.log(`Running ${t}...\n`);
      await runOne(t);
    }
    console.log("\n=== L4 — MV3 timing & SPA ===\n");
    for (const t of L4) {
      console.log(`Running ${t}...\n`);
      await runOne(t);
    }
  } finally {
    await stopFixtureServer();
    console.log("\n--- Fixture server stopped ---\n");
  }

  console.log("\nAll tests completed.\n");
})();
