import { tokenSubjectIdentity } from "./tokenIdentity.js";
import type { HolderIntelligence } from "./holderIntelligence.js";
export interface FomoWalletObservation {
  chain: string; address: string; capturedAt: string; sourceUrl: string; receiptHash: string;
  state: "reported" | "unlabelled"; label?: string; twitter?: string;
}
export interface StoredFomoEvidence {
  state: "available" | "unavailable" | "not-configured";
  rows: FomoWalletObservation[];
}
export const FOMO_REUSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export function validFomoObservation(row: FomoWalletObservation): boolean {
  const identity = tokenSubjectIdentity(row?.chain, row?.address);
  if (!identity || identity.chain !== row.chain || identity.address !== row.address || row.chain === "evm"
    || !Number.isFinite(Date.parse(row.capturedAt)) || !/^[a-f0-9]{64}$/.test(row.receiptHash)
    || !["reported", "unlabelled"].includes(row.state)
    || (row.state === "reported" && (typeof row.label !== "string" || !row.label.trim() || row.label.length > 200))) return false;
  return row.sourceUrl === `https://api.fomoscan.sh/v2/user/wallet/${encodeURIComponent(row.address)}`;
}
/** Stored, chain-scoped provider attribution. Never a fresh lookup or a score input. */
export function attachStoredFomo(snapshot: HolderIntelligence, evidence: StoredFomoEvidence, readAt: string): HolderIntelligence {
  const unavailable = (state: "unavailable" | "not-configured") => ({ ...snapshot, enrichment: { ...snapshot.enrichment, fomo: state } });
  if (!evidence || !Array.isArray(evidence.rows) || !Number.isFinite(Date.parse(readAt))) return unavailable("unavailable");
  if (evidence.state !== "available") return unavailable(evidence.state === "not-configured" ? "not-configured" : "unavailable");
  const requested = new Set(snapshot.rows.map(row => row.address));
  const map = new Map<string, FomoWalletObservation>();
  for (const row of evidence.rows) {
    if (!validFomoObservation(row) || row.chain !== snapshot.chain || !requested.has(row.address) || map.has(row.address)) return unavailable("unavailable");
    const age = Date.parse(readAt) - Date.parse(row.capturedAt);
    if (age < 0 || age > FOMO_REUSE_MAX_AGE_MS) continue;
    map.set(row.address, row);
  }
  const rows = snapshot.rows.map(row => {
    const observation = map.get(row.address);
    return !observation ? row : { ...row, identities: [...(row.identities ?? []).filter(item => item.provider !== "fomo"), {
      provider: "fomo" as const, state: observation.state, label: observation.label, twitter: observation.twitter,
      capturedAt: observation.capturedAt, sourceUrl: observation.sourceUrl, receiptHash: observation.receiptHash,
      scope: "provider-address-label" as const,
    }] };
  });
  const state = map.size === 0 ? "no-stored-evidence" : map.size === rows.length ? "complete" : "partial";
  return { ...snapshot, rows, enrichment: { ...snapshot.enrichment, fomo: state } };
}
