const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

(async () => {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  await page.keyboard.down("Control");
  await page.keyboard.press(".");
  await page.keyboard.up("Control");

  const rate = await getPlaybackRate(page);
  console.log("Keyboard Shortcut:", rate > 1 ? "PASS" : "FAIL");

  await browser.close();
})();
