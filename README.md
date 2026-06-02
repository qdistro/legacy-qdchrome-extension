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

The extension requests broad permissions because it is a bridge adapter:

| Permission | Why |
| --- | --- |
| `nativeMessaging` | Talk to the qdistro browser bridge |
| `tabs`, `activeTab` | Enumerate and operate on browser tabs |
| `cookies` | Export cookies through a gated bridge operation |
| `downloads` | Report download lifecycle updates |
| `notifications` | Show notifications requested by the bridge |
| `contextMenus` | Provide "Send to qdistro..." style actions |
| `scripting`, `<all_urls>` | Page extraction and content observers |
| `webNavigation` | Navigation context for page operations |
| `storage` | Options page state |

## Architecture

```
qdchrome-extension/
├── manifest.chromium.json
├── manifest.firefox.json        # legacy compatibility build target
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

## Related repos

- [qdistro](../qdistro) contains the native browser bridge daemon and the
  architecture/security docs.
- [qdfirefox-extension](../qdfirefox-extension) is the Firefox-native extension
  with contextual-identity support.
- [qdbrowser](../qdbrowser) is the first-party Qt browser.
