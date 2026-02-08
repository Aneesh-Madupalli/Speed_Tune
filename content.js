/**
 * Speed Tune - Content Script (Enterprise)
 *
 * Handles: video detection, speed control, indicator, keyboard fallback,
 * settings. Production-ready: debounced observer, global speed interval,
 * visibility-aware, stale ref cleanup, defensive DOM access.
 */

(function () {
  "use strict";

  const DEBOUNCE_MS = 250;
  const GLOBAL_SPEED_CHECK_MS = 500;
  const SCAN_INTERVAL_MS = 2000;

  // ============================================================================
  // SPEED TUNE CONTROLLER CLASS
  // ============================================================================

  class SpeedTuneController {
    constructor() {
      this.currentSpeed = 1.0;
      this.videos = new Set();
      this.observer = null;

      this.constantIndicator = null;
      this.constantIndicatorUpdateHandlers = [];
      /** Single source of truth: the one video eligible for speed indicator (main player only). */
      this.indicatorPrimaryVideo = null;
      this.indicatorRecomputeIntervalId = null;
      this.lastIndicatorHideTime = 0;

      this.popupToast = null;
      this.popupToastTimeout = null;

      this.showConstantIndicator = true;
      this.indicatorPosition = "top-left";
      this.saveSpeedEnabled = false;

      this.debounceTimer = null;
      this.speedCheckIntervalId = null;
      this.scanIntervalId = null;
      this.videoListeners = new Map();
      this.urlChangeObserver = null;
      this.lastUrl = "";

      this.init();
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Initialize the controller
     */
    init() {
      this.setupMutationObserver();
      this.findAndSetupVideos();
      this.loadSavedSettings();

      window.speedTuneController = this;

      const retryIntervals = [500, 1000, 2000, 3000, 5000];
      retryIntervals.forEach((delay) => {
        setTimeout(() => this.scheduleFindVideos(), delay);
      });

      this.lastUrl = location.href;
      this.setupUrlChangeObserver();
      this.setupVisibilityListener();
      this.startGlobalSpeedCheck();
      this.startPeriodicScan();
      this.setupKeyboardShortcuts();
      this.setupPlayIntentListener();
    }

    /**
     * Bind to playback events: user intent is the strongest signal for main video.
     * Grid/preview videos rarely receive real "play" events.
     */
    setupPlayIntentListener() {
      document.addEventListener(
        "play",
        (e) => {
          const v = e.target;
          if (!(v instanceof HTMLVideoElement)) return;
          if (!this.isLikelyMainPlayer(v)) return;
          this.switchActiveVideo(v);
        },
        true
      );
    }

    // ========================================================================
    // KEYBOARD SHORTCUTS (FALLBACK)
    // ========================================================================

    /**
     * Setup keyboard shortcut listeners as fallback
     * Handles: Ctrl+., Ctrl+,, Ctrl+Shift+., Ctrl+Shift+,
     */
    setupKeyboardShortcuts() {
      const controller = this;

      document.addEventListener(
        "keydown",
        (e) => {
          try {
            // Validate event object
            if (!e || typeof e.preventDefault !== "function") {
              return;
            }

            // Only listen when Ctrl is pressed (and not in input fields)
            if (e.ctrlKey && !e.altKey && !e.metaKey) {
              const target = e.target;
              const isInput =
                target &&
                (target.tagName === "INPUT" ||
                  target.tagName === "TEXTAREA" ||
                  target.isContentEditable);

              if (isInput) return; // Don't interfere with typing

              const handleShortcut = (newSpeed) => {
                try {
                  if (e && typeof e.preventDefault === "function") {
                    e.preventDefault();
                  }
                  if (e && typeof e.stopPropagation === "function") {
                    e.stopPropagation();
                  }

                  controller.setSpeed(
                    newSpeed,
                    controller.showConstantIndicator,
                    controller.indicatorPosition
                  );

                  // Update storage
                  chrome.storage.sync.get(["speedTuneSettings"], (result) => {
                    if (chrome.runtime.lastError) {
                      console.error("[SpeedTune] Storage error:", chrome.runtime.lastError);
                      return;
                    }
                    const settings = result.speedTuneSettings || {};
                    chrome.storage.sync.set({
                      speedTuneSettings: { ...settings, speed: newSpeed },
                    });
                  });
                } catch (error) {
                  console.error("[SpeedTune] Error handling keyboard shortcut:", error);
                }
              };

              // IMPORTANT: Check Shift combinations FIRST (before non-Shift)

              // Ctrl + Shift + . (Period) - Increase speed by 1.0x
              if (e.shiftKey && (e.key === "." || e.code === "Period")) {
                const newSpeed = Math.min(
                  16,
                  Math.round((controller.currentSpeed + 1.0) * 100) / 100
                );
                handleShortcut(newSpeed);
                return;
              }

              // Ctrl + Shift + , (Comma) - Reset to 1.0x
              if (e.shiftKey && (e.key === "," || e.code === "Comma")) {
                handleShortcut(1.0);
                return;
              }

              // Ctrl + . (Period) - Increase speed by 0.1x
              if (!e.shiftKey && (e.key === "." || e.code === "Period")) {
                const newSpeed = Math.min(
                  16,
                  Math.round((controller.currentSpeed + 0.1) * 100) / 100
                );
                handleShortcut(newSpeed);
                return;
              }

              // Ctrl + , (Comma) - Decrease speed by 0.1x
              if (!e.shiftKey && (e.key === "," || e.code === "Comma")) {
                const newSpeed = Math.max(
                  0.1,
                  Math.round((controller.currentSpeed - 0.1) * 100) / 100
                );
                handleShortcut(newSpeed);
                return;
              }
            }
          } catch (error) {
            console.error("[SpeedTune] Error in keyboard shortcut handler:", error);
          }
        },
        true
      ); // Use capture phase
    }

    // ========================================================================
    // SETTINGS MANAGEMENT
    // ========================================================================

    /**
     * Load saved settings from storage
     */
    loadSavedSettings() {
      chrome.storage.sync.get(["speedTuneSettings"], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[SpeedTune] Error loading settings:", chrome.runtime.lastError);
          // Use defaults on error
          const videos = this.getAllVideos();
          if (videos.length > 0) {
            this.setSpeed(1.0, this.showConstantIndicator, this.indicatorPosition);
          } else {
            this.currentSpeed = 1.0;
            this.hideConstantIndicator();
            this.hidePopupToast();
          }
          return;
        }

        if (result.speedTuneSettings) {
          const settings = result.speedTuneSettings;
          this.showConstantIndicator = settings.showIndicator !== false;
          this.indicatorPosition = settings.indicatorPosition || "top-left";
          this.saveSpeedEnabled = settings.saveSpeed || false;

          // Apply saved speed if Save Speed toggle is ON
          if (settings.saveSpeed && settings.speed) {
            const videos = this.getAllVideos();
            if (videos.length > 0) {
              this.setSpeed(settings.speed, this.showConstantIndicator, this.indicatorPosition);
            } else {
              // No videos yet - just set the speed value
              this.currentSpeed = settings.speed;
              this.hideConstantIndicator();
              this.hidePopupToast();
            }
          } else {
            // Save Speed is OFF - use default 1x speed
            const videos = this.getAllVideos();
            if (videos.length > 0) {
            this.setSpeed(1.0, this.showConstantIndicator, this.indicatorPosition);
          } else {
            this.currentSpeed = 1.0;
            this.hideConstantIndicator();
            this.hidePopupToast();
            }
          }
        } else {
          // No settings found - use defaults
          const videos = this.getAllVideos();
          if (videos.length > 0) {
            this.setSpeed(1.0, this.showConstantIndicator, this.indicatorPosition);
          } else {
            this.currentSpeed = 1.0;
            this.hideConstantIndicator();
            this.hidePopupToast();
          }
        }
      });
    }

    // ========================================================================
    // VIDEO DETECTION
    // ========================================================================

    /**
     * Schedule findAndSetupVideos with debounce (single run per burst).
     */
    scheduleFindVideos() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.findAndSetupVideos();
      }, DEBOUNCE_MS);
    }

    /**
     * Setup MutationObserver with debounce to detect dynamically added videos.
     */
    setupMutationObserver() {
      try {
        this.observer = new MutationObserver((mutations) => {
          let shouldCheck = false;
          for (const mutation of mutations) {
            if (mutation.type !== "childList") continue;
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              try {
                if (
                  node.tagName === "VIDEO" ||
                  (node.querySelector && node.querySelector("video")) ||
                  node.tagName === "IFRAME" ||
                  (node.classList &&
                    (node.classList.contains("video") || node.classList.contains("player")))
                ) {
                  shouldCheck = true;
                  break;
                }
              } catch (e) {
                // Ignore access errors on detached/cross-origin nodes
              }
            }
            if (shouldCheck) break;
          }
          if (shouldCheck) this.scheduleFindVideos();
        });

        const body = document.body;
        if (body) {
          this.observer.observe(body, { childList: true, subtree: true });
        }
      } catch (e) {
        console.warn("[SpeedTune] MutationObserver setup failed:", e);
      }
    }

    /**
     * SPA: observe URL changes and rescan when route changes.
     */
    setupUrlChangeObserver() {
      try {
        this.urlChangeObserver = new MutationObserver(() => {
          const url = location.href;
          if (url !== this.lastUrl) {
            this.lastUrl = url;
            setTimeout(() => this.findAndSetupVideos(), 1000);
          }
        });
        this.urlChangeObserver.observe(document, { subtree: true, childList: true });
      } catch (e) {
        console.warn("[SpeedTune] URL observer setup failed:", e);
      }
    }

    /**
     * When tab is hidden, pause intervals; when visible, resume.
     */
    setupVisibilityListener() {
      try {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") {
            this.stopPeriodicScan();
            this.stopGlobalSpeedCheck();
          } else {
            this.startPeriodicScan();
            this.startGlobalSpeedCheck();
            this.scheduleFindVideos();
          }
        });
      } catch (e) {
        console.warn("[SpeedTune] Visibility listener failed:", e);
      }
    }

    startPeriodicScan() {
      this.stopPeriodicScan();
      this.scanIntervalId = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        this.findAndSetupVideos();
      }, SCAN_INTERVAL_MS);
    }

    stopPeriodicScan() {
      if (this.scanIntervalId) {
        clearInterval(this.scanIntervalId);
        this.scanIntervalId = null;
      }
    }

    /**
     * Single global interval: re-apply speed only on the active (main) video when it drifts.
     */
    startGlobalSpeedCheck() {
      this.stopGlobalSpeedCheck();
      this.speedCheckIntervalId = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        try {
          const active = this.indicatorPrimaryVideo || this.selectPrimaryVideo();
          if (!active || !document.contains(active) || this.isLiveVideo(active)) return;
          const targetSpeed = this.currentSpeed;
          if (Math.abs((active.playbackRate || 1) - targetSpeed) > 0.01) {
            active.playbackRate = targetSpeed;
          }
        } catch (e) {
          // Ignore
        }
      }, GLOBAL_SPEED_CHECK_MS);
    }

    stopGlobalSpeedCheck() {
      if (this.speedCheckIntervalId) {
        clearInterval(this.speedCheckIntervalId);
        this.speedCheckIntervalId = null;
      }
    }

    /**
     * Remove listeners for a video and delete from tracking (stale ref cleanup).
     */
    removeVideoListeners(video) {
      const entry = this.videoListeners.get(video);
      if (!entry) return;
      try {
        if (entry.applySpeed) {
          video.removeEventListener("loadstart", entry.applySpeed);
          video.removeEventListener("canplay", entry.applySpeed);
          video.removeEventListener("loadedmetadata", entry.applySpeed);
          video.removeEventListener("playing", entry.applySpeed);
        }
        if (entry.onRateChange) video.removeEventListener("ratechange", entry.onRateChange);
        if (entry.onDurationChange) video.removeEventListener("durationchange", entry.onDurationChange);
      } catch (e) {
        // Video may be detached
      }
      this.videoListeners.delete(video);
      this.videos.delete(video);
    }

    /**
     * Find and setup all videos; prune stale refs; use event listeners only (global interval handles re-apply).
     */
    findAndSetupVideos() {
      try {
        const allVideos = this.getAllVideos();

        // Prune: remove videos no longer in the document
        for (const video of Array.from(this.videos)) {
          try {
            if (!document.contains(video)) this.removeVideoListeners(video);
          } catch (e) {
            this.removeVideoListeners(video);
          }
        }

        const primary = this.selectPrimaryVideo();
        for (const video of allVideos) {
          try {
            if (!document.contains(video)) continue;
          } catch (e) {
            continue;
          }

          if (!this.videos.has(video)) {
            this.videos.add(video);

            if (!this.isLiveVideo(video) && video === primary) {
              try {
                video.playbackRate = this.currentSpeed;
              } catch (error) {
                console.warn("[SpeedTune] Error setting playback rate:", error);
              }
            }

            const applySpeed = () => {
              try {
                if (this.isLiveVideo(video)) return;
                const active = this.indicatorPrimaryVideo || this.selectPrimaryVideo();
                if (video !== active || !video || !document.contains(video)) return;
                if (!video.paused) video.playbackRate = this.currentSpeed;
              } catch (err) {
                // Ignore
              }
            };

            const onRateChange = () => {
              try {
                if (this.isLiveVideo(video)) return;
                const active = this.indicatorPrimaryVideo || this.selectPrimaryVideo();
                if (video !== active) return;
                if (video && Math.abs((video.playbackRate || 1) - this.currentSpeed) > 0.01) {
                  setTimeout(() => {
                    try {
                      if (video && document.contains(video) && !video.paused) {
                        video.playbackRate = this.currentSpeed;
                      }
                    } catch (err) {}
                  }, 100);
                }
              } catch (err) {}
            };

            const onDurationChange = () => {
              try {
                if (video && video.duration === Infinity) {
                  this.updateIndicators(false);
                }
              } catch (err) {}
            };

            video.addEventListener("loadstart", applySpeed);
            video.addEventListener("canplay", applySpeed);
            video.addEventListener("loadedmetadata", applySpeed);
            video.addEventListener("playing", applySpeed);
            video.addEventListener("ratechange", onRateChange);
            video.addEventListener("durationchange", onDurationChange);

            this.videoListeners.set(video, { applySpeed, onRateChange, onDurationChange });
          } else {
            if (!this.isLiveVideo(video) && video === primary) {
              try {
                if (document.contains(video) && Math.abs((video.playbackRate || 1) - this.currentSpeed) > 0.01) {
                  video.playbackRate = this.currentSpeed;
                }
              } catch (e) {}
            }
          }
        }

        if (allVideos.length > 0) {
          this.updateIndicators(false);
        } else {
          this.hideConstantIndicator();
          this.hidePopupToast();
        }
      } catch (e) {
        console.warn("[SpeedTune] findAndSetupVideos error:", e);
      }
    }

    /**
     * Get all video elements on the page (defensive: try/catch per source).
     * Includes: standard videos, shadow DOM, iframes, generic selectors.
     */
    getAllVideos() {
      const videos = [];

      try {
        const list = document.querySelectorAll("video");
        if (list && list.length) videos.push(...list);
      } catch (e) {
        // Document may be in invalid state
      }

      try {
        const traverseShadowDOM = (root) => {
          if (!root || !root.querySelectorAll) return;
          const elements = root.querySelectorAll("*");
          for (const el of elements) {
            try {
              if (el.shadowRoot) {
                const inner = el.shadowRoot.querySelectorAll("video");
                if (inner && inner.length) videos.push(...inner);
                traverseShadowDOM(el.shadowRoot);
              }
            } catch (err) {}
          }
        };
        traverseShadowDOM(document);
      } catch (e) {}

      try {
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          try {
            if (iframe.contentDocument) {
              const list = iframe.contentDocument.querySelectorAll("video");
              if (list && list.length) videos.push(...list);
            }
          } catch (err) {}
        }
      } catch (e) {}

      try {
        const additional = this.getPlatformSpecificVideos();
        if (additional && additional.length) videos.push(...additional);
      } catch (e) {}

      return [...new Set(videos)];
    }

    /**
     * True if the video belongs to the main page document (not an iframe).
     * Prevents showing the indicator on article/image pages where the only
     * video is inside an ad or embed iframe.
     */
    isInMainDocument(video) {
      try {
        return video && video.ownerDocument === document;
      } catch (e) {
        return false;
      }
    }

    /**
     * True if the video is meaningfully visible (not hidden, not tiny).
     * @param {HTMLVideoElement} video
     * @param {number} minWidth - Minimum width in pixels (default 200)
     * @param {number} minHeight - Minimum height in pixels (default 150)
     */
    isMeaningfullyVisible(video, minWidth = 200, minHeight = 150) {
      try {
        if (!video || !document.contains(video)) return false;
        const style = window.getComputedStyle(video);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const opacity = parseFloat(style.opacity);
        if (Number.isNaN(opacity) || opacity < 0.01) return false;
        const w = video.offsetWidth || video.clientWidth || 0;
        const h = video.offsetHeight || video.clientHeight || 0;
        return w >= minWidth && h >= minHeight;
      } catch (e) {
        return false;
      }
    }

    /**
     * True if the video is a live stream (unbounded duration — speed cannot be controlled).
     * HTML5: live streams report duration === Infinity per spec.
     */
    isLiveVideo(video) {
      try {
        if (!video || !document.contains(video)) return false;
        return video.duration === Infinity || video.duration === Number.POSITIVE_INFINITY;
      } catch (e) {
        return false;
      }
    }

    /** Min size for indicator: main player only (excludes small grid clips). ~16:9. */
    static get MAIN_VIDEO_MIN_SIZE() {
      return { width: 380, height: 214 };
    }

    /**
     * True if the video is likely the main player (playing or has been played), not a grid thumbnail.
     * Grid thumbnails are usually paused at currentTime 0 with only metadata loaded.
     * Aligns with canonical "isLikelyMainVideo": ended=false, readyState>=2, not (paused at 0).
     */
    isLikelyMainPlayer(video) {
      try {
        if (!video || !document.contains(video)) return false;
        if (video.ended) return false;
        if (video.readyState < 2) return false;
        if (video.paused && video.currentTime === 0) return false;
        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Candidate videos for main-player selection (do not attach UI here).
     * Hard filters: main document, min size (main player scale), not ended, not live.
     */
    getCandidateVideos() {
      const all = this.getAllVideos();
      const { width: minW, height: minH } = SpeedTuneController.MAIN_VIDEO_MIN_SIZE;
      return all.filter((v) => {
        if (!this.isInMainDocument(v) || this.isLiveVideo(v) || v.ended) return false;
        try {
          const r = v.getBoundingClientRect();
          return r.width >= minW && r.height >= minH;
        } catch (e) {
          return false;
        }
      });
    }

    /**
     * Select the single primary (main) video from candidates.
     * Prefers "likely main" (playing or paused-after-watch), then largest by area.
     */
    selectPrimaryVideo() {
      const candidates = this.getCandidateVideos();
      if (candidates.length === 0) return null;
      const mainLike = candidates.filter((v) => this.isLikelyMainPlayer(v));
      const pool = mainLike.length > 0 ? mainLike : candidates;
      return pool.reduce((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.width * ar.height > br.width * br.height ? a : b;
      });
    }

    /**
     * Get the single "primary" video for showing the speed indicator (uses selectPrimaryVideo).
     */
    getPrimaryVideoForIndicator() {
      return this.selectPrimaryVideo();
    }

    /**
     * True if there is a primary video for the indicator (main doc, meaningfully visible).
     * Used by popup so "Video detected" matches indicator logic (single source of truth).
     */
    hasPrimaryVideo() {
      return !!this.getPrimaryVideoForIndicator();
    }

    /**
     * Whether a video meets visibility rules for showing the indicator (no active ref).
     * Used before attaching: readyState >= 2, playback or user intent, in viewport.
     */
    shouldShowIndicatorForVideo(v) {
      if (!v || !document.contains(v)) return false;
      if (v.readyState < 2) return false;
      if (v.paused && v.currentTime === 0) return false;
      try {
        const rect = v.getBoundingClientRect();
        return (
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        );
      } catch (e) {
        return false;
      }
    }

    /**
     * Show speed indicator only when: v is active, has enough data, and has playback or user intent.
     * No grid thumbnails, no previews, no background autoplay.
     */
    shouldShowIndicator(v) {
      return v !== null && v === this.indicatorPrimaryVideo && this.shouldShowIndicatorForVideo(v);
    }

    /**
     * Single place to switch active video: detach UI from old, set active, attach to new.
     * Never attach UI without detaching the old one first.
     */
    switchActiveVideo(v) {
      if (v === this.indicatorPrimaryVideo) return;
      if (!this.showConstantIndicator) return;
      const candidates = this.getCandidateVideos();
      if (!candidates.length || !candidates.includes(v)) return;

      this.hideConstantIndicator();
      this.indicatorPrimaryVideo = v;
      if (!this.isLiveVideo(v)) {
        try {
          v.playbackRate = this.currentSpeed;
        } catch (e) {}
      }
      this.createConstantIndicator(v);
    }

    /**
     * Get additional video elements using generic selectors
     * Uses universal patterns to detect videos without platform-specific checks
     */
    getPlatformSpecificVideos() {
      const videos = [];

      try {
        // Generic selectors that work across platforms
        // These patterns are common in video players but not platform-specific
        
        // Common player container patterns
        videos.push(...document.querySelectorAll("[class*='player'] video"));
        videos.push(...document.querySelectorAll("[class*='Player'] video"));
        videos.push(...document.querySelectorAll("[id*='player'] video"));
        videos.push(...document.querySelectorAll("[id*='Player'] video"));
        videos.push(...document.querySelectorAll("[class*='video'] video"));
        videos.push(...document.querySelectorAll("[class*='Video'] video"));
        
        // Common data attribute patterns
        videos.push(...document.querySelectorAll("[data-testid*='player'] video"));
        videos.push(...document.querySelectorAll("[data-testid*='video'] video"));
        videos.push(...document.querySelectorAll("[data-automationid*='player'] video"));
        videos.push(...document.querySelectorAll("[data-video-id] video"));
        videos.push(...document.querySelectorAll("[data-a-target*='player'] video"));
        
        // Common class patterns for video containers
        videos.push(...document.querySelectorAll(".video-player video"));
        videos.push(...document.querySelectorAll(".html5-video-player video"));
        videos.push(...document.querySelectorAll(".rendererContainer video"));
        videos.push(...document.querySelectorAll(".webPlayerContainer video"));
        videos.push(...document.querySelectorAll(".player-container video"));
        videos.push(...document.querySelectorAll(".video-container video"));
        
        // Fallback: Check all video elements for visible/valid ones
        const allVideos = document.querySelectorAll("video");
        allVideos.forEach((video) => {
          if (
            video.offsetWidth > 200 &&
            video.offsetHeight > 100 &&
            video.readyState >= 0
          ) {
            videos.push(video);
          }
        });
      } catch (e) {
        console.warn("[SpeedTune] Generic selector error:", e);
      }

      return videos;
    }

    // ========================================================================
    // SPEED CONTROL
    // ========================================================================

    /**
     * Set playback speed for all videos
     * @param {number} speed - Playback speed (0.1 to 16)
     * @param {boolean} showConstantIndicator - Show persistent indicator
     * @param {string} position - Indicator position
     */
    setSpeed(speed, showConstantIndicator = true, position = "top-left") {
      // Round to fix floating-point precision issues
      const roundedSpeed = Math.round(speed * 100) / 100;
      this.currentSpeed = Math.max(0.1, Math.min(16, roundedSpeed));

      // Update indicator settings
      const indicatorWasEnabled = this.showConstantIndicator;
      this.showConstantIndicator = showConstantIndicator;
      this.indicatorPosition = position;

      // If indicator was just disabled, hide it immediately
      if (indicatorWasEnabled && !showConstantIndicator) {
        this.hideConstantIndicator();
        this.hidePopupToast();
      }

      // Apply speed only to the active (main) video — never to grid/preview/thumbnail videos
      const active = this.indicatorPrimaryVideo || this.selectPrimaryVideo();
      if (active && document.contains(active) && !this.isLiveVideo(active)) {
        this.videos.add(active);
        active.playbackRate = this.currentSpeed;
      }
      // Keep other videos in our set for discovery; do not change their playbackRate
      this.getAllVideos().forEach((v) => {
        if (v && document.contains(v)) this.videos.add(v);
      });

      // Update indicators (will hide if disabled)
      this.updateIndicators(true);
    }

    /**
     * Get current playback speed
     */
    getCurrentSpeed() {
      return this.currentSpeed;
    }

    // ========================================================================
    // SPEED INDICATORS
    // ========================================================================

    /**
     * Update indicators based on current mode
     * @param {boolean} isSpeedChange - Whether this is triggered by a speed change
     */
    updateIndicators(isSpeedChange = false) {
      // Check if there are any videos on the page
      const allVideos = this.getAllVideos();
      const hasVideos = allVideos.length > 0;

      // If no videos found, hide all indicators
      if (!hasVideos) {
        this.hideConstantIndicator();
        this.hidePopupToast();
        return;
      }

      // If Speed Indicator toggle is OFF, hide everything completely
      if (!this.showConstantIndicator) {
        this.hideConstantIndicator();
        this.hidePopupToast();
        return;
      }

      // Speed Indicator is ON - show constant indicator
      this.hidePopupToast();
      this.showConstantSpeedIndicator();
    }

    /**
     * Show constant speed indicator (persistent HUD).
     * Only called when showConstantIndicator is true. Only shows for a primary
     * video in the main document that is meaningfully visible; avoids showing
     * on article/image pages where the only video is in an iframe (e.g. ad).
     */
    showConstantSpeedIndicator() {
      // Double-check: Don't show if indicator is disabled
      if (!this.showConstantIndicator) {
        this.hideConstantIndicator();
        return;
      }

      const targetVideo = this.getPrimaryVideoForIndicator();
      if (!targetVideo) {
        this.hideConstantIndicator();
        return;
      }
      if (!this.shouldShowIndicatorForVideo(targetVideo)) {
        this.hideConstantIndicator();
        return;
      }

      if (this.constantIndicator) {
        // Update existing indicator (only if indicator is enabled)
        if (this.showConstantIndicator) {
          this.indicatorPrimaryVideo = targetVideo;
          this.constantIndicator.textContent = `${this.currentSpeed.toFixed(1)}x`;
          this.positionConstantIndicator(this.constantIndicator, targetVideo);
        } else {
          // Indicator was disabled - remove it
          this.hideConstantIndicator();
        }
      } else {
        // Create new indicator (only if enabled)
        if (this.showConstantIndicator) {
          this.createConstantIndicator(targetVideo);
        }
      }
    }

    /**
     * Create constant speed indicator element (fade-in).
     * Only creates if indicator is enabled.
     */
    createConstantIndicator(video) {
      // Don't create if indicator is disabled
      if (!this.showConstantIndicator) {
        return;
      }

      try {
        this.constantIndicator = document.createElement("div");
        this.constantIndicator.className = "speed-tune-constant-indicator";
        this.constantIndicator.setAttribute("aria-live", "polite");
        this.constantIndicator.setAttribute("role", "status");

        // Styling: no transition — instant show, correct position only
        Object.assign(this.constantIndicator.style, {
          position: "absolute",
          zIndex: "999999",
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(10px)",
          color: "white",
          padding: "6px 12px",
          borderRadius: "20px",
          fontSize: "14px",
          fontWeight: "600",
          fontFamily:
            '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          pointerEvents: "none",
        });

        this.constantIndicator.textContent = `${this.currentSpeed.toFixed(1)}x`;

        // Cache primary so scroll/resize only reposition (no expensive getPrimaryVideoForIndicator on every scroll)
        this.indicatorPrimaryVideo = video;
        this.positionConstantIndicator(this.constantIndicator, video);
        document.body.appendChild(this.constantIndicator);

        // On scroll/resize: hide instantly if video scrolled out of view; otherwise reposition.
        const updatePosition = () => {
          if (!this.showConstantIndicator || !this.constantIndicator) {
            this.hideConstantIndicator();
            return;
          }
          let video = this.indicatorPrimaryVideo;
          if (!video || !document.contains(video)) {
            video = this.getPrimaryVideoForIndicator();
            this.indicatorPrimaryVideo = video;
            if (!video) {
              this.hideConstantIndicator();
              return;
            }
          }
          const rect = video.getBoundingClientRect();
          const inView =
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight;
          if (!inView) {
            this.hideConstantIndicator();
            return;
          }
          this.positionConstantIndicator(this.constantIndicator, video);
        };
        this.constantIndicatorUpdateHandlers.push(updatePosition);
        window.addEventListener("scroll", updatePosition, { passive: true });
        window.addEventListener("resize", updatePosition, { passive: true });

        // Periodic reconciliation (anti-desync): DOM/SPA/route changes; only switch when primary changes.
        const RECONCILE_MS = 800;
        this.indicatorRecomputeIntervalId = setInterval(() => {
          if (!this.showConstantIndicator) return;
          const primary = this.selectPrimaryVideo();
          if (!primary) {
            if (this.constantIndicator) this.hideConstantIndicator();
            return;
          }
          if (
            this.indicatorPrimaryVideo &&
            !this.shouldShowIndicatorForVideo(this.indicatorPrimaryVideo)
          ) {
            this.hideConstantIndicator();
            return;
          }
          if (primary !== this.indicatorPrimaryVideo) {
            this.switchActiveVideo(primary);
            return;
          }
          if (this.constantIndicator) {
            this.positionConstantIndicator(this.constantIndicator, primary);
          }
        }, RECONCILE_MS);
      } catch (error) {
        console.error("[SpeedTune] Error creating constant indicator:", error);
      }
    }

    /**
     * Find the <video> element at viewport coordinates (element under cursor or its ancestor).
     */
    getVideoAtPoint(clientX, clientY) {
      try {
        const el = document.elementFromPoint(clientX, clientY);
        let node = el;
        while (node) {
          if (node.tagName === "VIDEO") return node;
          node = node.parentElement;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    /**
     * Position constant indicator relative to video (safe for detached nodes).
     */
    positionConstantIndicator(indicator, video) {
      try {
        if (!indicator || !video || !document.contains(video)) return;
        const videoRect = video.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();

        let top, left;
        switch (this.indicatorPosition) {
          case "top-left":
            top = videoRect.top + 10;
            left = videoRect.left + 10;
            break;
          case "top-right":
            top = videoRect.top + 10;
            left = videoRect.right - indicatorRect.width - 10;
            break;
          case "bottom-left":
            top = videoRect.bottom - indicatorRect.height - 10;
            left = videoRect.left + 10;
            break;
          case "bottom-right":
            top = videoRect.bottom - indicatorRect.height - 10;
            left = videoRect.right - indicatorRect.width - 10;
            break;
          case "center":
            top = videoRect.top + (videoRect.height - indicatorRect.height) / 2;
            left = videoRect.left + (videoRect.width - indicatorRect.width) / 2;
            break;
          default:
            top = videoRect.top + 10;
            left = videoRect.left + 10;
        }

        top = Math.max(10, Math.min(window.innerHeight - indicatorRect.height - 10, top));
        left = Math.max(10, Math.min(window.innerWidth - indicatorRect.width - 10, left));

        indicator.style.top = `${top + window.scrollY}px`;
        indicator.style.left = `${left + window.scrollX}px`;
      } catch (e) {
        // Detached or inaccessible node
      }
    }

    /**
     * Hide constant indicator instantly (no fade — clear for user when disabled)
     */
    hideConstantIndicator() {
      if (!this.constantIndicator) return;

      if (this.indicatorRecomputeIntervalId) {
        clearInterval(this.indicatorRecomputeIntervalId);
        this.indicatorRecomputeIntervalId = null;
      }
      this.lastIndicatorHideTime = Date.now();
      const el = this.constantIndicator;
      const handlers = [...this.constantIndicatorUpdateHandlers];
      this.constantIndicator = null;
      this.constantIndicatorUpdateHandlers = [];
      this.indicatorPrimaryVideo = null;

      try {
        el.remove();
      } catch (e) {}
      handlers.forEach((handler) => {
        window.removeEventListener("scroll", handler);
        window.removeEventListener("resize", handler);
      });
    }

    /**
     * Show popup speed toast (transient notification)
     * NOTE: This method is no longer used - indicators are completely hidden when toggle is OFF
     * Kept for backward compatibility but should not be called
     */
    showPopupSpeedToast() {
      // Don't show if indicator is disabled
      if (!this.showConstantIndicator) {
        this.hidePopupToast();
        return;
      }

      // Clear existing fade timeout
      if (this.popupToastTimeout) {
        clearTimeout(this.popupToastTimeout);
        this.popupToastTimeout = null;
      }

      if (this.popupToast) {
        // Update existing toast
        this.popupToast.textContent = `Speed: ${this.currentSpeed.toFixed(1)}x`;
      } else {
        // Create new toast
        this.createPopupToast();
      }

      // Set debounced fade timeout
      this.popupToastTimeout = setTimeout(() => {
        this.hidePopupToast();
      }, 1000);
    }

    /**
     * Create popup toast element
     */
    createPopupToast() {
      try {
        this.popupToast = document.createElement("div");
        this.popupToast.className = "speed-tune-popup-toast";

        // Styling
        Object.assign(this.popupToast.style, {
          position: "fixed",
          top: "20px",
          right: "20px",
          zIndex: "999999",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          backdropFilter: "blur(10px)",
          color: "white",
          padding: "12px 20px",
          borderRadius: "25px",
          fontSize: "16px",
          fontWeight: "600",
          fontFamily:
            '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          pointerEvents: "none",
          transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          transform: "translateY(-20px) translateZ(0)",
          opacity: "0",
          willChange: "transform, opacity",
        });

        this.popupToast.textContent = `Speed: ${this.currentSpeed.toFixed(1)}x`;
        document.body.appendChild(this.popupToast);

        // Animate in
        requestAnimationFrame(() => {
          if (this.popupToast) {
            this.popupToast.style.opacity = "1";
            this.popupToast.style.transform = "translateY(0) translateZ(0)";
          }
        });
      } catch (error) {
        console.error("[SpeedTune] Error creating popup toast:", error);
      }
    }

    /**
     * Hide popup toast
     */
    hidePopupToast() {
      if (this.popupToast) {
        this.popupToast.style.opacity = "0";
        this.popupToast.style.transform = "translateY(-20px) translateZ(0)";

        setTimeout(() => {
          if (this.popupToast) {
            this.popupToast.remove();
            this.popupToast = null;
          }
        }, 300);
      }

      if (this.popupToastTimeout) {
        clearTimeout(this.popupToastTimeout);
        this.popupToastTimeout = null;
      }
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Cleanup on page unload: observers, intervals, timers, per-video listeners.
     */
    destroy() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.stopPeriodicScan();
      this.stopGlobalSpeedCheck();
      if (this.observer) {
        try {
          this.observer.disconnect();
        } catch (e) {}
        this.observer = null;
      }
      if (this.urlChangeObserver) {
        try {
          this.urlChangeObserver.disconnect();
        } catch (e) {}
        this.urlChangeObserver = null;
      }
      for (const video of Array.from(this.videoListeners.keys())) {
        this.removeVideoListeners(video);
      }
      this.hideConstantIndicator();
      this.hidePopupToast();
      window.speedTuneController = null;
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Initialize the controller when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      new SpeedTuneController();
    });
  } else {
    new SpeedTuneController();
  }

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (window.speedTuneController) {
      window.speedTuneController.destroy();
    }
  });
})();
