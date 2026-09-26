import config from '../config.js';
import DataLakeSource from './dataLakeSource.js';

export function createLedgerSource({ rpc, decodeBatch, fetchImpl } = {}) {
  const source = config.DATALAKE_URL && config.DATALAKE_ENABLED && config.RPC_RETENTION_LEDGERS
    ? new DataLakeSource({ baseUrl: config.DATALAKE_URL, schema: config.DATALAKE_SCHEMA, decodeBatch, fetchImpl })
    : null;
  return {
    sourceFor(ledger) {
      if (source && ledger < config.LATEST_LEDGER - config.RPC_RETENTION_LEDGERS) return source;
      return rpc;
    },
    dataLake: source,
  };
}
