const { launch } = require("../setupBrowser");
const { hasIndicator } = require("../helpers");

(async () => {
  const { browser, page } = await launch();

  // Article/image page: no primary video in main document (indicator must NOT show)
  await page.goto("https://example.com");
  await new Promise((r) => setTimeout(r, 5000));

  const present = await hasIndicator(page);
  console.log("No Indicator on Article:", !present ? "PASS" : "FAIL");

  await browser.close();
})();
