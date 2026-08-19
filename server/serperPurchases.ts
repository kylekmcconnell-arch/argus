// Append-only Serper credit purchase ledger. Serper has no public purchase
// history API, so each top-up is recorded here and rendered on Data sources.
// Future purchases are appended to SERPER_PURCHASES — keep this data, not UI copy.

export interface SerperPurchase {
  purchasedAt: string;
  usd: number;
  credits: number;
  pack: string;
  expiresAt: string;
}

export interface SerperPurchaseView extends SerperPurchase {
  active: boolean;
}

/** Paid Serper credits expire 6 months after purchase (America/Cancun calendar). */
export const SERPER_PURCHASES: readonly SerperPurchase[] = [
  {
    purchasedAt: "2026-08-19T16:00:00.000Z",
    usd: 50,
    credits: 50_000,
    pack: "Starter",
    expiresAt: "2027-02-19",
  },
];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive end of the expiry calendar day in America/Cancun (UTC-5). */
export function purchaseExpiryInstant(expiresAt: string): Date {
  const trimmed = expiresAt.trim();
  if (DATE_ONLY.test(trimmed)) return new Date(`${trimmed}T23:59:59.999-05:00`);
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

export function isPurchaseActive(purchase: SerperPurchase, now: Date = new Date()): boolean {
  return now.getTime() <= purchaseExpiryInstant(purchase.expiresAt).getTime();
}

export function listSerperPurchases(now: Date = new Date()): SerperPurchaseView[] {
  return SERPER_PURCHASES
    .map((purchase) => ({ ...purchase, active: isPurchaseActive(purchase, now) }))
    .slice()
    .sort((a, b) => Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt));
}

export function activeCreditTotal(purchases: readonly SerperPurchase[] = SERPER_PURCHASES, now: Date = new Date()): number {
  return purchases
    .filter((purchase) => isPurchaseActive(purchase, now))
    .reduce((sum, purchase) => sum + Math.max(0, purchase.credits), 0);
}

export function latestPurchase(purchases: readonly SerperPurchase[] = SERPER_PURCHASES): SerperPurchase | null {
  return purchases.slice().sort((a, b) => Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt))[0] ?? null;
}

export function earliestActivePurchase(
  purchases: readonly SerperPurchase[] = SERPER_PURCHASES,
  now: Date = new Date(),
): SerperPurchase | null {
  const active = purchases.filter((purchase) => isPurchaseActive(purchase, now));
  if (active.length === 0) return null;
  return active.slice().sort((a, b) => Date.parse(a.purchasedAt) - Date.parse(b.purchasedAt))[0] ?? null;
}
