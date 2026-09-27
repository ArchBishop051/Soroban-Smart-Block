export function createIngestPipeline({
  concurrency = 4,
  batchSize = 64,
  maxQueue = 2000,
  processBatch = async () => {},
  logger = console,
} = {}) {
  const queue = [];
  let activeWorkers = 0;
  const pendingDrains = [];

  const notifyDrain = () => {
    if (queue.length === 0 && activeWorkers === 0) {
      const resolvers = pendingDrains.splice(0);
      for (const resolve of resolvers) resolve();
    }
  };

  const schedule = () => {
    while (queue.length > 0 && activeWorkers < concurrency) {
      const batch = queue.splice(0, Math.min(batchSize, queue.length));
      if (!batch.length) break;

      activeWorkers += 1;
      Promise.resolve(processBatch(batch))
        .then(() => {
          activeWorkers -= 1;
          notifyDrain();
          schedule();
        })
        .catch((err) => {
          activeWorkers -= 1;
          logger.error?.({ err: err.message }, "ingest batch failed");
          notifyDrain();
          schedule();
        });
    }
  };

  return {
    get queueDepth() {
      return queue.length;
    },
    get active() {
      return activeWorkers;
    },
    enqueue(items) {
      const input = Array.isArray(items) ? items : [items];
      if (!input.length) return { accepted: 0, dropped: 0 };

      const overflow = Math.max(0, queue.length + input.length - maxQueue);
      const accepted = Math.max(0, input.length - overflow);
      const dropped = input.length - accepted;

      if (accepted > 0) {
        queue.push(...input.slice(0, accepted));
        schedule();
      }

      return { accepted, dropped };
    },
    async drain() {
      if (queue.length === 0 && activeWorkers === 0) return;
      await new Promise((resolve) => pendingDrains.push(resolve));
    },
  };
}
