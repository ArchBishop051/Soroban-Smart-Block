import { canonicalJson, rowKey } from "./canonical.js";

export function diffRows(actual, expected, keys) {
  const left = new Map((actual || []).map((row) => [rowKey(row, keys), row]));
  const right = new Map((expected || []).map((row) => [rowKey(row, keys), row]));
  const added = [], removed = [], changed = [];
  for (const [key, row] of right) if (!left.has(key)) added.push(row);
  for (const [key, row] of left) if (!right.has(key)) removed.push(row);
  for (const [key, before] of left) {
    const after = right.get(key);
    if (!after) continue;
    const fields = {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (canonicalJson(before[field]) !== canonicalJson(after[field])) fields[field] = { before: before[field] ?? null, after: after[field] ?? null };
    }
    if (Object.keys(fields).length) changed.push({ key, fields });
  }
  return { added, removed, changed, summary: { added: added.length, removed: removed.length, changed: changed.length } };
}
