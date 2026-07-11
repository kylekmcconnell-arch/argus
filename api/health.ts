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

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const services = [
    configuredService("xai", "Grok (xAI)", process.env.XAI_API_KEY, "configure XAI_API_KEY"),
    configuredService("anthropic", "Claude analyst", process.env.ANTHROPIC_API_KEY, "configure ANTHROPIC_API_KEY"),
    configuredService("twitterapi", "twitterapi.io", process.env.TWITTERAPI_KEY, "configure TWITTERAPI_KEY"),
  ];

  res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=900");
  return res.status(200).json({
    available: true,
    mode: "configuration",
    services,
    down: services.filter((service) => !service.ok).length,
  });
}
