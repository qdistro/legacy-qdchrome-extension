// manifest.chromium.json shape tests + Firefox-canonicalization guard.
//
// This repo is Chromium-only. The Firefox extension is shipped from its
// own canonical sources (../qdfirefox-extension standalone, and
// ../qdistro/browser_bridge/extension bundled) — NOT built here. A
// legacy Firefox MV2 target used to be emitted from this repo under
// gecko id `qdistro@qdistro.local`, colliding with the bundled
// extension's id (two distinct codebases, same id). The guard suite
// below keeps that target from being reintroduced.
//
// The chromium tests pin invariants the build script would silently
// break: which content scripts inject into iframes (pwd-content needs
// all_frames:true to reach federated SSO iframes; mpris/screenlock must
// stay top-frame-only).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function load(name) {
  return JSON.parse(
    readFileSync(resolve(__dirname, "..", name), "utf8")
  );
}

function assertSplit(manifest) {
  const cs = manifest.content_scripts;
  expect(Array.isArray(cs)).toBe(true);
  expect(cs).toHaveLength(2);

  const pwd = cs.find((e) => e.js.some((p) => p.endsWith("pwd-content.js")));
  expect(pwd).toBeTruthy();
  expect(pwd.all_frames).toBe(true);
  expect(pwd.js).toEqual(["src/content/pwd-content.js"]);

  const others = cs.find((e) => e.js.some((p) => p.endsWith("mpris-content.js")));
  expect(others).toBeTruthy();
  expect(others.all_frames).toBe(false);
  expect(others.js).toContain("src/content/mpris-content.js");
  expect(others.js).toContain("src/content/screenlock-content.js");
  expect(others.js).not.toContain("src/content/pwd-content.js");
}

describe("manifest.chromium.json content_scripts", () => {
  it("splits pwd-content (all_frames:true) from mpris/screenlock", () => {
    assertSplit(load("manifest.chromium.json"));
  });
});

// P04-E parity check — P0-5 fix. The pwd.fill content script
// needs scripting + webNavigation in MV3 to inject into
// freshly-navigated frames.
describe("manifest.chromium.json permissions (P04-E)", () => {
  const m = load("manifest.chromium.json");
  it("declares nativeMessaging", () => {
    expect(m.permissions).toContain("nativeMessaging");
  });
  it("declares scripting (MV3)", () => {
    expect(m.permissions).toContain("scripting");
  });
  it("declares webNavigation", () => {
    expect(m.permissions).toContain("webNavigation");
  });
  it("MV3 host_permissions covers all urls", () => {
    expect(m.host_permissions).toContain("<all_urls>");
  });
});

// P04 fix-pass S4 (test-integrity): closed-set assertions so a
// future commit silently adding a broad permission fails the test.
describe("chrome extension manifest — closed permission set", () => {
  const chromiumExpected = new Set([
    "nativeMessaging",
    "tabs",
    "activeTab",
    "cookies",
    "downloads",
    "notifications",
    "contextMenus",
    "scripting",
    "webNavigation",
    "storage",
  ]);

  it("manifest.chromium.json permissions are exactly the expected set", () => {
    const m = load("manifest.chromium.json");
    const actual = new Set(m.permissions || []);
    for (const p of actual) {
      expect(
        chromiumExpected.has(p),
        `unexpected permission ${p} in chromium manifest — update the allowlist after security review`,
      ).toBe(true);
    }
    for (const p of chromiumExpected) {
      expect(actual.has(p), `missing permission ${p}`).toBe(true);
    }
  });
});

// ---- Firefox-canonicalization guard -------------------------------
// Keeps the removed Firefox MV2 target from being reintroduced. The
// Firefox extension is canonical elsewhere (qdfirefox-extension /
// qdistro browser_bridge bundled); building one here under
// `qdistro@qdistro.local` re-creates the id-collision drift trap.
describe("Firefox build target is not shipped from this repo", () => {
  it("manifest.firefox.json is absent", () => {
    expect(existsSync(resolve(__dirname, "..", "manifest.firefox.json")))
      .toBe(false);
  });

  it("build-extension.sh emits no Firefox output", () => {
    const sh = readFileSync(
      resolve(__dirname, "..", "scripts", "build-extension.sh"), "utf8");
    // Strip comment lines so the explanatory header (which names the
    // removed artifacts) does not trip the guard; only live build
    // statements should be checked.
    const code = sh
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    for (const needle of [
      "firefox.xpi",
      "background.bundle.js",
      "manifest.firefox.json",
      "dist/firefox",
      "$DIST/firefox",
    ]) {
      expect(
        code.includes(needle),
        `build-extension.sh still references ${needle} — this repo is Chromium-only`,
      ).toBe(false);
    }
  });
});
