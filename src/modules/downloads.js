// downloads module — 9e-2.
//
// Listens to chrome.downloads.onChanged and forwards state
// transitions (start / progress / complete / interrupted) to the
// bridge as `downloads.update`. The bridge re-exposes these on
// qbus-admin so the admin notification area can show downloads
// across users.
//
// Permission: `downloads` (manifest).
//
// @ts-check
(function (root) {
  "use strict";
  const api = root.qdistroApi;
  const dispatcher = root.qdistroDispatcher;

  function snapshot(item) {
    if (!item) return null;
    return {
      id: item.id,
      url: item.url || item.finalUrl || "",
      filename: item.filename || "",
      state: item.state || "in_progress",
      total_bytes: item.totalBytes || 0,
      bytes_received: item.bytesReceived || 0,
      mime: item.mime || "",
      start_time: item.startTime || null,
    };
  }

  function install() {
    if (!api.downloads || !api.downloads.onChanged) return;
    api.downloads.onChanged.addListener((delta) => {
      // Resolve the full item then forward; the delta alone is sparse.
      api.downloads.search({ id: delta.id }, (items) => {
        if (api.runtime.lastError) return;
        const item = items && items[0];
        if (!item) return;
        dispatcher.request("downloads.update", snapshot(item))
          .catch(() => { /* fire-and-forget */ });
      });
    });
  }

  root.qdistroDownloads = { install, snapshot };
})(typeof self !== "undefined" ? self : globalThis);
