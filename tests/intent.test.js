// intent.js tests — the per-call MVP token minter.
//
// Spec/14 Phase-9d intent tokens are {request_id, timestamp,
// operation, hmac} with a 5s TTL. The current implementation is
// "MVP shape" — it mints unsigned tokens (hmac=null) and the bridge
// is the security gate that will reject them once the handshake
// lands. These tests pin that shape so the bridge contract is
// stable, and document the gaps that the bridge must enforce.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension, makeFakeChrome, makeFakePort } from "./helpers.js";

describe("qdistroIntent", () => {
  let env;
  beforeEach(() => {
    env = loadExtension({ chrome: makeFakeChrome(), portHandle: makeFakePort() });
  });

  it("exposes mint / setSessionSecret / ttlMs", () => {
    expect(env.scope.qdistroIntent).toBeTruthy();
    expect(typeof env.scope.qdistroIntent.mint).toBe("function");
    expect(typeof env.scope.qdistroIntent.setSessionSecret).toBe("function");
    expect(typeof env.scope.qdistroIntent.ttlMs).toBe("function");
  });

  it("ttlMs() reports the 5000ms spec-defined default", () => {
    expect(env.scope.qdistroIntent.ttlMs()).toBe(5000);
  });

  it("mint() returns a token with the canonical fields", () => {
    const t = env.scope.qdistroIntent.mint("cookies.export");
    expect(t).toMatchObject({
      operation: "cookies.export",
      ttl_ms: 5000,
    });
    expect(typeof t.timestamp).toBe("number");
    expect(typeof t.nonce).toBe("string");
    expect(t.nonce.length).toBeGreaterThan(0);
  });

  it("mint() honors an explicit TTL override", () => {
    const t = env.scope.qdistroIntent.mint("pwd.fill", 1500);
    expect(t.ttl_ms).toBe(1500);
  });

  it("mint() coerces a missing operation to the empty string", () => {
    const t = env.scope.qdistroIntent.mint();
    expect(t.operation).toBe("");
  });

  it("mint() returns hmac=null when no session secret is set", () => {
    // Bridge-side rejection is the intended posture pre-handshake.
    const t = env.scope.qdistroIntent.mint("page.extract");
    expect(t.hmac).toBeNull();
  });

  it("mint() still returns hmac=null after setSessionSecret (placeholder)", () => {
    // The current placeholder hmacPlaceholder() returns null even
    // with a secret. Pin this so it changes deliberately when the
    // real HMAC lands.
    env.scope.qdistroIntent.setSessionSecret("test-secret");
    const t = env.scope.qdistroIntent.mint("pwd.save");
    expect(t.hmac).toBeNull();
  });

  it("setSessionSecret(null) clears a previously set secret without throwing", () => {
    env.scope.qdistroIntent.setSessionSecret("s");
    env.scope.qdistroIntent.setSessionSecret(null);
    const t = env.scope.qdistroIntent.mint("x");
    expect(t.hmac).toBeNull();
  });

  it("each mint() produces a unique nonce", () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      seen.add(env.scope.qdistroIntent.mint("op").nonce);
    }
    expect(seen.size).toBe(20);
  });

  it("nonce includes a monotonic counter prefix", () => {
    const a = env.scope.qdistroIntent.mint("op");
    const b = env.scope.qdistroIntent.mint("op");
    const ai = parseInt(a.nonce.split("-")[0], 10);
    const bi = parseInt(b.nonce.split("-")[0], 10);
    expect(bi).toBeGreaterThan(ai);
  });

  it("timestamp tracks Date.now() (via fake timers)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
      const t = env.scope.qdistroIntent.mint("op");
      expect(t.timestamp).toBe(Date.parse("2024-06-01T00:00:00Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("operation field tags the token's scope (bridge enforces match)", () => {
    // The extension does not verify that a 'cookies.export' token is
    // not later used against 'pwd.save' — that is the bridge's job.
    // We assert the operation tag is preserved verbatim so the bridge
    // has something to check.
    const a = env.scope.qdistroIntent.mint("cookies.export");
    const b = env.scope.qdistroIntent.mint("pwd.save");
    expect(a.operation).toBe("cookies.export");
    expect(b.operation).toBe("pwd.save");
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("mints quickly enough that two adjacent calls share a timestamp", () => {
    // Real-clock test — both calls land within the same ms.
    const a = env.scope.qdistroIntent.mint("op");
    const b = env.scope.qdistroIntent.mint("op");
    // Same-ms timestamps are allowed; nonce keeps them unique.
    expect(Math.abs(b.timestamp - a.timestamp)).toBeLessThan(50);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
