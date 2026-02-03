/**
 * Speed Tune - Background Service Worker (Enterprise)
 *
 * Handles: lifecycle, commands, auto-apply on load, storage.
 * Production: settings migration, safe executor (retry/backoff), error handling.
 */

importScripts("safeExecuteSetSpeed.js");

// ============================================================================
// CONSTANTS
// ============================================================================

const SPEED_MIN = 0.1;
const SPEED_MAX = 16;
const SPEED_INCREMENT_SMALL = 0.1;
const SPEED_INCREMENT_LARGE = 1.0;
const PAGE_LOAD_DELAY = 2000;
const SETTINGS_VERSION = "1.0.0";
const DEBUG_MODE = false;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function roundSpeed(speed) {
  return Math.round(speed * 100) / 100;
}

function debugLog(...args) {
  if (DEBUG_MODE) console.log("[SpeedTune Background]", ...args);
}

/**
 * Default settings schema (single source of truth).
 */
function getDefaultSettings() {
  return {
    speed: 1.0,
    saveSpeed: false,
    showIndicator: true,
    indicatorPosition: "top-left",
    version: SETTINGS_VERSION,
  };
}

/**
 * Migrate/normalize stored settings to current schema; write back if changed.
 */
function migrateSettings(raw, callback) {
  const defaults = getDefaultSettings();
  if (!raw || typeof raw !== "object") {
    if (callback) callback(defaults);
    return defaults;
  }
  const migrated = {
    speed: typeof raw.speed === "number" ? Math.max(SPEED_MIN, Math.min(SPEED_MAX, raw.speed)) : defaults.speed,
    saveSpeed: typeof raw.saveSpeed === "boolean" ? raw.saveSpeed : defaults.saveSpeed,
    showIndicator: raw.showIndicator !== false,
    indicatorPosition: ["top-left", "top-right", "bottom-left", "bottom-right", "center"].includes(raw.indicatorPosition)
      ? raw.indicatorPosition
      : defaults.indicatorPosition,
    version: SETTINGS_VERSION,
  };
  if (callback) callback(migrated);
  return migrated;
}

// ============================================================================
// EXTENSION LIFECYCLE
// ============================================================================

/**
 * Initialize extension on install/reload; ensure settings schema exists and is migrated.
 */
chrome.runtime.onInstalled.addListener(() => {
  debugLog("Extension installed/reloaded");

  chrome.storage.sync.get(["speedTuneSettings"], (result) => {
    if (chrome.runtime.lastError) {
      const def = getDefaultSettings();
      chrome.storage.sync.set({ speedTuneSettings: def });
      return;
    }

    const raw = result.speedTuneSettings;
    if (!raw) {
      chrome.storage.sync.set({ speedTuneSettings: getDefaultSettings() }, () => {
        if (!chrome.runtime.lastError) debugLog("Default settings initialized");
      });
      return;
    }

    migrateSettings(raw, (migrated) => {
      chrome.storage.sync.set({ speedTuneSettings: migrated }, () => {
        if (!chrome.runtime.lastError) debugLog("Settings migrated if needed");
      });
    });
  });
});

// ============================================================================
// KEYBOARD SHORTCUT HANDLING
// ============================================================================

/**
 * Handle keyboard command shortcuts
 */
chrome.commands.onCommand.addListener((command) => {
  debugLog("Keyboard shortcut detected:", command);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.error("[SpeedTune] Error querying tabs:", chrome.runtime.lastError);
      return;
    }

    if (tabs && tabs[0]) {
      const url = tabs[0].url;

      // Block internal Chrome/Edge pages (content scripts don't run there)
      if (url && (url.startsWith("chrome://") || url.startsWith("edge://"))) {
        debugLog("Keyboard shortcut ignored on restricted page:", url);
        return;
      }

      executeSpeedCommand(tabs[0].id, command);
    }
  });
});

/**
 * Apply speed in tab via shared safe executor (never assumes controller exists).
 */
function applySpeedInTab(tabId, speed, showIndicator, position) {
  if (typeof safelySetSpeed === "function") {
    safelySetSpeed(tabId, speed, showIndicator, position);
  }
}

/**
 * Execute speed command from keyboard shortcut
 */
function executeSpeedCommand(tabId, command) {
  chrome.storage.sync.get(["speedTuneSettings"], (result) => {
    if (chrome.runtime.lastError) return;

    const raw = result.speedTuneSettings;
    const settings = migrateSettings(raw);
    let currentSpeed = settings.speed;
    let newSpeed = currentSpeed;

    switch (command) {
      case "increase-speed-small":
        newSpeed = Math.min(SPEED_MAX, roundSpeed(currentSpeed + SPEED_INCREMENT_SMALL));
        break;
      case "decrease-speed-small":
        newSpeed = Math.max(SPEED_MIN, roundSpeed(currentSpeed - SPEED_INCREMENT_SMALL));
        break;
      case "increase-speed-large":
        newSpeed = Math.min(SPEED_MAX, roundSpeed(currentSpeed + SPEED_INCREMENT_LARGE));
        break;
      case "reset-speed":
        newSpeed = 1.0;
        break;
      default:
        console.warn("[SpeedTune] Unknown command:", command);
        return;
    }

    const updatedSettings = { ...settings, speed: newSpeed };

    chrome.storage.sync.set({ speedTuneSettings: updatedSettings }, () => {
      if (chrome.runtime.lastError) return;
      applySpeedInTab(tabId, newSpeed, settings.showIndicator !== false, settings.indicatorPosition || "top-left");
    });
  });
}

// ============================================================================
// PAGE LOAD HANDLING
// ============================================================================

/**
 * Auto-apply saved speed when pages load
 * Only applies if Save Speed toggle is ON
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status !== "complete" ||
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("edge://")
  ) {
    return;
  }

  chrome.storage.sync.get(["speedTuneSettings"], (result) => {
    if (chrome.runtime.lastError) return;

    const raw = result.speedTuneSettings;
    const settings = raw ? migrateSettings(raw) : getDefaultSettings();

    if (!settings.saveSpeed || !settings.speed || settings.speed === 1.0) return;

    setTimeout(() => {
      applySpeedInTab(
        tabId,
        settings.speed,
        settings.showIndicator !== false,
        settings.indicatorPosition || "top-left"
      );
    }, PAGE_LOAD_DELAY);
  });
});
