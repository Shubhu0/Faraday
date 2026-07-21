# Publishing Faraday to every browser

One codebase, one zip per store. Build them with:

```
node tools/make.mjs
powershell -Command "Compress-Archive -Path dist/chromium/* -DestinationPath store/faraday-chromium-0.2.0.zip -Force"
powershell -Command "Compress-Archive -Path dist/firefox/*  -DestinationPath store/faraday-firefox-0.2.0.zip  -Force"
```

Assets are ready in `store/`: screenshots (1280×800), listing copy and permission justifications (`store/listing.md`), privacy policy (`PRIVACY.md` — use its GitHub URL as the "privacy policy URL" in every form).

Version bumps: edit `version` in all three `platform/*/manifest.json` (keep in lockstep), rebuild, re-zip, upload.

---

## Chrome Web Store (Chrome, Brave, Vivaldi users)

1. Register a developer account at https://chrome.google.com/webstore/devconsole ($5 one-time fee).
2. "New item" → upload `store/faraday-chromium-0.2.0.zip`.
3. Fill the listing from `store/listing.md`; upload screenshots; set the privacy policy URL.
4. Complete the "Privacy practices" tab: no data collected, no remote code; paste the permission justifications.
5. Submit for review. First review typically takes a few days; broad host permissions can add scrutiny — the justifications above address it.

## Microsoft Edge Add-ons

1. Register (free) at https://partner.microsoft.com/dashboard/microsoftedge.
2. Upload the **same** chromium zip. Same listing text, same screenshots.
3. Review is usually fast (1–3 days).

## Firefox Add-ons (AMO)

1. Create a free account at https://addons.mozilla.org and open https://addons.mozilla.org/developers/.
2. Submit `store/faraday-firefox-0.2.0.zip` ("On this site" = listed).
3. There is no build step, so no source-code package is needed — the zip *is* the source.
4. Before or after: users must grant host permissions (Firefox makes them optional). This is already documented in the README install section.
5. Optional local pre-check: `npx web-ext lint --source-dir dist/firefox`.

## Opera Add-ons

1. Free account at https://addons.opera.com/developer/.
2. Upload the chromium zip. (Opera users can also install straight from the Chrome Web Store.)

## Safari (macOS/iOS)

Requires a Mac + Apple Developer Program membership ($99/year):

1. `xcrun safari-web-extension-converter dist/safari --project-location safari-xcode`
2. Open the generated Xcode project, set your team/bundle ID, archive, and submit through App Store Connect like any app.
3. Marked experimental until tested on real Safari — do this last.

---

## Self-hosting for users who avoid stores

The GitHub Releases page can carry the zips from `store/`. Chromium users can load them unpacked; Firefox users need the AMO-signed build (unsigned zips only load temporarily) — AMO can produce "unlisted" signed builds if you ever want GitHub-only distribution.

## Release checklist

- [ ] `node tools/make.mjs` clean, `node --check` on all JS
- [ ] Manifest versions bumped in lockstep (×3)
- [ ] Manual smoke test: block, per-site toggle, focus lockout, DLP modal, both themes
- [ ] Zips rebuilt, uploaded to each store + GitHub Release
- [ ] Tag: `git tag v<version> && git push --tags`
