// manifest.{chromium,firefox}.json shape tests. Pin invariants that
// the build script would silently break: which content scripts
// inject into iframes (pwd-content needs all_frames:true to reach
// federated SSO iframes; mpris/screenlock must stay top-frame-only).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

describe("manifest.firefox.json content_scripts", () => {
  it("splits pwd-content (all_frames:true) from mpris/screenlock", () => {
    assertSplit(load("manifest.firefox.json"));
  });
});

// P04-E parity check — P0-5 fix. The pwd.fill content script
// needs scripting + webNavigation in MV3 to inject into
// freshly-navigated frames; the MV2 (legacy Firefox) manifest needs
// webNavigation as a permission. Asserted per-manifest because the
// wire-protocol coverage on both must match.
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

describe("manifest.firefox.json permissions (P04-E)", () => {
  const m = load("manifest.firefox.json");
  it("declares nativeMessaging", () => {
    expect(m.permissions).toContain("nativeMessaging");
  });
  it("declares webNavigation", () => {
    expect(m.permissions).toContain("webNavigation");
  });
  it("MV2 permissions list contains <all_urls>", () => {
    expect(m.permissions).toContain("<all_urls>");
  });
});
