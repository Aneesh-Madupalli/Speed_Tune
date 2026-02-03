const { launch } = require("../setupBrowser");
const { hasIndicator } = require("../helpers");

async function run() {
  const { browser, page } = await launch();

  await page.goto("https://example.com");
  await new Promise((r) => setTimeout(r, 5000));

  const indicator = await hasIndicator(page);
  const pass = !indicator;
  console.log("L2 Article (no video):", pass ? "PASS" : "FAIL", pass ? "(no indicator, no false detection)" : "");

  await browser.close();
}

module.exports = { run };
