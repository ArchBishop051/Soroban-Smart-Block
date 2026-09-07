import { useState, useEffect, useCallback } from 'react';
import {
  isConnected,
  getAddress,
  getNetwork,
  requestAccess,
} from '@stellar/freighter-api';

export interface FreighterState {
  available: boolean;
  connected: boolean;
  publicKey: string | null;
  network: string | null;
  connecting: boolean;
  error: string | null;
}

/** Unwrap a Freighter API response of the shape `{ ...data, error? }`. */
function unwrap<T extends { error?: unknown }>(res: T): Omit<T, 'error'> {
  if (res.error) {
    throw new Error(
      typeof res.error === 'string' ? res.error : 'Freighter request failed',
    );
  }
  return res;
}

export function useFreighter() {
  const [state, setState] = useState<FreighterState>({
    available: false,
    connected: false,
    publicKey: null,
    network: null,
    connecting: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const { isConnected: available } = unwrap(await isConnected());
        if (!available) {
          if (!cancelled) setState((s) => ({ ...s, available: false }));
          return;
        }
        // `getAddress` resolves with an address only if the user has already
        // granted access; otherwise it returns an error we treat as "not yet
        // connected" rather than surfacing it.
        const addrRes = await getAddress();
        if (addrRes.error || !addrRes.address) {
          if (!cancelled) {
            setState((s) => ({
              ...s,
              available: true,
              connected: false,
              publicKey: null,
            }));
          }
          return;
        }
        const { network } = unwrap(await getNetwork());
        if (!cancelled) {
          setState({
            available: true,
            connected: true,
            publicKey: addrRes.address,
            network,
            connecting: false,
            error: null,
          });
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, available: false }));
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const { address } = unwrap(await requestAccess());
      const { network } = unwrap(await getNetwork());
      setState({
        available: true,
        connected: true,
        publicKey: address,
        network,
        connecting: false,
        error: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setState((s) => ({ ...s, connecting: false, error: message }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState((s) => ({ ...s, connected: false, publicKey: null, network: null, error: null }));
  }, []);

  return { ...state, connect, disconnect };
}
