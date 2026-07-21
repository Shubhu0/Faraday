// Faraday: shared UI helpers for popup and options pages.
// Defines the FaradayUI global. Loaded before popup.js / options.js.

"use strict";

const FaradayUI = (() => {
  const api = typeof browser !== "undefined" ? browser : chrome;

  // Activity kinds: label for lists, action verb for the log table.
  const KINDS = {
    platform: { label: "AI platform", action: "Blocked" },
    sdk: { label: "AI assistant SDK", action: "Blocked" },
    custom: { label: "Custom block", action: "Blocked" },
    widget: { label: "Embedded widget", action: "Removed" },
    dlp: { label: "Sensitive data", action: "Guarded" }
  };

  function kindMeta(kind) {
    return KINDS[kind] || { label: kind, action: "Blocked" };
  }

  function riskFor(blockedToday) {
    if (blockedToday <= 2) return "low";
    if (blockedToday <= 6) return "medium";
    return "high";
  }

  function riskLabel(risk) {
    return risk.charAt(0).toUpperCase() + risk.slice(1);
  }

  function fmtTime(t) {
    return new Date(t).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function fmtAgo(t) {
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function fmtCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function send(msg) {
    return api.runtime.sendMessage(msg);
  }

  // Theme: "auto" follows the OS; explicit values win. Applies data-theme to
  // <html> and returns what was applied.
  function resolveTheme(setting) {
    if (setting === "light" || setting === "dark") return setting;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(setting) {
    const resolved = resolveTheme(setting);
    document.documentElement.dataset.theme = resolved;
    return resolved;
  }

  // Wires a theme toggle button: flips light <-> dark (from auto, flips away
  // from the current resolved theme) and persists the choice.
  function bindThemeButton(btn, getSetting, onChanged) {
    function paint() {
      const resolved = applyTheme(getSetting());
      btn.textContent = resolved === "dark" ? "☀" : "☾";
      btn.title = resolved === "dark" ? "Switch to light" : "Switch to dark";
    }
    btn.addEventListener("click", async () => {
      const next = resolveTheme(getSetting()) === "dark" ? "light" : "dark";
      await send({ type: "setSetting", key: "theme", value: next });
      if (onChanged) onChanged(next);
      paint();
    });
    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", paint);
    }
    paint();
    return { paint };
  }

  return {
    api,
    kindMeta,
    riskFor,
    riskLabel,
    fmtTime,
    fmtAgo,
    fmtCountdown,
    send,
    resolveTheme,
    applyTheme,
    bindThemeButton
  };
})();
