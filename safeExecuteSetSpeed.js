/**
 * Speed Tune — Safe executor for setSpeed (MV3 production)
 *
 * Single shared helper for popup and background. Never assumes the content
 * script or controller exists. Probes, retries, and backs off so speed
 * eventually applies instead of failing silently.
 *
 * Use: safelySetSpeed(tabId, speed, showIndicator, position)
 * Returns: Promise<boolean> — true if applied, false after all retries.
 */

(function () {
  "use strict";

  const MAX_RETRIES = 6;
  const BACKOFF_MS = 250;

  async function safelySetSpeed(tabId, speed, showIndicator, position) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (s, show, pos) => {
            const c = window.speedTuneController;
            if (!c) return "not-ready";

            // Wait for videos to be detected (SPA / heavy DOM / delayed mount)
            if (!c.videos || c.videos.size === 0) return "not-ready";

            c.setSpeed(s, show, pos);
            return "ok";
          },
          args: [speed, showIndicator, position],
        });

        const result = results && results[0] && results[0].result;
        if (result === "ok") return true;
      } catch (err) {
        // Tab not ready / restricted / navigating / discarded
      }

      // Exponential backoff before next attempt
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS * (attempt + 1)));
      }
    }

    return false;
  }

  const global = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this;
  global.safelySetSpeed = safelySetSpeed;
})();
