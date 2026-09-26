import { upsertEventRollups } from '../src/rollups.js';

describe('incremental rollups', () => {
  it('upserts contract and function hourly buckets', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await upsertEventRollups(client, { contract_id: 'C1', function: 'transfer', fee_charged: 3, created_at: '2026-01-01T01:22:00Z' });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][0]).toContain('rollup_contract_hourly');
  });
});
