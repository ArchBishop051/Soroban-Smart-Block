import { Keypair } from "@stellar/stellar-sdk";

export const SOURCE_VERIFICATION_DOMAIN = "soroban-source-verification:v1";

export function sourceVerificationMessage(wasmHash, compilerHash) {
  return `${SOURCE_VERIFICATION_DOMAIN}:${wasmHash}:${compilerHash}`;
}

export function verifySourceVerification({ wasm_hash, signer, signature, compiler_hash }) {
  if (!/^[a-f0-9]{64}$/.test(wasm_hash) || !/^[a-f0-9]{64}$/.test(compiler_hash)) {
    return false;
  }

  try {
    const keypair = Keypair.fromPublicKey(signer);
    const signatureBytes = Buffer.from(signature, "base64");
    if (signatureBytes.length !== 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    return keypair.verify(Buffer.from(sourceVerificationMessage(wasm_hash, compiler_hash)), signatureBytes);
  } catch {
    return false;
  }
}
