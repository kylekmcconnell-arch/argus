import type { CollectTokenShippingFn } from "../token/audit";
import type { ShippingSummary } from "../threat/shipping";

// The browser-side shipping collector the token audit injects: one call to the
// scan-time summary lane, which reads GitHub with the server's key. A missing
// key, a failed read or a slow one all degrade to "no summary", never to a
// failed audit. Mirrors socialActivityClient.
export const collectTokenShipping: CollectTokenShippingFn = async (githubOrg, options) => {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const budgetMs = options?.deadlineAt ? Math.max(3000, Math.min(28_000, options.deadlineAt - Date.now())) : 28_000;
  const qs = new URLSearchParams({ org: githubOrg });
  if (options?.token?.address && options.token.chain) {
    qs.set("address", options.token.address);
    qs.set("chain", options.token.chain);
    if (options.token.deployer) qs.set("deployer", options.token.deployer);
  }
  const response = await fetchImpl(`/api/shipping-summary?${qs}`, { signal: AbortSignal.timeout(budgetMs) });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { available?: boolean; summary?: ShippingSummary };
  return body.available && body.summary ? body.summary : undefined;
};
