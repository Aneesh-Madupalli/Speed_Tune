/**
 * Speed Tune - Popup UI
 *
 * Handles:
 * - User interface for speed control
 * - Settings management
 * - Video status detection
 * - Storage synchronization
 *
 * Safe-executor logic is inlined here to avoid "failed to fetch script" when
 * loading a separate safeExecuteSetSpeed.js file from the popup.
 */

// ============================================================================
// SAFE EXECUTOR (inlined — no separate script fetch)
// ============================================================================

const SAFE_EXEC_MAX_RETRIES = 6;
const SAFE_EXEC_BACKOFF_MS = 250;

async function safelySetSpeed(tabId, speed, showIndicator, position) {
  for (let attempt = 0; attempt < SAFE_EXEC_MAX_RETRIES; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (s, show, pos) => {
          const c = window.speedTuneController;
          if (!c) return "not-ready";
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
    if (attempt < SAFE_EXEC_MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, SAFE_EXEC_BACKOFF_MS * (attempt + 1)));
    }
  }
  return false;
}

// Expose for popup use (same name as before)
window.safelySetSpeed = safelySetSpeed;

// ============================================================================
// SPEED TUNE POPUP CLASS
// ============================================================================

class SpeedTunePopup {
  constructor() {
    // State
    this.speed = 1.0;
    this.saveSpeed = false;
    this.showIndicator = true;
    this.indicatorPosition = "top-left";
    this.hasVideo = false;

    // Initialize
    this.initElements();
    this.loadSettings();
    this.checkVideoStatus();
    this.bindEvents();
    this.setupStorageListener();
    this.updateUI();
  }

  // ========================================================================
  // INITIALIZATION
  // ========================================================================

  /**
   * Initialize DOM element references
   */
  initElements() {
    this.elements = {
      statusDot: document.getElementById("statusDot"),
      statusText: document.getElementById("statusText"),
      statusHint: document.getElementById("statusHint"),
      speedValue: document.getElementById("speedValue"),
      speedSlider: document.getElementById("speedSlider"),
      speedInput: document.getElementById("speedInput"),
      inputArrowUp: document.getElementById("inputArrowUp"),
      inputArrowDown: document.getElementById("inputArrowDown"),
      minusBtn: document.getElementById("minusBtn"),
      plusBtn: document.getElementById("plusBtn"),
      resetBtn: document.getElementById("resetBtn"),
      saveSpeedToggle: document.getElementById("saveSpeedToggle"),
      indicatorToggle: document.getElementById("indicatorToggle"),
      positionGrid: document.getElementById("positionGrid"),
      positionSetting: document.getElementById("positionSetting"),
    };
  }

  /**
   * Normalize settings to current schema (migration).
   */
  migrateSettings(raw) {
    const defaults = { speed: 1.0, saveSpeed: false, showIndicator: true, indicatorPosition: "top-left" };
    if (!raw || typeof raw !== "object") return defaults;
    return {
      speed: Math.max(0.1, Math.min(16, Number(raw.speed) || 1.0)),
      saveSpeed: !!raw.saveSpeed,
      showIndicator: raw.showIndicator !== false,
      indicatorPosition: ["top-left", "top-right", "bottom-left", "bottom-right", "center"].includes(raw.indicatorPosition)
        ? raw.indicatorPosition
        : "top-left",
    };
  }

  /**
   * Load settings from storage (with migration fallback on error).
   */
  loadSettings() {
    chrome.storage.sync.get(["speedTuneSettings"], (result) => {
      if (chrome.runtime.lastError) {
        this.speed = 1.0;
        this.saveSpeed = false;
        this.showIndicator = true;
        this.indicatorPosition = "top-left";
        this.updateUI();
        return;
      }

      const settings = this.migrateSettings(result.speedTuneSettings);
      this.speed = settings.speed;
      this.saveSpeed = settings.saveSpeed;
      this.showIndicator = settings.showIndicator;
      this.indicatorPosition = settings.indicatorPosition;
      this.updateUI();
    });
  }

  /**
   * Ask content script for primary video with retry (controller may not be injected yet).
   * Returns true if primary video exists, false otherwise or after max retries.
   */
  async checkPrimaryVideo(tabId) {
    const MAX_TRIES = 5;
    const RETRY_MS = 250;

    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const c = window.speedTuneController;
            if (!c) return "not-ready";
            return c.hasPrimaryVideo() ? "yes" : "no";
          },
        });

        const result = results && results[0] && results[0].result;
        if (result === "yes") return true;
        if (result === "no") return false;
      } catch (err) {
        // Tab restricted / navigating / script not ready
      }

      if (i < MAX_TRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }

    return false;
  }

  /**
   * Check if current page has a primary video (same logic as indicator — single source of truth).
   * Retries so popup never lies during load.
   */
  checkVideoStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs[0]) {
        this.hasVideo = false;
        this.updateVideoStatus();
        return;
      }

      this.hasVideo = await this.checkPrimaryVideo(tabs[0].id);
      this.updateVideoStatus();
    });
  }

  /**
   * Update video status display (enterprise: clear no-video messaging).
   */
  updateVideoStatus() {
    if (this.hasVideo) {
      this.elements.statusDot.classList.add("active");
      this.elements.statusDot.classList.remove("inactive");
      this.elements.statusText.textContent = "Video detected";
      if (this.elements.statusHint) this.elements.statusHint.textContent = "";
    } else {
      this.elements.statusDot.classList.remove("active");
      this.elements.statusDot.classList.add("inactive");
      this.elements.statusText.textContent = "No video on this page";
      if (this.elements.statusHint) {
        this.elements.statusHint.textContent = "Open a page with a visible video to control speed.";
      }
    }
  }

  // ========================================================================
  // EVENT HANDLING
  // ========================================================================

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Slider
    this.elements.speedSlider.addEventListener("input", (e) => {
      this.handleSpeedChange(parseFloat(e.target.value));
    });

    // Initialize numeric input buffer for custom number entry (e.g., "65" -> 6.5, "6" -> 6.0)
    this.numericInputBuffer = "";

    // Number input: when focused, select all so user can easily overwrite
    this.elements.speedInput.addEventListener("focus", (e) => {
      this.numericInputBuffer = "";
      // Select existing text so the first digit replaces it
      setTimeout(() => {
        try {
          e.target.select();
        } catch (err) {
          // ignore selection issues
        }
      }, 0);
    });

    // Number input: track raw text as the user types (do not change speed on every keystroke)
    this.elements.speedInput.addEventListener("input", (e) => {
      this.numericInputBuffer = e.target.value;
    });

    // Number input: on blur, interpret digits so that "65" => 6.5, "6" => 6.0, etc.
    this.elements.speedInput.addEventListener("blur", () => {
      this.applyNumericInputBuffer();
    });

    // Number input: Enter commits the value and blurs the field
    this.elements.speedInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.applyNumericInputBuffer();
        this.elements.speedInput.blur();
      }
    });

    // Input arrow buttons - increase/decrease by 0.1x
    this.elements.inputArrowUp.addEventListener("click", () => {
      this.adjustSpeed(0.1);
    });

    this.elements.inputArrowDown.addEventListener("click", () => {
      this.adjustSpeed(-0.1);
    });

    // Buttons
    this.elements.minusBtn.addEventListener("click", () => {
      this.adjustSpeed(-0.5);
    });

    this.elements.plusBtn.addEventListener("click", () => {
      this.adjustSpeed(0.5);
    });

    this.elements.resetBtn.addEventListener("click", () => {
      this.handleSpeedChange(1.0);
    });

    // Toggles (click and keyboard for role="switch")
    const toggleOnKey = (el, toggleFn) => (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleFn();
      }
    };
    this.elements.saveSpeedToggle.addEventListener("click", () => this.toggleSaveSpeed());
    this.elements.saveSpeedToggle.addEventListener("keydown", toggleOnKey(this.elements.saveSpeedToggle, () => this.toggleSaveSpeed()));
    this.elements.indicatorToggle.addEventListener("click", () => this.toggleIndicator());
    this.elements.indicatorToggle.addEventListener("keydown", toggleOnKey(this.elements.indicatorToggle, () => this.toggleIndicator()));

    // Position grid
    this.elements.positionGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".position-btn");
      if (btn) {
        const position = btn.dataset.position;
        this.handlePositionChange(position);
      }
    });

    // Button animations
    [this.elements.minusBtn, this.elements.plusBtn, this.elements.resetBtn].forEach(
      (btn) => {
        btn.addEventListener("mousedown", () => {
          btn.style.transform = "scale(0.95)";
        });
        btn.addEventListener("mouseup", () => {
          btn.style.transform = "";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.transform = "";
        });
      }
    );

    // Position button animations
    this.elements.positionGrid.addEventListener("mousedown", (e) => {
      const btn = e.target.closest(".position-btn");
      if (btn) btn.style.transform = "scale(0.95)";
    });

    this.elements.positionGrid.addEventListener("mouseup", (e) => {
      const btn = e.target.closest(".position-btn");
      if (btn) btn.style.transform = "";
    });

    this.elements.positionGrid.addEventListener("mouseleave", (e) => {
      const btn = e.target.closest(".position-btn");
      if (btn) btn.style.transform = "";
    });
  }

  /**
   * Apply the current numeric input buffer to the speed value.
   *
   * Supports two styles of input:
   * 1) Normal decimal input (with "." or ","), e.g.:
   *    - "1.25"  => 1.25
   *    - "0.75"  => 0.75
   *    - "10"    => 10.0
   *
   * 2) Shorthand digit-only input (no dot), e.g.:
   *    - "6"     => 6.0
   *    - "65"    => 6.5
   *    - "125"   => 12.5
   *
   * The final value is clamped into the valid range before being applied.
   */
  applyNumericInputBuffer() {
    const inputElement = this.elements.speedInput;

    // Prefer the tracked buffer, but fall back to the live input value
    const raw =
      (typeof this.numericInputBuffer === "string"
        ? this.numericInputBuffer
        : inputElement.value) || "";

    const trimmed = raw.trim();

    // If empty, reset the input display to the current speed
    if (!trimmed) {
      this.updateAllSpeedInputs();
      return;
    }

    let interpretedSpeed = null;

    // Case 1: decimal-style input (contains "." or ",") -> parse as float
    if (/[.,]/.test(trimmed)) {
      const normalized = trimmed.replace(",", ".");
      const floatVal = parseFloat(normalized);
      if (!Number.isNaN(floatVal)) {
        interpretedSpeed = floatVal;
      }
    } else {
      // Case 2: pure digit shorthand input ("6", "65", "125", etc.)
      const digitsOnly = trimmed.replace(/\D/g, "");

      if (!digitsOnly) {
        this.updateAllSpeedInputs();
        return;
      }

      const intValue = parseInt(digitsOnly, 10);
      if (Number.isNaN(intValue)) {
        this.updateAllSpeedInputs();
        return;
      }

      if (digitsOnly.length === 1) {
        // Single digit: treat as whole number (e.g., "6" -> 6.0)
        interpretedSpeed = intValue;
      } else {
        // Two or more digits: treat as tenths (e.g., "65" -> 6.5, "125" -> 12.5)
        interpretedSpeed = intValue / 10;
      }
    }

    // If we still couldn't interpret a valid number, reset UI and exit
    if (interpretedSpeed === null || Number.isNaN(interpretedSpeed)) {
      this.updateAllSpeedInputs();
      return;
    }

    // Apply speed using existing handler (handles clamping and UI sync)
    this.handleSpeedChange(interpretedSpeed);

    // Keep buffer in sync with the applied (normalized) speed
    this.numericInputBuffer = this.speed.toFixed(1);
  }

  // ========================================================================
  // SPEED CONTROL
  // ========================================================================

  /**
   * Handle speed change
   */
  handleSpeedChange(newSpeed) {
    const roundedSpeed = Math.round(parseFloat(newSpeed) * 100) / 100;
    this.speed = Math.max(0.1, Math.min(16, roundedSpeed));

    this.updateAllSpeedInputs();
    this.applySpeed();

    if (this.saveSpeed) {
      this.saveSettings();
    }
  }

  /**
   * Adjust speed by delta
   */
  adjustSpeed(delta) {
    this.handleSpeedChange(this.speed + delta);
  }

  /**
   * Update all speed input UI elements
   */
  updateAllSpeedInputs() {
    this.elements.speedValue.textContent = `${this.speed.toFixed(1)}x`;
    this.elements.speedSlider.value = this.speed;
    this.elements.speedSlider.setAttribute("aria-valuenow", String(this.speed));
    this.elements.speedInput.value = this.speed.toFixed(1);

    // Update slider visual progress
    const progress = ((this.speed - 0.1) / (16 - 0.1)) * 100;
    this.elements.speedSlider.style.background = `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${progress}%, #e5e7eb ${progress}%, #e5e7eb 100%)`;
  }

  /**
   * Apply speed via shared safe executor (never assumes controller exists).
   */
  applySpeed() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs[0]) return;
      const tabId = tabs[0].id;
      const speed = this.speed;
      const showIndicator = this.showIndicator;
      const position = this.indicatorPosition;
      if (typeof window.safelySetSpeed === "function") {
        window.safelySetSpeed(tabId, speed, showIndicator, position);
      }
    });
  }

  // ========================================================================
  // SETTINGS MANAGEMENT
  // ========================================================================

  /**
   * Toggle Save Speed setting
   */
  toggleSaveSpeed() {
    this.saveSpeed = !this.saveSpeed;
    
    // If Save Speed is turned OFF, reset speed to 1.0x
    if (!this.saveSpeed) {
      this.speed = 1.0;
      this.updateAllSpeedInputs();
      // Apply 1.0x speed to the content script
      this.applySpeed();
    }
    
    this.updateUI();
    this.saveSettings();
  }

  /**
   * Toggle Speed Indicator setting
   */
  toggleIndicator() {
    this.showIndicator = !this.showIndicator;
    this.updateUI();
    this.saveSettings();
    this.applySpeed();
  }

  /**
   * Handle position change
   */
  handlePositionChange(position) {
    this.indicatorPosition = position;
    this.updateUI();
    this.saveSettings();
    this.applySpeed();
  }

  /**
   * Update position grid UI
   */
  updatePositionGrid() {
    const positionBtns = this.elements.positionGrid.querySelectorAll(".position-btn");
    positionBtns.forEach((btn) => {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    });
    const activeBtn = this.elements.positionGrid.querySelector(
      `[data-position="${this.indicatorPosition}"]`
    );
    if (activeBtn) {
      activeBtn.classList.add("active");
      activeBtn.setAttribute("aria-pressed", "true");
    }
  }

  /**
   * Update all UI elements
   */
  updateUI() {
    this.updateAllSpeedInputs();

    // Update toggles and aria
    this.elements.saveSpeedToggle.classList.toggle("active", this.saveSpeed);
    this.elements.saveSpeedToggle.setAttribute("aria-checked", String(this.saveSpeed));
    this.elements.indicatorToggle.classList.toggle("active", this.showIndicator);
    this.elements.indicatorToggle.setAttribute("aria-checked", String(this.showIndicator));

    // Update position grid
    this.updatePositionGrid();

    // Show/hide position setting based on Speed Indicator toggle
    this.elements.positionSetting.style.display = this.showIndicator ? "flex" : "none";
  }

  /**
   * Save settings to storage
   */
  saveSettings() {
    const settings = {
      speed: this.speed,
      saveSpeed: this.saveSpeed,
      showIndicator: this.showIndicator,
      indicatorPosition: this.indicatorPosition,
      version: "1.0.0",
    };

    chrome.storage.sync.set({ speedTuneSettings: settings }, () => {
      if (chrome.runtime.lastError) {
        console.error("[SpeedTune Popup] Error saving settings:", chrome.runtime.lastError);
      }
    });
  }

  /**
   * Setup storage change listener (for keyboard shortcuts)
   */
  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "sync" && changes.speedTuneSettings) {
        const newSettings = changes.speedTuneSettings.newValue;
        const oldSettings = changes.speedTuneSettings.oldValue;

        if (newSettings) {
          const speedChanged = !oldSettings || oldSettings.speed !== newSettings.speed;

          // Update local state
          this.speed = newSettings.speed || 1.0;
          this.saveSpeed = newSettings.saveSpeed || false;
          this.showIndicator = newSettings.showIndicator !== false;
          this.indicatorPosition = newSettings.indicatorPosition || "top-left";

          // Update UI
          this.updateUI();

          // Apply speed if changed from keyboard shortcut
          if (speedChanged) {
            this.applySpeed();
          }
        }
      }
    });
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Initialize popup
  new SpeedTunePopup();

  // Add smooth hover effects
  const interactiveElements = document.querySelectorAll(
    'button, input[type="range"], .toggle, select'
  );
  interactiveElements.forEach((element) => {
    element.addEventListener("mouseenter", () => {
      element.style.transition = "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)";
    });
  });

  // Add ripple effect to buttons
  const buttons = document.querySelectorAll("button");
  buttons.forEach((button) => {
    button.addEventListener("click", function (e) {
      const ripple = document.createElement("span");
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        transform: scale(0);
        animation: ripple 0.6s ease-out;
        pointer-events: none;
      `;

      this.style.position = "relative";
      this.style.overflow = "hidden";
      this.appendChild(ripple);

      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });

  // Add CSS for ripple animation
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ripple {
      to {
        transform: scale(2);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
});
