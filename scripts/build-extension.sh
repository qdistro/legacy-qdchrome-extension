#!/bin/bash
# Build qdchrome-extension into per-browser layouts under dist/.
#
# Outputs:
#   dist/chromium/        unpacked MV3 tree (uses importScripts)
#   dist/firefox/         unpacked MV2 tree (concatenated bundle)
#   dist/chromium.zip     packed for `chrome.runtime.installFromZip`
#   dist/firefox.xpi      packed for Firefox AMO submission
#
# Chromium MV3 uses importScripts(...) in the service worker so we
# can ship the source tree as-is. Firefox MV2 background pages don't
# support importScripts at the path layout we need; we concatenate
# src/*.js into a single background.bundle.js for that target.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$HERE/dist"

rm -rf "$DIST"
mkdir -p "$DIST/chromium/src/modules" "$DIST/firefox"

# --- Chromium MV3 -----------------------------------------------------
cp "$HERE/manifest.chromium.json" "$DIST/chromium/manifest.json"
# The service worker (background.js) lives at the extension root; its
# importScripts paths are relative to that root.
cp "$HERE/src/background.js" "$DIST/chromium/background.js"
cp "$HERE/src/popup.html"    "$DIST/chromium/popup.html"
cp "$HERE/src/popup.js"      "$DIST/chromium/popup.js"
cp "$HERE/src/options.html"  "$DIST/chromium/options.html"
cp "$HERE/src/options.js"    "$DIST/chromium/options.js"
cp "$HERE/src/api.js"        "$DIST/chromium/src/api.js"
cp "$HERE/src/port.js"       "$DIST/chromium/src/port.js"
cp "$HERE/src/dispatcher.js" "$DIST/chromium/src/dispatcher.js"
cp "$HERE/src/intent.js"     "$DIST/chromium/src/intent.js"
cp "$HERE"/src/modules/*.js  "$DIST/chromium/src/modules/"
cp -r "$HERE/icons"          "$DIST/chromium/icons"

# --- Firefox MV2 ------------------------------------------------------
# Concatenate sources (order matters: api → port → dispatcher → intent
# → modules → background-without-importScripts). The catch in
# background.js swallows the importScripts call when it's undefined.
cp "$HERE/manifest.firefox.json" "$DIST/firefox/manifest.json"
cp "$HERE/src/popup.html"        "$DIST/firefox/popup.html"
cp "$HERE/src/popup.js"          "$DIST/firefox/popup.js"
cp "$HERE/src/options.html"      "$DIST/firefox/options.html"
cp "$HERE/src/options.js"        "$DIST/firefox/options.js"
cp -r "$HERE/icons"              "$DIST/firefox/icons"

{
    echo "// === qdistro background bundle — concatenated by build-extension.sh ==="
    for f in \
        "$HERE/src/api.js" \
        "$HERE/src/port.js" \
        "$HERE/src/dispatcher.js" \
        "$HERE/src/intent.js" \
        "$HERE/src/modules/tabs.js" \
        "$HERE/src/modules/pwd.js" \
        "$HERE/src/modules/pageExtract.js" \
        "$HERE/src/modules/cookies.js" \
        "$HERE/src/modules/mpris.js" \
        "$HERE/src/modules/downloads.js" \
        "$HERE/src/modules/notifications.js" \
        "$HERE/src/modules/screenlock.js" \
        "$HERE/src/background.js"; do
        echo ""
        echo "// --- $(basename "$f") ---"
        cat "$f"
    done
} > "$DIST/firefox/background.bundle.js"

# --- Zip both ---------------------------------------------------------
if ! command -v zip >/dev/null 2>&1; then
    echo "[build-extension] zip not installed; unpacked trees written" >&2
    exit 0
fi
( cd "$DIST/chromium" && zip -qr "$DIST/chromium.zip" . )
( cd "$DIST/firefox"  && zip -qr "$DIST/firefox.xpi"  . )

echo "[build-extension] OK"
ls -la "$DIST"
