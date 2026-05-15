// mpris module tests.
//
// The current implementation is stub-grade: it registers an inbound
// `mpris.control` handler (play/pause/next/prev) that just acks, and
// exposes an outbound `update()` helper for the (future) content-script
// observer. Tests pin the wire shape so the bridge side can land
// independently — when the real implementation arrives, these still
// catch regressions on the protocol surface.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension, makeFakeChrome, makeFakePort } from "./helpers.js";

describe("qdistroMpris", () => {
  let env;
  beforeEach(() => {
    env = loadExtension({ chrome: makeFakeChrome(), portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  function lastOutbound(op) {
    return env.port.sent.find((m) => m.op === op);
  }

  it("exposes qdistroMpris.update", () => {
    expect(env.scope.qdistroMpris).toBeTruthy();
    expect(typeof env.scope.qdistroMpris.update).toBe("function");
  });

  it("registers an inbound handler for mpris.control", () => {
    expect(env.scope.qdistroDispatcher.handlers.has("mpris.control")).toBe(true);
  });

  it("handles mpris.control 'play' and replies ok", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 1, action: "play",
    });
    const reply = lastOutbound("mpris.control.reply");
    expect(reply).toBeTruthy();
    expect(reply.ok).toBe(true);
    expect(reply.action).toBe("play");
    expect(reply.request_id).toBe(1);
  });

  it("handles mpris.control 'pause'", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 2, action: "pause",
    });
    const reply = lastOutbound("mpris.control.reply");
    expect(reply.action).toBe("pause");
  });

  it("handles mpris.control 'next'", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 3, action: "next",
    });
    const reply = lastOutbound("mpris.control.reply");
    expect(reply.action).toBe("next");
  });

  it("handles mpris.control 'prev'", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 4, action: "prev",
    });
    const reply = lastOutbound("mpris.control.reply");
    expect(reply.action).toBe("prev");
  });

  it("coerces a missing action to the empty string", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 5,
    });
    const reply = lastOutbound("mpris.control.reply");
    expect(reply.action).toBe("");
    expect(reply.ok).toBe(true);
  });

  it("marks the reply as stub:true so the bridge can log it", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 6, action: "play",
    });
    const reply = lastOutbound("mpris.control.reply");
    expect(reply.stub).toBe(true);
  });

  it("update() emits an outbound mpris.update frame with the payload", () => {
    void env.scope.qdistroMpris.update({
      state: "playing",
      title: "Some Song",
      artist: "Some Artist",
      tab_id: 42,
    });
    const frame = lastOutbound("mpris.update");
    expect(frame).toBeTruthy();
    expect(frame).toMatchObject({
      state: "playing",
      title: "Some Song",
      artist: "Some Artist",
      tab_id: 42,
    });
    expect(typeof frame.request_id).toBe("number");
  });

  it("update() with an empty/missing payload still ships a frame", () => {
    void env.scope.qdistroMpris.update();
    const frame = lastOutbound("mpris.update");
    expect(frame).toBeTruthy();
    expect(frame.op).toBe("mpris.update");
  });

  it("update() resolves on a bridge reply", async () => {
    const p = env.scope.qdistroMpris.update({ state: "paused" });
    const frame = lastOutbound("mpris.update");
    env.port.deliver({
      op: "mpris.update.reply",
      request_id: frame.request_id,
      ok: true,
    });
    const r = await p;
    expect(r.ok).toBe(true);
  });

  it("update() surfaces a bridge error reply without throwing", async () => {
    const p = env.scope.qdistroMpris.update({ state: "stopped" });
    const frame = lastOutbound("mpris.update");
    env.port.deliver({
      op: "mpris.update.reply",
      request_id: frame.request_id,
      ok: false,
      error: "no_active_player",
    });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_active_player");
  });
});
