// Shared Arkham risk-briefing core.
//
// Arkham's risk briefing answers WHY a wallet is risky: the seed->target
// exposure showing which hacker / mixer / sanctioned entity the wallet is
// connected to, in which direction, how many hops away, and how much USD flowed.
// It turns "risk score: flagged" into "$72M, 1 hop backward from Tornado.Cash".
//
// Extracted here so both the on-demand panel (api/arkham-risk-paths) and the
// scan-time deployer trace (api/deployer-risk, called during a token audit) run
// one implementation. Arkham is a flat subscription (usd: 0 marginal per call).

const RISK = "https://api.arkm.com/risk/address/";
const INTEL = "https://api.arkm.com/intelligence/address/";

export interface ArkhamRiskPath {
  seed: string;
  seedName?: string;
  seedType?: string;
  category?: string;
  /** "backward" = funds came FROM the seed (a funding source); "forward" = sent TO it. */
  direction: "backward" | "forward";
  score: number;
  usd: number;
  hops: number;
  firstAt?: string;
  lastAt?: string;
}

export interface ArkhamRiskBriefing {
  level: string;
  score: number;
  greatestCategory?: string;
  incomingUsd: number;
  outgoingUsd: number;
  hopDistance?: number;
  updatedAt?: string;
  categoryScores: { category: string; score: number }[];
}

export interface ArkhamRiskResult {
  available: boolean;
  paths: ArkhamRiskPath[];
  briefing?: ArkhamRiskBriefing;
  /** Provider call accounting for the panel cost ledger. */
  calls: number;
  succeeded: number;
}

const cleanText = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
};

const CATEGORY_SCORES = [
  ["darkweb_score", "dark web"],
  ["gambling_score", "gambling"],
  ["hacker_score", "hacker"],
  ["mixed_kyc_service_score", "mixed-KYC service"],
  ["mixer_score", "mixer"],
  ["non_kyc_service_score", "non-KYC service"],
  ["ponzi_score", "Ponzi"],
  ["privacy_score", "privacy service"],
  ["ransomware_score", "ransomware"],
  ["sanctions_score", "sanctions"],
  ["scam_score", "scam"],
  ["token_blacklist_score", "blacklisted token"],
] as const;

async function seedName(addr: string, key: string, usage: { calls: number; succeeded: number }): Promise<{ name?: string; type?: string }> {
  usage.calls += 1;
  try {
    const r = await fetch(`${INTEL}${encodeURIComponent(addr)}`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(7000) });
    if (!r.ok) return {};
    const d = (await r.json()) as { arkhamEntity?: { name?: string; type?: string }; arkhamLabel?: { name?: string } };
    usage.succeeded += 1;
    return { name: d.arkhamEntity?.name || d.arkhamLabel?.name, type: d.arkhamEntity?.type };
  } catch { return {}; }
}

/**
 * Fetch and shape the full risk briefing for an address: best top source per
 * seed by USD contribution, category scores, and each seed's Arkham entity.
 * Never throws; returns available:false on any provider failure.
 */
export async function fetchAddressRiskPaths(address: string, key: string): Promise<ArkhamRiskResult> {
  const usage = { calls: 0, succeeded: 0 };
  try {
    usage.calls += 1;
    // The score response is the full briefing: category scores, dated top
    // sources, direction, hops, and exposure amounts. It supersedes the older
    // /paths-only read while keeping the same shaped path list for callers.
    const r = await fetch(`${RISK}${encodeURIComponent(address)}`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { available: false, paths: [], calls: usage.calls, succeeded: usage.succeeded };
    const d = (await r.json()) as Record<string, unknown>;
    usage.succeeded += 1;
    const raw = Array.isArray(d?.top_sources) ? d.top_sources as Record<string, unknown>[] : [];
    // Best path per seed (highest USD contribution), then the top few overall.
    const bySeed = new Map<string, Record<string, unknown>>();
    for (const p of raw) {
      const s = String(p?.seed_address ?? "");
      if (!s) continue;
      const ex = bySeed.get(s);
      if (!ex || Number(p?.contribution_usd ?? 0) > Number(ex?.contribution_usd ?? 0)) bySeed.set(s, p);
    }
    const top = [...bySeed.values()].sort((a, b) => Number(b?.contribution_usd ?? 0) - Number(a?.contribution_usd ?? 0)).slice(0, 6);
    const labels = await Promise.all(top.map((p) => seedName(String(p.seed_address), key, usage)));
    const paths: ArkhamRiskPath[] = top.map((p, i) => ({
      seed: String(p.seed_address),
      seedName: labels[i].name,
      seedType: labels[i].type,
      category: typeof p?.risk_category === "string" ? p.risk_category : undefined,
      direction: p?.direction === "backward" ? "backward" : "forward",
      score: Number(p?.contribution_pct ?? 0),
      usd: Number(p?.contribution_usd ?? 0),
      hops: Number(p?.hop_distance ?? 0),
      firstAt: cleanText(p?.first_ts),
      lastAt: cleanText(p?.last_ts),
    }));
    const categoryScores = CATEGORY_SCORES
      .map(([field, category]) => ({ category, score: Number(d[field] ?? 0) }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const briefing: ArkhamRiskBriefing = {
      level: String(d.risk_level ?? "NONE"),
      score: Number(d.max_score ?? 0),
      greatestCategory: cleanText(d.greatest_risk_category),
      incomingUsd: Number(d.risk_weighted_incoming_usd ?? 0),
      outgoingUsd: Number(d.risk_weighted_outgoing_usd ?? 0),
      hopDistance: Number.isFinite(Number(d.hop_distance)) ? Number(d.hop_distance) : undefined,
      updatedAt: cleanText(d.updated_at),
      categoryScores,
    };
    return { available: true, paths, briefing, calls: usage.calls, succeeded: usage.succeeded };
  } catch {
    return { available: false, paths: [], calls: usage.calls, succeeded: usage.succeeded };
  }
}
