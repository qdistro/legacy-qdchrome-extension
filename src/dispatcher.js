// request_id-correlated dispatcher.
//
// Two flows:
//
//   1. Bridge-initiated request (daemon → bridge → extension):
//      bridge sends `{op: "tabs.list", request_id: "rN-hex"}` over
//      the port. request_id is a string (e.g. "r1-abc123"); the
//      dispatcher accepts any truthy value (`!= null`).
//      Dispatcher routes by op to a registered handler in
//      src/modules/, awaits the handler's reply payload, then sends
//      `{op: "tabs.list.reply", request_id: "rN-hex", ...payload}` back.
//      Per spec/14 Phase-9b §"Timeout behavior when MV3 service worker
//      suspends" — the bridge handles retry; we just respond.
//
//   2. Extension-initiated request (popup click → extension → bridge → daemon):
//      caller invokes `qdistroDispatcher.request("cookies.export", body)`
//      which assigns a request_id and returns a Promise. The dispatcher
//      keeps a Map<request_id, {resolve,reject,timer}> until a matching
//      `.reply` arrives.
//
// Borrowed from KDE Plasma's `SettingsManager.executeMethod` shape —
// outbound requests use integer request_ids (from nextRequestId++);
// inbound bridge-initiated requests use string request_ids (e.g.
// "r1-abc123"). Both types are accepted — the dispatcher checks
// `!= null`, not typeof. Timeouts per-request, dispose on disconnect.
//
// @ts-check
(function (root) {
  "use strict";
  const port = root.qdistroPort;
  const DEFAULT_TIMEOUT_MS = 10000;

  const handlers = new Map();       // op → async (body, identity) => replyBody
  const pending = new Map();        // request_id → {resolve, reject, timer, op}
  let nextRequestId = 1;

  function log(...args) {
    try { console.log("[qdistro/dispatch]", ...args); } catch (_) { /* SW */ }
  }

  function register(op, handler) {
    if (handlers.has(op)) {
      log(`overwriting handler for ${op}`);
    }
    handlers.set(op, handler);
  }

  async function handleInbound(msg) {
    if (!msg || typeof msg !== "object") return;
    const op = String(msg.op || "");
    if (!op) return;

    // Reply to an outbound request we initiated.
    if (op.endsWith(".reply") && msg.request_id != null) {
      const slot = pending.get(msg.request_id);
      if (!slot) {
        log("orphan reply", op, msg.request_id);
        return;
      }
      pending.delete(msg.request_id);
      if (slot.timer) clearTimeout(slot.timer);
      slot.resolve(msg);
      return;
    }

    // Inbound op from the bridge.
    const h = handlers.get(op);
    if (!h) {
      log("no handler for inbound op", op);
      if (msg.request_id != null) {
        port.send({
          op: `${op}.reply`,
          request_id: msg.request_id,
          ok: false,
          error: "unknown_op",
        });
      }
      return;
    }
    try {
      const body = (await h(msg)) || {};
      if (msg.request_id != null) {
        port.send({
          op: `${op}.reply`,
          request_id: msg.request_id,
          ok: true,
          ...body,
        });
      }
    } catch (e) {
      log("handler threw", op, e);
      if (msg.request_id != null) {
        port.send({
          op: `${op}.reply`,
          request_id: msg.request_id,
          ok: false,
          error: "handler_raised",
          detail: String(e).slice(0, 200),
        });
      }
    }
  }

  function request(op, body, opts) {
    opts = opts || {};
    const request_id = nextRequestId++;
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(request_id)) {
          pending.delete(request_id);
          reject(new Error(`timeout: ${op}`));
        }
      }, timeoutMs);
      pending.set(request_id, { resolve, reject, timer, op });
      const sent = port.send({ op, request_id, ...(body || {}) });
      if (!sent) {
        clearTimeout(timer);
        pending.delete(request_id);
        reject(new Error("port_disconnected"));
      }
    });
  }

  function _resetForTests() {
    for (const slot of pending.values()) {
      if (slot.timer) clearTimeout(slot.timer);
    }
    pending.clear();
    handlers.clear();
    nextRequestId = 1;
  }

  port.onMessage(handleInbound);

  root.qdistroDispatcher = {
    register,
    request,
    handlers,    // tests inspect
    pending,     // tests inspect
    handleInbound, // tests drive directly
    _resetForTests,
  };
})(typeof self !== "undefined" ? self : globalThis);
