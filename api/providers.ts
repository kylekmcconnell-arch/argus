// Vercel serverless function: GET /api/providers
// Reports which data providers are configured (from Vercel env vars). No secrets.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// bundled collector (see scripts/build-collector.mjs) — single file, no
// cross-dir ESM imports to break at runtime.
import { providerStatus } from "./_collector.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ providers: providerStatus() });
}
