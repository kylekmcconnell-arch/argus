import { recordCall } from "../server/cost.js";
import { fetchAddressLabelsBatch, ARKHAM_INTEL_BATCH } from "./_arkham-core.js";
import { tokenSubjectIdentity } from "../src/lib/tokenIdentity.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";
import type { HolderIdentityBatch, HolderIdentityCollector } from "../src/lib/holderEnrichment.js";

export const collectHolderIdentities: HolderIdentityCollector = async (chain, addresses) => {
  const ids = addresses.map(address => tokenSubjectIdentity(chain, address));
  if (addresses.length > 25 || ids.some(id => !id || id.chain !== chain)) throw new Error("Invalid holder identities");
  const targets = [...new Set(ids.map(id => id!.address))];
  const base: HolderIdentityBatch = { chain, provider: "arkham", capturedAt: new Date().toISOString(),
    state: "not-configured", sourceUrl: ARKHAM_INTEL_BATCH, scope: "provider-address-label", rows: [] };
  const key = process.env.ARKHAM_API_KEY;
  if (!key || !targets.length) return base;
  const result = await fetchAddressLabelsBatch(targets, key, 8000);
  recordCall("arkham", "holder-identities", 0, `${targets.length} addresses, subscription-backed`, result.outcome === "answered" ? "succeeded" : "failed");
  if (result.outcome !== "answered") return { ...base, state: "unavailable" };
  const rows = targets.map(address => {
    const label = result.rows.get(providerAddressKey(address));
    return { address, state: !label ? "unavailable" as const : label.name ? "reported" as const : "unlabelled" as const,
      ...(label?.name ? { label: label.name, entityType: label.type, twitter: label.twitter } : {}) };
  });
  return { ...base, state: rows.every(row => row.state !== "unavailable") ? "complete" : "partial", rows };
};
