// Public, capability-gated snapshot page. The URL carries only a random token;
// every displayed field is loaded from the immutable report version it names.
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serviceCredentials, serviceHeaders, type ServiceCredentials } from "./_auth.js";
import {
  exactReportPath,
  presentPublicReport,
  publicReportDescription,
  publicReportTitle,
  type PublicReportPresentation,
} from "../src/lib/reportPresentation.js";

interface ShareRow {
  organization_id?: unknown;
  report_version_id?: unknown;
  expires_at?: unknown;
}

interface VersionRow {
  id?: unknown;
  case_id?: unknown;
  payload?: unknown;
  verdict?: unknown;
  score?: unknown;
  completeness_state?: unknown;
  attestation_state?: unknown;
  created_at?: unknown;
}

interface CaseRow {
  kind?: unknown;
  canonical_ref?: unknown;
  display_query?: unknown;
}

interface CheckRow {
  state?: unknown;
  stale_at?: unknown;
  metadata?: unknown;
}

interface SharedSnapshot {
  reportVersionId: string;
  kind: string;
  title: string;
  headline: string;
  presentation: PublicReportPresentation;
  attestation: string;
  createdAt: string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const esc = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]!));

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function attestationLabel(value: unknown): string {
  if (value === "server_collected") return "SERVER-COLLECTED REPORT";
  if (value === "analyst_submitted") return "ANALYST-SUBMITTED REPORT";
  return "LEGACY · UNATTESTED";
}

function kindLabel(kind: string): string {
  if (kind === "person") return "PRINCIPAL AUDIT";
  if (kind === "token") return "TOKEN AUDIT";
  if (kind === "investigation") return "PROJECT INVESTIGATION";
  if (kind === "site") return "SITE INVESTIGATION";
  return "INVESTIGATION";
}

async function jsonRows<T>(response: Response): Promise<T[]> {
  if (!response.ok) throw new Error(`snapshot lookup failed (${response.status})`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as T[]) : [];
}

async function resolveSnapshot(
  credentials: ServiceCredentials,
  token: string,
): Promise<SharedSnapshot | null> {
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const now = new Date().toISOString();
  const shareResponse = await fetch(
    `${credentials.url}/rest/v1/share_links?select=organization_id,report_version_id,expires_at&token_hash=eq.${tokenHash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const shares = await jsonRows<ShareRow>(shareResponse);
  const organizationId = typeof shares[0]?.organization_id === "string" ? shares[0].organization_id : "";
  const reportVersionId = typeof shares[0]?.report_version_id === "string" ? shares[0].report_version_id : "";
  if (!organizationId || !reportVersionId) return null;

  const versionResponse = await fetch(
    `${credentials.url}/rest/v1/report_versions?select=id,case_id,payload,verdict,score,completeness_state,attestation_state,created_at&id=eq.${encodeURIComponent(reportVersionId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const versions = await jsonRows<VersionRow>(versionResponse);
  const version = versions[0];
  const caseId = typeof version?.case_id === "string" ? version.case_id : "";
  if (version?.id !== reportVersionId || !caseId) return null;

  const [caseResponse, checkResponse] = await Promise.all([
    fetch(
      `${credentials.url}/rest/v1/cases?select=kind,canonical_ref,display_query&id=eq.${encodeURIComponent(caseId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
    ),
    fetch(
      `${credentials.url}/rest/v1/check_runs?select=state,stale_at,metadata&organization_id=eq.${encodeURIComponent(organizationId)}&report_version_id=eq.${encodeURIComponent(reportVersionId)}`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
    ),
  ]);
  const [cases, checks] = await Promise.all([
    jsonRows<CaseRow>(caseResponse),
    jsonRows<CheckRow>(checkResponse),
  ]);
  const reportCase = cases[0];
  const kind = cleanText(reportCase?.kind, 30);
  const canonicalRef = cleanText(reportCase?.canonical_ref, 500);
  if (!kind || !canonicalRef) return null;

  const payload = objectValue(version?.payload);
  const tokenPayload = objectValue(payload.token);
  const reportPayload = objectValue(payload.report);
  const reconPayload = objectValue(payload.recon);
  const title = kind === "person"
    ? cleanText(reportPayload.handle, 80) || cleanText(payload.handle, 80)
    : kind === "token" || kind === "investigation"
      ? cleanText(payload.symbol, 40) || cleanText(tokenPayload.symbol, 40)
      : cleanText(reconPayload.domain, 120);
  const headline = cleanText(payload.headline, 180)
    || cleanText(tokenPayload.headline, 180)
    || cleanText(reconPayload.headline, 180)
    || cleanText(reconPayload.summary, 180)
    || "Immutable ARGUS due-diligence snapshot.";
  const verdict = cleanText(version?.verdict, 50)
    || cleanText(reportPayload.composite_verdict, 50)
    || cleanText(payload.verdict, 50)
    || cleanText(tokenPayload.verdict, 50)
    || "INCOMPLETE";

  return {
    reportVersionId,
    kind,
    title: title || cleanText(reportCase?.display_query, 120) || canonicalRef,
    headline,
    presentation: presentPublicReport({
      verdict,
      score: version?.score,
      completeness: version?.completeness_state,
      attestation: version?.attestation_state,
      checks,
    }),
    attestation: attestationLabel(version?.attestation_state),
    createdAt: cleanText(version?.created_at, 40),
  };
}

function notFound(res: VercelResponse): void {
  res.setHeader("cache-control", "no-store");
  res.status(404).send("This ARGUS share link is invalid, expired, or revoked.");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).send("Method not allowed");
    return;
  }

  // Old links allowed callers to forge title/verdict/score in query params.
  // Capability links accept one field only; every other display input is rejected.
  const queryKeys = Object.keys(req.query);
  const rawToken = req.query.share;
  if (queryKeys.length !== 1 || queryKeys[0] !== "share" || typeof rawToken !== "string" || !TOKEN_PATTERN.test(rawToken)) {
    res.status(400).send("Only a valid ARGUS share token is accepted.");
    return;
  }

  const credentials = serviceCredentials();
  if (!credentials) {
    res.setHeader("cache-control", "no-store");
    res.status(503).send("Secure sharing is not configured.");
    return;
  }

  let snapshot: SharedSnapshot | null;
  try {
    snapshot = await resolveSnapshot(credentials, rawToken);
  } catch (error) {
    console.error("[card] snapshot lookup failed", error);
    res.setHeader("cache-control", "no-store");
    res.status(502).send("This ARGUS snapshot is temporarily unavailable.");
    return;
  }
  if (!snapshot) {
    notFound(res);
    return;
  }

  const proto = req.headers["x-forwarded-proto"] === "http" ? "http" : "https";
  const host = typeof req.headers.host === "string" ? req.headers.host : "";
  const base = host ? `${proto}://${host}` : "";
  const shareUrl = `/api/card?share=${encodeURIComponent(rawToken)}`;
  const ogImage = `${base}/api/og?share=${encodeURIComponent(rawToken)}`;
  const subject = snapshot.kind === "token" || snapshot.kind === "investigation"
    ? `$${snapshot.title.replace(/^\$/, "")}`
    : snapshot.title;
  const appUrl = exactReportPath(snapshot.reportVersionId);
  const pageTitle = publicReportTitle(subject, snapshot.presentation);
  const description = publicReportDescription(snapshot.headline, snapshot.attestation, snapshot.presentation);
  const dateLabel = snapshot.createdAt
    ? new Date(snapshot.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    : "";
  const safeAppUrl = esc(appUrl);
  const versionLabel = snapshot.reportVersionId.slice(0, 8).toUpperCase();
  const presentation = snapshot.presentation;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}"/>
<meta name="robots" content="noindex,nofollow,noarchive"/>
<meta name="referrer" content="no-referrer"/>
<link rel="canonical" href="${esc(`${base}${shareUrl}`)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(pageTitle)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(pageTitle)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#09090b;color:#fafafa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);border:1px solid #27272a;border-radius:22px;background:linear-gradient(145deg,#18181b,#0f0f11);padding:34px;box-shadow:0 30px 90px #0008}.brand{display:flex;align-items:center;gap:12px;color:#a1a1aa;font-size:12px;letter-spacing:.16em}.mark{width:29px;height:29px;border-radius:8px;background:#fafafa;display:grid;place-items:center}.dot{width:10px;height:10px;border-radius:50%;background:#d64a9e}.chip{margin-left:auto;border:1px solid #3f3f46;border-radius:999px;padding:6px 10px;font-size:10px;color:#d4d4d8}.subject{margin:44px 0 0;font-size:clamp(40px,8vw,72px);line-height:1;letter-spacing:-.045em;overflow-wrap:anywhere}.headline{margin:18px 0 0;max-width:650px;color:#a1a1aa;font-size:18px;line-height:1.55}.readiness{display:inline-flex;margin-top:30px;border:1px solid var(--result);border-radius:7px;padding:7px 10px;color:var(--result);font:10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}.result{display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap;margin-top:22px}.label{font-size:10px;letter-spacing:.2em;color:#a1a1aa}.verdict{margin-top:7px;font-size:clamp(34px,7vw,58px);font-weight:750;color:var(--result);overflow-wrap:anywhere}.score{display:flex;align-items:baseline;gap:5px;border:2px solid var(--result);border-radius:999px;padding:10px 18px;color:var(--result);font-size:30px;font-weight:750}.score small{font-size:13px;color:#a1a1aa}.score-kind{font:9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#a1a1aa}.signal{margin-top:16px;color:var(--result);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.note{margin:12px 0 0;color:#a1a1aa;font-size:13px;line-height:1.5}.meta{display:flex;gap:9px;flex-wrap:wrap;margin-top:28px}.meta span{border:1px solid #27272a;border-radius:7px;padding:7px 9px;color:#a1a1aa;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em}.actions{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:26px;padding-top:24px;border-top:1px solid #27272a;color:#a1a1aa;font-size:12px}.actions a{color:#09090b;background:#fafafa;border-radius:9px;padding:10px 14px;text-decoration:none;font-weight:650}
</style></head><body><main class="card" style="--result:${esc(presentation.color)}">
<div class="brand"><span class="mark"><span class="dot"></span></span><strong>ARGUS</strong><span>${esc(kindLabel(snapshot.kind))}</span><span class="chip">IMMUTABLE SNAPSHOT</span></div>
<h1 class="subject">${esc(subject)}</h1>
<div class="readiness">${esc(presentation.readinessLabel)}</div>
<p class="headline">${esc(snapshot.headline)}</p>
<section class="result"><div><div class="label">${esc(presentation.resultLabel)}</div><div class="verdict">${esc(presentation.displayVerdict)}</div></div>${presentation.primaryScore ? `<div class="score">${esc(presentation.primaryScore)}<small>/100</small>${presentation.scoreLabel ? `<span class="score-kind">${esc(presentation.scoreLabel)}</span>` : ""}</div>` : ""}</section>
${presentation.secondarySignal ? `<div class="signal">${esc(presentation.secondarySignal)}</div>` : ""}
<p class="note">${esc(presentation.note)}</p>
<div class="meta"><span>${esc(snapshot.attestation)}</span><span>${esc(presentation.coverageLabel)}</span><span>VERSION ${esc(versionLabel)}</span>${dateLabel ? `<span>CAPTURED ${esc(dateLabel.toUpperCase())}</span>` : ""}</div>
<div class="actions"><span>Bound to this exact immutable report version.</span><a href="${safeAppUrl}" rel="noreferrer">Open exact snapshot</a></div>
</main></body></html>`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=0, s-maxage=60, stale-while-revalidate=30");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
  res.status(200).send(html);
}
