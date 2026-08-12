// Zero-spend provider readiness. GET /api/health reports whether the critical
// provider credentials are configured without calling any external provider.
// Live credit/key probes belong behind an explicit, authenticated admin action
// so opening a report can never create unowned spend.
import type { VercelRequest, VercelResponse } from "@vercel/node";

interface Svc {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  action?: string;
  /**
   * The adapter is retired: it is not in the ADAPTERS registry and cannot run,
   * so its key being absent costs no coverage. The row stays visible because
   * this endpoint answers "which keys does this build read", but nothing may
   * report a retired lane as degraded coverage.
   */
  retired?: boolean;
}

function configuredService(
  id: string,
  label: string,
  value: string | undefined,
  action: string,
): Svc {
  const ok = Boolean(value?.trim());
  return {
    id,
    label,
    ok,
    ...(ok ? {} : { detail: "not configured in this deployment", action }),
  };
}

/**
 * A lane that was deliberately switched off, listed for completeness only.
 *
 * Configuring the key would NOT bring it back: the adapter is commented out of
 * the registry in server/orchestrate.ts, so there is no action to offer and no
 * coverage to restore.
 */
function retiredService(id: string, label: string, reason: string): Svc {
  return { id, label, ok: false, retired: true, detail: `retired: ${reason}` };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const services = [
    configuredService("xai", "Grok (xAI)", process.env.XAI_API_KEY, "configure XAI_API_KEY"),
    configuredService("anthropic", "Claude research + analyst", process.env.ANTHROPIC_API_KEY, "configure ANTHROPIC_API_KEY"),
    configuredService("twitterapi", "twitterapi.io", process.env.TWITTERAPI_KEY, "configure TWITTERAPI_KEY"),
    configuredService("serper", "Serper (grounded search)", process.env.SERPER_API_KEY, "configure SERPER_API_KEY"),
    configuredService("openrouter", "OpenRouter (cheap extraction)", process.env.OPENROUTER_API_KEY, "configure OPENROUTER_API_KEY"),
    configuredService("cryptorank", "CryptoRank (unlock schedule)", process.env.CRYPTORANK_API_KEY, "configure CRYPTORANK_API_KEY"),
    // The rest of the keyed providers. This endpoint exists so a lane can be
    // confirmed provisioned WITHOUT spending on an audit, and it was answering
    // that question for six of the nineteen keys the code reads. The thirteen it
    // omitted include the ones behind the deployer trail, wallet identity, and
    // employment history, so a dark lane looked identical to a working one until
    // a report came back missing a panel nobody could explain.
    configuredService("helius", "Helius (Solana deployer + wallet age)", process.env.HELIUS_API_KEY, "configure HELIUS_API_KEY"),
    configuredService("etherscan", "Etherscan (EVM contract creation)", process.env.ETHERSCAN_API_KEY, "configure ETHERSCAN_API_KEY"),
    configuredService("arkham", "Arkham (wallet identity + funding trail)", process.env.ARKHAM_API_KEY, "configure ARKHAM_API_KEY"),
    configuredService("pdl", "People Data Labs (employment history)", process.env.PDL_API_KEY, "configure PDL_API_KEY"),
    configuredService("github", "GitHub (code footprint)", process.env.GITHUB_TOKEN, "configure GITHUB_TOKEN"),
    configuredService("coingecko", "CoinGecko (listings + market data)", process.env.COINGECKO_API_KEY, "configure COINGECKO_API_KEY"),
    retiredService("crunchbase", "Crunchbase (company funding)", "DeFiLlama and Monid/Akta cover funding and backing"),
    retiredService("reddit", "Reddit (community signal)", "Reddit API access was not approved"),
    configuredService("gmgn", "GMGN (holder cost basis + wallet tags)", process.env.GMGN_API_KEY, "configure GMGN_API_KEY (apply at https://gmgn.ai/ai)"),
  ];

  // Knowledge-base reuse diagnostic: read-through only engages when
  // ARGUS_ENTITY_REUSE=on reaches the RUNNING build. A verified fact flapping
  // back to unanswered on a repeat audit is the symptom of this being off.
  const entityReuse = (process.env.ARGUS_ENTITY_REUSE || "").trim().toLowerCase() === "on";

  // Extraction-routing diagnostic: confirm, without a paid audit, whether the
  // decoupled grounded-search path is provisioned and which model the cheap
  // extractor actually uses. Mirrors groundedSearch.ts exactly: grounded search
  // runs only with Serper + an extractor, and OpenRouter routing engages only
  // when its key is set AND ARGUS_EXTRACT_MODEL is a provider/model slug (else
  // it stays on the native Anthropic extractor). No secret values are exposed.
  const extractModel = process.env.ARGUS_EXTRACT_MODEL?.trim();
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const hasSerper = Boolean(process.env.SERPER_API_KEY?.trim());
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const openRouterRouting = Boolean(hasOpenRouter && extractModel && extractModel.includes("/"));
  const extraction = {
    groundedSearchActive: hasSerper && (hasOpenRouter || hasAnthropic),
    extractModel: extractModel || "claude-haiku-4-5 (default, native Anthropic)",
    extractProvider: openRouterRouting ? "openrouter" : "anthropic",
    reason: !hasSerper
      ? "grounded search INACTIVE: SERPER_API_KEY is not set on this build"
      : openRouterRouting
        ? "grounded extraction routes through OpenRouter"
        : hasOpenRouter
          ? "OpenRouter key set but ARGUS_EXTRACT_MODEL is not a provider/model slug (needs a value like google/gemini-2.5-flash-lite); using native Anthropic extractor"
          : "grounded extraction uses the native Anthropic extractor (no OpenRouter key)",
  };

  // Model-tier diagnostic: which Claude models the RUNNING build uses for the
  // two dominant cost paths. Confirms an ARGUS_ANALYST_MODEL /
  // ARGUS_DISCOVERY_MODEL env flip took effect without spending on an audit.
  const analystModel = process.env.ARGUS_ANALYST_MODEL?.trim() || "claude-sonnet-4-6 (default)";
  const discoveryModel = process.env.ARGUS_DISCOVERY_MODEL?.trim() || `${analystModel} (follows analyst)`;
  const discoveryRoute = process.env.ARGUS_BASIC_FACTS_PRIMARY?.trim()
    || "claude-web-search (default)";
  const models = { analyst: analystModel, discovery: discoveryModel, discoveryRoute };

  res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({
    available: true,
    mode: "configuration",
    services,
    extraction,
    models,
    knowledgeBase: {
      reuse: entityReuse,
      note: entityReuse
        ? "verified facts from prior audits seed new runs of the same entity"
        : "read-through INACTIVE: ARGUS_ENTITY_REUSE is not 'on' in this build; repeat audits re-discover everything",
    },
    down: services.filter((service) => !service.ok).length,
  });
}
