// Provider / API-key status. GET /api/keys-status
//
// One typed catalog drives the public evidence explanation and the private
// credential inventory. Reports only configuration state, never a secret value.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listSerperPurchases } from "../server/serperPurchases.js";
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "../src/lib/providerCatalog.js";

export const config = { maxDuration: 15 };

const PROVIDERS = PROVIDER_CATALOG.filter((provider) => provider.tier !== "keyless");
const KEYLESS = PROVIDER_CATALOG.filter((provider) => provider.tier === "keyless");

function credentialConfigured(provider: ProviderCatalogEntry): boolean {
  const primary = provider.env ?? [];
  if (!primary.length) return true;
  const alternatives = provider.alternativeEnv ?? [];
  const primaryConfigured = provider.id === "supabase"
    ? primary.some((key) => !!process.env[key]) || alternatives.some((key) => !!process.env[key])
    : primary.every((key) => !!process.env[key]);
  return primaryConfigured && (provider.alsoEnv ?? []).every((key) => !!process.env[key]);
}

interface GithubRateLimit {
  remaining?: unknown;
  limit?: unknown;
  reset?: unknown;
}

async function githubUsage(token: string): Promise<{ remaining: number; limit: number; resetsIn: string } | null> {
  try {
    const r = await fetch("https://api.github.com/rate_limit", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "argus" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { resources?: { core?: GithubRateLimit }; rate?: GithubRateLimit };
    const core = d.resources?.core ?? d.rate;
    if (
      typeof core?.remaining !== "number"
      || typeof core.limit !== "number"
      || typeof core.reset !== "number"
    ) return null;
    const mins = Math.max(0, Math.round((core.reset * 1000 - Date.now()) / 60000));
    return { remaining: core.remaining, limit: core.limit, resetsIn: `${mins}m` };
  } catch {
    return null;
  }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  const gh = process.env.GITHUB_TOKEN;
  const ghUsage = gh ? await githubUsage(gh) : null;

  const providers = PROVIDERS.map((p) => {
    const configured = credentialConfigured(p);
    return {
      id: p.id,
      label: p.label,
      powers: p.powers,
      limits: p.limits,
      source: p.source,
      tier: p.tier,
      kind: p.kind,
      lifecycle: p.lifecycle,
      category: p.category,
      availableWithoutCredential: p.availableWithoutCredential ?? false,
      configured,
      usage: p.live === "github" && configured && ghUsage ? `${ghUsage.remaining}/${ghUsage.limit} calls left · resets ${ghUsage.resetsIn}` : undefined,
      // Compact purchase ledger for Serper only. Never a live credit probe.
      ...(p.id === "serper" ? { purchases: listSerperPurchases() } : {}),
    };
  });

  // Keyless sources rendered as identical rows: always-on, no key, no top-up.
  const keyless = KEYLESS.map((k) => ({
    id: k.id,
    label: k.label,
    powers: k.powers,
    limits: k.limits,
    source: k.source,
    tier: "keyless" as const,
    kind: k.kind,
    lifecycle: k.lifecycle,
    category: k.category,
    availableWithoutCredential: true,
    configured: true,
  }));

  res.status(200).json({
    providers,
    keyless,
    note: "Credential presence is not a live availability test. Recent request outcomes appear separately when recorded.",
  });
}
