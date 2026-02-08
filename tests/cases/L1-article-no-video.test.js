const { launch } = require("../setupBrowser");
const { hasIndicator } = require("../helpers");

const baseUrl = process.env.FIXTURE_BASE_URL || "http://127.0.0.1:8765";

async function run() {
  const { browser, page } = await launch();
  await page.goto(`${baseUrl}/article-no-video.html`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2000));

  const indicator = await hasIndicator(page);
  const pass = !indicator;
  console.log("L1 Article No Video:", pass ? "PASS" : "FAIL", pass ? "(no indicator on article)" : "");

  await browser.close();
}

module.exports = { run };
