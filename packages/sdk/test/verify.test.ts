import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { canonicalize, verifySignedResponse, type ExplorerKey, type SignedEnvelope } from '../src/verify';

// Mirrors indexer/src/signing.js: Ed25519 over the JCS form of the envelope.
function sign(payload: unknown, keyId: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const unsigned = { payload, ledger: 42, issued_at: '2026-01-01T00:00:00.000Z', key_id: keyId };
  const signature = crypto.sign(null, Buffer.from(canonicalize(unsigned)), privateKey).toString('base64url');
  const key: ExplorerKey = {
    key_id: keyId,
    alg: 'Ed25519',
    public_key: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    status: 'active',
    not_before: null,
    not_after: null,
  };
  return { envelope: { ...unsigned, signature } as SignedEnvelope, key };
}

describe('verifySignedResponse', () => {
  it('accepts an untampered envelope', async () => {
    const { envelope, key } = sign({ data: [{ seq: 1 }] }, 'k1');
    expect(await verifySignedResponse(envelope, [key])).toEqual({ valid: true, status: 'active' });
  });

  it('rejects any tampering', async () => {
    const { envelope, key } = sign({ data: [{ seq: 1 }] }, 'k1');
    const tampered = { ...envelope, ledger: 43 };
    expect((await verifySignedResponse(tampered, [key])).valid).toBe(false);
  });

  it('distinguishes retired and unknown keys', async () => {
    const { envelope, key } = sign({ ok: true }, 'old');
    expect(await verifySignedResponse(envelope, [{ ...key, status: 'retired' }])).toEqual({
      valid: true,
      status: 'retired',
    });
    expect(await verifySignedResponse(envelope, [])).toEqual({ valid: false, status: 'unknown_key' });
  });
});
