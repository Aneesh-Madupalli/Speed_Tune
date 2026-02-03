const { launch } = require("../setupBrowser");
const { hasIndicator, waitForVideo } = require("../helpers");

(async () => {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const present = await hasIndicator(page);
  console.log("Indicator Present:", present ? "PASS" : "FAIL");

  await browser.close();
})();
