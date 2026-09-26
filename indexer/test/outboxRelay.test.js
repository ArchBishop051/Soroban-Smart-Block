import { enqueueOutbox } from '../src/outboxRelay.js';

describe('transactional outbox', () => {
  it('writes a stable event id and payload through the transaction client', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1, event_id: 'seq-1' }] }) };
    const row = await enqueueOutbox(client, { payload: { seq: 1 } }, { eventId: 'seq-1' });
    expect(row.event_id).toBe('seq-1');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('indexer_outbox'), ['seq-1', 'event', JSON.stringify({ seq: 1 })]);
  });
});
