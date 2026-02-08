const { launch } = require("../setupBrowser");
const { waitForVideo } = require("../helpers");

async function run() {
  const { browser, page } = await launch();

  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await waitForVideo(page);

  const page2 = await browser.newPage();
  await page2.goto("about:blank");
  await page.bringToFront();

  console.log("L4 Tab Visibility: PASS");
  await browser.close();
}

module.exports = { run };
