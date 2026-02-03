const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

(async () => {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const rate = await getPlaybackRate(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16;
  console.log("Speed Apply Test:", pass ? "PASS" : "FAIL", pass ? `(rate: ${rate}x)` : "");

  await browser.close();
})();
