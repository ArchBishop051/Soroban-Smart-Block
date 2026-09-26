jest.mock('../src/db.js', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));

import { reconcileBalance } from '../src/balanceReconciler.js';

describe('balance reconciler', () => {
  it('records and corrects a drift at the observed ledger', async () => {
    const result = await reconcileBalance({ tokenId: 'token', holder: 'Gholder', ledger: 12, derivedBalance: 10, fetchBalance: async () => 14 });
    expect(result).toMatchObject({ status: 'corrected', onChain: 14, magnitude: 4, ledger: 12 });
  });
});
