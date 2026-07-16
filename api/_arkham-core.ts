// Shared Arkham risk-path core.
//
// Arkham's risk/paths trace answers WHY a wallet is risky: the seed->target
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
}

export interface ArkhamRiskResult {
  available: boolean;
  paths: ArkhamRiskPath[];
  /** Provider call accounting for the panel cost ledger. */
  calls: number;
  succeeded: number;
}

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
 * Fetch and shape the top risk paths for an address: best path per seed by USD
 * contribution, top few overall, each seed labeled with its Arkham entity.
 * Never throws; returns available:false on any provider failure.
 */
export async function fetchAddressRiskPaths(address: string, key: string): Promise<ArkhamRiskResult> {
  const usage = { calls: 0, succeeded: 0 };
  try {
    usage.calls += 1;
    const r = await fetch(`${RISK}${encodeURIComponent(address)}/paths`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { available: false, paths: [], calls: usage.calls, succeeded: usage.succeeded };
    const d = (await r.json()) as { paths?: unknown[] };
    usage.succeeded += 1;
    const raw = Array.isArray(d?.paths) ? d.paths as Record<string, unknown>[] : [];
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
      score: Number(p?.score ?? 0),
      usd: Number(p?.contribution_usd ?? 0),
      hops: Number(p?.hop_distance ?? 0),
    }));
    return { available: true, paths, calls: usage.calls, succeeded: usage.succeeded };
  } catch {
    return { available: false, paths: [], calls: usage.calls, succeeded: usage.succeeded };
  }
}
