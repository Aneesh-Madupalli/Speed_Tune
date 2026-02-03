/**
 * Helpers for Speed Tune Puppeteer tests.
 * Match content.js: indicator uses class "speed-tune-constant-indicator".
 * Video can be in main doc or shadow DOM (e.g. YouTube).
 */

function findVideo() {
  const root = document.body;
  if (!root) return null;
  const direct = root.querySelector("video");
  if (direct) return direct;
  const walk = (node) => {
    if (node.tagName === "VIDEO") return node;
    const q = node.querySelector && node.querySelector("video");
    if (q) return q;
    if (node.shadowRoot) {
      const inShadow = node.shadowRoot.querySelector("video");
      if (inShadow) return inShadow;
      for (const child of node.shadowRoot.children) {
        const found = walk(child);
        if (found) return found;
      }
    }
    for (const child of node.children || []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

async function waitForVideo(page, timeoutMs = 45000) {
  await page.waitForFunction(
    () => {
      const root = document.body;
      if (!root) return false;
      const walk = (node) => {
        if (node.tagName === "VIDEO") return true;
        if (node.querySelector && node.querySelector("video")) return true;
        if (node.shadowRoot && node.shadowRoot.querySelector("video")) return true;
        if (node.shadowRoot) {
          for (const child of node.shadowRoot.children) if (walk(child)) return true;
        }
        for (const child of node.children || []) if (walk(child)) return true;
        return false;
      };
      return walk(root);
    },
    { timeout: timeoutMs }
  );
}

async function getPlaybackRate(page) {
  return page.evaluate(() => {
    const root = document.body;
    if (!root) return undefined;
    const walk = (node) => {
      if (node.tagName === "VIDEO") return node.playbackRate;
      const q = node.querySelector && node.querySelector("video");
      if (q) return q.playbackRate;
      if (node.shadowRoot) {
        const v = node.shadowRoot.querySelector("video");
        if (v) return v.playbackRate;
        for (const child of node.shadowRoot.children) {
          const r = walk(child);
          if (r !== undefined) return r;
        }
      }
      for (const child of node.children || []) {
        const r = walk(child);
        if (r !== undefined) return r;
      }
      return undefined;
    };
    return walk(root);
  });
}

async function hasIndicator(page) {
  return page.evaluate(
    () => !!document.querySelector(".speed-tune-constant-indicator")
  );
}

async function getControllerSpeed(page) {
  return page.evaluate(() => {
    const c = window.speedTuneController;
    return c ? c.getCurrentSpeed() : null;
  });
}

module.exports = { getPlaybackRate, hasIndicator, getControllerSpeed, waitForVideo };
