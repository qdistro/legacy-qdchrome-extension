// Test helpers — load the extension's source files into a synthetic
// `self` global so the IIFE modules attach their exports there.
//
// Vanilla JS modules (the rest of the source) use the `self` global
// of a service worker. In Node we synthesize the same shape and use
// vm.runInThisContext via `eval` for each source — cheap, no
// jsdom dependency, no transpiler.
//
// @ts-check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "src");

export function makeFakePort() {
  const listeners = { msg: [], dc: [] };
  const sent = [];
  const port = {
    postMessage: (m) => { sent.push(m); },
    disconnect: () => {
      for (const cb of listeners.dc) cb();
    },
    onMessage: { addListener: (cb) => listeners.msg.push(cb) },
    onDisconnect: { addListener: (cb) => listeners.dc.push(cb) },
  };
  return {
    port, sent,
    deliver: (msg) => { for (const cb of listeners.msg) cb(msg); },
    triggerDisconnect: () => { for (const cb of listeners.dc) cb(); },
  };
}

/**
 * Build a listener registry that captures `addListener` callbacks so
 * tests can fire them synthetically (used for chrome.downloads,
 * chrome.notifications, chrome.contextMenus).
 */
function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (cb) => { listeners.push(cb); },
    fire: (...args) => { for (const cb of listeners) cb(...args); },
  };
}

export function makeFakeChrome(overrides = {}) {
  const fakes = {
    runtime: {
      id: "test-ext-id",
      lastError: null,
      connectNative: () => { throw new Error("override connectNative"); },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    tabs: {
      query: (q, cb) => cb([]),
      create: (p, cb) => cb({ id: 99, ...p }),
      remove: (ids, cb) => cb(),
      executeScript: (tabId, opts, cb) => cb && cb([{ result: {} }]),
    },
    cookies: {
      getAll: (q, cb) => cb([]),
    },
    downloads: {
      onChanged: makeEvent(),
      search: (q, cb) => cb([]),
    },
    notifications: {
      onClicked: makeEvent(),
      onClosed: makeEvent(),
      create: (id, opts, cb) => cb && cb("notif-1"),
    },
    contextMenus: {
      create: (def, cb) => { cb && cb(); },
      onClicked: makeEvent(),
    },
    storage: { local: { get: (k, cb) => cb({}), set: (v, cb) => cb && cb() } },
    scripting: { executeScript: () => Promise.resolve([{ result: {} }]) },
  };
  return Object.assign(fakes, overrides);
}

export { makeEvent };

/**
 * Load the extension source into a fresh global scope and return it.
 * Each call yields an independent `self` so tests don't bleed.
 */
export function loadExtension(opts = {}) {
  const fakeChrome = opts.chrome || makeFakeChrome();
  const fakePortHandle = opts.portHandle || makeFakePort();
  fakeChrome.runtime.connectNative = () => fakePortHandle.port;

  const scope = {};
  scope.self = scope;
  scope.console = console;
  scope.chrome = fakeChrome;
  scope.setTimeout = setTimeout;
  scope.clearTimeout = clearTimeout;
  scope.setInterval = setInterval;
  scope.clearInterval = clearInterval;
  scope.Date = Date;
  scope.Math = Math;
  scope.JSON = JSON;
  scope.Promise = Promise;
  scope.Error = Error;
  scope.Array = Array;
  scope.Object = Object;
  scope.String = String;
  scope.Number = Number;
  scope.Boolean = Boolean;
  scope.Map = Map;
  scope.Set = Set;
  scope.Symbol = Symbol;

  function evalFile(rel) {
    const code = fs.readFileSync(path.join(SRC, rel), "utf8");
    // Each source file is an IIFE with `(function(root){ ... })(typeof self !== "undefined" ? self : globalThis)`.
    // We can directly eval against `scope` via a small wrapper.
    const wrapped =
      `(function(self, chrome, console){\n${code}\n}).call(__scope__, __scope__, __scope__.chrome, __scope__.console)`;
    const fn = new Function("__scope__", `return ${wrapped};`);
    fn(scope);
  }

  evalFile("api.js");
  evalFile("port.js");
  evalFile("dispatcher.js");
  evalFile("intent.js");
  evalFile("modules/tabs.js");
  evalFile("modules/pwd.js");
  evalFile("modules/pageExtract.js");
  evalFile("modules/cookies.js");
  evalFile("modules/mpris.js");
  evalFile("modules/downloads.js");
  evalFile("modules/notifications.js");
  evalFile("modules/screenlock.js");

  return { scope, port: fakePortHandle };
}
