const { launch } = require("../setupBrowser");
const { getPlaybackRate, hasIndicator, waitForVideo } = require("../helpers");

const baseUrl = process.env.FIXTURE_BASE_URL || "http://127.0.0.1:8765";

async function run() {
  const { browser, page } = await launch();
  await page.goto(`${baseUrl}/single-video.html`, { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const rate = await getPlaybackRate(page);
  const indicator = await hasIndicator(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16 && indicator;
  console.log("L1 Single Video:", pass ? "PASS" : "FAIL", pass ? "(speed + indicator)" : "");

  await browser.close();
}

module.exports = { run };
