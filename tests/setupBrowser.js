const puppeteer = require("puppeteer");
const path = require("path");

const extensionPath = path.resolve(__dirname, "..");

async function launch() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  return { browser, page };
}

module.exports = { launch };
