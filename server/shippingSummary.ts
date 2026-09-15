// Server-side shipping collector for the watchlist sweep and the collector
// bundle: reads GitHub directly with the server's key instead of going through
// /api/shipping-summary, so a sweep does not depend on the web tier.
import { env } from "./config";
import { assessShipping, summarizeShipping, type ShippingSummary } from "../src/threat/shipping";
import { collectShipping } from "../src/threat/shippingCollect";
import type { CollectTokenShippingFn } from "../src/token/audit";

export const collectShippingSummary: CollectTokenShippingFn = async (githubOrg, options): Promise<ShippingSummary | undefined> => {
  const key = env("GITHUB_TOKEN");
  if (!key) return undefined;
  const usage = { calls: 0, succeeded: 0 };
  const input = await collectShipping({ target: githubOrg, kind: "org", key, usage, ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  return summarizeShipping(assessShipping(input), new Date().toISOString());
};
