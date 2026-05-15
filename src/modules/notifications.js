// notifications module — 9e-3.
//
// Listens to chrome.notifications.onClicked / onClosed and forwards
// to the bridge as `notifications.event`. The bridge applies the
// per-origin policy and surfaces approved notifications via the
// compositor.
//
// Note: the chrome.notifications API only surfaces extension-owned
// notifications, not the page-level Notification API. To intercept
// the latter we'd need a content-script Notification polyfill,
// which is intrusive — deferred.
//
// @ts-check
(function (root) {
  "use strict";
  const api = root.qdistroApi;
  const dispatcher = root.qdistroDispatcher;

  function install() {
    if (!api.notifications) return;
    if (api.notifications.onClicked) {
      api.notifications.onClicked.addListener((notificationId) => {
        dispatcher.request("notifications.event", {
          kind: "clicked", notification_id: notificationId,
        }).catch(() => {});
      });
    }
    if (api.notifications.onClosed) {
      api.notifications.onClosed.addListener((notificationId, byUser) => {
        dispatcher.request("notifications.event", {
          kind: "closed", notification_id: notificationId,
          by_user: !!byUser,
        }).catch(() => {});
      });
    }
  }

  // Inbound: bridge wants us to show a notification.
  dispatcher.register("notifications.show", async (msg) => {
    if (!api.notifications || !api.notifications.create) {
      return { ok: false, error: "notifications_unavailable" };
    }
    return await new Promise((resolve) => {
      api.notifications.create("", {
        type: "basic",
        iconUrl: msg.icon_url || "icons/icon-48.png",
        title: String(msg.title || "qdistro"),
        message: String(msg.message || ""),
      }, (id) => {
        resolve({ notification_id: id });
      });
    });
  });

  root.qdistroNotifications = { install };
})(typeof self !== "undefined" ? self : globalThis);
