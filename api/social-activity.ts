import type { VercelRequest, VercelResponse } from "@vercel/node";
import { collectSocialActivity } from "./_collector.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 45 };

function clean(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "method_not_allowed" });
    return;
  }
  res.setHeader("cache-control", "private, no-store");
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const handle = clean(body.handle, 32);
  if (!handle) {
    res.status(400).json({ error: "official X handle required" });
    return;
  }
  const snapshot = await collectSocialActivity({
    handle,
    ticker: clean(body.ticker, 12),
    projectName: clean(body.projectName, 48),
  });
  res.status(200).json(snapshot);
}
