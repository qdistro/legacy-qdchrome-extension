// qdistro browser-bridge background — MV3 service worker (also
// runs as MV2 background page in Firefox). Boot sequence:
//
//   1. importScripts: load api shim, port manager, dispatcher,
//      intent, then every per-feature module under modules/.
//      Each module registers its handlers on import.
//   2. Open the persistent native-messaging port. Reconnect-with-
//      backoff and the 25s heartbeat watchdog run inside port.js.
//   3. Install context menus and event listeners (downloads,
//      notifications) on the worker scope.
//   4. Handle popup → background runtime.sendMessage so the popup
//      can drive the persistent port without opening its own
//      connectNative (one host per browser session per spec/14).
//
// importScripts is the MV3-correct way to compose a service worker.
// Firefox MV2 background pages don't have importScripts; the
// build script in scripts/build-extension.sh concatenates the
// sources into a single background.js for Firefox MV2.
//
// @ts-check

try {
  // MV3 path. The build script puts these files alongside.
  // eslint-disable-next-line no-undef
  importScripts(
    "src/api.js",
    "src/port.js",
    "src/dispatcher.js",
    "src/intent.js",
    "src/modules/tabs.js",
    "src/modules/pwd.js",
    "src/modules/pageExtract.js",
    "src/modules/cookies.js",
    "src/modules/mpris.js",
    "src/modules/downloads.js",
    "src/modules/notifications.js",
    "src/modules/screenlock.js",
  );
} catch (_) {
  // MV2 path (Firefox background page) — the build concatenates,
  // so all globals are already defined.
}

const api = self.qdistroApi;

function bootOnce() {
  if (self.__qdistroBooted) return;
  self.__qdistroBooted = true;

  // Wire context menu (9c).
  if (self.qdistroPageExtract) {
    self.qdistroPageExtract.installContextMenu();
  }
  // Wire downloads listener (9e-2).
  if (self.qdistroDownloads) self.qdistroDownloads.install();
  // Wire notification listeners (9e-3).
  if (self.qdistroNotifications) self.qdistroNotifications.install();

  // Open the persistent port.
  self.qdistroPort.connect();
}

// onStartup fires when the browser launches; onInstalled fires on
// install/update. Either way we boot exactly once per worker
// lifetime. SW restarts re-execute this file, so __qdistroBooted
// re-initializes — that's the intended shape.
if (api && api.runtime && api.runtime.onStartup) {
  api.runtime.onStartup.addListener(bootOnce);
}
if (api && api.runtime && api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener(bootOnce);
}

// MV3 cold-start: the worker wakes on an event (e.g. a popup
// sendMessage), past onStartup. Boot inline so the port is ready.
bootOnce();

// Popup ↔ background channel. Popup never owns its own
// connectNative — one host per session.
if (api && api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    (async () => {
      try {
        if (!req || typeof req !== "object") {
          sendResponse({ ok: false, error: "bad_request" });
          return;
        }
        switch (req.kind) {
          case "status": {
            sendResponse({
              ok: true,
              connected: self.qdistroPort.isConnected(),
            });
            return;
          }
          case "ping": {
            const r = await self.qdistroDispatcher.request("qdistro.ping", {
              echo: String(Date.now()),
            }, { timeoutMs: 5000 });
            sendResponse({ ok: true, response: r });
            return;
          }
          case "cookies.export": {
            const intent = self.qdistroIntent.mint("cookies.export");
            const r = await self.qdistroCookies.exportForUrl(req.url, intent);
            sendResponse({ ok: true, response: r });
            return;
          }
          default:
            sendResponse({ ok: false, error: "unknown_kind" });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true; // keep sendResponse channel open for async reply
  });
}
