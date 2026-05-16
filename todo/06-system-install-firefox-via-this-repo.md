# 06 — System-level injection of the Firefox build from this repo

## Why exist

`scripts/build-extension.sh` already emits `dist/firefox.xpi` (MV2, concatenated background). Some qdistro images may prefer to ship that artifact rather than maintain qdfirefox-extension separately. This doc covers what that injection looks like.

**Preferred path for qdistro images**: use **qdfirefox-extension** (the MV3 Firefox-native sibling repo) instead of this repo's MV2 xpi. The MV2 build here is a build-target convenience, not a recommended production artifact — Firefox MV2 sunset is scheduled and the chrome.* shim is more fragile than browser.* Promise API. See `../../qdfirefox-extension/todo/01-system-install-firefox.md` for the supported flow.

## What still works if you ship the MV2 xpi

The Firefox-side mechanism is identical (`policies.json` + `ExtensionSettings`); only the artifact and extension ID differ.

```json
{
  "policies": {
    "ExtensionSettings": {
      "qdistro@qdistro.local": {
        "installation_mode": "force_installed",
        "install_url": "file:///usr/share/qdistro/extensions/qdchrome-firefox.xpi"
      }
    }
  }
}
```

Note: the extension ID (`qdistro@qdistro.local`) differs from qdfirefox-extension's (`qdistro-firefox@qdistro.local`). Don't ship both system-installed — the native host's `allowed_extensions` only accepts one ID per manifest, and shipping two manifests under the same `name` will collide.

## Signing wall

Same as the Firefox-native repo: release Firefox refuses unsigned xpis regardless of install mechanism. Either:

- AMO sign via `web-ext sign` (works with MV2), or
- Custom Firefox build with `MOZ_REQUIRE_SIGNING=` empty.

## Concrete deliverables (only if this path is taken)

Mirror of the qdfirefox-extension scripts, but targeting this repo's `dist/firefox.xpi` and the `qdistro@qdistro.local` extension ID:

1. `scripts/install-system-policy.sh` (Firefox).
2. `scripts/install-native-host.sh --system --firefox`.
3. Image-pipeline integration.

## Recommendation

Skip this track. Ship qdfirefox-extension for Firefox, qdchrome-extension for Chromium. See [05-system-install-chromium.md](05-system-install-chromium.md) for the Chromium-side this repo actually wants to do.
