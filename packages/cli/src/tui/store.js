/**
 * Bounded event buffer backing the TUI. Ingest is O(batch); subscribers are
 * notified at most once per `throttleMs`, so 1k+ events/s never trigger 1k
 * redraws. While paused, arrivals are queued and flushed on resume.
 */

export const eventKey = (ev) => `${ev.contract_id}:${ev.ledger}:${ev.tx_hash}`;

export class EventStore {
  constructor({ capacity = 5000, throttleMs = 100 } = {}) {
    this.capacity = capacity;
    this.throttleMs = throttleMs;
    this.events = []; // newest first
    this.keys = new Set();
    this.pending = [];
    this.paused = false;
    this.received = 0;
    this.listeners = new Set();
    this.timer = null;
    this.version = 0; // bumped on every (throttled) notification
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.version++;
      for (const fn of this.listeners) fn();
    }, this.throttleMs);
  }

  add(batch) {
    this.received += batch.length;
    if (this.paused) {
      this.pending.push(...batch);
    } else {
      this.ingest(batch);
    }
    this.notify();
  }

  ingest(batch) {
    const fresh = [];
    for (const ev of batch) {
      const key = eventKey(ev);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      fresh.push(ev);
    }
    this.events = fresh.reverse().concat(this.events);
    if (this.events.length > this.capacity) {
      for (const ev of this.events.splice(this.capacity)) this.keys.delete(eventKey(ev));
    }
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused && this.pending.length) {
      this.ingest(this.pending);
      this.pending = [];
    }
    this.notify();
  }

  dispose() {
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
