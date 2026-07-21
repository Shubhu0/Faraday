// Faraday popup: master toggle, per-site toggle, focus session, collapsed
// activity monitor.

"use strict";

const { api, send, kindMeta, riskFor, riskLabel, fmtTime, fmtAgo, fmtCountdown } =
  FaradayUI;

const $ = (id) => document.getElementById(id);

// Turning "This site" off creates a 1-hour exception by default: protection
// quietly comes back instead of staying off forever. "Always off" lives in
// Site Permissions.
const SITE_OFF_MINUTES = 60;

let state = null;
let currentDomain = "";
let timerInterval = null;
let monitorOpen = false;

function activeException(domain) {
  const now = Date.now();
  for (const [d, expiry] of Object.entries(state.allowed || {})) {
    if (expiry !== 0 && expiry <= now) continue;
    if (domain === d || domain.endsWith("." + d)) return { domain: d, expiry };
  }
  return null;
}

function render() {
  const focusActive = state.focusUntil > Date.now();
  const on = state.settings.enabled !== false;

  // Master
  const master = $("masterToggle");
  master.checked = on;
  master.disabled = focusActive && on; // no bypass during focus
  document.body.classList.toggle("off", !on);

  // Status banner
  const banner = $("statusBanner");
  if (!on) {
    banner.className = "banner off";
    banner.textContent =
      "Protection is paused. Your activity may be visible to AI tools.";
  } else if (focusActive) {
    banner.className = "banner locked";
    banner.textContent =
      "Focus session active — exceptions are locked until the timer ends.";
  } else {
    banner.className = "banner on";
    banner.textContent = "Faraday is actively protecting your data.";
  }

  // This site
  const siteToggle = $("siteToggle");
  const siteSub = $("siteSub");
  if (!currentDomain) {
    siteSub.textContent = "No site in this tab";
    siteToggle.checked = false;
    siteToggle.disabled = true;
  } else {
    const exception = activeException(currentDomain);
    siteToggle.disabled = !on;
    siteToggle.checked = !exception;
    if (exception) {
      siteSub.textContent =
        exception.expiry === 0
          ? currentDomain + " — always off"
          : currentDomain + " — off until " + fmtTime(exception.expiry);
    } else {
      siteSub.textContent = currentDomain;
    }
  }

  // Focus
  const timer = $("focusTimer");
  const actions = $("focusActions");
  if (timerInterval) clearInterval(timerInterval);
  if (focusActive) {
    actions.hidden = true;
    timer.hidden = false;
    $("focusSub").textContent = "Locked — no early exit";
    const tick = () => {
      const remaining = state.focusUntil - Date.now();
      if (remaining <= 0) {
        clearInterval(timerInterval);
        refresh();
        return;
      }
      timer.textContent = fmtCountdown(remaining);
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  } else {
    actions.hidden = false;
    timer.hidden = true;
    $("focusSub").textContent =
      "Wipe exceptions and lock them until the timer ends";
    for (const btn of actions.querySelectorAll("button")) {
      btn.disabled = !on;
    }
  }

  // Monitor preview
  const today = state.monitorToday || 0;
  const risk = riskFor(today);
  $("riskDot").className = "dot " + risk;
  $("monitorSummary").textContent =
    today + " attempt" + (today === 1 ? "" : "s") + " blocked today";
  $("riskChip").className = "risk-chip " + risk;
  $("riskChip").textContent = riskLabel(risk) + " risk";
  $("monitorAcross").textContent =
    "across " + (state.monitorSites || 0) + " monitored site" +
    (state.monitorSites === 1 ? "" : "s");
}

function renderMonitorList(log) {
  const list = $("monitorList");
  const empty = $("monitorEmpty");
  list.textContent = "";
  const recent = log.slice(0, 5);
  empty.hidden = recent.length > 0;
  for (const entry of recent) {
    const li = document.createElement("li");

    const dot = document.createElement("span");
    dot.className = "dot " + (entry.kind || "custom");

    const src = document.createElement("span");
    src.className = "src";
    src.textContent = entry.target || entry.site || "(unknown)";
    src.title = (entry.site || "?") + " → " + (entry.target || "?");

    const type = document.createElement("span");
    type.className = "type";
    type.textContent = kindMeta(entry.kind).label;

    const when = document.createElement("span");
    when.className = "when";
    when.textContent = fmtAgo(entry.t);

    li.append(dot, src, type, when);
    list.append(li);
  }
}

async function refresh() {
  state = await send({ type: "getState" });
  FaradayUI.applyTheme(state.settings.theme);
  render();
}

async function initSite() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        currentDomain = url.hostname.replace(/^www\./, "");
      }
    } catch (e) {
      currentDomain = "";
    }
  }
}

function openSettings(hash) {
  api.tabs.create({
    url: api.runtime.getURL("options/options.html" + (hash || ""))
  });
  window.close();
}

document.addEventListener("DOMContentLoaded", async () => {
  await initSite();
  await refresh();

  FaradayUI.bindThemeButton(
    $("themeBtn"),
    () => state.settings.theme,
    (next) => {
      state.settings.theme = next;
    }
  );

  $("masterToggle").addEventListener("change", async (e) => {
    const res = await send({
      type: "setSetting",
      key: "enabled",
      value: e.target.checked
    });
    if (res && res.error === "focus-active") {
      e.target.checked = true;
    }
    await refresh();
  });

  $("siteToggle").addEventListener("change", async (e) => {
    if (!currentDomain) return;
    let res;
    if (e.target.checked) {
      res = await send({ type: "revokeSite", domain: currentDomain });
    } else {
      res = await send({
        type: "allowSite",
        domain: currentDomain,
        minutes: SITE_OFF_MINUTES
      });
    }
    if (res && res.error === "focus-active") {
      e.target.checked = true;
    }
    await refresh();
  });

  $("focusActions").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    await send({ type: "startFocus", minutes: Number(btn.dataset.focus) });
    await refresh();
  });

  $("monitorPreview").addEventListener("click", async () => {
    monitorOpen = !monitorOpen;
    $("monitorDetail").hidden = !monitorOpen;
    $("monitorChevron").classList.toggle("open", monitorOpen);
    $("monitorChevron").textContent = monitorOpen ? "⌄" : "›";
    if (monitorOpen) {
      const res = await send({ type: "getMonitorLog" });
      renderMonitorList((res && res.monitorLog) || []);
    }
  });

  $("viewAll").addEventListener("click", () => openSettings("#activity"));
  $("openSettings").addEventListener("click", () => openSettings("#general"));
});
