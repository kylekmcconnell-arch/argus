// Analyst edits — Wikipedia-style propose → verify → publish-or-hold.
//   GET   /api/augment?subjectKind=&canonicalRef=&subject=  → list subject additions
//   GET   /api/augment?view=pending|learnings              → owner review views
//   POST  /api/augment                                      → verify + submit atomically
//   PATCH /api/augment                                      → owner approve / deny / diagnose
//
// Two gates keep this from being a manipulation vector:
//   1. VERIFY — the submission must EXIST on-source (the GitHub resolves, the site
//      loads, the token trades). A non-existent target is rejected outright.
//   2. CORROBORATE — can we PROVE it belongs to this subject, not just that it
//      exists? If yes (e.g. the GitHub's own profile links back to this X account),
//      it publishes live. If not, it's held PENDING and an approval notice fires;
//      a human approves/denies in AdminOps. Correct-but-unprovable never auto-
//      publishes, and it's never silently dropped.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type ServiceCredentials,
} from "./_auth.js";
import { normalizeSubjectRef } from "../src/lib/subjectRef.js";
import { tokenEntityKey } from "../src/graph/network.js";

export const config = { maxDuration: 30 };

const norm = (s: string) => s.trim().toLowerCase().replace(/^[@$]/, "").replace(/\/$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUBJECT_KINDS = new Set(["person", "token", "investigation", "site"]);
const TARGET_TYPES = new Set(["github", "website", "x", "contract", "wallet"]);
const RELATIONSHIPS = new Set(["same_operator", "associate", "runs", "team", "advisor", "other"]);

type SubjectKind = "person" | "token" | "investigation" | "site";
type Status = "live" | "pending" | "denied";
type Augmentation = {
  id: string;
  status: Status;
  why?: string;
  type: string;
  value: string;
  label: string;
  url?: string;
  detail?: string;
  graphKey?: string;
  rel?: string;
  kind?: string;
  by: string;
  at: number;
  subject: string;
  subjectKind: string;
  canonicalRef: string;
  subjectGraphKey?: string;
};

type DbAugmentation = {
  id?: unknown;
  subject_kind?: unknown;
  canonical_ref?: unknown;
  subject_label?: unknown;
  subject_graph_key?: unknown;
  item_type?: unknown;
  target_kind?: unknown;
  relationship?: unknown;
  value?: unknown;
  label?: unknown;
  url?: unknown;
  detail?: unknown;
  graph_key?: unknown;
  verification_reason?: unknown;
  status?: unknown;
  submitted_by_label?: unknown;
  submitted_at?: unknown;
};

type JsonRecord = Record<string, unknown>;

const text = (value: unknown, max = 500): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const queryText = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function normalizedSubject(kindValue: string, value: string): { kind: SubjectKind; ref: string } | null {
  if (!SUBJECT_KINDS.has(kindValue)) return null;
  const kind = kindValue as SubjectKind;
  if (kind === "person") {
    const ref = normalizeSubjectRef(value);
    return /^[A-Za-z0-9_]{1,15}$/.test(ref) ? { kind, ref: ref.toLowerCase() } : null;
  }
  if (kind === "token" || kind === "investigation") {
    const clean = value.trim().replace(/^[$]+/, "");
    if (SOLANA_ADDRESS.test(clean)) return { kind, ref: clean };
    if (EVM_ADDRESS.test(clean)) return { kind, ref: clean.toLowerCase() };
    return null;
  }
  try {
    const url = /^https?:\/\//i.test(value) ? new URL(value) : new URL(`https://${value}`);
    const ref = url.hostname.replace(/^www\./i, "").toLowerCase();
    return ref && ref.length <= 500 ? { kind, ref } : null;
  } catch {
    return null;
  }
}

function canonicalTarget(type: string, value: string, graphKey?: string): string | null {
  const raw = value.trim();
  if (type === "contract" || type === "wallet") {
    if (SOLANA_ADDRESS.test(raw)) return raw;
    if (EVM_ADDRESS.test(raw)) return raw.toLowerCase();
    return null;
  }
  if (type === "x") {
    const handle = (graphKey || raw).replace(/^@/, "").replace(/^(?:https?:\/\/)?(?:x|twitter)\.com\//i, "");
    return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? `@${handle.toLowerCase()}` : null;
  }
  if (type === "github") {
    const login = (graphKey || raw).replace(/^(?:https?:\/\/)?github\.com\//i, "").replace(/^@/, "");
    return login ? `github.com/${login.toLowerCase()}` : null;
  }
  if (type === "website") {
    try {
      const candidate = graphKey || raw;
      const url = /^https?:\/\//i.test(candidate) ? new URL(candidate) : new URL(`https://${candidate}`);
      return url.hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

function publicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return !(
      value === "::"
      || value === "::1"
      || value.startsWith("fc")
      || value.startsWith("fd")
      || /^fe[89ab]/.test(value)
      || value.startsWith("ff")
      || value.startsWith("2001:db8:")
      || value.startsWith("::ffff:")
    );
  }
  return false;
}

async function validatedPublicUrl(raw: string, base?: URL): Promise<URL | null> {
  let url: URL;
  try {
    url = base
      ? new URL(raw, base)
      : /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
  } catch {
    return null;
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (isIP(hostname)) return publicIp(hostname) ? url : null;
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => publicIp(entry.address)) ? url : null;
  } catch {
    return null;
  }
}

async function fetchPublicWebsite(raw: string): Promise<{ response: Response; url: URL } | null> {
  let current = await validatedPublicUrl(raw);
  for (let redirect = 0; current && redirect <= 4; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (ARGUS)" },
    });
    if (response.status < 300 || response.status >= 400) return { response, url: current };
    const location = response.headers.get("location");
    if (!location) return { response, url: current };
    current = await validatedPublicUrl(location, current);
  }
  return null;
}

function toAugmentation(row: DbAugmentation): Augmentation | null {
  const id = text(row.id, 80);
  const status = row.status === "live" || row.status === "pending" || row.status === "denied" ? row.status : null;
  const type = text(row.item_type, 40);
  const value = text(row.value);
  const label = text(row.label);
  const subject = text(row.subject_label);
  const subjectKind = text(row.subject_kind, 30);
  const canonicalRef = text(row.canonical_ref);
  if (!id || !status || !type || !value || !label || !subject || !subjectKind || !canonicalRef) return null;
  const submittedAt = typeof row.submitted_at === "string" ? Date.parse(row.submitted_at) : Number.NaN;
  return {
    id,
    status,
    type,
    value,
    label,
    by: text(row.submitted_by_label, 120) || "analyst",
    at: Number.isFinite(submittedAt) ? submittedAt : Date.now(),
    subject,
    subjectKind,
    canonicalRef,
    ...(text(row.subject_graph_key) ? { subjectGraphKey: text(row.subject_graph_key) } : {}),
    ...(text(row.url, 2000) ? { url: text(row.url, 2000) } : {}),
    ...(text(row.detail, 1000) ? { detail: text(row.detail, 1000) } : {}),
    ...(text(row.graph_key) ? { graphKey: text(row.graph_key) } : {}),
    ...(text(row.verification_reason, 1000) ? { why: text(row.verification_reason, 1000) } : {}),
    ...(type === "link" && text(row.relationship, 40) ? { rel: text(row.relationship, 40) } : {}),
    ...(type === "link" && text(row.target_kind, 40) ? { kind: text(row.target_kind, 40) } : {}),
  };
}

async function rows(response: Response): Promise<DbAugmentation[]> {
  if (!response.ok) return [];
  const value = await response.json().catch(() => []);
  return Array.isArray(value) ? value : value && typeof value === "object" ? [value as DbAugmentation] : [];
}

const AUGMENT_SELECT = "id,subject_kind,canonical_ref,subject_label,subject_graph_key,item_type,target_kind,relationship,value,label,url,detail,graph_key,verification_reason,status,submitted_by_label,submitted_at";

async function listAug(
  credentials: ServiceCredentials,
  organizationId: string,
  subject: { kind: SubjectKind; ref: string },
  subjectLabel: string,
): Promise<Augmentation[]> {
  const exactUrl = `${credentials.url}/rest/v1/augmentation_items?select=${AUGMENT_SELECT}&organization_id=eq.${encodeURIComponent(organizationId)}&subject_kind=eq.${subject.kind}&canonical_ref=eq.${encodeURIComponent(subject.ref)}&status=in.%28live%2Cpending%29&order=submitted_at.desc&limit=100`;
  const requests = [fetch(exactUrl, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(7000) })];
  // Only person and site display keys were deterministic in the legacy store.
  // Ticker-keyed token rows are intentionally left for owner reconciliation.
  if ((subject.kind === "person" || subject.kind === "site") && subjectLabel) {
    const legacyRef = normalizeSubjectRef(subjectLabel);
    requests.push(fetch(`${credentials.url}/rest/v1/augmentation_items?select=${AUGMENT_SELECT}&organization_id=eq.${encodeURIComponent(organizationId)}&subject_kind=eq.legacy&canonical_ref=eq.${encodeURIComponent(legacyRef)}&status=in.%28live%2Cpending%29&order=submitted_at.desc&limit=100`, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(7000) }));
  }
  try {
    const responses = await Promise.all(requests);
    const mapped = (await Promise.all(responses.map(rows))).flat().map(toAugmentation).filter((item): item is Augmentation => item !== null);
    const byFact = new Map<string, Augmentation>();
    for (const item of mapped) {
      const factKey = [
        item.type,
        item.kind ?? "",
        item.rel ?? "",
        normalizeSubjectRef(item.graphKey || item.value),
      ].join("|");
      // Exact typed rows are queried first and supersede legacy display-key rows.
      if (!byFact.has(factKey)) byFact.set(factKey, item);
    }
    return [...byFact.values()];
  } catch {
    return [];
  }
}

async function listPending(credentials: ServiceCredentials, organizationId: string): Promise<Augmentation[]> {
  try {
    const response = await fetch(`${credentials.url}/rest/v1/augmentation_items?select=${AUGMENT_SELECT}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=submitted_at.desc&limit=300`, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(7000) });
    return (await rows(response)).map(toAugmentation).filter((item): item is Augmentation => item !== null);
  } catch {
    return [];
  }
}

type Learning = { subject: string; label: string; kind: string; reason: string; fix: string; at: number };

async function listLearnings(credentials: ServiceCredentials, organizationId: string): Promise<Learning[]> {
  try {
    const response = await fetch(`${credentials.url}/rest/v1/augmentation_events?select=metadata,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&event_type=eq.augmentation.diagnosed&order=created_at.desc&limit=60`, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(7000) });
    if (!response.ok) return [];
    const values = await response.json().catch(() => []);
    if (!Array.isArray(values)) return [];
    return values.map((value) => {
      const row = record(value);
      const metadata = record(row.metadata);
      const at = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
      return {
        subject: text(metadata.subject),
        label: text(metadata.label),
        kind: text(metadata.kind, 80),
        reason: text(metadata.reason, 400),
        fix: text(metadata.fix, 400),
        at: Number.isFinite(at) ? at : Date.now(),
      };
    }).filter((item) => item.subject && item.label && item.reason && item.fix);
  } catch {
    return [];
  }
}

async function loadItem(credentials: ServiceCredentials, organizationId: string, itemId: string): Promise<Augmentation | null> {
  try {
    const response = await fetch(`${credentials.url}/rest/v1/augmentation_items?select=${AUGMENT_SELECT}&organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(itemId)}&limit=1`, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(7000) });
    return toAugmentation((await rows(response))[0] ?? {});
  } catch {
    return null;
  }
}

// ── independent verification per type ──────────────────────────────────────
// graphKey mirrors how the audit engine keys the same entity, so a manual link
// bridges to any real audit of that entity in the trust graph.
async function verify(type: string, value: string): Promise<{ ok: boolean; label: string; url?: string; detail?: string; graphKey?: string; reason?: string } | null> {
  const v = value.trim();
  try {
    if (type === "github") {
      const login = v.match(/github\.com\/([A-Za-z0-9-]{1,39})/i)?.[1] || v.replace(/^@/, "");
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) return { ok: false, label: login, reason: "not a valid GitHub username" };
      const key = process.env.GITHUB_TOKEN;
      const r = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, label: login, reason: "no GitHub account at that username" };
      const u = (await r.json()) as { login: string; name?: string; public_repos?: number; followers?: number; html_url?: string };
      return { ok: true, label: `github.com/${u.login}`, url: u.html_url ?? `https://github.com/${u.login}`, detail: `${u.public_repos ?? 0} repos · ${u.followers ?? 0} followers${u.name ? ` · ${u.name}` : ""}`, graphKey: `github.com/${u.login.toLowerCase()}` };
    }
    if (type === "website") {
      const result = await fetchPublicWebsite(v);
      if (!result) return { ok: false, label: v, reason: "not a public web URL" };
      const host = result.url.hostname;
      if (!result.response.ok) return { ok: false, label: host, reason: `site returned ${result.response.status}` };
      const bare = host.replace(/^www\./, "").toLowerCase();
      return { ok: true, label: bare, url: result.url.toString(), detail: "resolves live", graphKey: bare };
    }
    if (type === "x") {
      const h = v.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,30})/i)?.[1] || v.replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,30}$/.test(h)) return { ok: false, label: h, reason: "not a valid X handle" };
      const r = await fetch(`https://unavatar.io/x/${h}?fallback=false`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, label: `@${h}`, reason: "no X account at that handle" };
      return { ok: true, label: `@${h}`, url: `https://x.com/${h}`, detail: "account exists", graphKey: `@${h.toLowerCase()}` };
    }
    if (type === "contract" || type === "wallet") {
      const addr = v.replace(/^\s+|\s+$/g, "");
      const isEvm = /^0x[a-fA-F0-9]{40}$/.test(addr);
      const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
      if (!isEvm && !isSol) return { ok: false, label: addr, reason: "not a valid contract/wallet address" };
      if (type === "wallet") return { ok: false, label: addr.slice(0, 8) + "…", reason: "wallet ownership can't be verified from an address alone" };
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(addr)}`, { signal: AbortSignal.timeout(8000) });
      const d = r.ok ? ((await r.json()) as { pairs?: { chainId?: string; baseToken?: { symbol?: string } }[] }) : null;
      const pair = d?.pairs?.[0];
      if (pair) {
        const chain = pair.chainId || (isSol ? "solana" : "evm");
        return {
          ok: true,
          label: pair.baseToken?.symbol ? `$${pair.baseToken.symbol}` : addr.slice(0, 8) + "…",
          url: `https://dexscreener.com/${chain}/${addr}`,
          detail: `trades on ${chain}`,
          graphKey: tokenEntityKey(chain, addr),
        };
      }
      return { ok: false, label: addr.slice(0, 8) + "…", reason: "no on-chain token found for this address" };
    }
    return { ok: false, label: v, reason: "unsupported type" };
  } catch (e) {
    return { ok: false, label: v, reason: "verification failed (" + String(e).slice(0, 60) + ")" };
  }
}

// The GitHub account's self-declared X handle — the one path we can auto-prove an
// addition belongs to the subject (the account itself points back at this X).
async function ghTwitter(login: string): Promise<string | null> {
  try {
    const key = process.env.GITHUB_TOKEN;
    const r = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), accept: "application/vnd.github+json", "user-agent": "argus" }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const u = (await r.json()) as { twitter_username?: string | null };
    return u.twitter_username ? u.twitter_username.toLowerCase().replace(/^@/, "") : null;
  } catch { return null; }
}

// Corroboration: prove the addition is THIS subject's, not just that it exists.
async function corroborate(effectiveType: string, subject: string, graphKey?: string): Promise<{ ok: boolean; why: string }> {
  const subj = norm(subject);
  const subjectIsHandle = /^[a-z0-9_]{2,30}$/.test(subj);
  if (effectiveType === "github" && subjectIsHandle) {
    const login = (graphKey ?? "").replace(/^github\.com\//, "");
    if (login) { const tw = await ghTwitter(login); if (tw && tw === subj) return { ok: true, why: "the GitHub profile links back to this same X account" }; }
    return { ok: false, why: "the account exists, but nothing on it ties it to this subject" };
  }
  if (effectiveType === "link") return { ok: false, why: "a relationship claim can't be independently proven" };
  return { ok: false, why: "verified to exist, but not corroborated as this subject's" };
}

// Best-effort, env-gated notice for a pending edit. A generic webhook (Slack /
// Discord / Zapier→email) and/or a Resend email; if neither is set it just queues,
// visible in the AdminOps approval view.
async function notifyPending(subject: string, item: Augmentation): Promise<void> {
  const summary = `${item.rel ? `link (${item.rel}) → ` : ""}${item.label}${item.detail ? `: ${item.detail}` : ""}`;
  const line = `ARGUS pending edit on ${subject}: ${summary} (by ${item.by}). ${item.why ?? ""} Approve or deny in AdminOps.`;
  const hook = process.env.ARGUS_EDIT_WEBHOOK;
  if (hook) { try { await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: line, subject, item }), signal: AbortSignal.timeout(6000) }); } catch { /* */ } }
  const rk = process.env.RESEND_API_KEY, to = process.env.ARGUS_ADMIN_EMAIL;
  if (rk && to) { try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${rk}`, "content-type": "application/json" }, body: JSON.stringify({ from: "ARGUS <onboarding@resend.dev>", to: [to], subject: `ARGUS: pending edit on ${subject}`, text: line }), signal: AbortSignal.timeout(8000) }); } catch { /* */ } }
}

// Self-learning: when an analyst approves a fact the scan MISSED, ask why and what
// to change so it's caught next time. Grounded only in the approved fact — a
// pipeline improvement suggestion, surfaced to the operator (not auto-applied).
async function diagnose(subject: string, item: Augmentation): Promise<{ reason: string; fix: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const fact = `${item.rel ? `a "${item.rel}" relationship to ` : ""}${item.kind ?? item.type}: ${item.label}${item.detail ? ` (${item.detail})` : ""}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 400,
        system: "You are ARGUS, an automated crypto due-diligence engine, improving your OWN pipeline. An analyst just approved a true fact that your automated scan of a subject FAILED to surface. Diagnose it. Reply with ONLY compact JSON {\"reason\":\"...\",\"fix\":\"...\"}: reason = the single most likely reason an automated scan missed this, one sentence; fix = ONE concrete, specific, implementable change to the scan pipeline that would catch this class of thing next time. Name the data source, search, or check to add or adjust in one actionable sentence. No text outside the JSON.",
        messages: [{ role: "user", content: `Subject: ${subject}\nMissed fact (analyst-verified): ${fact}` }],
      }),
      signal: AbortSignal.timeout(22000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { content?: { text?: string }[] };
    const text = (d.content ?? []).map((b) => b.text ?? "").join(" ");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { reason?: string; fix?: string };
    if (!j.reason && !j.fix) return null;
    return { reason: String(j.reason ?? "").slice(0, 400), fix: String(j.fix ?? "").slice(0, 400) };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH") {
    res.status(405).setHeader("Allow", "GET, POST, PATCH").json({ error: "method_not_allowed" });
    return;
  }

  const view = queryText(req.query.view).toLowerCase();
  const requiredRole = req.method === "GET"
    ? view ? "owner" : "viewer"
    : req.method === "PATCH" ? "owner" : "analyst";
  const auth = await requireArgusAuth(
    req,
    res,
    requiredRole,
  );
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");

  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured" });
    return;
  }

  if (req.method === "GET") {
    if (view === "pending") {
      res.status(200).json({ ok: true, pending: await listPending(credentials, auth.organizationId) });
      return;
    }
    if (view === "learnings") {
      res.status(200).json({ ok: true, learnings: await listLearnings(credentials, auth.organizationId) });
      return;
    }
    if (view) {
      res.status(400).json({ error: "invalid_augmentation_view" });
      return;
    }
    const subjectLabel = queryText(req.query.subject).slice(0, 500);
    const subject = normalizedSubject(
      queryText(req.query.subjectKind).toLowerCase(),
      queryText(req.query.canonicalRef),
    );
    if (!subject) {
      res.status(400).json({ error: "valid_subject_identity_required" });
      return;
    }
    res.status(200).json({
      subject: subjectLabel || subject.ref,
      subjectKind: subject.kind,
      canonicalRef: subject.ref,
      items: await listAug(credentials, auth.organizationId, subject, subjectLabel),
    });
    return;
  }

  const rawBody = typeof req.body === "string"
    ? (() => { try { return JSON.parse(req.body); } catch { return null; } })()
    : req.body;
  const body = record(rawBody);

  if (req.method === "POST") {
    if (JSON.stringify(body).length > 20_000) {
      res.status(413).json({ error: "augmentation_request_too_large" });
      return;
    }
    const subjectLabel = text(body.subject, 500);
    const subjectGraphKey = text(body.subjectGraphKey, 500);
    const subject = normalizedSubject(text(body.subjectKind, 30).toLowerCase(), text(body.canonicalRef));
    const type = text(body.type, 40).toLowerCase();
    const value = text(body.value);
    const relationship = text(body.rel, 40).toLowerCase();
    if (!subject || !subjectLabel || !TARGET_TYPES.has(type) || !value || (relationship && !RELATIONSHIPS.has(relationship))) {
      res.status(400).json({ error: "invalid_augmentation_submission" });
      return;
    }

    const verified = await verify(type, value);
    if (!verified?.ok) {
      res.status(200).json({ verified: false, reason: verified?.reason ?? "could not verify" });
      return;
    }
    const targetCanonicalRef = canonicalTarget(type, value, verified.graphKey);
    if (!targetCanonicalRef) {
      res.status(200).json({ verified: false, reason: "verified target has no stable identity" });
      return;
    }
    const effectiveType = relationship ? "link" : type;
    const corroboration = await corroborate(effectiveType, subject.kind === "person" ? subject.ref : subjectLabel, verified.graphKey);

    const rpcResponse = await fetch(`${credentials.url}/rest/v1/rpc/submit_augmentation_item`, {
      method: "POST",
      headers: serviceHeaders(credentials.key),
      body: JSON.stringify({
        p_organization_id: auth.organizationId,
        p_actor_user_id: auth.userId,
        p_subject_kind: subject.kind,
        p_canonical_ref: subject.ref,
        p_subject_label: subjectLabel,
        p_subject_graph_key: subjectGraphKey || null,
        p_item_type: effectiveType,
        p_target_kind: relationship ? type : "",
        p_relationship: relationship,
        p_target_canonical_ref: targetCanonicalRef,
        p_value: value,
        p_label: verified.label,
        p_url: verified.url ?? null,
        p_detail: verified.detail ?? null,
        p_graph_key: verified.graphKey ?? null,
        p_auto_publish: corroboration.ok,
        p_verification_reason: corroboration.why,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!rpcResponse?.ok) {
      console.error("[augment] atomic submit failed", rpcResponse?.status ?? "network");
      res.status(503).json({ verified: true, error: "augmentation_store_failed" });
      return;
    }
    const item = toAugmentation((await rows(rpcResponse))[0] ?? {});
    if (!item) {
      res.status(503).json({ verified: true, error: "augmentation_store_failed" });
      return;
    }
    if (item.status === "denied") {
      res.status(409).json({ verified: false, reason: "this exact fact was previously denied by an owner" });
      return;
    }
    const items = await listAug(credentials, auth.organizationId, subject, subjectLabel);
    if (item.status === "pending") await notifyPending(subjectLabel, item);
    res.status(200).json({
      verified: true,
      status: item.status,
      why: item.why,
      item,
      items,
    });
    return;
  }

  const action = text(body.action, 30).toLowerCase();
  const itemId = text(body.id, 80);
  if (!UUID.test(itemId) || !["approve", "deny", "diagnose"].includes(action)) {
    res.status(400).json({ error: "valid_augmentation_action_required" });
    return;
  }
  const existing = await loadItem(credentials, auth.organizationId, itemId);
  if (!existing) {
    res.status(404).json({ error: "augmentation_not_found" });
    return;
  }

  if (action === "diagnose") {
    const diagnosis = await diagnose(existing.subject, existing);
    if (diagnosis) {
      const diagnosisResponse = await fetch(`${credentials.url}/rest/v1/rpc/record_augmentation_diagnosis`, {
        method: "POST",
        headers: serviceHeaders(credentials.key),
        body: JSON.stringify({
          p_organization_id: auth.organizationId,
          p_actor_user_id: auth.userId,
          p_item_id: itemId,
          p_reason: diagnosis.reason,
          p_fix: diagnosis.fix,
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (!diagnosisResponse?.ok) {
        const error = record(await diagnosisResponse?.json().catch(() => ({})));
        if (error.code === "P0002") {
          res.status(409).json({ ok: false, error: "augmentation_not_live" });
          return;
        }
        console.error("[augment] diagnosis store failed", diagnosisResponse?.status ?? "network");
        res.status(503).json({ ok: false, error: "learning_store_failed" });
        return;
      }
    }
    res.status(200).json({ ok: true, diagnosis });
    return;
  }

  const reviewResponse = await fetch(`${credentials.url}/rest/v1/rpc/review_augmentation_item`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: auth.organizationId,
      p_actor_user_id: auth.userId,
      p_item_id: itemId,
      p_decision: action,
      p_review_note: text(body.note, 1000) || null,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!reviewResponse?.ok) {
    const error = record(await reviewResponse?.json().catch(() => ({})));
    if (error.code === "40001") {
      res.status(409).json({ ok: false, error: "augmentation_decision_conflict" });
      return;
    }
    if (error.code === "P0002") {
      res.status(404).json({ ok: false, error: "augmentation_not_found" });
      return;
    }
    console.error("[augment] owner review failed", reviewResponse?.status ?? "network");
    res.status(503).json({ ok: false, error: "augmentation_review_failed" });
    return;
  }
  const item = toAugmentation((await rows(reviewResponse))[0] ?? {});
  res.status(200).json({ ok: true, action, item });
}
