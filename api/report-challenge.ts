// Verified report challenges. POST/GET /api/report-challenge
//
// A challenger declares who they are: part of the subject's own team, or a
// community member. Team claims are gated by a domain-bound email
// verification: the address's domain must match the subject's verified
// official website AS SAVED IN THE FROZEN REPORT (never a client-supplied
// domain), and a single-use, expiring link proves control of the inbox.
// Without this gate, a bad actor could pose as the team to fool the system or
// submit fake "official" corrections to damage the brand. A team-verified
// correction carries a higher confirmation level.
//
// Two text fields, distinct on purpose: `whatsWrong` is the correction for
// THIS report; `whereWrong` is how the system's LOGIC erred, routed to global
// methodology learning so the same mistake class is prevented everywhere.
//
// Actions:
//   POST {action:"request_verification", subject, reportVersionId, email}
//   GET  ?action=confirm&token=...      (the emailed link; token is the secret)
//   GET  ?action=status&id=...          (dialog polling)
//   POST {action:"submit", ...}         (the challenge itself)
//   GET  ?action=list                   (owner review)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes } from "node:crypto";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import { loadExactVersionReport } from "./report.js";
import { canonicalOfficialWebsite } from "../src/lib/fundScaleEvidence.js";

export const config = { maxDuration: 30 };

const REPORT_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID = REPORT_VERSION_ID;
const VERIFICATION_TTL_MS = 30 * 60 * 1000;
const MAX_FILES = 3;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 4_000_000;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

const cleanText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function parseBody(req: VercelRequest): JsonRecord {
  try {
    return record(typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body);
  } catch {
    return {};
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

type ServiceCreds = { url: string; key: string };

async function restSelect(credentials: ServiceCreds, path: string): Promise<JsonRecord[]> {
  const response = await fetch(`${credentials.url}/rest/v1/${path}`, {
    headers: serviceHeaders(credentials.key),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`challenge read failed (${response.status})`);
  const rows = await response.json() as unknown;
  return Array.isArray(rows) ? rows.map(record) : [];
}

async function restInsert(credentials: ServiceCreds, table: string, row: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(`${credentials.url}/rest/v1/${table}`, {
    method: "POST",
    headers: serviceHeaders(credentials.key, { prefer: "return=representation" }),
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`challenge write failed (${response.status})`);
  const rows = await response.json() as unknown;
  return Array.isArray(rows) ? record(rows[0]) : record(rows);
}

async function restPatch(credentials: ServiceCreds, path: string, patch: JsonRecord): Promise<void> {
  const response = await fetch(`${credentials.url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`challenge update failed (${response.status})`);
}

/**
 * The subject's official apex domain, from the FROZEN report the challenge is
 * about. The client never supplies the domain: the saved dossier's website
 * (with the verified token's homepage taking precedence, mirroring the
 * intelligence layer) is the only accepted identity surface.
 */
export function officialDomainFromReportPayload(payload: unknown): string | null {
  const dossier = record(payload);
  const tokenHomepage = record(dossier.projectToken).homepage;
  const website = typeof tokenHomepage === "string" && tokenHomepage.trim()
    ? tokenHomepage
    : typeof dossier.website === "string" ? dossier.website : "";
  return website ? canonicalOfficialWebsite(website)?.domain ?? null : null;
}

/** Exact apex agreement, or a subdomain of the official apex. Fails closed. */
export function emailDomainMatchesOfficial(email: string, officialDomain: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  const apex = officialDomain.trim().toLowerCase();
  if (!domain || !apex) return false;
  return domain === apex || domain.endsWith(`.${apex}`);
}

type FileAttachment = { name: string; type: string; dataUrl: string };

/** Validate evidence attachments; returns null when the set violates a cap. */
export function validateAttachments(value: unknown): FileAttachment[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_FILES) return null;
  const files: FileAttachment[] = [];
  let total = 0;
  for (const entry of value) {
    const row = record(entry);
    const name = cleanText(row.name, 120);
    const type = cleanText(row.type, 60);
    const dataUrl = typeof row.dataUrl === "string" ? row.dataUrl : "";
    if (!name || !FILE_TYPES.has(type) || !dataUrl.startsWith(`data:${type};base64,`)) return null;
    // base64 length -> approximate decoded bytes
    const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
    if (bytes <= 0 || bytes > MAX_FILE_BYTES) return null;
    total += bytes;
    if (total > MAX_TOTAL_BYTES) return null;
    files.push({ name, type, dataUrl });
  }
  return files;
}

// Best-effort, env-gated notices, mirroring api/augment.ts notifyPending.
async function notifyChallenge(kind: "challenge" | "system_learning", subject: string, line: string): Promise<void> {
  const hook = process.env.ARGUS_EDIT_WEBHOOK;
  if (hook) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: line, subject, kind }),
        signal: AbortSignal.timeout(6000),
      });
    } catch { /* best-effort */ }
  }
  const rk = process.env.RESEND_API_KEY;
  const to = process.env.ARGUS_ADMIN_EMAIL;
  if (rk && to) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${rk}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "ARGUS <onboarding@resend.dev>",
          to: [to],
          subject: kind === "system_learning" ? `ARGUS system learning: ${subject}` : `ARGUS: report challenged on ${subject}`,
          text: line,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch { /* best-effort */ }
  }
}

async function sendVerificationEmail(email: string, companyLabel: string, confirmUrl: string): Promise<boolean> {
  const rk = process.env.RESEND_API_KEY;
  if (!rk) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${rk}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "ARGUS <onboarding@resend.dev>",
      to: [email],
      subject: `Verify you are part of the ${companyLabel} team`,
      text: [
        `Please verify that you are indeed one of the ${companyLabel} team, and that you are verifying information on ARGUS for the public.`,
        "",
        `Confirm here: ${confirmUrl}`,
        "",
        "Then return to the ARGUS tab you came from: your correction form will show you as verified and you can submit it.",
        "",
        "If you did not request this, ignore this email; the link expires in 30 minutes and works once.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(8000),
  });
  return response.ok;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = req.query as Record<string, unknown>;
  const queryAction = typeof query.action === "string" ? query.action : "";

  // The emailed confirmation link. The token IS the credential (the recipient
  // proved inbox control by receiving it), so this route takes no bearer auth.
  if (req.method === "GET" && queryAction === "confirm") {
    const token = cleanText(query.token, 128);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).send("<p>This verification link is not valid.</p>");
    try {
      const credentials = serviceCredentials();
      if (!credentials) return res.status(503).send("<p>Verification is temporarily unavailable.</p>");
      const rows = await restSelect(credentials, `challenge_verifications?select=id,expires_at,verified_at,consumed_at,email_domain&token_hash=eq.${sha256(token)}&limit=1`);
      const row = rows[0];
      if (!row?.id) return res.status(404).send("<p>This verification link is not valid.</p>");
      if (row.consumed_at) return res.status(410).send("<p>This verification was already used.</p>");
      if (typeof row.expires_at === "string" && Date.parse(row.expires_at) < Date.now()) {
        return res.status(410).send("<p>This verification link expired. Request a new one from the report.</p>");
      }
      if (!row.verified_at) {
        await restPatch(credentials, `challenge_verifications?id=eq.${row.id}`, { verified_at: new Date().toISOString() });
      }
      return res.status(200).send(
        "<p><strong>Verified.</strong> Return to the ARGUS tab you came from: the correction form now shows you as part of the team, and your submission will carry team-verified standing.</p>",
      );
    } catch {
      return res.status(503).send("<p>Verification is temporarily unavailable. Try the link again in a moment.</p>");
    }
  }

  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) return res.status(503).json({ error: "challenge storage is not configured" });

  if (req.method === "GET" && queryAction === "status") {
    const id = cleanText(query.id, 40);
    if (!UUID.test(id)) return res.status(400).json({ error: "bad verification id" });
    const rows = await restSelect(credentials, `challenge_verifications?select=id,verified_at,consumed_at,expires_at&organization_id=eq.${auth.organizationId}&id=eq.${id}&limit=1`);
    const row = rows[0];
    if (!row?.id) return res.status(404).json({ error: "unknown verification" });
    return res.status(200).json({
      verified: Boolean(row.verified_at) && !row.consumed_at,
      expired: typeof row.expires_at === "string" && Date.parse(row.expires_at) < Date.now(),
    });
  }

  if (req.method === "GET" && queryAction === "list") {
    if (auth.role !== "owner") return res.status(403).json({ error: "owner access is required" });
    const rows = await restSelect(credentials, `report_challenges?select=id,subject_ref,report_version_id,context,challenger_role,email,email_verified,whats_wrong,where_wrong,status,created_by_label,created_at&organization_id=eq.${auth.organizationId}&order=created_at.desc&limit=100`);
    return res.status(200).json({ challenges: rows });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET/POST only" });
  const body = parseBody(req);
  const action = cleanText(body.action, 40);

  if (action === "request_verification") {
    const subject = cleanText(body.subject, 120);
    const reportVersionId = cleanText(body.reportVersionId, 40);
    const email = cleanText(body.email, 200).toLowerCase();
    if (!subject || !REPORT_VERSION_ID.test(reportVersionId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "subject, reportVersionId, and a valid email are required" });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(200).json({
        available: false,
        note: "Email verification is not configured on this deployment. Submit as a community member, or ask an ARGUS owner to configure RESEND_API_KEY.",
      });
    }
    const loaded = await loadExactVersionReport(credentials, auth.organizationId, reportVersionId);
    if (!loaded) return res.status(404).json({ error: "unknown report version" });
    const officialDomain = officialDomainFromReportPayload(record(loaded.report).payload);
    if (!officialDomain) {
      return res.status(200).json({
        available: false,
        note: "This report carries no verified official website, so a team email cannot be domain-checked. Submit as a community member instead.",
      });
    }
    if (!emailDomainMatchesOfficial(email, officialDomain)) {
      return res.status(200).json({
        available: false,
        note: `The email's domain does not match the verified official site (${officialDomain}). Team verification requires a company address.`,
      });
    }
    const token = randomBytes(32).toString("hex");
    const row = await restInsert(credentials, "challenge_verifications", {
      organization_id: auth.organizationId,
      subject_ref: subject,
      email,
      email_domain: officialDomain,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
      created_by: auth.userId,
    });
    const origin = (process.env.ARGUS_APP_ORIGIN || `https://${req.headers.host ?? ""}`).replace(/\/$/, "");
    const confirmUrl = `${origin}/api/report-challenge?action=confirm&token=${token}`;
    const reportRecord = record(loaded.report);
    const companyLabel = cleanText(reportRecord.query, 80) || subject;
    const sent = await sendVerificationEmail(email, companyLabel, confirmUrl);
    if (!sent) return res.status(200).json({ available: false, note: "The verification email could not be sent. Try again, or submit as a community member." });
    return res.status(200).json({ available: true, verificationId: row.id, expiresInMinutes: 30 });
  }

  if (action === "submit") {
    const subject = cleanText(body.subject, 120);
    const context = cleanText(body.context, 300);
    const role = cleanText(body.role, 20);
    const whatsWrong = cleanText(body.whatsWrong, 4000);
    const whereWrong = cleanText(body.whereWrong, 4000);
    const reportVersionId = cleanText(body.reportVersionId, 40);
    const email = cleanText(body.email, 200).toLowerCase();
    const verificationId = cleanText(body.verificationId, 40);
    if (!subject || !whatsWrong || (role !== "team" && role !== "community")) {
      return res.status(400).json({ error: "subject, whatsWrong, and a challenger role are required" });
    }
    const files = validateAttachments(body.files);
    if (files === null) {
      return res.status(400).json({ error: `attachments must be at most ${MAX_FILES} files (png/jpeg/webp/pdf/txt), 2MB each and 4MB together` });
    }

    let emailVerified = false;
    if (role === "team") {
      // A team claim without a completed, unspent, matching verification never
      // submits: that gate is the whole point.
      if (!UUID.test(verificationId) || !email) {
        return res.status(400).json({ error: "team challenges require a verified company email" });
      }
      const rows = await restSelect(credentials, `challenge_verifications?select=id,email,subject_ref,verified_at,consumed_at,expires_at&organization_id=eq.${auth.organizationId}&id=eq.${verificationId}&limit=1`);
      const verification = rows[0];
      const usable = verification?.id
        && verification.email === email
        && verification.subject_ref === subject
        && Boolean(verification.verified_at)
        && !verification.consumed_at;
      if (!usable) return res.status(403).json({ error: "the team email has not been verified for this report" });
      await restPatch(credentials, `challenge_verifications?id=eq.${verification.id}`, { consumed_at: new Date().toISOString() });
      emailVerified = true;
    }

    const inserted = await restInsert(credentials, "report_challenges", {
      organization_id: auth.organizationId,
      subject_ref: subject,
      ...(REPORT_VERSION_ID.test(reportVersionId) ? { report_version_id: reportVersionId } : {}),
      ...(context ? { context } : {}),
      challenger_role: role,
      ...(email ? { email } : {}),
      email_verified: emailVerified,
      ...(emailVerified && UUID.test(verificationId) ? { verification_id: verificationId } : {}),
      whats_wrong: whatsWrong,
      ...(whereWrong ? { where_wrong: whereWrong } : {}),
      files,
      created_by: auth.userId,
      created_by_label: auth.displayName || auth.email,
    });

    const who = role === "team" ? (emailVerified ? `TEAM-VERIFIED (${email})` : "team (unverified)") : "community";
    await notifyChallenge("challenge", subject, `ARGUS report challenge on ${subject} by ${who}${context ? ` about "${context}"` : ""}: ${whatsWrong.slice(0, 400)}${files.length ? ` [${files.length} attachment${files.length === 1 ? "" : "s"}]` : ""}`);
    if (whereWrong) {
      // The system-learning field is global by design: it describes how the
      // methodology erred, not just what this report got wrong.
      await notifyChallenge("system_learning", subject, `ARGUS system-learning note from a ${who} challenger on ${subject}: ${whereWrong.slice(0, 800)}`);
    }
    return res.status(200).json({ ok: true, id: inserted.id, emailVerified });
  }

  return res.status(400).json({ error: "unknown action" });
}
