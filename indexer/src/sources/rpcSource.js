/** Source adapter for the existing Soroban RPC event stream. */
export class RpcSource {
  constructor(rpc, { limit = 200, filters = [{ type: 'contract' }] } = {}) {
    this.rpc = rpc;
    this.limit = limit;
    this.filters = filters;
  }

  async readRange(from, to) {
    const events = [];
    let cursor;
    let latestLedger = from;
    do {
      const response = await this.rpc.getEvents({
        startLedger: cursor ? undefined : from,
        endLedger: to,
        filters: this.filters,
        limit: this.limit,
        ...(cursor ? { cursor } : {}),
      });
      latestLedger = response.latestLedger ?? latestLedger;
      events.push(...(response.events || []).filter((event) => event.ledger >= from && event.ledger <= to));
      cursor = response.events?.length === this.limit ? response.cursor : undefined;
    } while (cursor);
    return { events, latestLedger };
  }
}

export default RpcSource;
