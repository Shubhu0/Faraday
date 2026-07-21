# Store listing copy

Reusable text for every store. Keep all stores in sync when editing.

## Name

Faraday — AI Data Privacy Blocker

## Short summary (Chrome limit: 132 chars)

Block AI platforms and scrapers, remove embedded AI chatbots, and stop sensitive data from leaving your browser. 100% local.

## Description

Faraday gives you sessions that are private from AI — with the freedom to be AI-free for a while.

**Three layers of protection, all local:**

🛡 **Network blocking** — ~35 AI platforms (ChatGPT, Claude, Gemini, Copilot, Perplexity and more) and the embedded assistant SDKs that third-party sites inject (Intercom, Drift, Ada, Tidio, Voiceflow, Chatbase, Botpress) are blocked natively by the browser's rule engine. Zero overhead.

🧹 **Widget removal** — AI chat bubbles are swept off pages as they load, including late-injected ones.

🔒 **Sensitive-data guard** — pastes and messages on AI sites are scanned for emails, card numbers, API keys, JWTs and private keys before they're sent. Redact with one click. Scanned text is never stored or transmitted.

**You stay in control:**

- Master switch, plus a per-site toggle. Turning a site off lasts one hour by default — protection quietly comes back.
- Focus sessions wipe all exceptions and lock them until the timer ends. No early exit, by design.
- A local data monitor shows what tried to reach AI backends today, with a risk level and a full activity log.
- Light and dark, follows your system.

**Radically private:** Faraday makes zero network requests of its own. No telemetry, no analytics, no remote config, no accounts. Everything — settings, exceptions, activity log — stays in your browser. The code is open source.

**Honest limits:** Faraday is client-side. It covers browser→AI traffic, embedded widgets, and accidental pastes. No extension can stop a website's own servers from forwarding data to AI backends, or AI inside native apps — and we'll never claim otherwise.

## Category

- Chrome Web Store: Privacy & Security
- Edge Add-ons: Privacy
- Firefox AMO: Privacy & Security

## Privacy-practices answers (Chrome "data usage" form)

- Collects user data: **No** (all categories: not collected)
- Remote code: **No**
- Single purpose: "Blocks AI platforms, widgets, and accidental sensitive-data leaks to AI services, locally."

## Permission justifications (paste into review forms)

- `declarativeNetRequest`: Core blocking of AI platform and SDK domains via static/dynamic rules.
- `declarativeNetRequestFeedback` (Chromium): Feeds the local, on-device activity log of blocked requests. No data leaves the device.
- `webRequest` (Firefox): Observation only — feeds the same local activity log and toolbar badge; blocking itself is done by declarativeNetRequest.
- `storage`: Stores settings, per-site exceptions, and the local activity log on-device.
- `alarms`: Expires timed per-site exceptions and ends focus sessions.
- `tabs`: Reads the active tab's domain for the per-site toggle; resets the badge on navigation.
- Host permissions `<all_urls>`: The widget remover and sensitive-data guard must run on any site, since embedded AI widgets can appear anywhere. No page data is transmitted anywhere.
