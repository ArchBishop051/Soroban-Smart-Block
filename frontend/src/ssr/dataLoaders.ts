/**
 * Shared data loaders for SSR and client-side hydration.
 * These functions fetch data from the indexer API and can be called
 * both on the server (during SSR) and on the client (for hydration).
 */

const API_BASE = process.env.API_URL || "http://localhost:3001";

export interface ContractData {
  id: string;
  name?: string;
  description?: string;
  spec_type?: string;
  registered_at?: string;
}

export interface TokenData {
  id: string;
  name?: string;
  symbol?: string;
  decimals?: number;
}

export interface TransactionData {
  hash: string;
  ledger: number;
  success: boolean;
  fee_paid?: number;
  created_at?: string;
}

export interface EventData {
  seq: number;
  contract_id?: string;
  function?: string;
  type?: string;
  created_at?: string;
}

export interface LedgerData {
  seq: number;
  hash?: string;
  transaction_count?: number;
  operation_count?: number;
  created_at?: string;
}

/**
 * Fetch contract data for SSR
 */
export async function loadContractData(contractId: string): Promise<ContractData | null> {
  try {
    const response = await fetch(`${API_BASE}/api/contracts/${contractId}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to load contract ${contractId}:`, error);
    return null;
  }
}

/**
 * Fetch token data for SSR
 */
export async function loadTokenData(tokenId: string): Promise<TokenData | null> {
  try {
    const response = await fetch(`${API_BASE}/api/tokens/${tokenId}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to load token ${tokenId}:`, error);
    return null;
  }
}

/**
 * Fetch transaction data for SSR
 */
export async function loadTransactionData(txHash: string): Promise<TransactionData | null> {
  try {
    const response = await fetch(`${API_BASE}/api/transactions/${txHash}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to load transaction ${txHash}:`, error);
    return null;
  }
}

/**
 * Fetch event data for SSR
 */
export async function loadEventData(eventSeq: string): Promise<EventData | null> {
  try {
    const response = await fetch(`${API_BASE}/api/events/${eventSeq}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to load event ${eventSeq}:`, error);
    return null;
  }
}

/**
 * Fetch ledger data for SSR
 */
export async function loadLedgerData(ledgerSeq: string): Promise<LedgerData | null> {
  try {
    const response = await fetch(`${API_BASE}/api/ledgers/${ledgerSeq}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to load ledger ${ledgerSeq}:`, error);
    return null;
  }
}

/**
 * Load data based on route pattern
 */
export async function loadDataForRoute(url: string) {
  const contractMatch = url.match(/^\/contract\/(.+)$/);
  if (contractMatch) {
    return loadContractData(contractMatch[1]);
  }

  const tokenMatch = url.match(/^\/token\/(.+)$/);
  if (tokenMatch) {
    return loadTokenData(tokenMatch[1]);
  }

  const txMatch = url.match(/^\/tx\/(.+)$/);
  if (txMatch) {
    return loadTransactionData(txMatch[1]);
  }

  const eventMatch = url.match(/^\/event\/(.+)$/);
  if (eventMatch) {
    return loadEventData(eventMatch[1]);
  }

  const ledgerMatch = url.match(/^\/ledger\/(.+)$/);
  if (ledgerMatch) {
    return loadLedgerData(ledgerMatch[1]);
  }

  return null;
}
