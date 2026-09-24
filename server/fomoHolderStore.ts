import { createHash } from "node:crypto";
import { serviceCredentials, serviceHeaders } from "../api/_auth.js";
import { tokenSubjectIdentity } from "../src/lib/tokenIdentity.js";
import { FOMO_REUSE_MAX_AGE_MS, validFomoObservation, type FomoWalletObservation, type StoredFomoEvidence } from "../src/lib/fomoHolderEvidence.js";

/** Only wallet-resolution receipts qualify. Handle names cannot bind a wallet to an X person. */
export function importFomoWalletSweep(raw: string, now = Date.now()): FomoWalletObservation[] {
  const input = JSON.parse(raw);
  if (!input || !Array.isArray(input.rows) || input.rows.length > 10000 || !Number.isFinite(Date.parse(input.generatedAt)) || Date.parse(input.generatedAt) > now) throw new Error("Invalid wallet sweep receipt");
  const receiptHash = createHash("sha256").update(raw).digest("hex");
  const observations: FomoWalletObservation[] = [];
  for (const row of input.rows) {
    if (!["hit", "miss"].includes(row.state)) continue;
    const identity = tokenSubjectIdentity(row.chain, row.address);
    if (!identity || identity.chain !== row.chain || row.chain === "evm") throw new Error("An exact chain and wallet are required");
    const resolved = row.chain === "solana" ? row.fomo?.solanaAddress : row.fomo?.evmAddress;
    if (row.state === "hit" && (!row.fomo?.id || typeof row.fomo?.handle !== "string" || !row.fomo.handle.trim()
      || tokenSubjectIdentity(row.chain, resolved)?.ref !== identity.ref)) throw new Error("Fomo response does not bind the requested wallet");
    const observation: FomoWalletObservation = { chain: identity.chain, address: identity.address, capturedAt: input.generatedAt,
      sourceUrl: `https://api.fomoscan.sh/v2/user/wallet/${encodeURIComponent(identity.address)}`, receiptHash,
      state: row.state === "hit" ? "reported" : "unlabelled",
      ...(row.state === "hit" ? { label: row.fomo.handle, ...(typeof row.fomo.twitter === "string" ? { twitter: row.fomo.twitter.slice(0, 100) } : {}) } : {}) };
    if (!validFomoObservation(observation)) throw new Error("Invalid Fomo observation");
    if (observations.some(item => item.chain === observation.chain && item.address === observation.address)) throw new Error("Duplicate wallet receipt requires reconciliation");
    observations.push(observation);
  }
  return observations;
}

export async function readStoredFomo(organizationId: string | undefined, chain: string, addresses: string[], fetchImpl = fetch): Promise<StoredFomoEvidence> {
  const credentials = serviceCredentials();
  if (!credentials || !organizationId) return { state: "not-configured", rows: [] };
  if (!addresses.length) return { state: "available", rows: [] };
  const ids = addresses.map(address => tokenSubjectIdentity(chain, address));
  if (addresses.length > 25 || ids.some(id => !id || id.chain !== chain)) return { state: "unavailable", rows: [] };
  const query = new URLSearchParams({ organization_id: `eq.${organizationId}`, chain: `eq.${chain}`,
    address: `in.(${ids.map(id => id!.address).join(",")})`, captured_at: `gte.${new Date(Date.now() - FOMO_REUSE_MAX_AGE_MS).toISOString()}`,
    order: "captured_at.desc,receipt_hash.asc", limit: "1001", select: "organization_id,chain,address,captured_at,source_url,receipt_hash,state,label,twitter" });
  try {
    const response = await fetchImpl(`${credentials.url}/rest/v1/fomo_wallet_observations?${query}`, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { state: "unavailable", rows: [] };
    const data = await response.json();
    if (!Array.isArray(data) || data.length > 1000) return { state: "unavailable", rows: [] };
    const wanted = new Set(ids.map(id => id!.address));
    const latest = new Map<string, FomoWalletObservation>();
    for (const row of data) {
      const observation = { chain: row.chain, address: row.address, capturedAt: row.captured_at, sourceUrl: row.source_url, receiptHash: row.receipt_hash, state: row.state, label: row.label, twitter: row.twitter };
      if (row.organization_id !== organizationId || row.chain !== chain || !wanted.has(row.address) || !validFomoObservation(observation)) return { state: "unavailable", rows: [] };
      const previous = latest.get(row.address);
      if (previous && previous.capturedAt === observation.capturedAt && (previous.state !== observation.state || previous.label !== observation.label || previous.twitter !== observation.twitter)) return { state: "unavailable", rows: [] };
      if (!previous || Date.parse(previous.capturedAt) < Date.parse(observation.capturedAt)) latest.set(row.address, observation);
    }
    return { state: "available", rows: [...latest.values()] };
  } catch { return { state: "unavailable", rows: [] }; }
}
