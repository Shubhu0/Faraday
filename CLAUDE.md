# CLAUDE.md — Faraday: AI Data Privacy Blocker

Cross-browser WebExtension (Chromium MV3, Firefox MV3, Safari) that blocks AI platforms and scrapers, removes embedded AI widgets, and guards sensitive data locally. Core promise: user data stays private from AI. 100% local, zero telemetry — this is non-negotiable and every change must preserve it.

## Layout (uBlock-Origin-style)

* `src/` — platform-neutral extension code. This is the whole extension except the manifest.
* `platform/{chromium,firefox,safari}/manifest.json` — one manifest per target. Chromium serves Chrome/Edge/Brave/Opera/Vivaldi.
* `tools/make.mjs` — copy-only assembly: `node tools/make.mjs [target]` → `dist/<target>/` (gitignored). Load unpacked from `dist/chromium` or `dist/firefox`; Safari via `xcrun safari-web-extension-converter dist/safari`.
* Cross-browser rule: every file that touches extension APIs starts with `const api = typeof browser !== "undefined" ? browser : chrome;` and uses promise-style calls only. Per-browser differences are runtime feature-detection in background.js — never fork the logic per platform.

## Architecture: three layers

1. Network blocking — `src/rules/ai_platforms.json` (~35 AI platforms) and `src/rules/ai_sdks.json` (embedded assistant SDKs: Intercom, Drift, Ada, Tidio, Voiceflow, Chatbase, Botpress). Static declarativeNetRequest rulesets, evaluated natively. One rule per ruleset using `requestDomains` arrays.
2. Widget removal — `src/content/widget-remover.js`. Sweeps DOM at document_start + DOMContentLoaded, MutationObserver for late-injected widgets. Signatures live in `src/content/blocklists.js` (`WIDGET_SELECTORS`, `WIDGET_SCRIPT_HINTS`).
3. Local DLP guard — `src/content/dlp-guard.js`. Intercepts paste (capture phase), Enter-to-send, and form submit on AI hosts (or everywhere via `dlpEverywhere`). Scans via `FARADAY.scan()` in `blocklists.js`: emails, SSNs, phones, Luhn-validated cards, API keys (sk-, sk-ant-, AKIA, ghp_, xox, AIza), JWTs, private key blocks. Modal in a closed shadow DOM (theme-aware): redact / send anyway / cancel. Scanned text is never stored or transmitted.

Both content layers honor per-site exceptions: an `allowed` entry for the current host disables them there too.

## Key files

* `src/background.js` — background worker. Owns dynamic rules, focus sessions, badge, stats, activity monitor. Message types: `getState`, `getMonitorLog`, `clearMonitorLog`, `allowSite`, `revokeSite`, `startFocus`, `endFocus`, `setSetting`, `setCustomBlocked`, `widgetRemoved`, `dlpDecision`.
* `src/content/blocklists.js` — shared config (`FARADAY` global). Injected before both content scripts. Single source of truth for AI hosts, widget signatures, DLP patterns.
* `src/common/theme.css` — Faraday design tokens (light + dark). `src/common/ui.js` — `FaradayUI` global: api facade, kind labels, risk levels, time formatting, theme binding. Both pages load these.
* `src/popup/` — master toggle + status banner, per-site toggle, focus session, collapsed data monitor ("N attempts blocked today" → recent activity → "View full activity").
* `src/options/` — sidebar tabs routed by location.hash: `#general` (master + layer toggles), `#sites` (exceptions + custom blocked domains), `#activity` (stat cards, detected-tools chips, full log table).

## Core mechanics (do not break)

* Rule ID ranges: static rules 1–999 in JSON files; dynamic allow rules start at 1000 (priority 100); custom user blocks start at 5000 (priority 1). Allow beats block via priority.
* Allow rules come in pairs: one `requestDomains` + one `initiatorDomains` per allowed domain, so an allowed site works fully.
* `rebuildDynamicRules()` in background.js is the only writer of dynamic rules. It removes all and re-adds from storage state. Any new rule feature goes through it.
* Focus sessions (`startFocus`): wipes `allowed` map, sets `storage.session.focusUntil`; while active, `allowSite` AND switching the master toggle off are rejected, and `endFocus` refuses to end early. This lockout is the signature feature — never add a bypass.
* Storage schema (`storage.local`): `settings {enabled, widgetRemoval, dlpEnabled, dlpEverywhere, sdkRuleset, theme}` (theme: auto|light|dark), `allowed {domain: expiryMs|0}` (0 = permanent), `customBlocked [domains]`, `stats {widgetsRemoved, dlpWarnings}`, `monitorLog [{t, site, target, kind}]` (kind: platform|sdk|custom|widget|dlp, capped at 200).
* Master switch (`settings.enabled`): off disables both static rulesets, clears dynamic rules, and no-ops both content scripts.
* Per-site UX: the popup's "This site" toggle creates a **1-hour exception by default** (fail-safe: protection returns on its own); "Always off" is a deliberate second step in Site Permissions.
* Badge: Chromium uses DNR's native `displayActionCountAsBadgeText`; Firefox (no such API) falls back to per-tab manual counts fed by the webRequest observer. Feature-detected via `hasNativeBadge` — don't replace the native path.
* Activity monitor sources: Chromium `onRuleMatchedDebug` (unpacked-only) or Firefox `webRequest.onBeforeRequest` (observation only — DNR still blocks natively), plus `widgetRemoved`/`dlpDecision` events everywhere. The log is fetched lazily via `getMonitorLog`; `getState` carries only `monitorCount`, `monitorToday`, `monitorSites`. Risk level: today ≤2 low, ≤6 medium, else high.

## Conventions

* Vanilla JS, no build step beyond file copying, no bundler, no dependencies.
* No external network requests from the extension, ever. No analytics, no remote config, no CDN fonts (system font stack, not Google-hosted Inter). The only planned exception is the roadmap blocklist fetch, which must be opt-in and from a pinned GitHub raw URL.
* DLP additions: new detectors go in `DLP_PATTERNS` in blocklists.js with a human-readable `label`. Anything with false-positive risk (like card numbers) needs a validator (see `luhnValid`).
* New AI domains: platform-grade destinations → `ai_platforms.json`; SDKs embedded in third-party sites → `ai_sdks.json`; also add chat hosts to `AI_HOSTS` in blocklists.js so DLP covers them in Guard mode.
* UI: Faraday design language — oklch palette in `src/common/theme.css` (accent `oklch(0.55 0.15 250)`, amber/red for risk, light + dark via `[data-theme]`), 12–16px radii, 44×24 toggles, ui-monospace for numbers/domains. New UI must use the tokens, both themes, and `FaradayUI` helpers.
* Manifest changes: edit ALL of `platform/*/manifest.json`, keep versions in lockstep, and update the README permissions table.

## Testing (manual, no harness yet)

1. `node tools/make.mjs`, load `dist/chromium` (chrome://extensions) and/or `dist/firefox` (about:debugging), check for background errors.
2. Visit chatgpt.com → blocked, badge increments.
3. Popup → "This site" off → loads for 1 h; paste `test@example.com` → DLP modal; Redact replaces with `[REDACTED]`.
4. Focus session 30 min → exceptions wiped, per-site/master toggles locked, no early end.
5. Site with Intercom/Drift → widget absent; entry in Activity & Monitoring.
6. Theme toggle → popup and options both switch, persisted.
7. Validate on edit: `node --check` on all JS, JSON.parse on all JSON, rebuild dist.

## Roadmap (priority order)

1. Signed blocklist updates from GitHub (opt-in fetch, local override, EasyList-style)
2. Per-page blocked-request report surfaced in the popup
3. Entropy-based secret detection for unknown key formats
4. Block `window.ai` / Prompt API surface exposure

## Honest threat model (keep in README and marketing copy)

Client-side only. Covered: browser→AI traffic, embedded AI widgets, accidental secret pastes. Not coverable by any extension: a website's server forwarding data to AI backends, AI in native apps. Never claim otherwise.
