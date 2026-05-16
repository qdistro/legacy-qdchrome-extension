// page.extract module tests — context menu registration, click flow,
// page.extract frame shape, intent-token forwarding, broker-denied
// reply handling.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension, makeFakeChrome, makeFakePort, makeEvent } from "./helpers.js";

describe("qdistroPageExtract", () => {
  let env;
  let chrome;
  let menuCreated;
  let executedFns;

  beforeEach(() => {
    chrome = makeFakeChrome();
    menuCreated = [];
    chrome.contextMenus.create = (def, cb) => {
      menuCreated.push(def);
      if (cb) cb();
    };
    executedFns = [];
    chrome.scripting.executeScript = (opts) => {
      executedFns.push(opts);
      // Simulate the content-script returning the captured selection.
      return Promise.resolve([{
        result: {
          selected_text: "highlighted",
          url: "https://page.example/article",
          title: "Article",
        },
      }]);
    };
    env = loadExtension({ chrome, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  function lastOutbound(op) {
    return env.port.sent.find((m) => m.op === op);
  }

  it("exposes qdistroPageExtract", () => {
    expect(env.scope.qdistroPageExtract).toBeTruthy();
    expect(typeof env.scope.qdistroPageExtract.installContextMenu).toBe("function");
  });

  it("installContextMenu registers the 'Send to qdistro…' item", () => {
    env.scope.qdistroPageExtract.installContextMenu();
    expect(menuCreated).toHaveLength(1);
    expect(menuCreated[0]).toMatchObject({
      id: "qdistro-share-to",
      title: "Send to qdistro…",
    });
    expect(menuCreated[0].contexts).toEqual(
      expect.arrayContaining(["selection", "page", "link"]));
  });

  it("ignores clicks for other menu items", async () => {
    env.scope.qdistroPageExtract.installContextMenu();
    await chrome.contextMenus.onClicked.fire(
      { menuItemId: "other-item", selectionText: "hi" },
      { id: 7 });
    // No outbound frame.
    expect(env.port.sent.find((m) => m.op === "page.extract")).toBeUndefined();
  });

  it("ignores clicks without a tab id", async () => {
    env.scope.qdistroPageExtract.installContextMenu();
    await chrome.contextMenus.onClicked.fire(
      { menuItemId: "qdistro-share-to", selectionText: "hi" },
      null);
    expect(env.port.sent.find((m) => m.op === "page.extract")).toBeUndefined();
  });

  it("extract() captures selection and forwards a page.extract frame", async () => {
    void env.scope.qdistroPageExtract.extract(42, "selection", {
      operation: "page.extract", nonce: "n-1",
    });
    // executeScript runs async; wait a microtask.
    await new Promise((r) => setTimeout(r, 0));
    const frame = lastOutbound("page.extract");
    expect(frame).toBeTruthy();
    expect(frame).toMatchObject({
      selected_text: "highlighted",
      url: "https://page.example/article",
      title: "Article",
      destination: "selection",
    });
    expect(frame.intent_token).toMatchObject({ operation: "page.extract" });
  });

  it("executes the capture function in the target tab", async () => {
    void env.scope.qdistroPageExtract.extract(99, "page", null);
    await new Promise((r) => setTimeout(r, 0));
    expect(executedFns).toHaveLength(1);
    expect(executedFns[0].target).toEqual({ tabId: 99 });
    expect(typeof executedFns[0].func).toBe("function");
  });

  it("falls back to empty selection when the content script returns nothing", async () => {
    chrome.scripting.executeScript = () => Promise.resolve([{ result: undefined }]);
    const p = env.scope.qdistroPageExtract.capture(5);
    const cap = await p;
    expect(cap).toEqual({ selected_text: "", url: "", title: "" });
  });

  it("click on selection mints an intent token scoped to page.extract", async () => {
    env.scope.qdistroPageExtract.installContextMenu();
    await chrome.contextMenus.onClicked.fire(
      { menuItemId: "qdistro-share-to", selectionText: "hello" },
      { id: 3 });
    await new Promise((r) => setTimeout(r, 0));
    const frame = lastOutbound("page.extract");
    expect(frame).toBeTruthy();
    expect(frame.destination).toBe("selection");
    expect(frame.intent_token.op).toBe("page.extract");
    expect(frame.intent_token.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof frame.intent_token.ts).toBe("number");
  });

  it("click without selectionText falls back to page destination", async () => {
    env.scope.qdistroPageExtract.installContextMenu();
    await chrome.contextMenus.onClicked.fire(
      { menuItemId: "qdistro-share-to" },
      { id: 4 });
    await new Promise((r) => setTimeout(r, 0));
    const frame = lastOutbound("page.extract");
    expect(frame.destination).toBe("page");
  });

  it("surfaces a broker-denied reply (ok:false / error) without throwing", async () => {
    const p = env.scope.qdistroPageExtract.extract(1, "page", null);
    await new Promise((r) => setTimeout(r, 0));
    const frame = lastOutbound("page.extract");
    env.port.deliver({
      op: "page.extract.reply",
      request_id: frame.request_id,
      ok: false,
      error: "policy_denied",
    });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("policy_denied");
  });

  it("successful reply resolves with the daemon's stored handle", async () => {
    const p = env.scope.qdistroPageExtract.extract(1, "selection", null);
    await new Promise((r) => setTimeout(r, 0));
    const frame = lastOutbound("page.extract");
    env.port.deliver({
      op: "page.extract.reply",
      request_id: frame.request_id,
      ok: true,
      stored_id: "extract-abc",
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.stored_id).toBe("extract-abc");
  });

  it("click handler swallows downstream errors so the menu stays usable", async () => {
    // Make executeScript reject — the click handler should not throw.
    chrome.scripting.executeScript = () => Promise.reject(new Error("inject_failed"));
    env.scope.qdistroPageExtract.installContextMenu();
    // The async listener catches internally — no synchronous throw.
    expect(() =>
      chrome.contextMenus.onClicked.fire(
        { menuItemId: "qdistro-share-to", selectionText: "x" },
        { id: 2 })
    ).not.toThrow();
    // Drain microtasks so any unhandled rejection would surface.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // No page.extract frame should have been sent.
    expect(env.port.sent.find((m) => m.op === "page.extract")).toBeUndefined();
  });
});
