import DataLakeSource from '../src/sources/dataLakeSource.js';

describe('DataLakeSource', () => {
  it('returns deterministic ordered ledgers and reports missing files as gaps', async () => {
    const source = new DataLakeSource({
      baseUrl: 'https://lake.test', schema: { ledgersPerFile: 2, filesPerPartition: 10 },
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('fixture') }),
      decompress: (value) => value,
      decodeBatch: async () => ({ ledgers: [{ sequence: 3, events: [{ id: 'e3' }] }, { sequence: 2, events: [{ id: 'e2' }] }] }),
    });
    const result = await source.readRange(2, 3);
    expect(result.ledgers.map((ledger) => ledger.sequence)).toEqual([2, 3]);
  });
});
