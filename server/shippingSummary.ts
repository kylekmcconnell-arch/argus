// Server-side shipping collector for the watchlist sweep and the collector
// bundle: reads GitHub directly with the server's key instead of going through
// /api/shipping-summary, so a sweep does not depend on the web tier. Joins the
// token's daily price series and the deployer's creation trail the same way
// the endpoint does.
import { env } from "./config";
import { assessShipping, summarizeShipping, type ShippingDeploy, type ShippingPricePoint, type ShippingSummary } from "../src/threat/shipping";
import { collectShipping } from "../src/threat/shippingCollect";
import { deployTrailReadable, readDeployTrail } from "../src/threat/deployTrail";
import { fetchOhlcv } from "../src/lib/priceHistory";
import type { CollectTokenShippingFn } from "../src/token/audit";

export const collectShippingSummary: CollectTokenShippingFn = async (githubOrg, options): Promise<ShippingSummary | undefined> => {
  const key = env("GITHUB_TOKEN");
  if (!key) return undefined;
  const usage = { calls: 0, succeeded: 0 };
  const fetchImpl = options?.fetchImpl;
  const token = options?.token;
  const etherscanKey = env("ETHERSCAN_API_KEY") || undefined;
  const [input, series, trail] = await Promise.all([
    collectShipping({ target: githubOrg, kind: "org", key, usage, ...(fetchImpl ? { fetchImpl } : {}) }),
    token?.address && token.chain ? fetchOhlcv(token.address, token.chain, undefined, "day").catch(() => null) : Promise.resolve(null),
    token?.deployer && token.chain && deployTrailReadable(token.chain, etherscanKey) ? readDeployTrail({ chain: token.chain, wallet: token.deployer, etherscanKey, ...(fetchImpl ? { fetchImpl } : {}) }) : Promise.resolve(null),
  ]);
  const priceSeries: ShippingPricePoint[] | undefined = series?.candles.length ? series.candles.map((c) => ({ date: new Date(c.ts < 1e12 ? c.ts * 1000 : c.ts).toISOString(), close: c.close })) : undefined;
  const deploys: ShippingDeploy[] | undefined = trail ? trail.map((d) => ({ address: d.address, date: d.at, kind: "create" as const })) : undefined;
  const notes = [...(input.readNotes ?? [])];
  if (token?.address && !priceSeries) notes.push("The token's daily price series could not be read, so the chart-versus-commits read is empty.");
  if (token?.deployer && token.chain && !deployTrailReadable(token.chain, etherscanKey)) notes.push(`No explorer is configured for ${token.chain}, so the deployer's creations were not joined.`);
  return summarizeShipping(assessShipping({ ...input, readNotes: notes, ...(priceSeries ? { priceSeries } : {}), ...(deploys ? { deploys } : {}) }), new Date().toISOString());
};
