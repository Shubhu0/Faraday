// Faraday: widget removal layer.
// Sweeps the DOM for embedded AI assistant widgets at document_start and
// DOMContentLoaded, then watches for late-injected widgets via MutationObserver.
// Signatures live in blocklists.js (WIDGET_SELECTORS, WIDGET_SCRIPT_HINTS).

"use strict";

(() => {
  if (typeof FARADAY === "undefined") return;

  const api = typeof browser !== "undefined" ? browser : chrome;

  let enabled = true;
  let excepted = false; // per-site exception ("This site" toggled off)

  function applySettings(s) {
    enabled = s.enabled !== false && s.widgetRemoval !== false;
  }
  function applyAllowed(allowed) {
    const host = location.hostname.replace(/^www\./, "");
    const now = Date.now();
    excepted = Object.entries(allowed || {}).some(([domain, expiry]) => {
      if (expiry !== 0 && expiry <= now) return false;
      return host === domain || host.endsWith("." + domain);
    });
  }
  api.storage.local.get(["settings", "allowed"]).then((data) => {
    applySettings((data && data.settings) || {});
    applyAllowed((data && data.allowed) || {});
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) applySettings(changes.settings.newValue || {});
    if (changes.allowed) applyAllowed(changes.allowed.newValue || {});
  });

  let pendingCount = 0;
  let reportTimer = null;

  function report(n) {
    pendingCount += n;
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      const count = pendingCount;
      pendingCount = 0;
      reportTimer = null;
      try {
        api.runtime.sendMessage({ type: "widgetRemoved", count });
      } catch (e) {
        // Extension context gone (reload/update); nothing to do.
      }
    }, 500);
  }

  function isWidgetScript(node) {
    if (node.tagName !== "SCRIPT" || !node.src) return false;
    return FARADAY.WIDGET_SCRIPT_HINTS.some((hint) => node.src.includes(hint));
  }

  function matchesWidget(node) {
    if (!(node instanceof Element)) return false;
    return FARADAY.WIDGET_SELECTORS.some((sel) => {
      try {
        return node.matches(sel);
      } catch (e) {
        return false;
      }
    });
  }

  function sweep(root) {
    if (!enabled || excepted || !root || !root.querySelectorAll) return;
    let removed = 0;
    for (const sel of FARADAY.WIDGET_SELECTORS) {
      let nodes;
      try {
        nodes = root.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        node.remove();
        removed++;
      }
    }
    for (const script of root.querySelectorAll("script[src]")) {
      if (isWidgetScript(script)) {
        script.remove();
        removed++;
      }
    }
    if (removed > 0) report(removed);
  }

  // Initial sweep (document_start: <head> may be all that exists yet).
  sweep(document.documentElement);

  document.addEventListener("DOMContentLoaded", () => {
    sweep(document.documentElement);
  });

  const observer = new MutationObserver((mutations) => {
    if (!enabled || excepted) return;
    let removed = 0;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (matchesWidget(node) || isWidgetScript(node)) {
          node.remove();
          removed++;
        } else if (node.querySelectorAll) {
          // A container was added; check its subtree.
          sweep(node);
        }
      }
    }
    if (removed > 0) report(removed);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
