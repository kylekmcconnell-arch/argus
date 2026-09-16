import { deadlineFetch } from "../providerDeadline.js";
// CryptoRank funding-rounds adapter: a second crypto-native raises index next
// to DeFiLlama's curated raises. CryptoRank's v2 API is keyed and plan-tiered,
// so this lane is tier-adaptive and fail-soft:
//   - /v2/currencies + /v2/currencies/{id} (every plan, incl. the free
//     Sandbox key): candidate discovery, contract addresses for the exact
//     identity join, and the hasFundingRounds hint.
//   - /v2/currencies/{id}/full-metadata (Basic and up): official website and
//     X links (the tokenless identity surfaces) plus named backer funds.
//   - /v2/currencies/{id}/funding-rounds (Pro/Business): stage, date, raise,
//     valuation, and per-round investors.
// A plan-gated endpoint answers 403; the adapter records the gate and keeps
// whatever the key's plan did answer. Identity doctrine matches the DeFiLlama
// lane: a record lends funding evidence only through an exact contract-address
// join to the verified canonical token, or through the caller's official
// X-handle / official-domain test. Name similarity is discovery, never
// identity. The adapter never throws, and it distinguishes "provider
// unavailable" from "no rounds on record" so an outage never reads as
// "unfunded".
import { recordCall, type ProviderUsageStatus } from "../cost";
import { captureTimestamp } from "../captureTime";
import type { CryptoRankFundingSnapshot } from "../../src/data/evidence";

const API_BASE = "https://api.cryptorank.io/v2";
const MAX_CANDIDATE_DETAILS = 4;

export function cryptoRankConfigured(): boolean {
  return Boolean(process.env.CRYPTORANK_API_KEY?.trim());
}

export interface CryptoRankSubject {
  /** Display name; drives name-based candidate discovery. */
  name: string;
  /** Verified canonical token surfaces, when the subject has a bound token. */
  symbol?: string | null;
  contractAddress?: string | null;
  chain?: string | null;
  /**
   * Caller-supplied official-identity test for tokenless binding. The
   * handle/domain doctrine lives in basicFactsProjection; the adapter only
   * hands over the record's own official surfaces.
   */
  matchesOfficialIdentity?: (record: { officialTwitter: string | null; officialUrl: string | null }) => boolean;
}

export type CryptoRankFundingOutcome =
  | { available: true; value: CryptoRankFundingSnapshot }
  | { available: false; reason: "not_configured" | "no_data" | "unavailable"; note: string };

type ListItem = { id?: unknown; key?: unknown; symbol?: unknown; name?: unknown; type?: unknown };
type ContractItem = { address?: unknown; platform?: { key?: unknown; name?: unknown } | null };
type DetailData = { id?: unknown; key?: unknown; symbol?: unknown; name?: unknown; hasFundingRounds?: unknown; contracts?: unknown };
type LinkItem = { type?: unknown; value?: unknown };
type FundItem = { name?: unknown; isLead?: unknown };
type MetadataData = DetailData & { links?: unknown; funds?: unknown };
type RoundFundItem = { name?: unknown; isLead?: unknown };
type RoundItem = {
  stage?: unknown;
  announcementDate?: unknown;
  announcementLink?: unknown;
  raise?: unknown;
  valuation?: unknown;
  funds?: unknown;
};
type RoundsData = { totalFundingRaise?: unknown; fundingRounds?: unknown };

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "plan_gated" | "not_found" | "unauthorized" | "error"; note: string };

async function getJson<T>(path: string, apiKey: string, fetcher: typeof fetch): Promise<ApiResult<T>> {
  try {
    const response = await fetcher(`${API_BASE}${path}`, {
      headers: { "X-Api-Key": apiKey, accept: "application/json" },
    });
    if (response.status === 403) return { ok: false, kind: "plan_gated", note: `plan does not include ${path.split("?")[0]}` };
    if (response.status === 401) return { ok: false, kind: "unauthorized", note: "CryptoRank rejected the configured API key" };
    if (response.status === 404) return { ok: false, kind: "not_found", note: `no CryptoRank record at ${path.split("?")[0]}` };
    if (!response.ok) return { ok: false, kind: "error", note: `CryptoRank answered HTTP ${response.status}` };
    const body = await response.json() as { data?: T };
    if (body?.data === undefined) return { ok: false, kind: "error", note: "CryptoRank answered without a data envelope" };
    return { ok: true, data: body.data };
  } catch (error) {
    return { ok: false, kind: "error", note: `CryptoRank request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asNumberId = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** CryptoRank reports raise/valuation as absolute-USD decimal strings. */
const usdFromString = (value: unknown): number | null => {
  const text = asString(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

/**
 * Announcement dates arrive as epoch numbers (ms in v2; tolerate seconds).
 * CryptoRank documents that a 01-01 date means "year known, month and day
 * unknown", so that case degrades to a bare year instead of asserting a
 * precision the provider disclaims.
 */
export const roundDateFromEpoch = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1e12 ? value : value * 1000;
  const iso = new Date(ms).toISOString().slice(0, 10);
  return iso.endsWith("-01-01") ? iso.slice(0, 4) : iso;
};

const normalizeChain = (value: string | null | undefined): string =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeAddress = (value: string): string =>
  value.startsWith("0x") || value.startsWith("0X") ? value.toLowerCase() : value;

/**
 * Exact contract join: the record's listed contract equals the verified
 * canonical token address. When both sides name a chain and the names
 * disagree, the join fails closed; a missing chain on either side leaves the
 * address itself (already a near-unique surface) as the join.
 */
export function contractJoin(
  contracts: ContractItem[],
  canonicalAddress: string,
  canonicalChain: string | null | undefined,
): { address: string; platform: string | null } | null {
  const wanted = normalizeAddress(canonicalAddress.trim());
  if (!wanted) return null;
  const wantedChain = normalizeChain(canonicalChain);
  for (const contract of contracts) {
    const address = asString(contract.address);
    if (!address || normalizeAddress(address) !== wanted) continue;
    const platform = asString(contract.platform?.name) ?? asString(contract.platform?.key);
    const recordChain = normalizeChain(platform);
    if (wantedChain && recordChain && wantedChain !== recordChain) continue;
    return { address, platform };
  }
  return null;
}

/** Official surfaces from a full-metadata links[] block. */
export function officialSurfacesFromLinks(links: LinkItem[]): { officialTwitter: string | null; officialUrl: string | null } {
  let officialTwitter: string | null = null;
  let officialUrl: string | null = null;
  for (const link of links) {
    const type = asString(link.type)?.toLowerCase();
    const value = asString(link.value);
    if (!type || !value) continue;
    if (type === "web" && !officialUrl) officialUrl = value;
    if (type === "twitter" && !officialTwitter) {
      const handle = value.match(/(?:x\.com|twitter\.com)\/(@?[A-Za-z0-9_]{2,30})/)?.[1] ?? value;
      officialTwitter = handle.replace(/^@/, "");
    }
  }
  return { officialTwitter, officialUrl };
}

const mapRounds = (raw: unknown): CryptoRankFundingSnapshot["rounds"] => {
  if (!Array.isArray(raw)) return [];
  const rounds: CryptoRankFundingSnapshot["rounds"] = [];
  for (const entry of raw as RoundItem[]) {
    const stage = asString(entry.stage);
    const amountUsd = usdFromString(entry.raise);
    const valuationUsd = usdFromString(entry.valuation);
    // Rows with no stage, amount, or valuation are relationship residue, not
    // financing events; the DeFiLlama lane learned this the hard way.
    if (!stage && !amountUsd && !valuationUsd) continue;
    const funds = Array.isArray(entry.funds) ? entry.funds as RoundFundItem[] : [];
    rounds.push({
      stage: stage ?? "Undisclosed",
      date: roundDateFromEpoch(entry.announcementDate),
      amountUsd,
      valuationUsd,
      leadInvestors: funds.filter((fund) => fund.isLead === true).map((fund) => asString(fund.name)).filter((name): name is string => !!name),
      otherInvestors: funds.filter((fund) => fund.isLead !== true).map((fund) => asString(fund.name)).filter((name): name is string => !!name),
      announcementUrl: asString(entry.announcementLink),
    });
  }
  return rounds.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));
};

const normalizeName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Collect a subject's funding rounds from CryptoRank, bound by exact contract
 * address or the caller's official-identity test. Never throws. Tier-adaptive:
 * the snapshot's `access` block records which detail endpoints the configured
 * key's plan answered, so a plan gate is auditable and never silent.
 */
export async function collectCryptoRankFunding(
  subject: CryptoRankSubject,
  options: { fetcher?: typeof fetch } = {},
): Promise<CryptoRankFundingOutcome> {
  const apiKey = process.env.CRYPTORANK_API_KEY?.trim();
  if (!apiKey) return { available: false, reason: "not_configured", note: "CRYPTORANK_API_KEY is not configured." };
  const fetcher = options.fetcher ?? deadlineFetch;

  // Discovery: symbol lookup covers traded tokens; the full map covers
  // pre-token projects (the traded list excludes them by design). Both are
  // discovery only; nothing binds without an identity join below.
  const candidates = new Map<number, ListItem>();
  const symbol = asString(subject.symbol);
  if (symbol) {
    const listed = await getJson<ListItem[]>(`/currencies?symbol=${encodeURIComponent(symbol.toUpperCase())}&limit=100`, apiKey, fetcher);
    if (!listed.ok && (listed.kind === "unauthorized" || listed.kind === "error")) {
      recordCall("cryptorank", "funding", 0, `discovery · ${listed.kind}`, "failed");
      return { available: false, reason: "unavailable", note: listed.note };
    }
    if (listed.ok) {
      for (const item of listed.data) {
        const id = asNumberId(item.id);
        if (id !== null) candidates.set(id, item);
      }
    }
  }
  const wantedName = normalizeName(subject.name);
  if (!candidates.size && wantedName) {
    const mapped = await getJson<ListItem[]>(`/currencies/map?include=type`, apiKey, fetcher);
    if (!mapped.ok) {
      recordCall("cryptorank", "funding", 0, `map · ${mapped.kind}`, mapped.kind === "not_found" ? "succeeded" : "failed");
      return mapped.kind === "not_found"
        ? { available: false, reason: "no_data", note: "CryptoRank has no matching record." }
        : { available: false, reason: "unavailable", note: mapped.note };
    }
    for (const item of mapped.data) {
      const id = asNumberId(item.id);
      if (id === null) continue;
      const name = asString(item.name);
      const key = asString(item.key);
      if ((name && normalizeName(name) === wantedName) || (key && normalizeName(key) === wantedName)) {
        candidates.set(id, item);
      }
    }
  }
  if (!candidates.size) {
    recordCall("cryptorank", "funding", 0, "no_candidates", "succeeded");
    return { available: false, reason: "no_data", note: `CryptoRank lists no candidate record for "${subject.name}".` };
  }

  // Identity join, bounded: at most MAX_CANDIDATE_DETAILS detail reads.
  let bound: {
    id: number;
    key: string;
    name: string;
    symbol: string | null;
    hasFundingRounds: boolean;
    binding: CryptoRankFundingSnapshot["binding"];
    metadataAccess: CryptoRankFundingSnapshot["access"]["fullMetadata"];
    funds: Array<{ name: string; isLead: boolean }>;
  } | null = null;
  let metadataGated = false;
  const contractAddress = asString(subject.contractAddress);
  for (const [id] of [...candidates].slice(0, MAX_CANDIDATE_DETAILS)) {
    if (bound) break;
    const detail = await getJson<DetailData>(`/currencies/${id}`, apiKey, fetcher);
    if (!detail.ok) {
      if (detail.kind === "unauthorized" || detail.kind === "error") {
        recordCall("cryptorank", "funding", 0, `detail · ${detail.kind}`, "failed");
        return { available: false, reason: "unavailable", note: detail.note };
      }
      continue;
    }
    const key = asString(detail.data.key) ?? String(id);
    const name = asString(detail.data.name) ?? subject.name;
    const recordSymbol = asString(detail.data.symbol);
    const hasFundingRounds = detail.data.hasFundingRounds === true;
    if (contractAddress) {
      const contracts = Array.isArray(detail.data.contracts) ? detail.data.contracts as ContractItem[] : [];
      const join = contractJoin(contracts, contractAddress, subject.chain);
      if (join) {
        bound = {
          id, key, name, symbol: recordSymbol, hasFundingRounds,
          binding: { method: "canonical_token_address", address: join.address, platform: join.platform },
          metadataAccess: "not_needed",
          funds: [],
        };
        continue;
      }
    }
    if (!subject.matchesOfficialIdentity) continue;
    // The tokenless identity surfaces live behind full-metadata (paid plans).
    const metadata = await getJson<MetadataData>(`/currencies/${id}/full-metadata`, apiKey, fetcher);
    if (!metadata.ok) {
      if (metadata.kind === "plan_gated") { metadataGated = true; continue; }
      if (metadata.kind === "unauthorized" || metadata.kind === "error") {
        recordCall("cryptorank", "funding", 0, `full-metadata · ${metadata.kind}`, "failed");
        return { available: false, reason: "unavailable", note: metadata.note };
      }
      continue;
    }
    const links = Array.isArray(metadata.data.links) ? metadata.data.links as LinkItem[] : [];
    const surfaces = officialSurfacesFromLinks(links);
    if (!subject.matchesOfficialIdentity(surfaces)) continue;
    const fundItems = Array.isArray(metadata.data.funds) ? metadata.data.funds as FundItem[] : [];
    bound = {
      id, key, name, symbol: recordSymbol,
      hasFundingRounds: metadata.data.hasFundingRounds === true || hasFundingRounds,
      binding: { method: "official_identity", officialTwitter: surfaces.officialTwitter, officialUrl: surfaces.officialUrl },
      metadataAccess: "ok",
      funds: fundItems
        .map((fund) => ({ name: asString(fund.name), isLead: fund.isLead === true }))
        .filter((fund): fund is { name: string; isLead: boolean } => !!fund.name),
    };
  }

  if (!bound) {
    if (metadataGated && !contractAddress) {
      recordCall("cryptorank", "funding", 0, "identity_surfaces_plan_gated", "partial");
      return {
        available: false,
        reason: "unavailable",
        note: "CryptoRank has candidate records, but the configured plan does not expose the official-identity surfaces needed to bind one safely.",
      };
    }
    recordCall("cryptorank", "funding", 0, "no_identity_join", "succeeded");
    return { available: false, reason: "no_data", note: `No CryptoRank record joined the verified identity for "${subject.name}".` };
  }

  // Detail escalation, degrading on plan gates.
  let rounds: CryptoRankFundingSnapshot["rounds"] = [];
  let totalRaisedUsd: number | null = null;
  let fundingRoundsAccess: CryptoRankFundingSnapshot["access"]["fundingRounds"] = "unavailable";
  let metadataAccess = bound.metadataAccess;
  let funds = bound.funds;
  if (bound.hasFundingRounds) {
    const detail = await getJson<RoundsData>(`/currencies/${bound.id}/funding-rounds`, apiKey, fetcher);
    if (detail.ok) {
      fundingRoundsAccess = "ok";
      rounds = mapRounds(detail.data.fundingRounds);
      totalRaisedUsd = usdFromString(detail.data.totalFundingRaise)
        ?? (rounds.some((round) => round.amountUsd) ? rounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0) : null);
    } else if (detail.kind === "plan_gated") {
      fundingRoundsAccess = "plan_gated";
      if (metadataAccess === "not_needed") {
        // Contract-bound record: named backers from full-metadata are the
        // cheaper fallback for a plan without the rounds endpoint.
        const metadata = await getJson<MetadataData>(`/currencies/${bound.id}/full-metadata`, apiKey, fetcher);
        if (metadata.ok) {
          metadataAccess = "ok";
          const fundItems = Array.isArray(metadata.data.funds) ? metadata.data.funds as FundItem[] : [];
          funds = fundItems
            .map((fund) => ({ name: asString(fund.name), isLead: fund.isLead === true }))
            .filter((fund): fund is { name: string; isLead: boolean } => !!fund.name);
        } else if (metadata.kind === "plan_gated") {
          metadataAccess = "plan_gated";
        }
      }
    }
  } else {
    fundingRoundsAccess = "ok";
  }

  const status: ProviderUsageStatus = fundingRoundsAccess === "plan_gated" ? "partial" : "succeeded";
  recordCall("cryptorank", "funding", 0, `${bound.key} · ${rounds.length}_rounds · ${bound.binding.method}${fundingRoundsAccess === "plan_gated" ? " · rounds_plan_gated" : ""}`, status);
  return {
    available: true,
    value: {
      currencyId: bound.id,
      key: bound.key,
      name: bound.name,
      symbol: bound.symbol,
      binding: bound.binding,
      hasFundingRounds: bound.hasFundingRounds,
      rounds,
      totalRaisedUsd,
      funds,
      access: { fundingRounds: fundingRoundsAccess, fullMetadata: metadataAccess },
      sourceUrl: `https://cryptorank.io/price/${bound.key}`,
      capturedAt: captureTimestamp(),
    },
  };
}
