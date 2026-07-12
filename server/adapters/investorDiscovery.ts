import { env } from "../config";
import { grokSearch } from "./x";
import type { CollectContext } from "./types";

const discoveryByEvidence = new WeakMap<object, Promise<string | null>>();
const focusedPortfolioByEvidence = new WeakMap<object, Promise<string | null>>();
const focusedFundScaleByEvidence = new WeakMap<object, Promise<string | null>>();

const subjectName = (ctx: CollectContext): string =>
  ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle;

const affiliationHints = (ctx: CollectContext): string => ctx.evidence.ventures
  .slice(0, 12)
  .map((venture) => `${venture.project_name} (${venture.role})`)
  .join(", ");

const subjectContext = (ctx: CollectContext): string => {
  const hints = affiliationHints(ctx);
  return `Audited subject: ${subjectName(ctx)} (X ${ctx.handle})` +
    `${ctx.evidence.profile.website ? `, official website ${ctx.evidence.profile.website}` : ""}. ` +
    `Official X bio: ${ctx.evidence.profile.bio || "not available"}.` +
    `${hints ? ` Affiliation leads to investigate without assuming: ${hints}.` : ""}`;
};

const normalizedHandle = (ctx: CollectContext): string =>
  ctx.handle.replace(/^@/, "").toLowerCase();

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
  const user = subjectContext(ctx) + " " +
    "Find source-linked direct investments, affiliated-fund investments, and source-linked fund-scale claims while keeping every attribution separate.";

  const pending = grokSearch(system, user, {
    maxToolCalls: 14,
    cacheKey: `investor-core:v3:${normalizedHandle(ctx)}`,
  });
  discoveryByEvidence.set(ctx.evidence, pending);
  return pending;
}

/**
 * One focused retry for a valid shared response whose investments array parsed
 * successfully but yielded no usable candidates. Invalid or failed shared
 * responses never reach this function, preserving the collector's null/failure
 * boundary instead of turning provider failure into apparent negative evidence.
 */
export function discoverFocusedPortfolioEvidenceText(ctx: CollectContext): Promise<string | null> {
  if (!env("XAI_API_KEY")) return Promise.resolve(null);
  const existing = focusedPortfolioByEvidence.get(ctx.evidence);
  if (existing) return existing;

  const system =
    "You discover public investment relationships for a forensic due-diligence collector. Use live web and X search only. " +
    "Find a bounded, representative set of disclosed investments made by this exact fund, VC, or angel. Prefer the fund's official portfolio page, a project or company financing announcement, a regulatory filing, or reputable independent editorial reporting. " +
    "Every candidate must include at least one exact public source URL; prefer two independent URLs. URLs and all model fields are leads only and will be fetched and independently re-derived. Never use model memory alone. " +
    "Never infer an investment from a follow, employment, token holding, trading activity, or company-name match. " +
    "Distinguish a personal investment from the portfolio of a fund the person works for. If a source names the fund, set investor_entity to that fund, attribution to affiliated_fund, and never rewrite it as the person's direct investment. " +
    "Return only compact JSON: {\"investments\":[{\"project\":\"\",\"investor_entity\":\"person or fund actually named by the source\",\"investor_x_handle\":\"@...\",\"attribution\":\"direct_subject|affiliated_fund\",\"relationship\":\"invested|backed|led round|incubated\",\"stage\":\"\",\"year\":\"\",\"project_x_handle\":\"@...\",\"project_domain\":\"example.com\",\"ticker\":\"$...\",\"contract\":\"\",\"chain\":\"\",\"sources\":[{\"url\":\"https://...\",\"title\":\"\"}]}]}. " +
    "Return at most 10 strong source-linked candidates. Return an empty list when none are found.";
  const user = subjectContext(ctx) +
    " Find source-linked direct investments and, separately, investments made by a fund this subject is currently and publicly affiliated with. Keep every attribution separate.";
  const pending = grokSearch(system, user, {
    maxToolCalls: 12,
    cacheKey: `investor-portfolio-focused:v1:${normalizedHandle(ctx)}`,
  });
  focusedPortfolioByEvidence.set(ctx.evidence, pending);
  return pending;
}

/** One focused retry for a valid shared response with no usable fund-scale rows. */
export function discoverFocusedFundScaleEvidenceText(ctx: CollectContext): Promise<string | null> {
  if (!env("XAI_API_KEY")) return Promise.resolve(null);
  const existing = focusedFundScaleByEvidence.get(ctx.evidence);
  if (existing) return existing;

  const system =
    "You discover public fund-scale evidence for a forensic due-diligence collector. Use live web and X search only. " +
    "Find disclosed USD fund closes, first closes, completed fund vehicle sizes, or dated assets under management for this exact manager or a fund the person currently works for. " +
    "Prefer the verified manager website, regulatory filings, or reputable independent editorial reporting. Every candidate must include an exact public source URL; prefer two independent URLs. URLs and all model fields are leads only and will be fetched and independently re-derived. Never use model memory alone. " +
    "Never treat a portfolio-company financing round, valuation, TVL, revenue, dry powder, deployed or invested capital, target raise, or proposed hard cap as fund scale. Accept USD claims only. " +
    "Distinguish personal capital from an affiliated fund. If a source names the fund, set attribution to affiliated_fund and never rewrite its capital as the person's own. " +
    "Return only compact JSON: {\"fund_scale\":[{\"fund_name\":\"manager or fund entity\",\"fund_vehicle\":\"named vehicle if stated\",\"fund_x_handle\":\"@...\",\"attribution\":\"direct_subject|affiliated_fund\",\"metric_hint\":\"aum|fund_vehicle|first_close|final_close\",\"amount_hint_usd\":0,\"sources\":[{\"url\":\"https://...\",\"title\":\"\"}]}]}. " +
    "Return at most 6 strong source-linked candidates. Return an empty list when none are found.";
  const user = subjectContext(ctx) +
    " Find source-linked scale claims for the exact subject and, separately, any fund the subject is currently and publicly affiliated with. Keep every attribution separate.";
  const pending = grokSearch(system, user, {
    maxToolCalls: 12,
    cacheKey: `investor-fund-scale-focused:v1:${normalizedHandle(ctx)}`,
  });
  focusedFundScaleByEvidence.set(ctx.evidence, pending);
  return pending;
}
