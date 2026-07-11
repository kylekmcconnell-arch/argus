// Adversarial verdict review. POST /api/challenge-verdict
//
// A second pair of eyes that tries to BREAK the verdict — both ways. Automated
// diligence can be too harsh (a legit token sharing a ticker with a rug, a real
// project flagged on a name collision — the TOSHI-defamation class of false
// positive) or too lenient (a clean-scanning contract whose deployer, funding, or
// documents tell a different story). This asks Claude to argue against the verdict
// in both directions, grounded ONLY in the evidence given, and to recommend
// upholding / softening / hardening it. It never invents facts.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { attachPanelCost, claudeUsd, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 30 };

const s = (v: unknown) => (typeof v === "string" ? v : "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method !== "POST") { res.status(405).json({ error: "POST required" }); return; }
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) ?? {};
  const subject = s(body.subject).slice(0, 80);
  const verdict = s(body.verdict).slice(0, 20);
  const score = body.score == null ? "n/a" : String(body.score);
  const evidence = s(body.evidence).slice(0, 6000);
  const panelToken = req.headers["x-argus-panel-token"];
  const panelTokenValue = Array.isArray(panelToken) ? panelToken[0] : panelToken;
  const panelCostVersionId = resolvePanelCostVersion(
    auth.organizationId,
    panelTokenValue,
  );
  if (!panelCostVersionId) { res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." }); return; }
  if (!verdict || !evidence) { res.status(400).json({ error: "verdict and evidence required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Claude not configured; adversarial review unavailable." }); return; }

  let attempted = false;
  let recorded = false;
  const recordAttempt = async (status: "succeeded" | "partial" | "failed", usd = 0, meta?: string) => {
    if (!attempted || recorded) return;
    recorded = true;
    try {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "claude",
        op: "panel:challenge-verdict",
        calls: 1,
        usd,
        initiatedBy: auth.userId,
        status,
        ...(meta ? { meta } : {}),
      });
    } catch { /* usage attribution must not replace the provider response */ }
  };

  attempted = true;
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 900,
        system:
          "You are an ADVERSARIAL reviewer of a crypto due-diligence verdict. Your job is to try to BREAK the verdict, in BOTH directions, using ONLY the evidence provided — never invent facts or assume anything not stated. " +
          "Argue (a) why the verdict may be TOO HARSH (a false positive: a name/ticker collision with a bad token, a renounced contract penalized for a capability it can't use, a legit project flagged by weak signals), and (b) why it may be TOO LENIENT (a false negative: a clean contract whose deployer/funding/holders/missing-docs undercut it, a signal the score didn't weigh). " +
          "If a direction has no real basis in the evidence, return no challenges for it — do not manufacture doubt. Then recommend: uphold (verdict is well-supported), soften (too harsh), or harden (too lenient). Rate how confident the ORIGINAL verdict is after your scrutiny: low/medium/high. " +
          "Reply with ONLY compact JSON: {\"recommendation\":\"uphold|soften|harden\",\"confidence\":\"low|medium|high\",\"summary\":\"one sentence\",\"challenges\":[{\"direction\":\"too_harsh|too_lenient\",\"point\":\"specific, grounded in the evidence\"}]}",
        messages: [{ role: "user", content: `Subject: ${subject || "(token)"}\nVerdict: ${verdict} (score ${score}/100)\n\nEvidence the verdict was based on:\n${evidence}\n\nTry to break this verdict in both directions, grounded only in the above.` }],
      }),
      signal: AbortSignal.timeout(26000),
    });
  } catch (e) {
    await recordAttempt("failed", 0, "transport_error");
    res.status(200).json({ available: true, error: String(e), note: "Adversarial review failed." });
    return;
  }
  if (!r.ok) {
    await recordAttempt("failed", 0, `http_${r.status}`);
    res.status(200).json({ available: true, note: `claude ${r.status}` });
    return;
  }

  let d: any;
  try {
    d = await r.json();
  } catch (e) {
    await recordAttempt("failed", 0, "response_json_error");
    res.status(200).json({ available: true, error: String(e), note: "Adversarial review returned an unreadable response." });
    return;
  }

  const usd = claudeUsd(d?.usage);
  const text = (Array.isArray(d?.content) ? d.content : []).map((b: any) => b?.text ?? "").join(" ");
  const m = text.match(/\{[\s\S]*\}/);
  let parsed: any = {};
  let validContract = false;
  if (m) {
    try {
      parsed = JSON.parse(m[0]);
      validContract = !!parsed
        && typeof parsed === "object"
        && !Array.isArray(parsed)
        && ["uphold", "soften", "harden"].includes(parsed.recommendation)
        && ["low", "medium", "high"].includes(parsed.confidence)
        && Array.isArray(parsed.challenges);
    } catch { /* malformed model output is a partial provider result */ }
  }
  await recordAttempt(validContract ? "succeeded" : "partial", usd, validContract ? undefined : "output_contract_error");
  const rec = ["uphold", "soften", "harden"].includes(parsed.recommendation) ? parsed.recommendation : "uphold";
  const conf = ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium";
  const challenges = (Array.isArray(parsed.challenges) ? parsed.challenges : [])
    .filter((c: any) => c && typeof c.point === "string" && c.point.trim())
    .map((c: any) => ({ direction: c.direction === "too_lenient" ? "too_lenient" : "too_harsh", point: c.point.trim().slice(0, 280) }))
    .slice(0, 6);
  res.status(200).json({ available: true, recommendation: rec, confidence: conf, summary: s(parsed.summary).slice(0, 200), challenges });
}
