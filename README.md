# Faraday — AI Data Privacy Blocker

A cross-browser (Chromium, Firefox, Safari) WebExtension that blocks AI platforms and scrapers, removes embedded AI widgets, and stops sensitive data from leaving your browser.

**100% local. Zero telemetry.** The extension makes no network requests of its own — no analytics, no remote config, no CDN assets (not even fonts). This is non-negotiable.

## What it does

1. **Network blocking** — static declarativeNetRequest rulesets block ~35 AI platforms (ChatGPT, Claude, Gemini, Copilot, Perplexity, and more) and the embedded assistant SDKs (Intercom, Drift, Ada, Tidio, Voiceflow, Chatbase, Botpress) that third-party sites inject. Rules are evaluated natively by the browser — zero runtime overhead.
2. **Widget removal** — a content script sweeps the DOM for AI chat widgets at page load and watches for late-injected ones with a MutationObserver.
3. **Sensitive-data guard (DLP)** — on AI chat sites (or everywhere, opt-in), pastes, Enter-to-send, and form submits are scanned for emails, SSNs, phone numbers, Luhn-validated card numbers, API keys (`sk-`, `sk-ant-`, `AKIA`, `ghp_`, `xox`, `AIza`), JWTs, and private key blocks. A modal offers **Redact / Send anyway / Cancel**. Scanned text is never stored or transmitted.

### The interface

- **Popup** — master protection switch with a status banner, a per-site toggle ("This site"), focus session timers, and a collapsed **data monitor**: "N attempts blocked today" with a risk level (low/medium/high), expanding to recent activity and a link to the full log.
- **Settings** — General (master switch + protection layers), Site Permissions (your exceptions, each with "off until…" or "always off", plus custom blocked domains), and Activity & Monitoring (stat cards, detected AI tools, full activity table).
- **Light & dark** — follows your OS by default; one-click override, persisted.
- Turning a site off from the popup creates a **1-hour exception by default** — protection quietly returns instead of staying off forever. "Always off" lives in Site Permissions.
- **Focus sessions** wipe all exceptions and lock out new ones until the timer ends — no early exit, by design. The master switch can't be turned off mid-session either.

## Install

No build tools beyond Node (used only to copy files — no bundler, no dependencies):

```
node tools/make.mjs          # builds dist/chromium, dist/firefox, dist/safari
```

- **Chrome / Edge / Brave / Opera / Vivaldi:** `chrome://extensions` → Developer mode → Load unpacked → `dist/chromium`
- **Firefox (121+):** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`. Firefox treats host permissions as optional: open the add-on's Permissions tab in `about:addons` and grant "Access your data for all websites" so widget removal and the data guard work.
- **Safari (16.4+):** `xcrun safari-web-extension-converter dist/safari` and run the generated Xcode project. Experimental — untested.

## Per-browser behavior

| Capability | Chromium | Firefox | Safari |
|---|---|---|---|
| Network blocking (DNR) | ✅ | ✅ | ✅ |
| Widget removal + DLP guard | ✅ | ✅ (grant host permissions) | ✅ |
| Focus sessions, exceptions, custom blocks | ✅ | ✅ | ✅ |
| Toolbar badge (blocked count) | native DNR badge | per-tab count via webRequest | — |
| Monitor: network entries | unpacked installs (DNR feedback) | ✅ (webRequest observation) | — |
| Monitor: widget + DLP entries | ✅ | ✅ | ✅ |

One codebase (`src/`), one manifest per platform (`platform/<target>/manifest.json`), assembled by `tools/make.mjs` — the same pattern uBlock Origin uses. All feature differences are runtime feature-detection, never forks of the logic.

## Permissions — why each one is needed

| Permission | Why |
|---|---|
| `declarativeNetRequest` | The blocking layer itself. Static rulesets block AI platforms/SDKs; dynamic rules implement per-site exceptions and custom blocks. |
| `declarativeNetRequestFeedback` (Chromium) | Feeds the local activity monitor: which site attempted a blocked AI request. Chrome only exposes this event for unpacked extensions; the log never leaves local storage. |
| `webRequest` (Firefox) | Same job as above on Firefox (which lacks DNR feedback): observe — never modify — requests to feed the monitor and badge. |
| `storage` | Settings, exceptions, custom blocklist, stats, and the activity log — all stored locally. |
| `alarms` | Expiring timed exceptions and ending focus sessions, even if the background worker sleeps. |
| `tabs` | The popup reads the active tab's URL for the "This site" toggle; Firefox badge reset on navigation. |
| `<all_urls>` (host) | Widget removal and the DLP guard must run on any site, since embedded AI widgets appear anywhere. Nothing leaves the browser. |

## Honest threat model

Client-side only.

**Covered:** browser→AI traffic, embedded AI widgets, accidental secret pastes into AI chats.

**Not coverable by any extension:** a website's server forwarding your data to AI backends on its own, and AI built into native apps. We will never claim otherwise.

## Testing (manual)

1. Build and load (see Install), check for background errors.
2. Visit chatgpt.com → blocked, badge increments.
3. Popup → toggle "This site" off → loads fully for 1 h; paste `test@example.com` into the chat → DLP modal fires; **Redact** replaces it with `[REDACTED]`.
4. Start a 30 min focus session → exceptions wiped, per-site/master toggles locked.
5. Visit a site with Intercom/Drift → widget absent; check Activity & Monitoring.
6. Toggle dark mode in the popup → settings page follows.
7. Validate on edit: `node tools/make.mjs`, `node --check` on JS, JSON.parse on JSON.

## Roadmap

1. Signed blocklist updates from GitHub (opt-in fetch, local override, EasyList-style)
2. Per-page blocked-request report surfaced in the popup
3. Entropy-based secret detection for unknown key formats
4. Block `window.ai` / Prompt API surface exposure
