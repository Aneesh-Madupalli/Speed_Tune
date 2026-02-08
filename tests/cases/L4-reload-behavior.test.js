const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

async function run() {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const rate = await getPlaybackRate(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16;
  console.log("L4 Reload Behavior:", pass ? "PASS" : "FAIL");

  await browser.close();
}

module.exports = { run };
