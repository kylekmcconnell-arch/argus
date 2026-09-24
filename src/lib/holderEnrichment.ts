import { attachStoredFomo, type StoredFomoEvidence } from "./fomoHolderEvidence.js";
import { tokenSubjectIdentity } from "./tokenIdentity.js";
import type { HolderIntelligence } from "./holderIntelligence.js";

export interface HolderIdentityReading {
  address: string;
  state: "reported" | "unlabelled" | "unavailable";
  label?: string;
  entityType?: string;
  twitter?: string;
}
export interface HolderIdentityBatch {
  storedFomo?: StoredFomoEvidence;
  chain: string;
  provider: "arkham";
  capturedAt: string;
  state: "complete" | "partial" | "unavailable" | "not-configured";
  sourceUrl: string;
  /** Arkham's all-chain address labels do not prove control on this chain. */
  scope: "provider-address-label";
  rows: HolderIdentityReading[];
}
export type HolderIdentityCollector = (chain: string, addresses: string[]) => Promise<HolderIdentityBatch>;

/** Joins only exact requested identities. Provider labels never alter scores or curated memberships. */
export function attachHolderIdentities(snapshot: HolderIntelligence, batch: HolderIdentityBatch): HolderIntelligence {
  const validTime = Number.isFinite(Date.parse(batch?.capturedAt));
  if (!validTime || batch?.chain !== snapshot.chain || batch.provider !== "arkham" || batch.scope !== "provider-address-label"
    || !["complete", "partial", "unavailable", "not-configured"].includes(batch.state)
    || !Array.isArray(batch.rows) || batch.rows.length > 25) return snapshot;
  const requested = new Set(snapshot.rows.map(row => tokenSubjectIdentity(snapshot.chain, row.address)?.ref));
  const readings = new Map<string, HolderIdentityReading>();
  for (const row of batch.rows) {
    const id = tokenSubjectIdentity(batch.chain, row?.address);
    if (!id || !requested.has(id.ref) || readings.has(id.ref)
      || !["reported", "unlabelled", "unavailable"].includes(row.state)) return snapshot;
    readings.set(id.ref, row);
  }
  const rows = snapshot.rows.map(row => {
    const reading = readings.get(tokenSubjectIdentity(snapshot.chain, row.address)!.ref);
    return { ...row, identities: [{ provider: "arkham" as const, capturedAt: batch.capturedAt,
      sourceUrl: "https://api.arkm.com/intelligence/address_enriched/batch/all", scope: batch.scope,
      state: reading?.state === "reported" && (typeof reading.label !== "string" || !reading.label.trim())
        ? "unavailable" as const : reading?.state ?? "unavailable" as const,
      ...(reading?.state === "reported" && typeof reading.label === "string" && reading.label.trim() ? {
        label: reading.label.slice(0, 200),
        ...(typeof reading.entityType === "string" ? { entityType: reading.entityType.slice(0, 80) } : {}),
        ...(typeof reading.twitter === "string" ? { twitter: reading.twitter.slice(0, 100) } : {}),
      } : {}),
    }] };
  });
  const answered = rows.filter(row => row.identities[0].state !== "unavailable").length;
  const state = batch.state === "not-configured" ? "not-configured" : !answered ? "unavailable" : answered === rows.length ? "complete" : "partial";
  return { ...snapshot, rows, enrichment: { ...snapshot.enrichment, arkham: state } };
}
export async function enrichHolderSnapshot(snapshot: HolderIntelligence, collect: HolderIdentityCollector): Promise<HolderIntelligence> {
  if (!snapshot.rows.length) return snapshot;
  try {
    const batch = await collect(snapshot.chain, snapshot.rows.map(row => row.address));
    const enriched = attachHolderIdentities(snapshot, batch);
    const result = enriched === snapshot ? { ...snapshot, enrichment: { ...snapshot.enrichment, arkham: "unavailable" as const } } : enriched;
    return batch.storedFomo ? attachStoredFomo(result, batch.storedFomo, batch.capturedAt) : result;
  }
  catch { return { ...snapshot, enrichment: { ...snapshot.enrichment, arkham: "unavailable" } }; }
}
export function holderIdentityRoute(fetchImpl: typeof fetch = fetch): HolderIdentityCollector {
  return async (chain, addresses) => {
    const response = await fetchImpl("/api/holder-enrichment", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, addresses }), signal: AbortSignal.timeout(16000) });
    if (!response.ok) throw new Error("Holder enrichment unavailable");
    return await response.json() as HolderIdentityBatch;
  };
}
