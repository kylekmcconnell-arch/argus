import type { HolderIntelligence } from "./holderIntelligence";
import { tokenSubjectIdentity } from "./tokenIdentity.js";
export interface HolderChange {
  kind: "newly-observed-indexed-wallet" | "share-change" | "no-longer-observed-indexed-wallet";
  address: string;
  before: number | null;
  after: number | null;
  registryNames: string[];
}
/** Comparable ranked observations, never inferred trades or inferred common control. */
export function compareHolderObservations(before?: HolderIntelligence, after?: HolderIntelligence): HolderChange[] {
  if (!before || !after || before.version !== 1 || after.version !== 1) return [];
  const validRows = (snapshot: HolderIntelligence) => Array.isArray(snapshot.rows) && snapshot.rows.length > 0 && snapshot.rows.length <= 25
    && snapshot.rows.every(row => row && tokenSubjectIdentity(snapshot.chain, row.address) && Number.isFinite(row.percent) && row.percent >= 0 && row.percent <= 100
      && Array.isArray(row.matches) && row.matches.every(match => match && typeof match.name === "string"))
    && snapshot.rows.reduce((sum, row) => sum + row.percent, 0) <= 100.01
    && snapshot.examined === snapshot.rows.length && snapshot.invalidRows === 0
    && new Set(snapshot.rows.map(row => tokenSubjectIdentity(snapshot.chain, row.address)?.ref)).size === snapshot.rows.length;
  if (!validRows(before) || !validRows(after)) return [];
  const oldIdentity = tokenSubjectIdentity(before.chain, before.tokenAddress);
  const newIdentity = tokenSubjectIdentity(after.chain, after.tokenAddress);
  if (!oldIdentity || oldIdentity.ref !== newIdentity?.ref) return [];
  if (before.status !== "complete" || after.status !== "complete" || before.ranking !== "ranked-addresses" || after.ranking !== "ranked-addresses") return [];
  if (before.source !== after.source || before.supplyCoveredPct == null || after.supplyCoveredPct == null) return [];
  const previousTime = Date.parse(before.capturedAt), currentTime = Date.parse(after.capturedAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) return [];
  const key = (address: string) => tokenSubjectIdentity(before.chain, address)?.ref;
  const oldRows = new Map(before.rows.map(row => [key(row.address), row]));
  const newRows = new Map(after.rows.map(row => [key(row.address), row]));
  const comparableRegistry = before.registryVersion === after.registryVersion;
  const isWallet = (role: string) => role === "unattributed" || role === "unclassified-contract";
  const changes: HolderChange[] = [];
  for (const row of after.rows) {
    if (!isWallet(row.role)) continue;
    const old = oldRows.get(key(row.address));
    const registryNames = [...new Set(row.matches.map(match => match.name))];
    if (!old && registryNames.length && comparableRegistry) {
      changes.push({ kind: "newly-observed-indexed-wallet", address: row.address, before: null, after: row.percent, registryNames });
    } else if (old && isWallet(old.role) && Math.abs(row.percent - old.percent) >= 2) {
      changes.push({ kind: "share-change", address: row.address, before: old.percent, after: row.percent, registryNames });
    }
  }
  for (const old of before.rows) if (isWallet(old.role) && comparableRegistry && old.matches.length && !newRows.has(key(old.address))) {
    changes.push({ kind: "no-longer-observed-indexed-wallet", address: old.address, before: old.percent, after: null, registryNames: [...new Set(old.matches.map(match => match.name))] });
  }
  return changes;
}
