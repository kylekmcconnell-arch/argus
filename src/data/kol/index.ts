// The KOL rate-card directory: a paid-influencer price book absorbed from the
// Mastersheet workbooks (see scripts/ingest_kol.py). This is ARGUS's ground
// truth for what non-organic promotion COSTS — used to estimate a project's
// paid-marketing spend and to bind an audited handle to a known-for-hire KOL.
//
// The JSON is generated; never hand-edit it. Re-ingest instead:
//   python3 scripts/ingest_kol.py "<workbook>.xlsx"

import directory from "./directory.json";

export interface KolRecord {
  id: string;
  name: string;
  region: string; // sheet / market: US, EU, TURKEY, LATAM, WEB2, ...
  country: string | null;
  platforms: string[];
  tier: number | null; // 1 = top tier (per the sheet's own grading)
  followers: number | null;
  followers_raw: string | null;
  categories: string[];
  language: string | null;
  rating: number | null; // 1..5 quality rating from the sheet
  price_range: string | null; // "$$$$" band as written
  price_range_level: number | null; // 1..5, count of $
  price_usd_low: number | null; // cheapest listed deliverable
  price_usd_high: number | null; // priciest listed deliverable
  price_on_request: boolean; // POR/POQ/"-": rate withheld
  price_from_deliverables: boolean; // rate recovered from the deliverables cell
  pricing_raw: string | null;
  deliverables: string | null;
  link: string | null;
  handle: string | null; // "@name" extracted from link, when present
  handle_platform: string | null;
}

interface Directory {
  generated_at: string;
  count: number;
  sources: { file: string; ingested_at: string; rows: number }[];
  records: KolRecord[];
}

const DIR = directory as Directory;
export const KOL_RECORDS: KolRecord[] = DIR.records;
export const KOL_SOURCES = DIR.sources;

// ---- matching --------------------------------------------------------------

const norm = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]/g, "");

const byHandle = new Map<string, KolRecord>();
const byName = new Map<string, KolRecord[]>();
for (const r of KOL_RECORDS) {
  if (r.handle) byHandle.set(norm(r.handle), r);
  const k = norm(r.name);
  (byName.get(k) ?? byName.set(k, []).get(k)!).push(r);
}

/** Resolve a handle or display name to rate-card rows. Handles win (unique);
 *  a display name may map to several regional listings for the same person. */
export function lookupKol(query: string): KolRecord[] {
  const k = norm(query);
  if (!k) return [];
  const h = byHandle.get(k);
  if (h) return [h];
  return byName.get(k) ?? [];
}

export function isKnownForHire(query: string): boolean {
  return lookupKol(query).length > 0;
}

// ---- spend estimation ------------------------------------------------------

export interface SpendEstimate {
  matched: { query: string; record: KolRecord }[];
  unmatched: string[]; // queries with no rate-card row
  priceUnknown: string[]; // matched but price-on-request
  /** Sum of cheapest listed deliverable across matched, priced KOLs. */
  floorUsd: number;
  /** Sum of priciest listed deliverable — the upper bound of one wave. */
  ceilingUsd: number;
}

/** Given the handles/names seen promoting a project, estimate the paid spend if
 *  each were hired once. A single co-ordinated posting wave sits between floor
 *  and ceiling; POR names are surfaced separately, not silently zeroed. */
export function estimateCampaignSpend(queries: string[]): SpendEstimate {
  const matched: SpendEstimate["matched"] = [];
  const unmatched: string[] = [];
  const priceUnknown: string[] = [];
  let floorUsd = 0;
  let ceilingUsd = 0;

  for (const q of queries) {
    const hits = lookupKol(q);
    if (hits.length === 0) {
      unmatched.push(q);
      continue;
    }
    // If a name maps to several regional rows, take the one with a known price.
    const rec = hits.find((r) => r.price_usd_low != null) ?? hits[0];
    matched.push({ query: q, record: rec });
    if (rec.price_usd_low == null) priceUnknown.push(q);
    else {
      floorUsd += rec.price_usd_low;
      ceilingUsd += rec.price_usd_high ?? rec.price_usd_low;
    }
  }
  return { matched, unmatched, priceUnknown, floorUsd, ceilingUsd };
}

// ---- aggregate views (for a market-overview panel) -------------------------

export interface RegionStat {
  region: string;
  count: number;
  priced: number;
  medianPriceUsd: number | null;
  totalFloorUsd: number;
}

export function regionStats(): RegionStat[] {
  const groups = new Map<string, KolRecord[]>();
  for (const r of KOL_RECORDS) {
    (groups.get(r.region) ?? groups.set(r.region, []).get(r.region)!).push(r);
  }
  const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return [...groups.entries()]
    .map(([region, rs]) => {
      const prices = rs
        .map((r) => r.price_usd_low)
        .filter((p): p is number => p != null);
      return {
        region,
        count: rs.length,
        priced: prices.length,
        medianPriceUsd: median(prices),
        totalFloorUsd: prices.reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => b.count - a.count);
}
