/**
 * Worker entry for a sandboxed decoder plugin (#900).
 *
 * Runs inside a worker_threads Worker started with an empty environment and
 * memory limits. The plugin source is evaluated in a fresh `vm` context that
 * has no Node globals (no require, process, Buffer, fetch, timers) and with
 * string code generation disabled. The helpers it receives are defined
 * *inside* that context, so no host object — and therefore no host
 * `Function` constructor — is ever reachable from plugin code. Events go in
 * and results come out only as JSON strings.
 */

import { parentPort, workerData } from "worker_threads";
import vm from "vm";

const { source, timeoutMs, maxOutputBytes } = workerData;

const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
});

// Helpers live in the sandbox realm. `module.exports.decode` is the plugin API.
vm.runInContext(
  `
  "use strict";
  var module = { exports: {} };
  var exports = module.exports;
  var helpers = Object.freeze({
    formatAmount: function (amount, decimals) {
      var d = decimals === undefined ? 7 : decimals;
      var s = String(amount);
      var neg = s.charAt(0) === "-";
      if (neg) s = s.slice(1);
      while (s.length <= d) s = "0" + s;
      var whole = s.slice(0, s.length - d);
      var frac = s.slice(s.length - d).replace(/0+$/, "");
      return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
    },
    shortAddress: function (addr) {
      var s = String(addr);
      return s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : s;
    }
  });
  `,
  context,
);

vm.runInContext(source, context, { timeout: timeoutMs, filename: "plugin.js" });

// Runs entirely inside the sandbox: parse input, call the plugin, serialize.
const invoke = vm.runInContext(
  `(function (eventJson) {
     var decode = module.exports && module.exports.decode;
     if (typeof decode !== "function") throw new Error("plugin does not export decode()");
     var out = decode(JSON.parse(eventJson), helpers);
     return out === undefined || out === null ? "null" : JSON.stringify(out);
   })`,
  context,
);

// Per-call CPU time is enforced by the host watchdog, which terminates this
// worker (interrupting even a tight loop) and starts a fresh one. A vm
// `timeout` per call would add a watchdog thread to every call.
parentPort.on("message", ({ id, eventJson }) => {
  try {
    const output = invoke(eventJson);
    if (typeof output !== "string") throw new Error("plugin returned a non-serializable value");
    if (Buffer.byteLength(output) > maxOutputBytes) {
      parentPort.postMessage({ id, error: `output exceeds ${maxOutputBytes} bytes`, kind: "output_limit" });
      return;
    }
    parentPort.postMessage({ id, output });
  } catch (err) {
    const timedOut = /Script execution timed out/.test(String(err?.message));
    parentPort.postMessage({
      id,
      error: String(err?.message ?? err),
      kind: timedOut ? "timeout" : "error",
    });
  }
});

parentPort.postMessage({ ready: true });
