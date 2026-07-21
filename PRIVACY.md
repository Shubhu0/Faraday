# Faraday Privacy Policy

**Last updated: July 19, 2026**

Faraday is built on one principle: your data stays on your device.

## What Faraday collects

**Nothing.** Faraday collects no data, transmits no data, and has no servers.

- **No telemetry or analytics.** The extension contains no tracking code of any kind.
- **No network requests.** Faraday itself never talks to the internet — no remote configuration, no update pings, no CDN assets.
- **No accounts.** There is nothing to sign up for.

## What Faraday stores (locally only)

Faraday keeps a small amount of state in your browser's extension storage, on your device:

- Your settings (which protection layers are on, theme preference)
- Your per-site exceptions and custom blocked domains
- Counters (widgets removed, data-guard warnings)
- A local activity log of blocked attempts (capped at 200 entries), viewable and clearable in Settings → Activity & Monitoring

This data never leaves your browser. Uninstalling the extension deletes it.

## The sensitive-data guard

When the guard scans a paste or message for things like card numbers and API keys, the scan happens synchronously in the page, in memory. The scanned text is **never stored and never transmitted** — not to us (we have no servers), not to anyone.

## Permissions

Every permission Faraday requests is justified in the [README](README.md#permissions--why-each-one-is-needed). None of them are used to read or move your data anywhere.

## Changes

Any change to this policy will appear in this file's git history — which is public and auditable, like the rest of the code.

## Contact

Open an issue on the GitHub repository.
