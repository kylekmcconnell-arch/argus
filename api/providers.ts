// Vercel serverless function: GET /api/providers
// Reports which data providers are configured (from Vercel env vars). No secrets.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { providerStatus } from "../server/config";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ providers: providerStatus() });
}
