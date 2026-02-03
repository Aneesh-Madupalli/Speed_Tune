# Speed Tune — Test Strategy (Chrome MV3 Product)

Enterprise-level test plan: **functional**, **architectural**, **timing (MV3)**, **DOM edge cases**, **UX correctness**, **regression safety**. All automated with Puppeteer (real Chrome + real extension + real/fixture pages).

## Test Layers

| Layer | Purpose | What runs |
|-------|--------|-----------|
| **L1 — Deterministic DOM** | Content script logic correctness | Local HTML fixtures (no network) |
| **L2 — Real site integration** | Real-world behavior | YouTube, example.com |
| **L3 — Extension architecture** | Popup / storage / content sync | Fixtures + YouTube |
| **L4 — Timing & MV3** | Controller, injection, SPA, visibility | YouTube + navigation/reload |
| **L5 — Regression** | Run before every change | `npm test` (all layers) |

## Run all tests

From the **Speed Tune** project root:

```bash
npm test
```

or:

```bash
node tests/run-all.js
```

- **Fixture server** starts on `http://127.0.0.1:8765` for L1 (and L3 fixtures).
- **L1 → L2 → L3 → L4** run in order.
- **~60–90 seconds** total (Chrome opens with extension loaded, `headless: false`).

## Folder structure

```
tests/
├── setupBrowser.js      # Launch Chrome with extension
├── helpers.js           # getPlaybackRate, hasIndicator, waitForVideo, etc.
├── fixtureServer.js     # HTTP server for L1 fixtures
├── run-all.js           # Start server, run L1–L4, stop server
├── fixtures/
│   ├── single-video.html
│   ├── multi-video.html
│   ├── delayed-video.html
│   ├── remove-video.html
│   └── article-no-video.html
└── cases/
    ├── L1-single-video.test.js
    ├── L1-multi-video.test.js
    ├── L1-delayed-video.test.js
    ├── L1-remove-video.test.js
    ├── L1-article-no-video.test.js
    ├── L2-youtube.test.js
    ├── L2-article.test.js
    ├── L3-popup-ui.test.js
    ├── L3-keyboard.test.js
    ├── L3-save-speed-off.test.js
    ├── L4-spa-navigation.test.js
    ├── L4-tab-visibility.test.js
    └── L4-reload-behavior.test.js
```

## What each layer protects

| Risk | Tests that catch it |
|------|----------------------|
| Indicator bug returns | L1-article-no-video, L1-multi-video, L2-article |
| Observer breaks | L1-delayed-video |
| Stale refs bug | L1-remove-video |
| Popup/content mismatch | L3-popup-ui, L1-article-no-video |
| Keyboard breaks | L3-keyboard |
| Storage/reload logic | L3-save-speed-off, L4-reload-behavior |
| SPA breaks controller | L4-spa-navigation |
| Tab visibility / perf | L4-tab-visibility |

## L1 — Fixtures (deterministic)

- **single-video.html** — One `<video>`. Speed applies, indicator appears.
- **multi-video.html** — Three videos (different sizes). All same playbackRate, indicator on largest only.
- **delayed-video.html** — Video added after 5s. Observer detects, speed applies, indicator appears.
- **remove-video.html** — Create video → remove → create new. New video gets speed, no stale refs.
- **article-no-video.html** — Text + images only. No indicator.

## Run a single test

```bash
# Start fixture server first (for L1/L3 fixtures)
node -e "require('./tests/fixtureServer').startFixtureServer().then(() => console.log('Server on 8765'))"
# In another terminal:
FIXTURE_BASE_URL=http://127.0.0.1:8765 node tests/cases/L1-single-video.test.js
```

Or run `npm test` and watch the layer you care about.

## Requirements

- Node.js (with npm)
- `npm install` (Puppeteer)
- Network for L2/L4 (YouTube, example.com)
- Port **8765** free for fixture server

## Headless / CI

In `tests/setupBrowser.js`, set `headless: true` for CI so no window is shown.
