// mpris module — 9e-1.
//
// Listens for media-session metadata in tabs (Web Media Session API
// via a content script on demand) and forwards play/pause/track to
// the bridge as `mpris.update`. Receives bridge-initiated
// `mpris.control` ops (play/pause/next/prev) and translates them
// into tab.executeScript calls on the active media tab.
//
// Stub-grade: the content-script media observer is non-trivial
// (cross-frame, autoplay-policy, etc.); we wire the dispatch shape
// and inbound handler so the bridge side can land independently.
//
// @ts-check
(function (root) {
  "use strict";
  const dispatcher = root.qdistroDispatcher;

  // Inbound: bridge tells us to control playback.
  dispatcher.register("mpris.control", async (msg) => {
    // STUB: real implementation locates the active media tab and
    // dispatches navigator.mediaSession actions or HTMLMediaElement
    // .play()/.pause() via tabs.executeScript.
    return { ok: true, action: String(msg.action || ""), stub: true };
  });

  // Outbound helper for the (future) content-script observer.
  function update(payload) {
    return dispatcher.request("mpris.update", payload || {});
  }

  root.qdistroMpris = { update };
})(typeof self !== "undefined" ? self : globalThis);
