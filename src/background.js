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

// Handshake fires on every (re)connect — the bridge rotates its
// session secret on each launch, so a stale extension secret won't
// pass verify_intent_token. Privileged-op sites await
// qdistroIntent.hasSession() before mint().
async function runHandshake() {
  try {
    const reply = await self.qdistroDispatcher.request("qdistro.handshake", {
      proto_version: 1,
    }, { timeoutMs: 5000 });
    if (reply && reply.ok && typeof reply.session_secret_hex === "string") {
      self.qdistroIntent.setSessionSecretHex(reply.session_secret_hex);
    } else {
      console.warn("[qdistro/background] handshake reply missing secret", reply);
    }
  } catch (e) {
    console.warn("[qdistro/background] handshake failed", e && e.message);
  }
}

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

  // Handshake on every (re)connect.
  self.qdistroPort.onConnected(runHandshake);

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

// Per-tab screenlock-inhibit accounting. The compositor's
// idle-inhibit protocol is reference-counted on the bridge side,
// but we still clean up here if a tab vanishes without firing
// pagehide (crashed renderer, kill -9 of the tab process).
const screenlockTabs = new Set();
if (api && api.tabs && api.tabs.onRemoved) {
  api.tabs.onRemoved.addListener((tabId) => {
    if (screenlockTabs.delete(tabId) && self.qdistroScreenlock) {
      self.qdistroScreenlock.release("tab_removed").catch(() => {});
    }
  });
}

// Popup ↔ background channel. Popup never owns its own
// connectNative — one host per session.
if (api && api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((req, sender, sendResponse) => {
    // Reject anything that isn't our own popup/options page or one
    // of our content scripts. Without `externally_connectable` in
    // the manifest, Chromium already refuses cross-extension and
    // page-context sendMessage calls; this is defense-in-depth so a
    // compromised content script of another extension that somehow
    // reaches us can't drive the bridge.
    if (!sender || sender.id !== api.runtime.id) {
      sendResponse({ ok: false, error: "untrusted_sender" });
      return false;
    }
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
            const intent = await self.qdistroIntent.mint("cookies.export");
            const r = await self.qdistroCookies.exportForUrl(req.url, intent);
            sendResponse({ ok: true, response: r });
            return;
          }

          // ---- content-script entry points ---------------------------
          // Each mints/forwards an intent token where the bridge
          // requires one; tokens carry hmac=null in MVP (see
          // todo/01-intent-tokens.md).

          case "pwd.request_fill": {
            const intent = await self.qdistroIntent.mint("pwd.fill");
            const r = await self.qdistroPwd.fill(
              req.url || (sender.url || ""),
              req.username || null,
              intent,
            );
            sendResponse({ ok: true, response: r });
            return;
          }
          case "pwd.request_save": {
            const intent = await self.qdistroIntent.mint("pwd.save");
            const r = await self.qdistroPwd.save(
              req.url || (sender.url || ""),
              req.username || null,
              req.password || "",
              intent,
            );
            sendResponse({ ok: true, response: r });
            return;
          }
          case "mpris.report_update": {
            // Fire-and-forget — the page polls 1Hz; we don't want
            // the content script blocked waiting on a wire ack.
            self.qdistroMpris.update({
              title: req.title || "",
              artist: req.artist || "",
              album: req.album || "",
              art_url: req.art_url || "",
              state: req.state || "none",
              position: typeof req.position === "number" ? req.position : null,
              duration: typeof req.duration === "number" ? req.duration : null,
              url: req.url || (sender.url || ""),
              tab_id: (sender.tab && sender.tab.id) || null,
            }).catch(() => {});
            sendResponse({ ok: true });
            return;
          }
          case "screenlock.report_inhibit": {
            const tabId = sender.tab && sender.tab.id;
            if (typeof tabId === "number") screenlockTabs.add(tabId);
            self.qdistroScreenlock.inhibit(req.reason || "fullscreen_video")
              .catch(() => {});
            sendResponse({ ok: true });
            return;
          }
          case "screenlock.report_release": {
            const tabId = sender.tab && sender.tab.id;
            if (typeof tabId === "number") screenlockTabs.delete(tabId);
            self.qdistroScreenlock.release(req.reason || "fullscreen_exit")
              .catch(() => {});
            sendResponse({ ok: true });
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
