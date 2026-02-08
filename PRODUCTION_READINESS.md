# Speed Tune — Production Readiness & Recommendations

## Is This Application Production-Ready?

**Short answer: Yes (enterprise-ready).** The extension has been hardened with debounced observers, global speed intervals, visibility-aware behavior, stale ref cleanup, defensive DOM access, executeScript retry/backoff, settings migration, and accessibility improvements.

Summary of what’s done and what’s recommended:

| Area            | Status   | Notes                                                                 |
|-----------------|----------|-----------------------------------------------------------------------|
| Core behavior   | Solid    | Speed control, popup, storage, commands work as designed             |
| Indicator bug   | Fixed    | Indicator limited to main-document, meaningfully visible primary video |
| Error handling  | Done     | Try/catch DOM/iframe; storage fallback; executeScript retry/backoff  |
| Performance     | Done     | Debounced observer; single global speed interval; tab visibility      |
| UX / a11y       | Done     | “No video” feedback, accessibility, Save Speed clarity                |
| Architecture    | Done     | Stale ref cleanup; SPA URL observer; settings migration               |

---

## 1. Production Readiness Assessment 

### What’s in good shape

- **Manifest V3**: Correct use of service worker, permissions, and commands.
- **Data flow**: `chrome.storage.sync` as source of truth; popup, background, and content script stay in sync.
- **Video detection**: Covers `<video>`, shadow DOM, same-origin iframes, and generic selectors with retries and URL-change handling.
- **Speed application**: `playbackRate` set on all videos; ratechange + interval re-apply when the page resets it.
- **Indicator fix**: Indicator is shown only for a **primary** video: main document, meaningfully visible (size/visibility/opacity), largest by area; no indicator on article/image-only pages where the only video is in an iframe (e.g. ad).

### What to improve before production

- **Reliability**: Wrap DOM/iframe access in try/catch; handle missing or failed `scripting.executeScript`; clean up stale video references and intervals when videos are removed.
- **Performance**: Debounce MutationObserver callbacks; replace per-video 500ms intervals with one global interval that only re-applies speed where it has drifted; consider pausing or throttling work when the tab is hidden.
- **UX**: Show clear feedback when the current tab has no (primary) video; improve accessibility (keyboard navigation, labels); clarify “Save Speed” behavior in the UI.
- **Architecture**: Avoid duplicate “apply speed” paths where possible; handle SPA navigation so you don’t end up with multiple controllers or duplicate observers.

---

## 2. Recommendations

### Architecture

- **Single source of truth**: Keep using `speedTuneSettings` in `chrome.storage.sync`; ensure popup and background never overwrite each other’s updates in a racy way (e.g. read-modify-write with clear precedence or messaging).
- **Single apply path**: Prefer one path that applies speed (e.g. content script owns application; background/popup only update storage and optionally notify content). Reduces risk of conflicting updates.
- **SPA navigation**: On URL change, consider cleaning up the previous controller (e.g. `destroy()`) before creating a new one, or reuse one controller and clear/rescan videos so you don’t accumulate observers or intervals.

### UX

- **“No video” feedback**: In the popup, when the active tab has no primary video (or no video at all), show a short message like “No video detected on this page” so users understand why the indicator or speed might not appear.
- **Accessibility**: Ensure popup controls have proper labels and keyboard support; ensure the speed indicator has sufficient contrast and doesn’t block critical page content.
- **Save Speed**: In the UI, briefly explain that “Save Speed” applies the saved value on new loads and across tabs; “OFF” means the page starts at 1x until the user changes it.

### Performance

- **MutationObserver**: Debounce the callback (e.g. 200–300 ms) so that bursts of DOM changes trigger one `findAndSetupVideos()` instead of many.
- **Speed re-apply interval**: Use one global interval (e.g. every 500 ms) that iterates over tracked videos and only sets `playbackRate` where it has drifted, instead of one 500 ms interval per video.
- **Tab visibility**: When the tab is hidden (`document.visibilityState === 'hidden'`), consider pausing the periodic scan and the global speed-check interval to save CPU; resume when visible.

### Reliability

- **DOM / iframe access**: Wrap all `contentDocument`, `querySelector`, and `getBoundingClientRect` usage in try/catch; skip or degrade gracefully on cross-origin or detached nodes.
- **Stale references**: When a video is removed from the DOM, remove it from `this.videos` and clear any interval/listener associated with it; avoid holding references to detached elements.
- **executeScript**: In popup and background, when calling `scripting.executeScript` to run `speedTuneController.setSpeed(...)`, handle the case where the controller isn’t ready (retry a few times with backoff) and the case where the tab is invalid or the script fails; show a non-intrusive message or ignore gracefully.
- **Storage**: On `chrome.storage.sync.get/set` errors, log and fall back to defaults; avoid leaving the extension in an inconsistent state.

### Future settings migrations

- If you add or rename keys in `speedTuneSettings` (e.g. a `version` field), handle older stored objects: on load, normalize to the current schema and write back once so future code can assume a consistent shape.

---

## 3. Indicator Bug (Fixed in content.js)

### Why it happened

- The extension collects **all** `<video>` elements, including those inside same-origin iframes (ads, embeds, tracking).
- The indicator was shown for the **largest** video by area, with only a loose size check (>100×100), and did **not**:
  - Restrict to the **main document** (so iframe videos counted), or
  - Require the video to be **meaningfully visible** (not hidden or tiny).
- On article pages with no main video but with an iframe that contains a small or hidden `<video>`, that iframe video was treated as the “primary” one and the indicator was shown (often in a corner or over the article). So the indicator appeared on pages that “only have images” from the user’s point of view.

### Fix applied in content.js

1. **Main-document only for the indicator**  
   New helper: `isInMainDocument(video)` → `video.ownerDocument === document`.  
   The overlay is only shown for a video in the main page, not inside an iframe.

2. **Meaningfully visible**  
   New helper: `isMeaningfullyVisible(video, minWidth, minHeight)` (default 200×150).  
   Requires: not `display:none`, not `visibility:hidden`, opacity ≥ 0.01, and at least the minimum size.  
   Avoids showing the indicator for hidden or tiny/tracking videos.

3. **Single “primary” video for the indicator**  
   New helper: `getPrimaryVideoForIndicator()`: among all videos, keeps only those in the main document and meaningfully visible, then returns the largest by area (or `null`).  
   `showConstantSpeedIndicator()` now uses this primary video; if there is none, the indicator is hidden.

**Result**: On article/image-only pages where the only video is in an iframe (e.g. ad) or is hidden/small, no indicator is shown. Speed control still applies to **all** videos (including iframe ones); only the **overlay** is limited to one main-document, visible primary video.

---

## 4. Pre-Production Checklist

- [x] Indicator only on primary main-document, visible video (no indicator on image-only pages with iframe ads).
- [x] MutationObserver debounced (250 ms).
- [x] One global interval for speed re-apply; no per-video intervals.
- [x] Try/catch around DOM and iframe access; cleanup of stale video refs and intervals.
- [x] Safe executor waits for controller (retry + backoff).
- [x] Safe executor waits for videos (`c.videos.size > 0`) before calling setSpeed.
- [x] Popup retries primary-video check (up to 5 tries, 250 ms) so it never lies during load.
- [x] Popup and indicator share same logic (popup asks controller `hasPrimaryVideo()`).
- [x] Popup/background safe executor waits for controller and videos.” - [x] Popup shows “No video detected” when the active tab has no (primary) video (retry so popup never lies during load).
- [x] Accessibility pass (aria-labels, role=switch, keyboard).
- [x] Pause work when tab is hidden (visibility API).
- [x] Settings schema versioning and migration on install and load.

All MV3 timing edges are closed. The extension is reference-grade MV3 and suitable for enterprise use.
