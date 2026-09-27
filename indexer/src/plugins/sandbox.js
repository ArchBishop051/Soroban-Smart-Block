/**
 * Host side of the decoder plugin sandbox (#900). See sandboxWorker.js.
 *
 * Each plugin gets its own worker (one isolate, reused across calls):
 *   - CPU:    per-call time limit enforced by a host watchdog that terminates
 *             the worker (interrupting even a tight loop) and restarts it
 *   - memory: worker resourceLimits; an out-of-memory worker is restarted
 *   - output: serialized result size limit
 *   - env:    the worker starts with an empty process.env
 */

import { Worker } from "worker_threads";

const WORKER_PATH = new URL("./sandboxWorker.js", import.meta.url);

export class PluginViolation extends Error {
  /** @param {"timeout"|"memory"|"output_limit"|"error"|"crash"} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export class PluginSandbox {
  constructor(source, { timeoutMs = 50, memoryMb = 32, maxOutputBytes = 16 * 1024 } = {}) {
    this.source = source;
    this.opts = { timeoutMs, memoryMb, maxOutputBytes };
    this.pending = new Map();
    this.nextId = 0;
    this.worker = null;
    this.ready = null;
  }

  _start() {
    const { timeoutMs, memoryMb, maxOutputBytes } = this.opts;
    const worker = new Worker(WORKER_PATH, {
      workerData: { source: this.source, timeoutMs, maxOutputBytes },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: Math.max(4, memoryMb / 4) },
      stdout: true,
      stderr: true,
    });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      worker.once("message", (msg) => (msg?.ready ? resolve() : reject(new Error("sandbox failed to start"))));
      worker.once("error", reject);
    });
    worker.on("message", (msg) => {
      if (msg?.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new PluginViolation(msg.kind ?? "error", msg.error));
      else p.resolve(JSON.parse(msg.output));
    });
    worker.on("error", (err) => this._fail(err.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "crash", err.message));
    worker.on("exit", () => {
      if (this.worker === worker) this.worker = null;
      this._fail("crash", "plugin worker exited");
    });
  }

  _fail(kind, message) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new PluginViolation(kind, message));
      this.pending.delete(id);
    }
  }

  /**
   * Run the plugin's decode() on a plain-data event.
   * @returns {Promise<unknown>} the plugin's output (plain data) or null
   */
  async call(event) {
    if (!this.worker) this._start();
    await this.ready;
    const id = this.nextId++;
    const eventJson = JSON.stringify(event, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    return new Promise((resolve, reject) => {
      // CPU time limit: terminating the worker interrupts even a tight loop;
      // the next call starts a fresh one.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PluginViolation("timeout", `exceeded ${this.opts.timeoutMs} ms`));
        this.restart();
      }, this.opts.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, eventJson });
    });
  }

  restart() {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
  }

  async close() {
    const worker = this.worker;
    this.worker = null;
    await worker?.terminate();
  }
}
