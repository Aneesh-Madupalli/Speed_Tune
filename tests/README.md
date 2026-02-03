# Speed Tune — Automated E2E Tests (Puppeteer)

Browser-level tests for the Chrome MV3 extension: real Chrome + real extension + real sites.

## Run all tests

From the project root (Speed Tune):

```bash
npm test
```

or:

```bash
node tests/run-all.js
```

Chrome will open with the extension loaded (`headless: false`). Each test runs in sequence.

## Run a single test

```bash
node tests/cases/speed-apply.test.js
```

## Test cases

| File | What it checks |
|------|----------------|
| `speed-apply.test.js` | Speed applies to video on a real page |
| `indicator-logic.test.js` | Indicator shows on primary video (e.g. YouTube) |
| `popup-detection.test.js` | Controller is ready and exposes speed |
| `keyboard-shortcuts.test.js` | Ctrl+. increases speed |
| `save-speed-reload.test.js` | Reload keeps non-1x speed (when Save Speed is on) |
| `spa-navigation.test.js` | Navigation to another video keeps behavior |
| `iframe-article.test.js` | No indicator on article/image-only page (primary-video bug) |
| `tab-visibility.test.js` | Tab hide/show doesn’t break extension |

## Requirements

- Node.js (with npm)
- `npm install` (installs Puppeteer)
- Network access (tests hit YouTube, example.com)

## Notes

- Tests use `headless: false` so you can watch Chrome; set `headless: true` in `setupBrowser.js` for CI.
- `save-speed-reload` may FAIL if Save Speed was off or speed was 1x in a previous run; it expects stored non-1x speed.
- `iframe-article` uses example.com (no primary video); use a real article URL if you want to test a news site.
