// Dynamic Open Graph image for an immutable capability-gated report snapshot.
// This route deliberately accepts no caller-authored title/verdict/score fields.
import React from "react";
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

interface ServiceCredentials {
  url: string;
  key: string;
}

interface Snapshot {
  kind: string;
  title: string;
  headline: string;
  verdict: string;
  score: string;
  attestation: string;
  completeness: string;
  createdAt: string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VCOLOR: Record<string, string> = {
  PASS: "#16a34a",
  CAUTION: "#d97706",
  FAIL: "#ea580c",
  AVOID: "#dc2626",
  UNVERIFIABLE_IDENTITY: "#7c3aed",
  INCOMPLETE: "#71717a",
};

function credentials(): ServiceCredentials | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url, key } : null;
}

function serviceHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  // Supabase's new sb_secret_* keys are opaque API keys, not bearer JWTs.
  if (!key.startsWith("sb_secret_")) headers.authorization = `Bearer ${key}`;
  return headers;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scoreLabel(value: unknown): string {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) return "";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function attestationLabel(value: unknown): string {
  if (value === "server_collected") return "SERVER-COLLECTED REPORT";
  if (value === "analyst_submitted") return "ANALYST-SUBMITTED REPORT";
  return "LEGACY · UNATTESTED";
}

function completenessLabel(value: unknown): string {
  if (value === "complete") return "COMPLETE COVERAGE";
  if (value === "failed") return "FAILED COVERAGE";
  return "PARTIAL COVERAGE";
}

function kindLabel(kind: string): string {
  if (kind === "person") return "PRINCIPAL AUDIT";
  if (kind === "token") return "TOKEN AUDIT";
  if (kind === "investigation") return "PROJECT INVESTIGATION";
  if (kind === "site") return "SITE INVESTIGATION";
  return "INVESTIGATION";
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function jsonRows<T>(response: Response): Promise<T[]> {
  if (!response.ok) throw new Error(`snapshot lookup failed (${response.status})`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as T[]) : [];
}

async function resolveSnapshot(service: ServiceCredentials, token: string): Promise<Snapshot | null> {
  const hash = await sha256(token);
  const now = new Date().toISOString();
  const shareResponse = await fetch(
    `${service.url}/rest/v1/share_links?select=organization_id,report_version_id&token_hash=eq.${hash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}&limit=1`,
    { headers: serviceHeaders(service.key) },
  );
  const shares = await jsonRows<Record<string, unknown>>(shareResponse);
  const organizationId = cleanText(shares[0]?.organization_id, 80);
  const reportVersionId = cleanText(shares[0]?.report_version_id, 80);
  if (!organizationId || !reportVersionId) return null;

  const versionResponse = await fetch(
    `${service.url}/rest/v1/report_versions?select=id,case_id,payload,verdict,score,completeness_state,attestation_state,created_at&id=eq.${encodeURIComponent(reportVersionId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { headers: serviceHeaders(service.key) },
  );
  const versions = await jsonRows<Record<string, unknown>>(versionResponse);
  const version = versions[0];
  const caseId = cleanText(version?.case_id, 80);
  if (version?.id !== reportVersionId || !caseId) return null;

  const caseResponse = await fetch(
    `${service.url}/rest/v1/cases?select=kind,canonical_ref,display_query&id=eq.${encodeURIComponent(caseId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { headers: serviceHeaders(service.key) },
  );
  const cases = await jsonRows<Record<string, unknown>>(caseResponse);
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
  const headline = cleanText(payload.headline, 150)
    || cleanText(tokenPayload.headline, 150)
    || cleanText(reconPayload.headline, 150)
    || cleanText(reconPayload.summary, 150)
    || "Immutable ARGUS due-diligence snapshot.";
  const verdict = cleanText(version?.verdict, 50)
    || cleanText(reportPayload.composite_verdict, 50)
    || cleanText(payload.verdict, 50)
    || cleanText(tokenPayload.verdict, 50)
    || "INCOMPLETE";

  return {
    kind,
    title: title || cleanText(reportCase?.display_query, 120) || canonicalRef,
    headline,
    verdict: verdict.toUpperCase(),
    score: scoreLabel(version?.score),
    attestation: attestationLabel(version?.attestation_state),
    completeness: completenessLabel(version?.completeness_state),
    createdAt: cleanText(version?.created_at, 40),
  };
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const keys = Array.from(url.searchParams.keys());
  const tokens = url.searchParams.getAll("share");
  const token = tokens[0] || "";
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");
  if (keys.length !== 1 || keys[0] !== "share" || tokens.length !== 1 || !TOKEN_PATTERN.test(token)) {
    return errorResponse(400, "Only a valid ARGUS share token is accepted.");
  }

  const service = credentials();
  if (!service) return errorResponse(503, "Secure sharing is not configured.");

  let snapshot: Snapshot | null;
  try {
    snapshot = await resolveSnapshot(service, token);
  } catch (error) {
    console.error("[og] snapshot lookup failed", error);
    return errorResponse(502, "This ARGUS snapshot is temporarily unavailable.");
  }
  if (!snapshot) return errorResponse(404, "This ARGUS share link is invalid, expired, or revoked.");

  const subject = snapshot.kind === "token" || snapshot.kind === "investigation"
    ? `$${snapshot.title.replace(/^\$/, "")}`
    : snapshot.title;
  const color = VCOLOR[snapshot.verdict] || "#38e1c4";
  const dateLabel = snapshot.createdAt
    ? new Date(snapshot.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase()
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#09090b",
          padding: "58px 64px",
          fontFamily: "sans-serif",
          position: "relative",
          color: "#fafafa",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ display: "flex", width: "34px", height: "34px", borderRadius: "8px", background: "#fafafa", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "13px", height: "13px", borderRadius: "9999px", background: "#d64a9e" }} />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "4px" }}>ARGUS</div>
          <div style={{ fontSize: "15px", color: "#a1a1aa", letterSpacing: "2px", marginLeft: "6px" }}>{kindLabel(snapshot.kind)}</div>
          <div style={{ display: "flex", marginLeft: "auto", border: "1px solid #3f3f46", borderRadius: "9999px", padding: "8px 13px", fontSize: "13px", color: "#a1a1aa", letterSpacing: "1px" }}>IMMUTABLE SNAPSHOT</div>
        </div>

        <div style={{ display: "flex", marginTop: "62px", fontSize: "72px", fontWeight: 650, color: "#fafafa", letterSpacing: "-2px", maxWidth: "1050px", whiteSpace: "nowrap", overflow: "hidden" }}>
          {subject.slice(0, 30)}
        </div>
        <div style={{ display: "flex", marginTop: "16px", fontSize: "25px", lineHeight: 1.35, color: "#a1a1aa", maxWidth: "910px", height: "68px", overflow: "hidden" }}>
          {snapshot.headline}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: "24px", position: "absolute", left: "64px", bottom: "94px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "17px", letterSpacing: "4px", color: "#71717a" }}>VERDICT</div>
            <div style={{ display: "flex", marginTop: "5px", fontSize: "74px", fontWeight: 800, color, lineHeight: 1, letterSpacing: "-2px" }}>{snapshot.verdict.replace("_IDENTITY", "")}</div>
          </div>
          {snapshot.score && (
            <div style={{ display: "flex", alignItems: "baseline", border: `3px solid ${color}`, borderRadius: "9999px", padding: "13px 24px", color, marginBottom: "3px" }}>
              <div style={{ fontSize: "48px", fontWeight: 800 }}>{snapshot.score}</div>
              <div style={{ fontSize: "20px", marginLeft: "4px", color: "#71717a" }}>/100</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", position: "absolute", left: "64px", bottom: "42px" }}>
          {[snapshot.attestation, snapshot.completeness, ...(dateLabel ? [`CAPTURED ${dateLabel}`] : [])].map((label) => (
            <div key={label} style={{ display: "flex", border: "1px solid #27272a", borderRadius: "7px", padding: "7px 10px", fontSize: "12px", color: "#a1a1aa", letterSpacing: "1px" }}>{label}</div>
          ))}
        </div>
        <div style={{ position: "absolute", right: "64px", bottom: "47px", fontSize: "18px", color: "#52525b" }}>{url.host}</div>
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: "9px", background: color }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" },
    },
  );
}
