// Faraday: background worker (service worker on Chromium/Safari, event page
// on Firefox). Owns dynamic rules, focus sessions, badge, stats, and the
// local activity monitor. All state lives in extension storage. No network
// requests, ever.

"use strict";

// Cross-browser facade: Firefox exposes promise-based `browser`; Chromium
// MV3's `chrome` is promise-based too when no callback is passed.
const api = typeof browser !== "undefined" ? browser : chrome;

const ALL_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "webtransport",
  "other"
];

// Rule ID ranges: static rules 1-999 live in rules/*.json;
// dynamic allow rules start at 1000 (priority 100, beats static blocks);
// custom user blocks start at 5000 (priority 1).
const ALLOW_RULE_BASE = 1000;
const CUSTOM_BLOCK_BASE = 5000;
const ALLOW_PRIORITY = 100;
const BLOCK_PRIORITY = 1;

const DEFAULT_SETTINGS = {
  enabled: true,
  widgetRemoval: true,
  dlpEnabled: true,
  dlpEverywhere: false,
  sdkRuleset: true,
  theme: "auto"
};

const THEMES = ["auto", "light", "dark"];

// Local activity monitor: recent blocked/guarded events, capped. Never
// leaves extension storage.
const MONITOR_CAP = 200;

// Per-browser capabilities, feature-detected once.
const hasRuleMatchedDebug = Boolean(
  api.declarativeNetRequest.onRuleMatchedDebug
);
const hasNativeBadge =
  typeof api.declarativeNetRequest.setExtensionActionOptions === "function";

// ---------- Storage helpers ----------

async function getLocal(keys) {
  return api.storage.local.get(keys);
}

async function getSettings() {
  const { settings } = await getLocal("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getFocusUntil() {
  const { focusUntil } = await api.storage.session.get("focusUntil");
  return focusUntil || 0;
}

async function focusActive() {
  return (await getFocusUntil()) > Date.now();
}

async function bumpStat(key, by) {
  const { stats } = await getLocal("stats");
  const next = { widgetsRemoved: 0, dlpWarnings: 0, ...(stats || {}) };
  next[key] = (next[key] || 0) + by;
  await api.storage.local.set({ stats: next });
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

// ---------- Activity monitor ----------

let monitorBuffer = [];
let monitorFlushTimer = null;

function recordMonitor(entry) {
  monitorBuffer.push(entry);
  if (monitorFlushTimer) return;
  monitorFlushTimer = setTimeout(flushMonitor, 1000);
}

async function flushMonitor() {
  monitorFlushTimer = null;
  if (monitorBuffer.length === 0) return;
  const pending = monitorBuffer;
  monitorBuffer = [];
  const { monitorLog = [] } = await getLocal("monitorLog");
  const next = monitorLog.concat(pending).slice(-MONITOR_CAP);
  await api.storage.local.set({ monitorLog: next });
}

// Source 1 (Chromium, unpacked): DNR feedback tells us exactly which rule
// blocked which request.
if (hasRuleMatchedDebug) {
  api.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const { rule, request } = info;
    // Skip dynamic allow matches (ids 1000-4999); log blocks only.
    if (rule.rulesetId === "_dynamic" && rule.ruleId < CUSTOM_BLOCK_BASE) return;
    const kind =
      rule.rulesetId === "ai_platforms"
        ? "platform"
        : rule.rulesetId === "ai_sdks"
          ? "sdk"
          : "custom";
    recordMonitor({
      t: Date.now(),
      site: hostnameOf(request.initiator || request.url),
      target: hostnameOf(request.url),
      kind
    });
  });
}

// Source 2 (Firefox): no onRuleMatchedDebug, but observational webRequest is
// available. We match outgoing requests against the same blocklists DNR uses
// (DNR still does the actual blocking natively) and feed both the monitor
// and the fallback badge.
const observer = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  allowed: {},
  customBlocked: [],
  platforms: [],
  sdks: []
};

function observerIsAllowed(hostname) {
  const now = Date.now();
  for (const [domain, expiry] of Object.entries(observer.allowed)) {
    if (expiry !== 0 && expiry <= now) continue;
    if (domainMatches(hostname, domain)) return true;
  }
  return false;
}

async function initObserver() {
  const [{ allowed = {}, customBlocked = [] }, settings] = await Promise.all([
    getLocal(["allowed", "customBlocked"]),
    getSettings()
  ]);
  observer.settings = settings;
  observer.allowed = allowed;
  observer.customBlocked = customBlocked;
  for (const [file, key] of [
    ["rules/ai_platforms.json", "platforms"],
    ["rules/ai_sdks.json", "sdks"]
  ]) {
    const res = await fetch(api.runtime.getURL(file));
    const rules = await res.json();
    observer[key] = rules.flatMap(
      (r) => (r.condition && r.condition.requestDomains) || []
    );
  }
  observer.ready = true;
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    observer.settings = {
      ...DEFAULT_SETTINGS,
      ...(changes.settings.newValue || {})
    };
  }
  if (changes.allowed) observer.allowed = changes.allowed.newValue || {};
  if (changes.customBlocked) {
    observer.customBlocked = changes.customBlocked.newValue || [];
  }
});

if (!hasRuleMatchedDebug && api.webRequest && api.webRequest.onBeforeRequest) {
  initObserver();
  api.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!observer.ready || !observer.settings.enabled) return;
      const target = hostnameOf(details.url);
      if (!target) return;
      let kind = null;
      if (observer.platforms.some((d) => domainMatches(target, d))) {
        kind = "platform";
      } else if (
        observer.settings.sdkRuleset &&
        observer.sdks.some((d) => domainMatches(target, d))
      ) {
        kind = "sdk";
      } else if (observer.customBlocked.some((d) => domainMatches(target, d))) {
        kind = "custom";
      }
      if (!kind) return;
      const site = hostnameOf(
        details.initiator || details.originUrl || details.documentUrl || ""
      );
      if (observerIsAllowed(target) || (site && observerIsAllowed(site))) return;
      recordMonitor({ t: Date.now(), site, target, kind });
      bumpTabBadge(details.tabId);
    },
    { urls: ["<all_urls>"] }
  );
}

// ---------- Badge ----------

// Chromium: DNR's native displayActionCountAsBadgeText — no manual counting.
// Firefox has no such option, so the webRequest observer counts per tab.
const tabBlockCounts = new Map();

function bumpTabBadge(tabId) {
  if (hasNativeBadge || tabId == null || tabId < 0) return;
  const n = (tabBlockCounts.get(tabId) || 0) + 1;
  tabBlockCounts.set(tabId, n);
  try {
    api.action.setBadgeText({ tabId, text: String(n) });
  } catch (e) {
    // Tab may already be gone.
  }
}

if (!hasNativeBadge && api.tabs) {
  api.tabs.onRemoved.addListener((tabId) => tabBlockCounts.delete(tabId));
  api.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading") {
      tabBlockCounts.delete(tabId);
      try {
        api.action.setBadgeText({ tabId, text: "" });
      } catch (e) {
        // ignore
      }
    }
  });
}

// ---------- Dynamic rules ----------

// The ONLY writer of dynamic rules. Removes all and re-adds from storage
// state. Any new rule feature goes through here. When the master toggle is
// off, all dynamic rules are cleared (static rulesets are disabled too).
async function rebuildDynamicRules() {
  const [{ allowed = {}, customBlocked = [] }, settings] = await Promise.all([
    getLocal(["allowed", "customBlocked"]),
    getSettings()
  ]);
  if (!settings.enabled) {
    const existing = await api.declarativeNetRequest.getDynamicRules();
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id)
    });
    return;
  }
  const now = Date.now();
  const addRules = [];

  // Allow rules come in pairs: requestDomains + initiatorDomains per allowed
  // domain, so an allowed site works fully (its own requests included).
  let allowId = ALLOW_RULE_BASE;
  for (const [domain, expiry] of Object.entries(allowed)) {
    if (expiry !== 0 && expiry <= now) continue; // expired
    addRules.push({
      id: allowId++,
      priority: ALLOW_PRIORITY,
      action: { type: "allow" },
      condition: { requestDomains: [domain], resourceTypes: ALL_RESOURCE_TYPES }
    });
    addRules.push({
      id: allowId++,
      priority: ALLOW_PRIORITY,
      action: { type: "allow" },
      condition: { initiatorDomains: [domain], resourceTypes: ALL_RESOURCE_TYPES }
    });
  }

  let blockId = CUSTOM_BLOCK_BASE;
  for (const domain of customBlocked) {
    addRules.push({
      id: blockId++,
      priority: BLOCK_PRIORITY,
      action: { type: "block" },
      condition: { requestDomains: [domain], resourceTypes: ALL_RESOURCE_TYPES }
    });
  }

  const existing = await api.declarativeNetRequest.getDynamicRules();
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules
  });
}

async function pruneExpiredAllows() {
  const { allowed = {} } = await getLocal("allowed");
  const now = Date.now();
  let changed = false;
  for (const [domain, expiry] of Object.entries(allowed)) {
    if (expiry !== 0 && expiry <= now) {
      delete allowed[domain];
      changed = true;
    }
  }
  if (changed) {
    await api.storage.local.set({ allowed });
    await rebuildDynamicRules();
  }
}

// Enables/disables static rulesets from the master toggle + sdkRuleset setting.
async function applyRulesets(settings) {
  if (!settings.enabled) {
    await api.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["ai_platforms", "ai_sdks"]
    });
    return;
  }
  await api.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: settings.sdkRuleset
      ? ["ai_platforms", "ai_sdks"]
      : ["ai_platforms"],
    disableRulesetIds: settings.sdkRuleset ? [] : ["ai_sdks"]
  });
}

// ---------- Lifecycle ----------

async function init() {
  if (hasNativeBadge) {
    await api.declarativeNetRequest.setExtensionActionOptions({
      displayActionCountAsBadgeText: true
    });
  } else if (api.action && api.action.setBadgeBackgroundColor) {
    api.action.setBadgeBackgroundColor({ color: "#5B7FD4" });
  }
  const settings = await getSettings();
  await api.storage.local.set({ settings });
  await applyRulesets(settings);
  await pruneExpiredAllows();
  await rebuildDynamicRules();
}

api.runtime.onInstalled.addListener(() => {
  init();
});
api.runtime.onStartup.addListener(() => {
  init();
});

// ---------- Alarms ----------

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "focus-end") {
    await api.storage.session.remove("focusUntil");
  } else if (alarm.name.startsWith("allow-expire:")) {
    await pruneExpiredAllows();
  }
});

// ---------- Messages ----------

const handlers = {
  async getState() {
    const [
      { allowed = {}, customBlocked = [], stats = {}, monitorLog = [] },
      settings,
      focusUntil
    ] = await Promise.all([
      getLocal(["allowed", "customBlocked", "stats", "monitorLog"]),
      getSettings(),
      getFocusUntil()
    ]);
    const all = monitorLog.concat(monitorBuffer);
    const dayStart = new Date().setHours(0, 0, 0, 0);
    return {
      ok: true,
      settings,
      allowed,
      customBlocked,
      stats: { widgetsRemoved: 0, dlpWarnings: 0, ...stats },
      focusUntil,
      // Summary numbers only — the log itself is fetched lazily via
      // getMonitorLog when the user opens the activity view.
      monitorCount: all.length,
      monitorToday: all.filter((e) => e.t >= dayStart).length,
      monitorSites: new Set(all.map((e) => e.site).filter(Boolean)).size
    };
  },

  // Full activity log, newest first. Fetched only when the user opens the
  // activity view (popup monitor panel or options Activity tab).
  async getMonitorLog() {
    await flushMonitor();
    const { monitorLog = [] } = await getLocal("monitorLog");
    return { ok: true, monitorLog: monitorLog.slice().reverse() };
  },

  async clearMonitorLog() {
    monitorBuffer = [];
    await api.storage.local.set({ monitorLog: [] });
    return { ok: true };
  },

  // {domain, minutes} — minutes 0 means permanent.
  async allowSite(msg) {
    if (await focusActive()) {
      return { ok: false, error: "focus-active" };
    }
    const domain = String(msg.domain || "").toLowerCase().trim();
    if (!domain) return { ok: false, error: "no-domain" };
    const minutes = Number(msg.minutes) || 0;
    const expiry = minutes > 0 ? Date.now() + minutes * 60000 : 0;

    const { allowed = {} } = await getLocal("allowed");
    allowed[domain] = expiry;
    await api.storage.local.set({ allowed });
    await rebuildDynamicRules();
    if (expiry !== 0) {
      api.alarms.create("allow-expire:" + domain, { when: expiry + 1000 });
    }
    return { ok: true, expiry };
  },

  async revokeSite(msg) {
    const domain = String(msg.domain || "").toLowerCase().trim();
    const { allowed = {} } = await getLocal("allowed");
    delete allowed[domain];
    await api.storage.local.set({ allowed });
    await rebuildDynamicRules();
    api.alarms.clear("allow-expire:" + domain);
    return { ok: true };
  },

  // Focus session: wipes the allowed map and locks out allowSite until the
  // timer expires. This lockout is the signature feature — no bypass.
  async startFocus(msg) {
    const minutes = Math.max(1, Number(msg.minutes) || 30);
    await api.storage.local.set({ allowed: {} });
    await api.storage.session.set({
      focusUntil: Date.now() + minutes * 60000
    });
    await rebuildDynamicRules();
    api.alarms.create("focus-end", { delayInMinutes: minutes });
    return { ok: true, focusUntil: Date.now() + minutes * 60000 };
  },

  // Only cleans up an already-expired session; never ends one early.
  async endFocus() {
    const focusUntil = await getFocusUntil();
    if (focusUntil > Date.now()) {
      return { ok: false, error: "focus-active" };
    }
    await api.storage.session.remove("focusUntil");
    api.alarms.clear("focus-end");
    return { ok: true };
  },

  async setSetting(msg) {
    const settings = await getSettings();
    if (!(msg.key in DEFAULT_SETTINGS)) {
      return { ok: false, error: "unknown-setting" };
    }
    if (msg.key === "theme") {
      if (!THEMES.includes(msg.value)) {
        return { ok: false, error: "bad-value" };
      }
      settings.theme = msg.value;
    } else {
      // Turning the whole extension off during a focus session would be a
      // bypass of the lockout — reject it.
      if (msg.key === "enabled" && !msg.value && (await focusActive())) {
        return { ok: false, error: "focus-active" };
      }
      settings[msg.key] = Boolean(msg.value);
    }
    await api.storage.local.set({ settings });
    if (msg.key === "sdkRuleset" || msg.key === "enabled") {
      await applyRulesets(settings);
      await rebuildDynamicRules();
    }
    return { ok: true, settings };
  },

  async setCustomBlocked(msg) {
    const domains = Array.isArray(msg.domains)
      ? msg.domains
          .map((d) => String(d).toLowerCase().trim())
          .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
      : [];
    await api.storage.local.set({ customBlocked: domains });
    await rebuildDynamicRules();
    return { ok: true, customBlocked: domains };
  },

  async widgetRemoved(msg, sender) {
    const count = Math.max(0, Number(msg.count) || 0);
    await bumpStat("widgetsRemoved", count);
    const site = sender && sender.tab ? hostnameOf(sender.tab.url) : "";
    if (site && count > 0) {
      recordMonitor({ t: Date.now(), site, target: "embedded AI widget", kind: "widget" });
    }
    return { ok: true };
  },

  async dlpDecision(msg, sender) {
    await bumpStat("dlpWarnings", 1);
    const site = sender && sender.tab ? hostnameOf(sender.tab.url) : "";
    if (site) {
      recordMonitor({ t: Date.now(), site, target: "sensitive data caught", kind: "dlp" });
    }
    return { ok: true };
  }
};

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) {
    sendResponse({ ok: false, error: "unknown-message" });
    return false;
  }
  handler(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});
