// page.extract module — 9c.
//
// Context-menu-driven. User selects text → right-click → "Send to…" →
// we capture {url, title, selected_text} and forward to bridge as
// `page.extract` with an intent token.
//
// Content-script injection is on-demand via scripting.executeScript
// (MV3). Avoids the always-on permission cost of a static content
// script — KDE Plasma's pattern.
//
// @ts-check
(function (root) {
  "use strict";
  const api = root.qdistroApi;
  const dispatcher = root.qdistroDispatcher;

  function executeInTab(tabId, func, args) {
    if (api.scripting && api.scripting.executeScript) {
      return api.scripting.executeScript({
        target: { tabId },
        func, args: args || [],
      }).then((results) => results && results[0] && results[0].result);
    }
    // MV2 / Firefox fallback (tabs.executeScript).
    return new Promise((resolve, reject) => {
      const code = `(${func.toString()})(${JSON.stringify(args || [])[0] === "[" ? (args || []).map((a) => JSON.stringify(a)).join(",") : ""})`;
      api.tabs.executeScript(tabId, { code }, (results) => {
        const err = api.runtime.lastError;
        if (err) return reject(new Error(err.message));
        resolve(results && results[0]);
      });
    });
  }

  function captureSelectionFn() {
    const sel = (window.getSelection && window.getSelection().toString()) || "";
    return {
      selected_text: sel,
      url: location.href,
      title: document.title,
    };
  }

  async function capture(tabId) {
    const captured = await executeInTab(tabId, captureSelectionFn);
    return captured || { selected_text: "", url: "", title: "" };
  }

  async function extract(tabId, destination, intentToken) {
    const captured = await capture(tabId);
    return await dispatcher.request("page.extract", {
      ...captured,
      destination: destination || null,
      intent_token: intentToken || null,
    });
  }

  // Context menu wiring — call once at boot from background.js.
  function installContextMenu() {
    if (!api.contextMenus) return;
    try {
      api.contextMenus.create({
        id: "qdistro-share-to",
        title: "Send to qdistro…",
        contexts: ["selection", "page", "link"],
      }, () => { void api.runtime.lastError; });
    } catch (_) { /* idempotent: already installed */ }

    api.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== "qdistro-share-to") return;
      if (!tab || tab.id == null) return;
      try {
        const intentToken = root.qdistroIntent
          ? await root.qdistroIntent.mint("page.extract", 5000)
          : null;
        await extract(tab.id, info.selectionText ? "selection" : "page", intentToken);
      } catch (e) {
        console.warn("[qdistro/pageExtract] failed", e);
      }
    });
  }

  root.qdistroPageExtract = { extract, capture, installContextMenu };
})(typeof self !== "undefined" ? self : globalThis);
