const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

const baseUrl = process.env.FIXTURE_BASE_URL || "http://127.0.0.1:8765";

async function run() {
  const { browser, page } = await launch();

  await page.goto(`${baseUrl}/single-video.html`, { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const rate = await getPlaybackRate(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16;
  console.log("L3 Save Speed / Reload:", pass ? "PASS" : "FAIL", pass ? "(valid rate after reload)" : "");

  await browser.close();
}

module.exports = { run };
