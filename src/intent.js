// Intent token minting — 9d.
//
// Per spec/14 Phase-9d §"Intent token implementation": tokens are
// {request_id, timestamp, operation, hmac} with HMAC key shared
// between extension and daemon via `qdistro.handshake`. Token TTL
// 5 seconds; scope is a single request-id.
//
// MVP shape (handshake not yet wired on the bridge side): we mint
// an unsigned token. The daemon-side verification will reject these
// once the handshake op lands; that's the right failure mode —
// extension code is in place, security gate is on the bridge.
//
// @ts-check
(function (root) {
  "use strict";

  const TTL_MS = 5000;
  let counter = 0;
  let sessionSecret = null;  // set by handshake when wired

  function mint(operation, ttlMs) {
    ttlMs = ttlMs || TTL_MS;
    counter += 1;
    return {
      operation: String(operation || ""),
      timestamp: Date.now(),
      ttl_ms: ttlMs,
      nonce: `${counter}-${Math.random().toString(36).slice(2, 10)}`,
      hmac: sessionSecret ? hmacPlaceholder() : null,
    };
  }

  function hmacPlaceholder() {
    // Real HMAC will use crypto.subtle once the handshake establishes
    // sessionSecret. Until then, intent tokens carry hmac=null and
    // the bridge will reject them — which is the intended posture.
    return null;
  }

  function setSessionSecret(secret) {
    sessionSecret = secret || null;
  }

  function ttlMs() { return TTL_MS; }

  root.qdistroIntent = { mint, setSessionSecret, ttlMs };
})(typeof self !== "undefined" ? self : globalThis);
