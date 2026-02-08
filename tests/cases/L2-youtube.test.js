const { launch } = require("../setupBrowser");
const { getPlaybackRate, hasIndicator, waitForVideo } = require("../helpers");

async function run() {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const rate = await getPlaybackRate(page);
  const indicator = await hasIndicator(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16 && indicator;
  console.log("L2 YouTube:", pass ? "PASS" : "FAIL", pass ? "(speed + indicator, shadow DOM safe)" : "");

  await browser.close();
}

module.exports = { run };
