// Upcoming token unlocks (CryptoRank v3): the "when is the next dump, and how
// big?" answer a buyer cannot easily assemble elsewhere. Dormant until
// CRYPTORANK_API_KEY is set (the API is credit-metered), and bounded to three
// requests per audit: one cached currency-map lookup, one exact contract-map
// join, and one per-currency upcoming-events read. Disclosure data only: it
// mints a checkable vesting fact, never a score floor or a verdict input on its
// own.
import { env } from "../config";
import { recordCall } from "../cost";
import { cacheGet, cacheSet } from "../cache";
import { captureTimestamp } from "../captureTime";

const API_BASE = "https://api.cryptorank.io/v3";
const FETCH_TIMEOUT_MS = 8_000;
const MAP_CACHE_KEY = "cryptorank:currency-map:v1";

interface MapEntry { id: number; slug: string; symbol: string | null; name: string }

export interface CanonicalUnlockToken {
  /** Identity-bound address from the canonical project-token record. */
  address: string;
  /** Canonical ARGUS chain key from the same project-token record. */
  chain: string;
}

export interface UpcomingUnlock {
  /** ISO date (YYYY-MM-DD) of the next scheduled unlock */
  nextUnlockDate: string;
  allocationName: string | null;
  percentOfSupply: number | null;
  unlockValueUsd: number | null;
  percentOfMcap: number | null;
  /** share of total supply already unlocked before this event, when reported */
  cumulativeUnlockedPercent: number | null;
  /** total % of supply unlocking across all events inside the next 90 days */
  next90dPercentOfSupply: number | null;
  /** Exact canonical contract that CryptoRank's own contract map joined. */
  canonicalAddress: string;
  /** Normalized chain on both sides of the exact contract join. */
  chain: string;
  /** CryptoRank currency selected for the contract-bound schedule. */
  currencyId: number;
  /** Exact contract-map endpoint used to prove the identity join. */
  contractSourceUrl: string;
  /** Exact vesting-events endpoint used to produce the schedule. */
  eventsSourceUrl: string;
  /** Provider percentage fields rejected as malformed or outside [0, 100]. */
  percentageValidation: {
    invalidFields: Array<"percentOfSupply" | "percentOfMcap" | "cumulativeUnlockedPercent" | "next90dPercentOfSupply">;
  };
  sourceUrl: string;
  /** Capture time of the CryptoRank vesting response, not another provider. */
  capturedAt: string;
}

export type UnlocksOutcome =
  | { available: true; value: UpcomingUnlock }
  | { available: false; note: string };

const norm = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const CHAIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ethereum: "ethereum",
  eth: "ethereum",
  erc20: "ethereum",
  "erc 20": "ethereum",
  solana: "solana",
  sol: "solana",
  base: "base",
  arbitrum: "arbitrum",
  "arbitrum one": "arbitrum",
  bsc: "bsc",
  "binance smart chain": "bsc",
  "bnb smart chain": "bsc",
  "bnb chain": "bsc",
  bep20: "bsc",
  "bep 20": "bsc",
  polygon: "polygon",
  matic: "polygon",
  "polygon pos": "polygon",
  optimism: "optimism",
  "optimistic ethereum": "optimism",
  avalanche: "avalanche",
  avax: "avalanche",
  "avalanche c chain": "avalanche",
  sui: "sui",
  ton: "ton",
  tron: "tron",
  trc20: "tron",
  "trc 20": "tron",
  blast: "blast",
  sei: "sei",
  "sei evm": "sei",
});

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const normalizeChain = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return CHAIN_ALIASES[norm(value)] ?? null;
  const nested = record(value);
  for (const key of ["slug", "name", "symbol", "code", "shortName"]) {
    const normalized = normalizeChain(nested[key]);
    if (normalized) return normalized;
  }
  return null;
};

const contractAddress = (row: Record<string, unknown>): string | null => {
  for (const value of [row.address, row.contractAddress, record(row.contract).address]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const contractChain = (row: Record<string, unknown>): unknown =>
  row.chain ?? row.blockchain ?? row.network ?? row.platform ?? row.chainName;

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const sameAddress = (left: string, right: string): boolean =>
  EVM_ADDRESS.test(left) && EVM_ADDRESS.test(right)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;

const finiteNonNegativeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

type UnlockPercentageField = UpcomingUnlock["percentageValidation"]["invalidFields"][number];

function boundedPercentage(value: unknown): { value: number | null; invalid: boolean } {
  if (value === undefined || value === null) return { value: null, invalid: false };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return { value: null, invalid: true };
  }
  return { value, invalid: false };
}

/**
 * A 90-day sum is a total over a provider response, so it needs an explicit
 * proof that there is no unseen page. A bare `data` array proves only which
 * rows were returned. Unknown pagination shapes stay incomplete.
 */
function responseIsComplete(payload: unknown, returnedRows: number): boolean {
  const root = record(payload);
  const containers = [root, record(root.meta), record(root.pagination), record(root.page)];
  for (const container of containers) {
    const hasNext = [container.hasNextPage, container.hasNext, container.has_next_page]
      .find((value) => typeof value === "boolean");
    const total = [container.total, container.totalCount, container.total_count, container.itemsTotal]
      .map(finiteNonNegativeInteger)
      .find((value): value is number => value !== null);
    const currentPage = [container.currentPage, container.page, container.pageNumber]
      .map(finiteNonNegativeInteger)
      .find((value): value is number => value !== null);
    const totalPages = [container.totalPages, container.pages, container.pageCount]
      .map(finiteNonNegativeInteger)
      .find((value): value is number => value !== null);
    const offset = finiteNonNegativeInteger(container.offset);

    if (hasNext === true) continue;
    if (hasNext === false && (total === undefined || total === returnedRows) && (offset === null || offset === 0)) {
      return true;
    }
    if (total !== undefined && total === returnedRows && (offset === null || offset === 0)) return true;
    if (totalPages === 1 && (currentPage === undefined || currentPage === 0 || currentPage === 1)) return true;
  }
  return false;
}

async function boundedJson(url: string, key: string): Promise<unknown | null> {
  try {
    const res = await Promise.race([
      fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS + 500)),
    ]);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const dataArray = (payload: unknown): Record<string, unknown>[] => {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
};

/** Resolve the CryptoRank id by symbol AND name/slug agreement. Symbol alone is
 * ambiguous across listings, so any ambiguity fails closed to no-data. */
function resolveCurrency(entries: MapEntry[], tokenName: string, symbol: string): MapEntry | null {
  const symbolKey = symbol.trim().toLowerCase();
  const nameKey = norm(tokenName);
  const bySymbol = entries.filter((entry) => (entry.symbol ?? "").toLowerCase() === symbolKey);
  const agreeing = bySymbol.filter((entry) => norm(entry.name) === nameKey || norm(entry.slug.replace(/-/g, " ")) === nameKey);
  if (agreeing.length === 1) return agreeing[0];
  if (agreeing.length === 0 && bySymbol.length === 1 && norm(bySymbol[0].name).includes(nameKey)) return bySymbol[0];
  return null;
}

/** Never throws. Dormant (zero requests) until CRYPTORANK_API_KEY is configured. */
export async function collectUpcomingUnlocks(
  tokenName: string,
  symbol: string,
  canonicalToken: CanonicalUnlockToken,
  options: { nowMs?: number } = {},
): Promise<UnlocksOutcome> {
  const key = env("CRYPTORANK_API_KEY");
  if (!key) return { available: false, note: "CryptoRank is not configured." };
  if (!tokenName.trim() || !symbol.trim()) return { available: false, note: "No token identity to resolve." };
  const canonicalAddress = canonicalToken.address.trim();
  const canonicalChain = normalizeChain(canonicalToken.chain);
  if (!canonicalAddress) return { available: false, note: "No canonical token contract was available for the CryptoRank join." };
  if (!canonicalChain) return { available: false, note: "The canonical token chain could not be normalized for the CryptoRank join." };

  // The currency map is large and stable; cache it so repeat audits spend one
  // metered credit instead of one per run.
  let entries: MapEntry[] | null = null;
  const cached = await cacheGet(MAP_CACHE_KEY);
  if (cached) {
    try { entries = JSON.parse(cached) as MapEntry[]; } catch { entries = null; }
  }
  if (!entries) {
    const payload = await boundedJson(`${API_BASE}/currencies/map`, key);
    if (!payload) {
      recordCall("cryptorank", "currency-map", 0, "map_unavailable", "failed");
      return { available: false, note: "CryptoRank currency map was unavailable." };
    }
    entries = dataArray(payload)
      .map((row) => ({
        id: typeof row.id === "number" ? row.id : NaN,
        slug: typeof row.slug === "string" ? row.slug : "",
        symbol: typeof row.symbol === "string" ? row.symbol : null,
        name: typeof row.name === "string" ? row.name : "",
      }))
      .filter((row) => Number.isFinite(row.id) && row.slug && row.name);
    recordCall("cryptorank", "currency-map", 0, `${entries.length} currencies · 1 credit`, "succeeded");
    void cacheSet(MAP_CACHE_KEY, JSON.stringify(entries));
  }

  const currency = resolveCurrency(entries, tokenName, symbol);
  if (!currency) {
    return { available: false, note: `No unambiguous CryptoRank listing for ${symbol} (${tokenName}).` };
  }

  // A name, symbol, or slug can only discover a candidate. The candidate may
  // lend vesting data to the report only after CryptoRank's own contract map
  // contains exactly one row for the canonical chain and exact address.
  const contractSourceUrl = `${API_BASE}/currencies/${currency.id}/contracts`;
  const contractsPayload = await boundedJson(contractSourceUrl, key);
  if (!contractsPayload) {
    recordCall("cryptorank", "currency-contracts", 0, `${currency.slug} · unavailable`, "failed");
    return { available: false, note: "CryptoRank contract mapping was unavailable." };
  }
  const contractRows = dataArray(contractsPayload);
  const addressRows = contractRows
    .map((row) => ({ row, address: contractAddress(row) }))
    .filter((entry): entry is { row: Record<string, unknown>; address: string } =>
      entry.address !== null && sameAddress(entry.address, canonicalAddress));
  if (!addressRows.length) {
    recordCall("cryptorank", "currency-contracts", 0, `${currency.slug} · canonical_contract_missing`, "succeeded");
    return { available: false, note: "The CryptoRank listing did not map to the exact canonical token contract." };
  }
  const normalizedAddressRows = addressRows.map((entry) => ({
    ...entry,
    chain: normalizeChain(contractChain(entry.row)),
  }));
  if (normalizedAddressRows.some((entry) => entry.chain === null)) {
    recordCall("cryptorank", "currency-contracts", 0, `${currency.slug} · contract_chain_unrecognized`, "partial");
    return { available: false, note: "CryptoRank's matching contract row did not carry a recognizable chain." };
  }
  const exactContracts = normalizedAddressRows.filter((entry) => entry.chain === canonicalChain);
  if (exactContracts.length !== 1) {
    recordCall(
      "cryptorank",
      "currency-contracts",
      0,
      `${currency.slug} · ${exactContracts.length > 1 ? "canonical_contract_ambiguous" : "canonical_chain_mismatch"}`,
      "succeeded",
    );
    return {
      available: false,
      note: exactContracts.length > 1
        ? "CryptoRank returned an ambiguous canonical contract mapping."
        : "The CryptoRank listing did not map the canonical contract to the canonical chain.",
    };
  }
  recordCall("cryptorank", "currency-contracts", 0, `${currency.slug} · exact_contract_join`, "succeeded");

  const eventsSourceUrl = `${API_BASE}/currencies/${currency.id}/vesting/events?filter=upcoming&sortBy=time&sortOrder=asc`;
  const eventsPayload = await boundedJson(eventsSourceUrl, key);
  if (!eventsPayload) {
    recordCall("cryptorank", "vesting-events", 0, `${currency.slug} · unavailable`, "failed");
    return { available: false, note: "CryptoRank vesting events were unavailable." };
  }
  const eventRows = dataArray(eventsPayload);
  const events = eventRows
    .map((row) => {
      const percentOfSupply = boundedPercentage(row.percentOfSupply);
      const percentOfMcap = boundedPercentage(row.percentOfMcap);
      const cumulativeUnlockedPercent = boundedPercentage(row.cumulativeUnlockedPercent);
      const invalidFields: UnlockPercentageField[] = [
        ...(percentOfSupply.invalid ? ["percentOfSupply" as const] : []),
        ...(percentOfMcap.invalid ? ["percentOfMcap" as const] : []),
        ...(cumulativeUnlockedPercent.invalid ? ["cumulativeUnlockedPercent" as const] : []),
      ];
      return {
        timeMs: typeof row.time === "number" ? row.time : NaN,
        allocationName: typeof row.allocationName === "string" && row.allocationName.trim() ? row.allocationName.trim() : null,
        percentOfSupply: percentOfSupply.value,
        unlockValueUsd: Number.isFinite(Number(row.unlockValue)) && Number(row.unlockValue) > 0 ? Number(row.unlockValue) : null,
        percentOfMcap: percentOfMcap.value,
        cumulativeUnlockedPercent: cumulativeUnlockedPercent.value,
        invalidFields,
      };
    })
    .filter((event) => Number.isFinite(event.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs);
  const nowMs = options.nowMs ?? Date.now();
  if (events.length !== eventRows.length) {
    recordCall("cryptorank", "vesting-events", 0, `${currency.slug} · result_shape_error`, "partial");
    return { available: false, note: "One or more CryptoRank vesting events did not carry usable event dates." };
  }
  const futureEvents = events.filter((event) => event.timeMs >= nowMs);
  if (!futureEvents.length) {
    // A completed read with no upcoming events IS the answer (fully unlocked or
    // untracked schedule), reported as no-data rather than a fabricated zero.
    recordCall("cryptorank", "vesting-events", 0, `${currency.slug} · no_upcoming`, "succeeded");
    return {
      available: false,
      note: eventRows.length === 0
        ? "CryptoRank tracks no upcoming unlock events for this token."
        : "No future unlock event remained in the returned CryptoRank schedule at capture time.",
    };
  }

  const next = futureEvents[0];
  const horizonMs = nowMs + 90 * 24 * 60 * 60 * 1000;
  const inHorizon = futureEvents.filter((event) => event.timeMs <= horizonMs);
  const completeResponse = responseIsComplete(eventsPayload, eventRows.length);
  const rawNext90d = completeResponse
    && events.length === eventRows.length
    && inHorizon.length > 0
    && inHorizon.every((event) => event.percentOfSupply !== null)
    ? inHorizon.reduce((total, event) => total + (event.percentOfSupply as number), 0)
    : null;
  const next90d = rawNext90d !== null && rawNext90d >= 0 && rawNext90d <= 100
    ? rawNext90d
    : null;
  const invalidPercentageFields = new Set<UnlockPercentageField>(next.invalidFields);
  if (inHorizon.some((event) => event.invalidFields.includes("percentOfSupply")) || (rawNext90d !== null && rawNext90d > 100)) {
    invalidPercentageFields.add("next90dPercentOfSupply");
  }
  const capturedAt = captureTimestamp();
  recordCall(
    "cryptorank",
    "vesting-events",
    0,
    `${currency.slug} · next_${new Date(next.timeMs).toISOString().slice(0, 10)} · 1 credit${invalidPercentageFields.size > 0 ? " · invalid_percentages_withheld" : ""}`,
    invalidPercentageFields.size > 0 ? "partial" : "succeeded",
  );
  return {
    available: true,
    value: {
      nextUnlockDate: new Date(next.timeMs).toISOString().slice(0, 10),
      allocationName: next.allocationName,
      percentOfSupply: next.percentOfSupply,
      unlockValueUsd: next.unlockValueUsd,
      percentOfMcap: next.percentOfMcap,
      cumulativeUnlockedPercent: next.cumulativeUnlockedPercent,
      next90dPercentOfSupply: next90d !== null && next90d > 0 ? Math.round(next90d * 100) / 100 : null,
      canonicalAddress,
      chain: canonicalChain,
      currencyId: currency.id,
      contractSourceUrl,
      eventsSourceUrl,
      percentageValidation: { invalidFields: [...invalidPercentageFields].sort() },
      sourceUrl: `https://cryptorank.io/price/${currency.slug}/vesting`,
      capturedAt,
    },
  };
}
