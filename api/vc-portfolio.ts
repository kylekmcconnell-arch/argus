// Model-discovered VC / investor portfolio candidates. GET /api/vc-portfolio?handle=&name=
//
// Grok (web + X) discovers candidate investor-project relationships. These are
// supplemental investigative leads, not verified holdings: a model-returned URL
// is only a candidate source until a deterministic collector freezes and verifies
// the relationship. The client may price a named token, but that market lookup
// does not verify the investment claim. XAI_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isIP } from "node:net";
import { cacheGetJson, cacheSetJson, attachPanelCost, grokUsd, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 120 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

interface GrokInvestmentCandidate {
  project?: unknown;
  ticker?: unknown;
  contract?: unknown;
  chain?: unknown;
  x_handle?: unknown;
  stage?: unknown;
  year?: unknown;
  outcome?: unknown;
  source_url?: unknown;
  source_title?: unknown;
}

interface GrokPayload {
  investments?: unknown;
}

type GrokAttempt = { parsed: GrokPayload | null; usd: number; status: "succeeded" | "partial" | "failed"; meta?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const textValue = (value: unknown): string => typeof value === "string" ? value : "";

function candidateSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !host
      || isIP(host)
      || host === "localhost"
      || host.endsWith(".local")
      || host.endsWith(".internal")
    ) return null;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function grok(key: string, system: string, user: string): Promise<GrokAttempt> {
  let r: Response;
  try {
    r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
        max_tool_calls: 16, // more sources -> deeper portfolio (a major fund has dozens of deals)
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch { return { parsed: null, usd: 0, status: "failed", meta: "transport_error" }; }
  if (!r.ok) return { parsed: null, usd: 0, status: "failed", meta: `http_${r.status}` };

  let d: unknown;
  try { d = await r.json(); }
  catch { return { parsed: null, usd: 0, status: "failed", meta: "response_json_error" }; }
  const payload = isRecord(d) ? d : {};
  const output = Array.isArray(payload.output) ? payload.output : [];
  const toolCalls = output.filter((item) => isRecord(item) && /search|tool/.test(String(item.type ?? ""))).length;
  const usage = isRecord(payload.usage) ? {
    input_tokens: typeof payload.usage.input_tokens === "number" ? payload.usage.input_tokens : undefined,
    output_tokens: typeof payload.usage.output_tokens === "number" ? payload.usage.output_tokens : undefined,
  } : undefined;
  const usd = grokUsd(usage, toolCalls);
  const outputText = typeof payload.output_text === "string"
    ? payload.output_text
    : output.flatMap((item) => isRecord(item) && Array.isArray(item.content) ? item.content : [])
      .map((content) => isRecord(content) ? textValue(content.text) : "")
      .join(" ");
  const text = outputText || "";
  const m = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
  if (!m) return { parsed: null, usd, status: "partial", meta: "output_contract_error" };
  let parsed: unknown;
  try { parsed = JSON.parse(m[0]); }
  catch { return { parsed: null, usd, status: "partial", meta: "output_contract_error" }; }
  return isRecord(parsed) && Array.isArray(parsed.investments)
    ? { parsed: parsed as GrokPayload, usd, status: "succeeded" }
    : { parsed: null, usd, status: "partial", meta: "output_contract_error" };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const key = process.env.XAI_API_KEY;
  const handle = q(req.query.handle).replace(/^@/, "");
  const name = q(req.query.name) || handle;
  const panelToken = req.headers["x-argus-panel-token"];
  const panelTokenValue = Array.isArray(panelToken) ? panelToken[0] : panelToken;
  const panelCostVersionId = resolvePanelCostVersion(
    auth.organizationId,
    panelTokenValue,
  );
  if (!panelCostVersionId) { res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." }); return; }
  if (!name) { res.status(400).json({ error: "handle or name required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Grok (XAI_API_KEY) not configured." }); return; }

  // 24h cache: a fund's public portfolio doesn't change between report opens.
  // ?fresh=1 bypasses it (used to re-deepen a fund cached under an older, thinner
  // search) and overwrites the cache with the new result.
  const fresh = q(req.query.fresh) === "1";
  const cacheKey = `vcport:leads-v2:${(name || handle).toLowerCase()}`;
  if (!fresh) {
    const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
    if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }
  }

  const system =
    "You are a research analyst discovering candidate public investments of a crypto/tech VC, fund, or angel. " +
    "Use live web/X search only (the fund's own portfolio page, round announcements, Crunchbase, CryptoRank, Messari, RootData, or reputable press). Do not include an investment from model memory alone. " +
    "For EACH candidate, include one specific public source URL that names or clearly supports the investor-project relationship. A URL is still only a candidate for later deterministic verification. Skip uncited relationships. " +
    "Capture: project name (required), token ticker, contract + chain if directly supported, project X handle, stage, year, reported current outcome, source_url, and source_title. " +
    "Reply with ONLY compact JSON: {\"investments\":[{\"project\":\"\",\"ticker\":\"$...\",\"contract\":\"\",\"chain\":\"\",\"x_handle\":\"@...\",\"stage\":\"\",\"year\":\"\",\"outcome\":\"\",\"source_url\":\"https://...\",\"source_title\":\"\"}]}. Return an empty list when no source-linked candidates are found. Never use em dashes.";
  const user = `Investor/fund: ${name}${handle && handle.toLowerCase() !== name.toLowerCase() ? ` (X @${handle})` : ""}. Find source-linked public portfolio candidates. Every row must include the exact candidate source URL; do not use uncited memory.`;

  // Grok is nondeterministic and often returns a THIN list for a fund with a big
  // public portfolio. When the first pass comes back short, run a second pass and
  // MERGE (dedupe by project) to deepen coverage — a fund's page can list 40+.
  const g = await grok(key, system, user);
  const attempts: GrokAttempt[] = [g];
  const list: GrokInvestmentCandidate[] = Array.isArray(g.parsed?.investments)
    ? g.parsed.investments.filter(isRecord)
    : [];
  const sourceLinkedCount = () => list.filter((item) =>
    textValue(item.project).trim() && candidateSourceUrl(item.source_url),
  ).length;
  if (sourceLinkedCount() < 15) {
    const g2 = await grok(key, system, user + " Search for additional source-linked candidates, including earlier-stage and less-famous companies. Keep only rows with a specific public source URL.");
    attempts.push(g2);
    const more: GrokInvestmentCandidate[] = Array.isArray(g2.parsed?.investments)
      ? g2.parsed.investments.filter(isRecord)
      : [];
    const indexes = new Map(list
      .map((item, index) => [textValue(item.project).trim().toLowerCase(), index] as const)
      .filter(([project]) => Boolean(project)));
    for (const i of more) {
      const k = textValue(i.project).trim().toLowerCase();
      if (!k) continue;
      const existing = indexes.get(k);
      if (existing === undefined) {
        indexes.set(k, list.length);
        list.push(i);
      } else if (!candidateSourceUrl(list[existing].source_url) && candidateSourceUrl(i.source_url)) {
        // A second pass with an actual candidate source supersedes an uncited
        // remembered row for the same project.
        list[existing] = i;
      }
    }
  }
  const uncitedCount = list.filter((item) =>
    textValue(item.project).trim() && !candidateSourceUrl(item.source_url),
  ).length;
  const candidates = list
    .filter((item) => textValue(item.project).trim() && candidateSourceUrl(item.source_url))
    .slice(0, 40)
    .map((item) => ({
      project: textValue(item.project).trim().slice(0, 80),
      ticker: textValue(item.ticker).trim() ? (textValue(item.ticker).startsWith("$") ? textValue(item.ticker).trim() : "$" + textValue(item.ticker).trim()).slice(0, 16) : null,
      contract: typeof item.contract === "string" && /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(item.contract.trim()) ? item.contract.trim() : null,
      chain: textValue(item.chain).trim() ? textValue(item.chain).trim().toLowerCase().slice(0, 16) : null,
      x_handle: typeof item.x_handle === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(item.x_handle.replace(/^@/, "")) ? "@" + item.x_handle.replace(/^@/, "") : null,
      stage: textValue(item.stage).trim() ? textValue(item.stage).trim().slice(0, 30) : null,
      year: typeof item.year === "string" || typeof item.year === "number" ? String(item.year).slice(0, 10) : null,
      outcome: textValue(item.outcome).trim() ? textValue(item.outcome).trim().slice(0, 60) : null,
      source_url: candidateSourceUrl(item.source_url),
      source_title: textValue(item.source_title).trim() ? textValue(item.source_title).trim().slice(0, 160) : null,
      evidence_state: "model_lead" as const,
    }));

  // Fold the panel spend into the KOL/VC's stored person report + cache the answer.
  const spend = attempts.reduce((sum, attempt) => sum + attempt.usd, 0);
  const providerStatus = attempts.every((attempt) => attempt.status === "succeeded")
    ? "succeeded"
    : attempts.every((attempt) => attempt.status === "failed")
      ? "failed"
      : "partial";
  const status = providerStatus === "succeeded" && uncitedCount > 0 ? "partial" : providerStatus;
  await attachPanelCost(auth.organizationId, panelCostVersionId, {
    provider: "grok",
    op: "panel:vc-portfolio",
    calls: attempts.length,
    usd: spend,
    initiatedBy: auth.userId,
    status,
    ...(status === "succeeded" ? {} : {
      meta: [
        `succeeded_${attempts.filter((attempt) => attempt.status === "succeeded").length}_of_${attempts.length}`,
        uncitedCount ? `discarded_${uncitedCount}_uncited` : "",
      ].filter(Boolean).join(" · "),
    }),
  });
  if (status === "failed") {
    res.status(502).json({
      error: "portfolio_search_failed",
      message: "The paid portfolio search failed. No portfolio conclusion or graph relationship was recorded.",
      retryable: true,
    });
    return;
  }
  if (status === "partial" && candidates.length === 0) {
    res.status(502).json({
      error: "portfolio_search_incomplete",
      message: "The paid portfolio search returned an incomplete response. No portfolio conclusion or graph relationship was recorded.",
      retryable: true,
    });
    return;
  }
  const result = {
    available: true,
    evidence_state: "model_lead" as const,
    notice: "Unverified source candidates only; excluded from the trust graph and frozen verdict.",
    name,
    candidate_count: candidates.length,
    search_status: status,
    omitted_uncited_count: uncitedCount,
    ...(uncitedCount > 0 ? {
      coverage_note: `${uncitedCount} model-returned relationship${uncitedCount === 1 ? " was" : "s were"} omitted because no candidate source URL was supplied.`,
    } : {}),
    candidates,
  };
  if (candidates.length) await cacheSetJson(cacheKey, result);
  res.status(200).json(result);
}
