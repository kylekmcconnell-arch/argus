import { env } from "../config";
import { grokSearch } from "./x";
import type { CollectContext } from "./types";

const discoveryByEvidence = new WeakMap<object, Promise<string | null>>();

/**
 * One bounded search supplies leads for both portfolio and fund-scale
 * verification. The model discovers URLs only; downstream collectors fetch the
 * exact bytes and independently re-derive every relationship, amount, metric,
 * attribution, and date before anything can enter scoring.
 */
export function discoverInvestorEvidenceText(ctx: CollectContext): Promise<string | null> {
  if (!env("XAI_API_KEY")) return Promise.resolve(null);
  const existing = discoveryByEvidence.get(ctx.evidence);
  if (existing) return existing;

  const subjectName = ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle;
  const affiliationHints = ctx.evidence.ventures
    .slice(0, 12)
    .map((venture) => `${venture.project_name} (${venture.role})`)
    .join(", ");
  const system =
    "You discover public investment and fund-scale evidence for a forensic due-diligence collector. Use live web and X search only. " +
    "For investments, find a bounded representative set disclosed by this exact fund, VC, or angel. " +
    "For fund scale, find disclosed USD fund closes, first closes, fund vehicle sizes, or dated assets under management for the exact manager or a fund the person currently works for. " +
    "Prefer the verified manager website, regulatory filings, project financing announcements for investment relationships, or reputable independent editorial reporting. " +
    "Every candidate must include an exact public source URL. URLs and all model fields are leads only and will be fetched and re-derived. Never use model memory alone. " +
    "Never infer an investment from a follow, employment, token holding, or company-name match. Never treat a portfolio company round, valuation, TVL, dry powder, deployed capital, target raise, or proposed hard cap as fund scale. " +
    "Distinguish a personal investment from the portfolio or scale of a fund the person works for. If a source names the fund, attribute it to the affiliated fund and never rewrite it as personal capital. " +
    "Return only compact JSON with both arrays: " +
    "{\"investments\":[{\"project\":\"\",\"investor_entity\":\"person or fund actually named by the source\",\"investor_x_handle\":\"@...\",\"attribution\":\"direct_subject|affiliated_fund\",\"relationship\":\"invested|backed|led round|incubated\",\"stage\":\"\",\"year\":\"\",\"project_x_handle\":\"@...\",\"project_domain\":\"example.com\",\"ticker\":\"$...\",\"contract\":\"\",\"chain\":\"\",\"sources\":[{\"url\":\"https://...\",\"title\":\"\"}]}]," +
    "\"fund_scale\":[{\"fund_name\":\"manager or fund entity\",\"fund_vehicle\":\"named vehicle if stated\",\"fund_x_handle\":\"@...\",\"attribution\":\"direct_subject|affiliated_fund\",\"metric_hint\":\"aum|fund_vehicle|first_close|final_close\",\"amount_hint_usd\":0,\"sources\":[{\"url\":\"https://...\",\"title\":\"\"}]}]}. " +
    "Return at most 10 investment candidates and 6 fund-scale candidates. Return empty arrays when none are found.";
  const user =
    `Audited subject: ${subjectName} (X ${ctx.handle})` +
    `${ctx.evidence.profile.website ? `, official website ${ctx.evidence.profile.website}` : ""}. ` +
    `Official X bio: ${ctx.evidence.profile.bio || "not available"}.` +
    `${affiliationHints ? ` Affiliation leads to investigate without assuming: ${affiliationHints}.` : ""} ` +
    "Find source-linked direct investments, affiliated-fund investments, and source-linked fund-scale claims while keeping every attribution separate.";

  const pending = grokSearch(system, user, {
    maxToolCalls: 14,
    cacheKey: `investor-core:v3:${ctx.handle.replace(/^@/, "").toLowerCase()}`,
  });
  discoveryByEvidence.set(ctx.evidence, pending);
  return pending;
}
