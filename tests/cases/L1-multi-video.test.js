const { launch } = require("../setupBrowser");
const { getAllPlaybackRates, hasIndicator, countVideos } = require("../helpers");

const baseUrl = process.env.FIXTURE_BASE_URL || "http://127.0.0.1:8765";

async function run() {
  const { browser, page } = await launch();
  await page.goto(`${baseUrl}/multi-video.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("video", { timeout: 10000 });

  const count = await countVideos(page);
  const rates = await getAllPlaybackRates(page);
  const indicator = await hasIndicator(page);
  const sameRate = rates.length >= 2 && rates.every((r) => r === rates[0]);
  const pass = count === 3 && sameRate && indicator;
  console.log("L1 Multi Video:", pass ? "PASS" : "FAIL", pass ? "(all same rate, indicator on largest)" : "");

  await browser.close();
}

module.exports = { run };
