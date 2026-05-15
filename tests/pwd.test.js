// pwd module tests — pwd.fill / pwd.save outbound shape, intent-token
// forwarding, and reply handling (credentials, vault locked).
//
// The pwd module is purely extension-initiated: there are no inbound
// handlers — fills are user-driven. We drive it via qdistroPwd.fill /
// .save and assert on the outbound frame and round-tripped reply.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension, makeFakeChrome, makeFakePort } from "./helpers.js";

describe("qdistroPwd", () => {
  let env;
  beforeEach(() => {
    env = loadExtension({ chrome: makeFakeChrome(), portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  function lastOutbound(op) {
    return env.port.sent.find((m) => m.op === op);
  }

  it("exposes the qdistroPwd module on the scope", () => {
    expect(env.scope.qdistroPwd).toBeTruthy();
    expect(typeof env.scope.qdistroPwd.fill).toBe("function");
    expect(typeof env.scope.qdistroPwd.save).toBe("function");
  });

  it("pwd.fill sends url, username, and intent_token", () => {
    void env.scope.qdistroPwd.fill("https://example.com/login", "alice", {
      operation: "pwd.fill", nonce: "n-1",
    });
    const frame = lastOutbound("pwd.fill");
    expect(frame).toBeTruthy();
    expect(frame.url).toBe("https://example.com/login");
    expect(frame.username).toBe("alice");
    expect(frame.intent_token).toMatchObject({ operation: "pwd.fill" });
    expect(typeof frame.request_id).toBe("number");
  });

  it("pwd.fill normalizes a missing username to null", () => {
    void env.scope.qdistroPwd.fill("https://example.com/login", "", {
      operation: "pwd.fill",
    });
    const frame = lastOutbound("pwd.fill");
    expect(frame.username).toBeNull();
  });

  it("pwd.fill resolves with credentials on a successful reply", async () => {
    const p = env.scope.qdistroPwd.fill(
      "https://example.com/login", null,
      { operation: "pwd.fill" });
    const frame = lastOutbound("pwd.fill");
    env.port.deliver({
      op: "pwd.fill.reply",
      request_id: frame.request_id,
      ok: true,
      credentials: [{ username: "alice", password: "s3cret" }],
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.credentials).toHaveLength(1);
    expect(r.credentials[0]).toMatchObject({ username: "alice" });
  });

  it("pwd.fill surfaces a credential-not-found reply as ok:false", async () => {
    const p = env.scope.qdistroPwd.fill(
      "https://example.com/login", "ghost",
      { operation: "pwd.fill" });
    const frame = lastOutbound("pwd.fill");
    env.port.deliver({
      op: "pwd.fill.reply",
      request_id: frame.request_id,
      ok: false,
      error: "credential_not_found",
    });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("credential_not_found");
  });

  it("pwd.fill surfaces vault_locked errors from the bridge", async () => {
    const p = env.scope.qdistroPwd.fill(
      "https://example.com/login", null,
      { operation: "pwd.fill" });
    const frame = lastOutbound("pwd.fill");
    env.port.deliver({
      op: "pwd.fill.reply",
      request_id: frame.request_id,
      ok: false,
      error: "vault_locked",
    });
    const r = await p;
    expect(r.error).toBe("vault_locked");
  });

  it("pwd.save sends url, username, password, and intent_token", () => {
    void env.scope.qdistroPwd.save(
      "https://example.com/signup", "bob", "hunter2",
      { operation: "pwd.save", nonce: "n-2" });
    const frame = lastOutbound("pwd.save");
    expect(frame).toBeTruthy();
    expect(frame.url).toBe("https://example.com/signup");
    expect(frame.username).toBe("bob");
    expect(frame.password).toBe("hunter2");
    expect(frame.intent_token).toMatchObject({ operation: "pwd.save" });
  });

  it("pwd.save resolves with ok:true when the bridge confirms storage", async () => {
    const p = env.scope.qdistroPwd.save(
      "https://example.com/", "bob", "hunter2",
      { operation: "pwd.save" });
    const frame = lastOutbound("pwd.save");
    env.port.deliver({
      op: "pwd.save.reply",
      request_id: frame.request_id,
      ok: true,
      stored_at: 1700000000,
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.stored_at).toBe(1700000000);
  });

  it("pwd.save surfaces vault_locked rejection from the bridge", async () => {
    const p = env.scope.qdistroPwd.save(
      "https://example.com/", "bob", "x",
      { operation: "pwd.save" });
    const frame = lastOutbound("pwd.save");
    env.port.deliver({
      op: "pwd.save.reply",
      request_id: frame.request_id,
      ok: false,
      error: "vault_locked",
    });
    const r = await p;
    expect(r.error).toBe("vault_locked");
  });

  it("pwd.save without an intent token still ships the frame (bridge enforces)", () => {
    // The extension forwards intent_token as-is; the bridge is the
    // security gate. We assert the wire shape so a bridge-side
    // verifier sees intent_token === null and rejects.
    void env.scope.qdistroPwd.save(
      "https://example.com/", "carol", "p",
      null);
    const frame = lastOutbound("pwd.save");
    expect(frame.intent_token).toBeNull();
  });

  it("registers no inbound handlers — pwd is one-way", () => {
    // Sanity: the dispatcher should not know any pwd.* op as inbound.
    expect(env.scope.qdistroDispatcher.handlers.has("pwd.fill")).toBe(false);
    expect(env.scope.qdistroDispatcher.handlers.has("pwd.save")).toBe(false);
  });

  it("uses a fresh request_id per call (concurrent fills do not collide)", () => {
    void env.scope.qdistroPwd.fill("https://a.example/", null, {});
    void env.scope.qdistroPwd.fill("https://b.example/", null, {});
    const frames = env.port.sent.filter((m) => m.op === "pwd.fill");
    expect(frames).toHaveLength(2);
    expect(frames[0].request_id).not.toBe(frames[1].request_id);
  });
});
