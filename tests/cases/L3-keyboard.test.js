const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

async function run() {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  await page.keyboard.down("Control");
  await page.keyboard.press(".");
  await page.keyboard.up("Control");

  const rate = await getPlaybackRate(page);
  const pass = typeof rate === "number" && rate > 1;
  console.log("L3 Keyboard (Ctrl+.):", pass ? "PASS" : "FAIL");

  await browser.close();
}

module.exports = { run };
