export interface EventInclusionProof {
  leaf: string;
  siblings: string[];
  left: boolean[];
  root: string;
  leafCount: number;
}

/** Verify an event inclusion proof produced by the explorer indexer. */
export async function verifyEventInclusion(
  eventXdr: Uint8Array,
  proof: EventInclusionProof,
): Promise<boolean> {
  const digest = async (bytes: Uint8Array) =>
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let current = await digest(eventXdr);
  const expected = proof.leaf.toLowerCase();
  if (Array.from(current, (b) => b.toString(16).padStart(2, "0")).join("") !== expected) return false;
  for (let i = 0; i < proof.siblings.length; i += 1) {
    const sibling = Uint8Array.from(proof.siblings[i].match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
    const pair = new Uint8Array(64);
    if (proof.left[i]) { pair.set(sibling); pair.set(current, 32); }
    else { pair.set(current); pair.set(sibling, 32); }
    current = await digest(pair);
  }
  return Array.from(current, (b) => b.toString(16).padStart(2, "0")).join("") === proof.root.toLowerCase();
}
