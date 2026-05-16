// background.js — runtime.onMessage entry points for popup and the
// pwd/mpris/screenlock content scripts. Chrome's listener uses
// sendResponse(cb) + return true; helpers.js's loadWithBackground
// wraps that in a Promise.
import { describe, it, expect, beforeEach } from "vitest";
import { loadWithBackground, makeFakeChrome, makeFakePort } from "./helpers.js";

describe("background runtime.onMessage", () => {
  let env;
  beforeEach(() => {
    env = loadWithBackground();
    env.scope.qdistroPort.connect();
  });

  function waitForSent(op, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const m = env.port.sent.find((x) => x.op === op);
        if (m) return resolve(m);
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timeout waiting for ${op}`));
        }
        setTimeout(tick, 5);
      };
      tick();
    });
  }

  it("rejects messages whose sender.id != runtime.id", async () => {
    const r = await env.sendMessage({ kind: "status" }, { id: "evil-ext-id" });
    expect(r).toEqual({ ok: false, error: "untrusted_sender" });
  });

  it("rejects non-object payloads", async () => {
    const r = await env.sendMessage("nope");
    expect(r).toEqual({ ok: false, error: "bad_request" });
  });

  it("status returns the current port connectedness", async () => {
    const r = await env.sendMessage({ kind: "status" });
    expect(r).toEqual({ ok: true, connected: true });
  });

  it("unknown kind returns unknown_kind", async () => {
    const r = await env.sendMessage({ kind: "no-such-kind" });
    expect(r).toEqual({ ok: false, error: "unknown_kind" });
  });

  describe("pwd content-script entry points", () => {
    it("pwd.request_fill mints intent token and forwards as pwd.fill", async () => {
      const p = env.sendMessage({
        kind: "pwd.request_fill",
        url: "https://example.com/login",
        username: "alice",
      });
      const req = await waitForSent("pwd.fill");
      expect(req.url).toBe("https://example.com/login");
      expect(req.username).toBe("alice");
      expect(req.intent_token.op).toBe("pwd.fill");
      env.port.deliver({
        op: "pwd.fill.reply", request_id: req.request_id, ok: true,
        credentials: [{ username: "alice", password: "secret" }],
      });
      const r = await p;
      expect(r.ok).toBe(true);
      expect(r.response.credentials).toHaveLength(1);
    });

    it("pwd.request_save mints pwd.save token and forwards credentials", async () => {
      const p = env.sendMessage({
        kind: "pwd.request_save",
        url: "https://example.com/login",
        username: "alice",
        password: "s3cret!",
      });
      const req = await waitForSent("pwd.save");
      expect(req).toMatchObject({
        url: "https://example.com/login",
        username: "alice",
        password: "s3cret!",
      });
      expect(req.intent_token.op).toBe("pwd.save");
      env.port.deliver({
        op: "pwd.save.reply", request_id: req.request_id, ok: true, saved: true,
      });
      await p;
    });
  });

  describe("mpris content-script entry point", () => {
    it("mpris.report_update forwards as mpris.publish (fire-and-forget)", async () => {
      const r = await env.sendMessage({
        kind: "mpris.report_update",
        title: "Song", artist: "Artist", state: "playing",
        url: "https://music.example/",
      });
      expect(r).toEqual({ ok: true });
      const req = await waitForSent("mpris.publish");
      expect(req).toMatchObject({
        title: "Song", artist: "Artist", playback_status: "playing",
      });
    });

    it("includes tab_id when sender carries a tab", async () => {
      env.sendMessage(
        { kind: "mpris.report_update", title: "X", state: "playing" },
        { id: env.scope.chrome.runtime.id, tab: { id: 42 } },
      );
      const req = await waitForSent("mpris.publish");
      expect(req.tab_id).toBe(42);
    });
  });

  describe("screenlock content-script entry points", () => {
    it("screenlock.report_inhibit forwards as screenlock.inhibit", async () => {
      const r = await env.sendMessage({
        kind: "screenlock.report_inhibit",
        reason: "fullscreen_video",
      });
      expect(r).toEqual({ ok: true });
      const req = await waitForSent("screenlock.inhibit");
      expect(req).toMatchObject({ reason: "fullscreen_video" });
    });

    it("screenlock.report_release forwards as screenlock.release", async () => {
      await env.sendMessage({
        kind: "screenlock.report_release", reason: "fullscreen_exit",
      });
      const req = await waitForSent("screenlock.release");
      expect(req).toMatchObject({ reason: "fullscreen_exit" });
    });

    it("tabs.onRemoved fires release for tabs with active inhibit", async () => {
      await env.sendMessage(
        { kind: "screenlock.report_inhibit", reason: "fullscreen_video" },
        { id: env.scope.chrome.runtime.id, tab: { id: 7 } },
      );
      await waitForSent("screenlock.inhibit");
      const beforeReleases = env.port.sent.filter((m) => m.op === "screenlock.release").length;
      const tabRemovedListeners = env.scope.chrome.tabs.onRemoved._listeners;
      for (const cb of tabRemovedListeners) cb(7, { isWindowClosing: false });
      // Wait for the release to land.
      await new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const after = env.port.sent.filter((m) => m.op === "screenlock.release").length;
          if (after > beforeReleases) return resolve();
          if (Date.now() - start > 1000) return reject(new Error("no release"));
          setTimeout(tick, 5);
        };
        tick();
      });
      const release = env.port.sent.filter((m) => m.op === "screenlock.release").at(-1);
      expect(release.reason).toBe("tab_removed");
    });

    it("does NOT fire release for a tab without an active inhibit", async () => {
      const tabRemovedListeners = env.scope.chrome.tabs.onRemoved._listeners;
      for (const cb of tabRemovedListeners) cb(999, { isWindowClosing: false });
      await new Promise((r) => setTimeout(r, 30));
      const releases = env.port.sent.filter((m) => m.op === "screenlock.release");
      expect(releases).toHaveLength(0);
    });
  });
});
