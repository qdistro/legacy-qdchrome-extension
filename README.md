# qdchrome-extension

Chromium MV3 WebExtension and native-messaging client for the qdistro browser
bridge. It is the Chromium-family peer of
[qdfirefox-extension](../qdfirefox-extension): same bridge contract, but without
Firefox containers/contextual identities.

## Role in qdistro

qdistro treats browsers as silo-facing applications, not as a trusted control
plane. This extension is the browser-side adapter that lets the qdistro browser
bridge coordinate tabs, password-vault prompts, page extraction, media status,
downloads, notifications, and screen-lock inhibition for Chromium-based
browsers.

It is not a replacement for [qdbrowser](../qdbrowser). qdbrowser is the
first-party Qt browser with direct qdistro integration. qdchrome-extension is
for Chromium/Chrome when compatibility with the upstream browser engine is
needed.

## Status

v0.2.0. The extension includes bridge modules for tabs, password fill/save,
page extraction, cookie export, MPRIS/media status, downloads, notifications,
and screen-lock inhibition. Tests are Vitest-based and run against synthetic
browser APIs.

Security-sensitive flows are still being aligned with the current qdistro
security model. In particular, password fill and cookie export should be treated
as privileged bridge operations that require trusted UI/bridge policy before any
user-facing install ships.

## Build

```bash
npm install
npm run build
```

The build script writes unpacked browser trees under `dist/`.

## Test

```bash
npm test
```

## Install (development)

```bash
python3 ../qdistro/browser_bridge/qdistro_browser_install.py \
  --browsers chromium \
  --bridge-path /path/to/qdistro-browser-bridge
```

Then load the unpacked extension from `dist/chromium/` in
`chrome://extensions` or `chromium://extensions` with developer mode enabled.
For system installs, `scripts/install-system-policy.sh` writes the Chromium
enterprise policy that force-installs the packed extension.

## Permissions

The extension is a bridge adapter; its permission set is pinned to the
minimal set the frozen v1 op set actually uses (see
`tests/manifest.test.js`):

| Permission | Why |
| --- | --- |
| `nativeMessaging` | Talk to the qdistro browser bridge |
| `tabs` | Enumerate and operate on browser tabs across windows |
| `cookies` | Export cookies through a gated bridge operation |
| `downloads` | Report download lifecycle updates |
| `notifications` | Show notifications requested by the bridge |
| `contextMenus` | Provide "Send to qdistro..." style actions |
| `scripting`, `<all_urls>` | Page extraction and content observers |
| `storage` | Options page state |

`activeTab` (redundant with the `<all_urls>` host grant + `tabs`) and
`webNavigation` (no navigation listener exists in `src/`) were dropped
under S8 P0-5. New permissions require updating the closed-set test after a
security review.

## Architecture

```
qdchrome-extension/
├── manifest.chromium.json
├── src/
│   ├── api.js                   # browser/chrome binding layer
│   ├── port.js                  # native-messaging connection
│   ├── dispatcher.js            # request_id-correlated dispatch
│   ├── intent.js                # short-lived privileged-op token
│   ├── background.js            # MV3 service worker
│   ├── popup.html/js
│   ├── options.html/js
│   ├── content/
│   │   ├── pwd-content.js
│   │   ├── mpris-content.js
│   │   └── screenlock-content.js
│   └── modules/
│       ├── tabs.js
│       ├── pwd.js
│       ├── pageExtract.js
│       ├── cookies.js
│       ├── mpris.js
│       ├── downloads.js
│       ├── notifications.js
│       └── screenlock.js
├── scripts/
│   ├── build-extension.sh
│   └── install-system-policy.sh
└── tests/
```

## Chromium-only — no Firefox build here

This repo builds the Chromium-family extension only. It used to also emit a
Firefox MV2 `dist/firefox.xpi` under gecko id `qdistro@qdistro.local`, but that
collided with the **bundled** Firefox extension shipped from
`../qdistro/browser_bridge/extension` (a different codebase under the *same*
id). To canonicalize the Firefox artifacts, that target was removed. Ship
Firefox from one of its two canonical sources instead:

- **standalone** — [qdfirefox-extension](../qdfirefox-extension), id
  `qdistro-firefox@qdistro.local` (MV3, first-class containers).
- **bundled** — `../qdistro/browser_bridge/extension`, id
  `qdistro@qdistro.local` (the MV2 build the browser-bridge installer
  authorizes by default).

See `../qdistro/doc/browser.md` ("Firefox extension artifacts") for the full
bundled-vs-standalone contract.

## Related repos

- [qdistro](../qdistro) contains the native browser bridge daemon and the
  architecture/security docs.
- [qdfirefox-extension](../qdfirefox-extension) is the Firefox-native extension
  with contextual-identity support.
- [qdbrowser](../qdbrowser) is the first-party Qt browser.
