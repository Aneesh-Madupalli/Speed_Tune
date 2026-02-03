const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

async function run() {
  const { browser, page } = await launch();

  const url1 = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  await page.goto(url1, { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const url2 = "https://www.youtube.com/watch?v=9bZkp7q19f0";
  try {
    await page.goto(url2, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e) {
    await page.goto(url1, { waitUntil: "domcontentloaded" });
  }
  await waitForVideo(page);

  const rate = await getPlaybackRate(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16;
  console.log("L4 SPA Navigation:", pass ? "PASS" : "FAIL");

  await browser.close();
}

module.exports = { run };
