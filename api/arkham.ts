// Arkham entity labels. GET /api/arkham?addresses=a,b,c   (or ?address=a)
//
// The single biggest upgrade to the on-chain forensics: it puts a NAME on the
// anonymous wallets. Arkham resolves an address to its real-world entity —
// "Binance" (cex), "Wintermute" (fund), or a named individual like "Vitalik
// Buterin" WITH their Twitter/LinkedIn — across EVM and Solana. So a deployer,
// funder, top holder, or cluster wallet that read as "0x1a2b…" now reads as who
// it actually is. Batched + per-address cached (addresses recur across reports).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";

export const config = { maxDuration: 20 };

const ARKHAM_INTEL = "https://api.arkm.com/intelligence/address_enriched/";
const ARKHAM_INTEL_BASIC = "https://api.arkm.com/intelligence/address/";
const ARKHAM_RISK = "https://api.arkm.com/risk/address/";

export type ArkhamTag = {
  id: string;
  label: string;
  rank: number;
  chain?: string;
};

export type ArkhamRiskSource = {
  address: string;
  category: string;
  direction: "forward" | "backward";
  scoreUsd: number;
  contributionPct: number;
  hops: number;
  firstAt?: string;
  lastAt?: string;
};

export type ArkhamRisk = {
  level: string;        // NONE | LOW | MEDIUM | HIGH | SEVERE
  category?: string;    // hacker | privacy | sanctioned | …
  score: number;        // 0-100
  incomingUsd?: number; // $ received, risk-weighted (exposure to bad sources)
  outgoingUsd?: number; // $ sent toward risky destinations
  hopDistance?: number;
  updatedAt?: string;
  isSeed: boolean;      // this address IS a flagged bad actor (hacker/mixer/sanctioned)
  categoryScores: { category: string; score: number }[];
  topSources: ArkhamRiskSource[];
};

export type ArkhamLabel = {
  name: string;
  entityId?: string;
  type?: string;      // cex | individual | fund | defi | dex | …
  sublabel?: string;  // e.g. "Cold Wallet", "Hot Wallet 3"
  twitter?: string;
  website?: string;
  linkedin?: string;
  crunchbase?: string;
  tags: ArkhamTag[];
  entityWalletCount?: number;
  entityChainCount?: number;
  isCex: boolean;
  isService: boolean;
  isContract: boolean;
  risk?: ArkhamRisk;  // present only when the wallet carries real risk (level != NONE or a seed)
};

interface CallCounter { calls: number; succeeded: number }
const getJson = async (url: string, key: string, usage: CallCounter) => {
  usage.calls += 1;
  try {
    const r = await fetch(url, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const data = await r.json();
    usage.succeeded += 1;
    return data;
  } catch {
    return null;
  }
};

type RawTag = { id?: unknown; label?: unknown; rank?: unknown; chain?: unknown };
type RawEntity = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  twitter?: unknown;
  website?: unknown;
  linkedin?: unknown;
  crunchbase?: unknown;
  service?: unknown;
  addresses?: unknown;
  populatedTags?: unknown;
};

const cleanText = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
};

function normalizeTags(...sources: unknown[]): ArkhamTag[] {
  const seen = new Set<string>();
  const tags: ArkhamTag[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const raw of source as RawTag[]) {
      const id = cleanText(raw?.id);
      const label = cleanText(raw?.label);
      if (!id || !label || seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());
      tags.push({
        id,
        label,
        rank: Number.isFinite(Number(raw?.rank)) ? Number(raw.rank) : 999,
        chain: cleanText(raw?.chain),
      });
    }
  }
  return tags.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)).slice(0, 12);
}

function entityFootprint(addresses: unknown): { wallets?: number; chains?: number } {
  if (!addresses || typeof addresses !== "object" || Array.isArray(addresses)) return {};
  const rows = Object.values(addresses as Record<string, unknown>);
  const wallets = rows.reduce<number>((total, row) => total + (Array.isArray(row) ? row.length : 0), 0);
  const chains = rows.filter((row) => Array.isArray(row) && row.length > 0).length;
  return {
    wallets: wallets > 0 ? wallets : undefined,
    chains: chains > 0 ? chains : undefined,
  };
}

const RISK_SCORE_FIELDS = [
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

async function lookup(addr: string, key: string, usage: CallCounter): Promise<ArkhamLabel | null> {
  const ck = `arkham:${providerAddressKey(addr)}:v3`;
  const cached = await cacheGetJson<ArkhamLabel | { none: true }>(ck);
  if (cached) return (cached as { none?: true }).none ? null : (cached as ArkhamLabel);
  try {
    // Enriched identity includes Arkham's behavior tags, cluster metadata, and
    // the full entity footprint. Risk is fetched beside it so an identity label
    // and a compliance warning remain separate claims.
    const [d, rk] = await Promise.all([
      getJson(
        `${ARKHAM_INTEL}${encodeURIComponent(addr)}?includeTags=true&includeClusters=true&includeEntityPredictions=false`,
        key,
        usage,
      ).then((enriched) => enriched ?? getJson(`${ARKHAM_INTEL_BASIC}${encodeURIComponent(addr)}`, key, usage)) as Promise<{ arkhamEntity?: RawEntity | null; arkhamLabel?: { name?: unknown } | null; populatedTags?: unknown; contract?: boolean } | null>,
      getJson(`${ARKHAM_RISK}${encodeURIComponent(addr)}`, key, usage) as Promise<Record<string, unknown> | null>,
    ]);
    const e = d?.arkhamEntity, lbl = d?.arkhamLabel;
    const name = cleanText(e?.name) || cleanText(lbl?.name) || "";
    const categoryScores = rk
      ? RISK_SCORE_FIELDS
          .map(([field, category]) => ({ category, score: Number(rk[field] ?? 0) }))
          .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
          .sort((a, b) => b.score - a.score)
      : [];
    const topSources: ArkhamRiskSource[] = Array.isArray(rk?.top_sources)
      ? (rk.top_sources as Record<string, unknown>[])
          .map((source): ArkhamRiskSource | null => {
            const address = cleanText(source?.seed_address);
            const category = cleanText(source?.risk_category);
            if (!address || !category) return null;
            return {
              address,
              category,
              direction: source?.direction === "backward" ? "backward" : "forward",
              scoreUsd: Number(source?.contribution_usd ?? 0),
              contributionPct: Number(source?.contribution_pct ?? 0),
              hops: Number(source?.hop_distance ?? 0),
              firstAt: cleanText(source?.first_ts),
              lastAt: cleanText(source?.last_ts),
            };
          })
          .filter((source): source is ArkhamRiskSource => source != null)
          .slice(0, 8)
      : [];
    // Only keep risk that actually matters — an elevated level or a flagged seed.
    const risk: ArkhamRisk | undefined = rk && ((rk.risk_level && rk.risk_level !== "NONE") || rk.is_seed)
      ? {
          level: String(rk.risk_level ?? "NONE"),
          category: cleanText(rk.greatest_risk_category),
          score: Number(rk.max_score ?? 0),
          incomingUsd: Number(rk.risk_weighted_incoming_usd ?? 0) || undefined,
          outgoingUsd: Number(rk.risk_weighted_outgoing_usd ?? 0) || undefined,
          hopDistance: Number.isFinite(Number(rk.hop_distance)) ? Number(rk.hop_distance) : undefined,
          updatedAt: cleanText(rk.updated_at),
          isSeed: !!rk.is_seed,
          categoryScores,
          topSources,
        }
      : undefined;
    if (!name && !risk) { await cacheSetJson(ck, { none: true }); return null; }
    const footprint = entityFootprint(e?.addresses);
    const entityType = cleanText(e?.type)?.toLowerCase();
    const labelName = cleanText(lbl?.name);
    const out: ArkhamLabel = {
      name,
      entityId: cleanText(e?.id),
      type: entityType,
      sublabel: labelName && name && labelName.toLowerCase() !== name.toLowerCase() ? labelName : undefined,
      twitter: cleanText(e?.twitter),
      website: cleanText(e?.website),
      linkedin: cleanText(e?.linkedin),
      crunchbase: cleanText(e?.crunchbase),
      tags: normalizeTags(d?.populatedTags, e?.populatedTags),
      entityWalletCount: footprint.wallets,
      entityChainCount: footprint.chains,
      isCex: entityType === "cex",
      isService: !!e?.service || entityType === "cex",
      isContract: !!d?.contract,
      risk,
    };
    await cacheSetJson(ck, out);
    return out;
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured (no ARKHAM_API_KEY)." }); return; }
  const raw = typeof req.query.addresses === "string" ? req.query.addresses : typeof req.query.address === "string" ? req.query.address : "";
  const addrs = [...new Set(raw.split(",").map(providerAddressKey).filter(Boolean))].slice(0, 30);
  if (!addrs.length) { res.status(400).json({ error: "addresses required" }); return; }
  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const results = await Promise.all(addrs.map((a) => lookup(a, key, usage).then((l) => [providerAddressKey(a), l] as const)));
    const labels: Record<string, ArkhamLabel> = {};
    for (const [a, l] of results) if (l && (l.name || l.risk)) labels[a] = l;
    res.status(200).json({ available: true, labels });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Arkham lookup failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "arkham",
        op: "panel:arkham-labels",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
