const { launch } = require("../setupBrowser");
const { getPlaybackRate, waitForVideo } = require("../helpers");

(async () => {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);
  await new Promise((r) => setTimeout(r, 2000));

  const rate = await getPlaybackRate(page);
  const pass = typeof rate === "number" && rate >= 0.1 && rate <= 16;
  console.log("Popup/Detection (extension active on page):", pass ? "PASS" : "FAIL");

  await browser.close();
})();
