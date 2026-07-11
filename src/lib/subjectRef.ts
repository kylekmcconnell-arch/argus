const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Normalize a subject for client-side identity maps without corrupting
 * case-sensitive Base58 contracts. Handles, sites, tickers, and EVM addresses
 * remain case-insensitive; valid Solana mints retain their exact case.
 */
export function normalizeSubjectRef(value?: string): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^[@$]+/, "")
    .replace(/\/$/, "");
  if (SOLANA_ADDRESS.test(clean)) return clean;
  if (EVM_ADDRESS.test(clean)) return clean.toLowerCase();
  return clean.toLowerCase();
}

export function sameSubjectRef(left?: string, right?: string): boolean {
  return normalizeSubjectRef(left) === normalizeSubjectRef(right);
}
