import crypto from "node:crypto";

export function hashLeaf(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashPair(left, right) {
  return hashLeaf(Buffer.concat([Buffer.from(left, "hex"), Buffer.from(right, "hex")]));
}

export class EventMmr {
  constructor() { this.peaks = []; this.leafCount = 0; }
  append(leaf) {
    let carry = leaf;
    let level = 0;
    while ((this.leafCount & (1 << level)) !== 0) {
      carry = hashPair(this.peaks[level], carry);
      this.peaks[level] = null;
      level += 1;
    }
    this.peaks[level] = carry;
    this.leafCount += 1;
    return this.root();
  }
  root() {
    let root = null;
    for (const peak of this.peaks) if (peak) root = root ? hashPair(peak, root) : peak;
    return { root: root ?? "00".repeat(32), leafCount: this.leafCount };
  }
}
