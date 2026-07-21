// Faraday options: General / Site Permissions / Activity & Monitoring,
// routed via location.hash so the popup can deep-link (#activity).

"use strict";

const { send, kindMeta, riskFor, riskLabel, fmtTime } = FaradayUI;

const $ = (id) => document.getElementById(id);

const TABS = ["general", "sites", "activity"];
const BOOL_SETTINGS = ["sdkRuleset", "widgetRemoval", "dlpEnabled", "dlpEverywhere"];

let state = null;

// ---------- Routing ----------

function currentTab() {
  const hash = location.hash.replace("#", "");
  return TABS.includes(hash) ? hash : "general";
}

function showTab(tab) {
  for (const t of TABS) {
    $("tab-" + t).hidden = t !== tab;
  }
  for (const btn of document.querySelectorAll(".nav-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  if (tab === "activity") loadActivity();
  if (tab === "sites") renderSites();
}

// ---------- General ----------

function renderGeneral() {
  const focusActive = state.focusUntil > Date.now();
  const on = state.settings.enabled !== false;

  const master = $("masterToggle");
  master.checked = on;
  master.disabled = focusActive && on;
  $("masterStatus").textContent = !on
    ? "Protection is paused. Your activity may be visible to AI tools."
    : focusActive
      ? "Protecting your data — focus session active, exceptions locked."
      : "Faraday is actively protecting your data.";

  for (const key of BOOL_SETTINGS) {
    $(key).checked = Boolean(state.settings[key]);
  }
}

// ---------- Site Permissions ----------

function renderSites() {
  const list = $("siteList");
  list.textContent = "";
  const now = Date.now();
  const entries = Object.entries(state.allowed || {}).filter(
    ([, expiry]) => expiry === 0 || expiry > now
  );

  $("sitesSub").textContent =
    entries.length === 0
      ? "Every site is protected."
      : "Protection is off for " +
        entries.length +
        " site" +
        (entries.length === 1 ? "" : "s") +
        ". Toggle a site back on to re-protect it.";
  $("sitesEmpty").hidden = entries.length > 0;

  for (const [domain, expiry] of entries) {
    const row = document.createElement("div");
    row.className = "site-row";

    const name = document.createElement("span");
    name.className = "site-domain";
    name.textContent = domain;

    const status = document.createElement("span");
    status.className = "site-status";
    status.textContent =
      expiry === 0 ? "Always off" : "Off until " + fmtTime(expiry);

    row.append(name, status);

    if (expiry !== 0) {
      const always = document.createElement("button");
      always.className = "always";
      always.textContent = "Always off";
      always.title = "Keep protection off for this site permanently";
      always.addEventListener("click", async () => {
        const res = await send({ type: "allowSite", domain, minutes: 0 });
        if (res && res.error === "focus-active") return;
        await refresh();
        renderSites();
      });
      row.append(always);
    }

    const label = document.createElement("label");
    label.className = "switch";
    label.title = "Toggle protection for " + domain;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = false; // listed sites are the excepted ones
    const track = document.createElement("span");
    track.className = "track";
    label.append(input, track);
    input.addEventListener("change", async () => {
      await send({ type: "revokeSite", domain });
      await refresh();
      renderSites();
    });
    row.append(label);

    list.append(row);
  }

  $("customBlocked").value = (state.customBlocked || []).join("\n");
}

// ---------- Activity ----------

async function loadActivity() {
  const res = await send({ type: "getMonitorLog" });
  const log = (res && res.monitorLog) || [];
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const today = log.filter((e) => e.t >= dayStart).length;
  const risk = riskFor(today);

  $("statToday").textContent = today;
  $("statRisk").textContent = riskLabel(risk);
  $("riskCard").className = "card stat " + risk;
  $("statSites").textContent = new Set(
    log.map((e) => e.site).filter(Boolean)
  ).size;

  // Detected sources (network targets only — widget/dlp entries have
  // descriptive targets, not domains)
  const domains = [
    ...new Set(
      log
        .filter((e) => ["platform", "sdk", "custom"].includes(e.kind))
        .map((e) => e.target)
        .filter(Boolean)
    )
  ].slice(0, 16);
  const chipRow = $("chipRow");
  chipRow.textContent = "";
  $("chipsEmpty").hidden = domains.length > 0;
  for (const d of domains) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = d;
    chipRow.append(chip);
  }

  // Table
  const body = $("logBody");
  body.textContent = "";
  $("logTable").style.display = log.length ? "" : "none";
  $("logEmpty").hidden = log.length > 0;
  for (const entry of log) {
    const row = document.createElement("div");
    row.className = "trow";

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = fmtTime(entry.t);

    const source = document.createElement("div");
    source.className = "source";
    const dot = document.createElement("span");
    dot.className = "dot " + (entry.kind || "custom");
    source.append(dot, entry.target || "(unknown)");

    const type = document.createElement("div");
    type.textContent = kindMeta(entry.kind).label;

    const site = document.createElement("div");
    site.className = "site-col";
    site.textContent = entry.site || "—";

    const action = document.createElement("div");
    const verb = kindMeta(entry.kind).action;
    action.className = "action " + verb.toLowerCase();
    action.textContent = verb;

    row.append(time, source, type, site, action);
    body.append(row);
  }
}

// ---------- Wiring ----------

async function refresh() {
  state = await send({ type: "getState" });
  FaradayUI.applyTheme(state.settings.theme);
  renderGeneral();
}

document.addEventListener("DOMContentLoaded", async () => {
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

  for (const key of BOOL_SETTINGS) {
    $(key).addEventListener("change", async (e) => {
      const res = await send({ type: "setSetting", key, value: e.target.checked });
      if (!res || !res.ok) e.target.checked = !e.target.checked;
    });
  }

  $("saveCustom").addEventListener("click", async () => {
    const domains = $("customBlocked")
      .value.split("\n")
      .map((d) => d.trim())
      .filter(Boolean);
    const res = await send({ type: "setCustomBlocked", domains });
    if (res && res.ok) {
      $("customBlocked").value = res.customBlocked.join("\n");
      state.customBlocked = res.customBlocked;
      const note = $("savedNote");
      note.hidden = false;
      setTimeout(() => (note.hidden = true), 1500);
    }
  });

  $("clearLog").addEventListener("click", async () => {
    await send({ type: "clearMonitorLog" });
    await loadActivity();
  });

  for (const btn of document.querySelectorAll(".nav-btn")) {
    btn.addEventListener("click", () => {
      location.hash = btn.dataset.tab;
    });
  }
  window.addEventListener("hashchange", () => showTab(currentTab()));
  showTab(currentTab());
});
