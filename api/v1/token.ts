import { tokenChecks, clearanceCoverage } from "../../src/lib/scanChecklist.js";
import { applyReportCheckContract } from "../../src/lib/reportCheckContract.js";
import { presentPublicReport } from "../../src/lib/reportPresentation.js";
// Authenticated API: GET /api/v1/token?address=<contract> (or ?url=...).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ResolvedInput, RunnableTokenInput } from "../../src/lib/resolveInput.js";
import { auditToken, collectSocialActivity, resolveInput } from "../_collector.js";
import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { screenSanctionedAddresses } from "../_sanctions-core.js";
import { claimScanReceipt, recordScanReceipt } from "../_scanReceipts.js";

export const config = { maxDuration: 60 };

const isRunnableTokenInput = (input: ResolvedInput): input is RunnableTokenInput =>
  input.kind === "token"
  && (input.via === "evm" || input.via === "solana" || input.via === "dexscreener");

function cors(req: VercelRequest, res: VercelResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowed = new Set((process.env.ARGUS_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (origin && allowed.has(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type, Idempotency-Key");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).setHeader("Allow", "GET, OPTIONS").json({ error: "method_not_allowed" }); return; }
  res.setHeader("cache-control", "private, no-store");
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  // Repeated query keys parse as arrays; only a single string value is valid.
  const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const ref = single(req.query.address) || single(req.query.url) || single(req.query.t);
  if (!ref) {
    res.status(400).json({ error: "pass ?address=<contract> or ?url=<dexscreener url>" });
    return;
  }
  const input = resolveInput(ref);
  if (!isRunnableTokenInput(input)) {
    res.status(400).json({ error: "input must be an exact token contract or DexScreener url" });
    return;
  }
  const idempotencyHeader = req.headers["idempotency-key"];
  const idempotencyKey = typeof idempotencyHeader === "string" ? idempotencyHeader.trim() : crypto.randomUUID();
  if (!/^[A-Za-z0-9:_-]{8,180}$/.test(idempotencyKey)) {
    res.status(400).json({ error: "invalid_idempotency_key", message: "Idempotency-Key must be 8 to 180 letters, numbers, colons, underscores, or hyphens." });
    return;
  }
  const quota = await consumeInvestigationQuota(auth, "/api/v1/token", { kind: "token_api" }, idempotencyKey);
  if (quota.error) { res.status(503).json({ error: quota.error }); return; }
  if (!quota.allowed) {
    res.status(429).json({
      error: "credit_budget_exhausted",
      remaining: quota.creditRemaining ?? quota.remaining,
      message: "You have no investigation credits left. Ask a workspace owner to add credits before starting another scan.",
    });
    return;
  }
  const claim = await claimScanReceipt(auth, {
    runKey: idempotencyKey, route: "/api/v1/token", kind: "token", canonicalRef: input.ref,
    displayQuery: ref, status: "running", creditsCharged: quota.used,
    startedAt: new Date(startedAt).toISOString(),
  });
  if (claim !== "written") {
    res.status(claim === "duplicate" ? 409 : 503).json({
      error: claim === "duplicate" ? "scan_run_already_claimed" : "scan_run_claim_unavailable",
      message: "This scan could not be started. Open its saved result or use a new scan identifier.",
    });
    return;
  }

  try {
    // Inject the direct OFAC screener so this server path records a real
    // sanctions outcome (and applies the AVOID cap) rather than skipping the
    // browser-only same-origin fetch.
    const d = await auditToken(input, undefined, {
      screenSanctions: screenSanctionedAddresses,
      collectSocialActivity,
    });
    if (!d) {
      await recordScanReceipt(auth, {
        runKey: idempotencyKey, route: "/api/v1/token", kind: "token", canonicalRef: input.ref,
        displayQuery: ref, status: "failed", creditsCharged: quota.used,
        startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt, failureCode: "not_found",
        failureDetail: "No DEX pair was found for this contract.",
      });
      res.status(404).json({ error: "no DEX pair found for this contract" });
      return;
    }
    const checks = applyReportCheckContract("token", tokenChecks(d));
    const completeness = clearanceCoverage(checks).sufficient ? "complete" : "partial";
    const presentation = presentPublicReport({ verdict: d.verdict, score: d.score, completeness, checks });
    await recordScanReceipt(auth, {
      runKey: idempotencyKey, route: "/api/v1/token", kind: "token", canonicalRef: input.ref,
      displayQuery: ref, status: presentation.final ? "complete" : "degraded", creditsCharged: quota.used,
      startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
    res.status(200).json({
      api: "argus/v1",
      kind: "token",
      address: d.address,
      chain: d.chain,
      symbol: d.symbol,
      name: d.name,
      verdict: presentation.final ? d.verdict : "INCOMPLETE",
      score: presentation.final ? d.score : null,
      decision_ready: presentation.final,
      completeness_state: completeness,
      assessment: { verdict: presentation.displayVerdict, score: presentation.primaryScore ? Number(presentation.primaryScore) : null, note: presentation.note },
      preliminary_model_signal: presentation.final ? null : { verdict: d.verdict, score: d.score, headline: d.headline },
      cap_applied: d.capApplied,
      headline: presentation.final ? d.headline : presentation.note,
      market: { priceUsd: d.priceUsd, marketCap: d.mcap, liquidityUsd: d.liquidityUsd, volume24h: d.vol24, ageDays: d.ageDays, priceChange: d.priceChange },
      safety: d.safety,
      sanctions: d.sanctionsScreen
        ? { screened: d.sanctionsScreen.checked, listSize: d.sanctionsScreen.listSize, sanctioned: d.sanctionsScreen.sanctioned, available: d.sanctionsScreen.available }
        : null,
      holders: { top: d.topHolders, insiderPct: d.insiderPct, bundleCount: d.bundleCount, bundleRisk: d.bundleRisk },
      corroboration: d.cg,
      provenance: { projectX: d.projectX, deployer: d.deployer },
      social_activity: d.socialActivity ?? null,
      axes: d.axes,
      findings: d.findings,
      links: { app: `https://argus-one-flax.vercel.app/?t=${d.address}` },
    });
  } catch (e) {
    await recordScanReceipt(auth, {
      runKey: idempotencyKey, route: "/api/v1/token", kind: "token", canonicalRef: input.ref,
      displayQuery: ref, status: "failed", creditsCharged: quota.used,
      startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt, failureCode: "scan_failed",
      failureDetail: e instanceof Error ? e.message : "The token scan failed.",
    });
    res.status(500).json({ error: String(e) });
  }
}
