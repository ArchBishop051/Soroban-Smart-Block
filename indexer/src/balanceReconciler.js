import { pool } from './db.js';
import { logger } from './logger.js';

/** Compare derived holder balances with an on-chain observation at one ledger. */
export async function reconcileBalance({ tokenId, holder, ledger, derivedBalance, fetchBalance }) {
  let observed;
  try { observed = await fetchBalance(tokenId, holder, ledger); } catch (error) {
    return { status: 'unknown', tokenId, holder, ledger, error: error.message };
  }
  const derived = Number(derivedBalance || 0);
  const onChain = Number(observed);
  const magnitude = Math.abs(onChain - derived);
  const status = magnitude === 0 ? 'matched' : 'corrected';
  await pool.query(`INSERT INTO balance_drift (token_id,holder,observed_ledger,derived,on_chain,magnitude,status) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tokenId, holder, ledger, derived, onChain, magnitude, status]);
  if (magnitude > 0) logger.warn({ tokenId, holder, ledger, derived, onChain }, 'token balance drift detected');
  return { status, tokenId, holder, ledger, derived, onChain, magnitude };
}

export function startBalanceReconciler({ listCandidates, fetchBalance, intervalMs = 60_000, maxPerRun = 20 } = {}) {
  const run = async () => {
    const candidates = (await listCandidates?.()) || [];
    for (const candidate of candidates.slice(0, maxPerRun)) await reconcileBalance({ ...candidate, fetchBalance });
  };
  const timer = setInterval(() => run().catch((error) => logger.error({ err: error.message }, 'balance reconciliation failed')), intervalMs);
  return { run, stop: () => clearInterval(timer) };
}
