// Dispatcher tests: request_id correlation, inbound handler dispatch,
// reply shape, timeout, unknown-op.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension } from "./helpers.js";

describe("qdistroDispatcher", () => {
  let env;
  beforeEach(() => {
    env = loadExtension();
    env.scope.qdistroPort.connect();
  });

  it("matches replies to outstanding requests by request_id", async () => {
    const p = env.scope.qdistroDispatcher.request("tabs.list");
    const sent = env.port.sent.find((m) => m.op === "tabs.list");
    expect(sent).toBeTruthy();
    expect(typeof sent.request_id).toBe("number");
    env.port.deliver({
      op: "tabs.list.reply",
      request_id: sent.request_id,
      ok: true,
      tabs: [{ id: 1, url: "https://example.com", title: "x" }],
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.tabs).toHaveLength(1);
  });

  it("routes inbound ops to registered handlers", async () => {
    env.scope.qdistroDispatcher.register("dummy.op", async (msg) => ({
      received_args: msg.args || null,
    }));
    await env.scope.qdistroDispatcher.handleInbound({
      op: "dummy.op", request_id: 42, args: { a: 1 },
    });
    const reply = env.port.sent.find(
      (m) => m.op === "dummy.op.reply" && m.request_id === 42);
    expect(reply).toBeTruthy();
    expect(reply.ok).toBe(true);
    expect(reply.received_args).toEqual({ a: 1 });
  });

  it("replies with unknown_op for unhandled inbound ops with a request_id", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "nope.unknown", request_id: 7,
    });
    const reply = env.port.sent.find(
      (m) => m.op === "nope.unknown.reply" && m.request_id === 7);
    expect(reply).toBeTruthy();
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("unknown_op");
  });

  it("rejects requests that exceed their timeout", async () => {
    const p = env.scope.qdistroDispatcher.request("slow.op", {}, { timeoutMs: 10 });
    await expect(p).rejects.toThrow(/timeout/);
  });
});
