export function resolveStartupCursor(savedCursor, maxIndexedLedger, initialCursor) {
  if (Number.isInteger(savedCursor) && savedCursor > 0) return savedCursor;
  if (Number.isInteger(maxIndexedLedger) && maxIndexedLedger > 0) return maxIndexedLedger;
  return initialCursor;
}