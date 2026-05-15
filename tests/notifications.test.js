// notifications module tests — onClicked/onClosed forwarding,
// inbound notifications.show, fallback when chrome.notifications is
// missing.
//
// Note on per-origin allowlist: the current source does not enforce
// one; that policy lives on the bridge per spec/14. These tests
// pin the wire shape so the daemon can enforce safely.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension, makeFakeChrome, makeFakePort } from "./helpers.js";

describe("qdistroNotifications", () => {
  let env;
  let chrome;
  let createCalls;

  beforeEach(() => {
    chrome = makeFakeChrome();
    createCalls = [];
    chrome.notifications.create = (id, opts, cb) => {
      createCalls.push({ id, opts });
      if (cb) cb("notif-generated");
    };
    env = loadExtension({ chrome, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  function lastOutbound(op) {
    return env.port.sent.find((m) => m.op === op);
  }

  it("exposes qdistroNotifications.install", () => {
    expect(env.scope.qdistroNotifications).toBeTruthy();
    expect(typeof env.scope.qdistroNotifications.install).toBe("function");
  });

  it("install() registers onClicked and onClosed listeners", () => {
    env.scope.qdistroNotifications.install();
    expect(chrome.notifications.onClicked.listeners.length).toBe(1);
    expect(chrome.notifications.onClosed.listeners.length).toBe(1);
  });

  it("install() is a no-op when chrome.notifications is missing", () => {
    chrome.notifications = undefined;
    const env2 = loadExtension({ chrome, portHandle: makeFakePort() });
    expect(() => env2.scope.qdistroNotifications.install()).not.toThrow();
  });

  it("onClicked fires a notifications.event frame with kind:'clicked'", () => {
    env.scope.qdistroNotifications.install();
    chrome.notifications.onClicked.fire("nf-1");
    const frame = lastOutbound("notifications.event");
    expect(frame).toBeTruthy();
    expect(frame.kind).toBe("clicked");
    expect(frame.notification_id).toBe("nf-1");
  });

  it("onClosed fires a notifications.event frame with kind:'closed' and by_user", () => {
    env.scope.qdistroNotifications.install();
    chrome.notifications.onClosed.fire("nf-2", true);
    const frame = lastOutbound("notifications.event");
    expect(frame).toBeTruthy();
    expect(frame.kind).toBe("closed");
    expect(frame.notification_id).toBe("nf-2");
    expect(frame.by_user).toBe(true);
  });

  it("onClosed coerces falsy by_user to boolean false", () => {
    env.scope.qdistroNotifications.install();
    chrome.notifications.onClosed.fire("nf-3", undefined);
    const frame = lastOutbound("notifications.event");
    expect(frame.by_user).toBe(false);
  });

  it("registers an inbound notifications.show handler", () => {
    expect(env.scope.qdistroDispatcher.handlers.has("notifications.show")).toBe(true);
  });

  it("notifications.show calls chrome.notifications.create with the right opts", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "notifications.show",
      request_id: 1,
      title: "Hello",
      message: "World",
      icon_url: "icons/x.png",
    });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].opts).toMatchObject({
      type: "basic",
      title: "Hello",
      message: "World",
      iconUrl: "icons/x.png",
    });
    const reply = lastOutbound("notifications.show.reply");
    expect(reply.ok).toBe(true);
    expect(reply.notification_id).toBe("notif-generated");
  });

  it("notifications.show defaults the icon when icon_url is missing", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "notifications.show",
      request_id: 2,
      title: "T", message: "M",
    });
    expect(createCalls[0].opts.iconUrl).toBe("icons/icon-48.png");
  });

  it("notifications.show coerces missing title/message to safe defaults", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "notifications.show", request_id: 3,
    });
    expect(createCalls[0].opts.title).toBe("qdistro");
    expect(createCalls[0].opts.message).toBe("");
  });

  it("notifications.show returns notifications_unavailable when API is missing", async () => {
    chrome.notifications = undefined;
    const env2 = loadExtension({ chrome, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    await env2.scope.qdistroDispatcher.handleInbound({
      op: "notifications.show", request_id: 1,
      title: "T", message: "M",
    });
    const reply = env2.port.sent.find((m) => m.op === "notifications.show.reply");
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("notifications_unavailable");
  });

  it("multiple clicks generate distinct request_ids", () => {
    env.scope.qdistroNotifications.install();
    chrome.notifications.onClicked.fire("a");
    chrome.notifications.onClicked.fire("b");
    const frames = env.port.sent.filter((m) => m.op === "notifications.event");
    expect(frames).toHaveLength(2);
    expect(frames[0].request_id).not.toBe(frames[1].request_id);
  });

  it("does not crash if onClicked is missing on chrome.notifications", () => {
    chrome.notifications = { onClosed: chrome.notifications.onClosed, create: chrome.notifications.create };
    const env2 = loadExtension({ chrome, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    expect(() => env2.scope.qdistroNotifications.install()).not.toThrow();
  });
});
