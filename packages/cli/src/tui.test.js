import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "./tui/App.js";
import { EventStore } from "./tui/store.js";
import { compileFilter } from "./tui/filter.js";
import { connectStream } from "./tui/stream.js";
import { resolveProfile } from "./tui/index.js";

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const ev = (seq, fn = "transfer", contract = "CAAA") => ({
  seq,
  ledger: 1000 + seq,
  tx_hash: `tx${seq}`,
  contract_id: contract,
  function: fn,
  description: `${fn} #${seq}`,
});

function mount(events, props = {}) {
  const store = new EventStore({ throttleMs: 10 });
  store.add(events);
  const exported = [];
  const app = render(React.createElement(App, { store, exportView: async (v) => (exported.push(v), "out.ndjson"), color: false, ...props }));
  return { store, app, exported };
}

describe("tui filter DSL", () => {
  it("supports field terms, negation, numeric comparisons and bare words", () => {
    const events = [ev(1, "transfer", "CAAA"), ev(2, "mint", "CBBB"), ev(3, "approve", "CAAA")];
    const run = (f) => events.filter(compileFilter(f)).map((e) => e.seq);
    assert.deepEqual(run(""), [1, 2, 3]);
    assert.deepEqual(run("fn:transfer"), [1]);
    assert.deepEqual(run("contract:caaa !fn:approve"), [1]);
    assert.deepEqual(run("seq>=2"), [2, 3]);
    assert.deepEqual(run("mint"), [2]);
  });
});

describe("tui navigation", () => {
  it("moves the selection, opens the detail pane and pauses", async () => {
    const { app, store } = mount([ev(1), ev(2), ev(3)]);
    await tick();
    assert.match(app.lastFrame(), /› +1003 .*transfer #3/);
    app.stdin.write("j");
    await tick();
    assert.match(app.lastFrame(), /› +1002 .*transfer #2/);
    app.stdin.write("\r");
    await tick();
    assert.match(app.lastFrame(), /Event #2 — transfer/);
    app.stdin.write(" ");
    await tick();
    assert.equal(store.paused, true);
    store.add([ev(4)]);
    await tick();
    assert.match(app.lastFrame(), /PAUSED \(1 queued\)/);
    app.unmount();
  });

  it("filters via the filter bar and exports the current view", async () => {
    const { app, exported } = mount([ev(1, "transfer"), ev(2, "mint"), ev(3, "transfer")]);
    await tick();
    app.stdin.write("/");
    await tick();
    for (const ch of "fn:mint") app.stdin.write(ch);
    await tick();
    app.stdin.write("\r");
    await tick();
    const frame = app.lastFrame();
    assert.match(frame, /mint #2/);
    assert.doesNotMatch(frame, /transfer #/);
    app.stdin.write("e");
    await tick();
    assert.deepEqual(exported[0].map((e) => e.seq), [2]);
    assert.match(app.lastFrame(), /exported 1 events/);
    app.unmount();
  });
});

class MockSocket extends EventEmitter {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    MockSocket.instances.push(this);
    setImmediate(() => this.emit("open"));
  }
  close() {
    this.emit("close");
  }
}

describe("tui stream", () => {
  it("keeps up with 1k events/s from a mock WS with throttled redraws", async () => {
    MockSocket.instances = [];
    const store = new EventStore({ capacity: 5000, throttleMs: 100 });
    let notifications = 0;
    store.subscribe(() => notifications++);
    const app = render(React.createElement(App, { store, exportView: async () => "", color: false }));
    const stream = connectStream({ baseUrl: "http://x", onEvents: (e) => store.add(e), WebSocketImpl: MockSocket });
    await tick(10);

    const socket = MockSocket.instances[0];
    const started = Date.now();
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      const batch = Array.from({ length: 100 }, () => ev(++seq));
      socket.emit("message", JSON.stringify({ type: "events_batch", data: batch }));
      await tick(100);
    }
    await tick(150);
    const elapsed = Date.now() - started;

    assert.equal(store.received, 2000);
    assert.equal(store.events.length, 2000);
    assert.ok(elapsed < 3500, `ingest lagged: ${elapsed}ms for 2s of traffic`);
    assert.ok(notifications <= 30, `expected throttled redraws, got ${notifications}`);
    assert.match(app.lastFrame(), /transfer #2000/);
    stream.close();
    app.unmount();
    store.dispose();
  });

  it("replays missed events from the REST API after a reconnect", async () => {
    MockSocket.instances = [];
    const got = [];
    const fetchImpl = async (url) => {
      assert.match(url, /\/api\/events\?limit=200/);
      return { ok: true, json: async () => ({ data: [ev(4), ev(3), ev(2)], next_cursor: null }) };
    };
    const stream = connectStream({ baseUrl: "http://x", onEvents: (e) => got.push(...e.map((x) => x.seq)), WebSocketImpl: MockSocket, fetchImpl });
    await tick(10);
    MockSocket.instances[0].emit("message", JSON.stringify({ type: "events_batch", data: [ev(1), ev(2)] }));
    MockSocket.instances[0].emit("close");
    await tick(1100); // first backoff is ≤1s
    assert.match(MockSocket.instances[1].url, /last_event_id=2/);
    await tick(20);
    assert.deepEqual(got, [1, 2, 3, 4]);
    stream.close();
  });
});

describe("tui profiles", () => {
  it("resolves named profiles and rejects unknown ones", () => {
    const config = { profiles: { testnet: { baseUrl: "https://t", apiKey: "k" } } };
    const defaults = { baseUrl: "http://localhost:3001" };
    assert.deepEqual(resolveProfile(config, { profile: "testnet" }, defaults), { baseUrl: "https://t", apiKey: "k" });
    assert.deepEqual(resolveProfile(config, {}, defaults), defaults);
    assert.throws(() => resolveProfile(config, { profile: "nope" }, defaults), /Unknown profile/);
  });
});
