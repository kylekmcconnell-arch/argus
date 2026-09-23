import { CABAL_REGISTRY_VERSION, findCabalWallets } from "../data/cabals";
import { classifyMarketAddress } from "./marketAddresses";
import { tokenSubjectIdentity } from "./tokenIdentity";

export const HOLDER_TARGET = 25;
export interface HolderObservation {
  address: string;
  percent: number;
  owner?: string;
  isContract?: boolean;
  tag?: string;
}
export interface HolderRegistryMatch {
  registryId: string;
  name: string;
  role: string;
  label: string;
  evidence: string;
  lastSeen: string;
  intent: string;
  attribution: "curated-record";
}
export interface HolderIntelligence {
  version: 1;
  chain: string;
  tokenAddress: string;
  capturedAt: string;
  source: string;
  sourceUrl: string | null;
  block: string | null;
  registryVersion: string;
  target: 25;
  status: "complete" | "partial" | "unavailable";
  ranking: "ranked-addresses" | "observed-owners" | "unranked-sample";
  examined: number;
  matched: number;
  supplyCoveredPct: number | null;
  invalidRows: number;
  notes: string[];
  enrichment: { arkham: "not-run"; fomo: "not-run" };
  rows: Array<HolderObservation & {
    rank: number;
    role: "pool" | "exchange" | "locker" | "burn" | "unclassified-contract" | "unattributed";
    roleEvidence: string | null;
    matches: HolderRegistryMatch[];
  }>;
}

/** Frozen observations, not a score or an allegation about the token's team. */
export function buildHolderIntelligence(input: {
  chain: string; tokenAddress: string; capturedAt: string;
  source: string; sourceUrl?: string | null; block?: string | null;
  rows: HolderObservation[]; ranked: boolean; completeUniverse?: boolean;
  poolAddresses?: string[];
  knownAccounts?: Record<string, { name?: string; type?: string }>;
  aggregateOwners?: boolean;
}): HolderIntelligence {
  const identity = tokenSubjectIdentity(input.chain, input.tokenAddress);
  const chain = identity?.chain ?? input.chain;
  const notes: string[] = [];
  let invalidRows = 0;
  const unique = new Map<string, HolderObservation>();
  const accounts = new Set<string>();
  for (const row of input.rows) {
    const address = input.aggregateOwners ? row.owner : row.address;
    const key = tokenSubjectIdentity(chain, address);
    if (!key || !identity || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100) { invalidRows++; continue; }
    const account = tokenSubjectIdentity(chain, row.address)?.ref;
    if (!account || accounts.has(account)) { invalidRows++; continue; }
    accounts.add(account);
    const previous = unique.get(key.ref);
    if (previous) {
      // Duplicate address observations must never be double counted. Solana
      // accounts with an explicit owner can be aggregated, but repeated accounts cannot.
      if (input.aggregateOwners && previous.address !== row.address) previous.percent += row.percent;
      else invalidRows++;
    } else unique.set(key.ref, { ...row, address: row.address, ...(input.aggregateOwners ? { owner: key.address } : {}) });
  }
  const all = [...unique.values()].sort((a, b) => b.percent - a.percent);
  const consistent = all.reduce((sum, row) => sum + row.percent, 0) <= 100.01;
  if (!consistent) notes.push("Provider rows exceed total supply; percentages are not a valid concentration measure.");
  if (invalidRows) notes.push(`${invalidRows} invalid or duplicate provider rows were not used; coverage is incomplete.`);
  if (input.aggregateOwners) notes.push("Token accounts were grouped by their reported owners. Owners outside this provider sample may rank higher.");
  if (!input.ranked) notes.push("The provider sample does not establish the globally largest 25 holders.");
  const rows = all.slice(0, HOLDER_TARGET).map((row, index) => {
    const address = row.owner ?? row.address;
    const market = classifyMarketAddress(address, { poolAddresses: input.poolAddresses, knownAccounts: input.knownAccounts });
    const burn = /^0x0{40}$/i.test(address) || /^0x0{36}dead$/i.test(address);
    const matches = findCabalWallets(chain, address).map(({ cabal, wallet }) => ({
      registryId: cabal.id, name: cabal.name, role: wallet.role,
      label: wallet.label ?? wallet.role, evidence: wallet.evidence,
      lastSeen: cabal.lastSeen, intent: cabal.intent, attribution: "curated-record" as const,
    }));
    return { ...row, address, rank: index + 1,
      role: market?.kind ?? (burn ? "burn" : row.isContract ? "unclassified-contract" : "unattributed") as HolderIntelligence["rows"][number]["role"],
      roleEvidence: market?.label ?? (burn ? "Exact burn address" : null), matches };
  });
  const complete = input.ranked && !input.aggregateOwners && consistent && !invalidRows && (rows.length === HOLDER_TARGET || input.completeUniverse === true);
  if (!complete) notes.push(`${rows.length}/${HOLDER_TARGET} addresses examined; the requested holder investigation remains incomplete.`);
  return {
    version: 1, chain, tokenAddress: identity?.address ?? input.tokenAddress,
    capturedAt: input.capturedAt, source: input.source, sourceUrl: input.sourceUrl ?? null, block: input.block ?? null,
    registryVersion: CABAL_REGISTRY_VERSION, target: HOLDER_TARGET,
    status: !rows.length ? "unavailable" : complete ? "complete" : "partial",
    ranking: input.aggregateOwners ? "observed-owners" : input.ranked ? "ranked-addresses" : "unranked-sample",
    examined: rows.length, matched: rows.filter(row => row.matches.length).length,
    supplyCoveredPct: consistent ? rows.reduce((sum, row) => sum + row.percent, 0) : null,
    invalidRows, notes, enrichment: { arkham: "not-run", fomo: "not-run" }, rows,
  };
}
