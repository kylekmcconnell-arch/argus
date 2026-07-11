// Analyst edits — Wikipedia-style propose → verify → publish-or-hold.
//   GET /api/augment?subject=<key>                              → list published (live) additions
//   GET /api/augment?subject=<key>&type=<t>&value=<v>[&rel=]    → verify + corroborate; publish live or hold pending
//   GET /api/augment?action=pending-all&secret=<s>             → (admin) every pending edit across subjects
//   GET /api/augment?action=approve|deny&ref=<r>&id=<i>&secret=<s>  → (admin) publish / drop a pending edit
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
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
} from "./_auth.js";

export const config = { maxDuration: 20 };

const norm = (s: string) => s.trim().toLowerCase().replace(/^[@$]/, "").replace(/\/$/, "");
const genId = (disc: string, value: string) => `${disc}_${norm(value).replace(/[^a-z0-9]+/g, "")}`.slice(0, 48);

type Status = "live" | "pending";
type Augmentation = { id?: string; status?: Status; why?: string; type: string; value: string; label: string; url?: string; detail?: string; graphKey?: string; rel?: string; kind?: string; by: string; at: number };

async function listAug(organizationId: string, ref: string): Promise<Augmentation[]> {
  const c = serviceCredentials();
  if (!c) return [];
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=payload&organization_id=eq.${encodeURIComponent(organizationId)}&ref=eq.${encodeURIComponent(ref)}&kind=eq.augmentation&limit=1`, { headers: serviceHeaders(c.key), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const rows = await r.json();
    const items = rows?.[0]?.payload?.items;
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}

async function loadRow(organizationId: string, ref: string): Promise<{ subject: string; items: Augmentation[] } | null> {
  const c = serviceCredentials();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=query,payload&organization_id=eq.${encodeURIComponent(organizationId)}&ref=eq.${encodeURIComponent(ref)}&kind=eq.augmentation&limit=1`, { headers: serviceHeaders(c.key), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.[0]) return null;
    const items = rows[0].payload?.items;
    return { subject: rows[0].query ?? ref, items: Array.isArray(items) ? items : [] };
  } catch { return null; }
}

async function listAllPending(organizationId: string): Promise<(Augmentation & { ref: string; subject: string })[]> {
  const c = serviceCredentials();
  if (!c) return [];
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=ref,query,payload&organization_id=eq.${encodeURIComponent(organizationId)}&kind=eq.augmentation&order=ts.desc&limit=300`, { headers: serviceHeaders(c.key), signal: AbortSignal.timeout(7000) });
    if (!r.ok) return [];
    const rows = (await r.json()) as { ref: string; query: string; payload?: { items?: Augmentation[] } }[];
    const out: (Augmentation & { ref: string; subject: string })[] = [];
    for (const row of rows) for (const it of row.payload?.items ?? []) if (it.status === "pending") out.push({ ...it, ref: row.ref, subject: row.query });
    return out.sort((a, b) => b.at - a.at);
  } catch { return []; }
}

async function saveAug(organizationId: string, ref: string, subject: string, items: Augmentation[]): Promise<boolean> {
  const c = serviceCredentials();
  if (!c) return false;
  try {
    const response = await fetch(`${c.url}/rest/v1/reports?on_conflict=organization_id,ref,kind`, {
      method: "POST",
      headers: serviceHeaders(c.key, { prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ organization_id: organizationId, ref, kind: "augmentation", query: subject.slice(0, 180), payload: { items }, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(6000),
    });
    return response.ok;
  } catch { return false; }
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
      let url = v; if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      let host = ""; try { host = new URL(url).hostname; } catch { return { ok: false, label: v, reason: "not a valid URL" }; }
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (ARGUS)" } });
      if (!r.ok) return { ok: false, label: host, reason: `site returned ${r.status}` };
      const bare = host.replace(/^www\./, "").toLowerCase();
      return { ok: true, label: bare, url: `https://${host}`, detail: "resolves live", graphKey: bare };
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
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(addr)}`, { signal: AbortSignal.timeout(8000) });
      const d = r.ok ? ((await r.json()) as { pairs?: { chainId?: string; baseToken?: { symbol?: string } }[] }) : null;
      const pair = d?.pairs?.[0];
      if (pair) return { ok: true, label: pair.baseToken?.symbol ? `$${pair.baseToken.symbol}` : addr.slice(0, 8) + "…", url: `https://dexscreener.com/${pair.chainId}/${addr}`, detail: `trades on ${pair.chainId}`, graphKey: pair.baseToken?.symbol ? `$${pair.baseToken.symbol.toUpperCase()}` : addr };
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
  const summary = `${item.rel ? `link (${item.rel}) → ` : ""}${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
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
        system: "You are ARGUS, an automated crypto due-diligence engine, improving your OWN pipeline. An analyst just approved a true fact that your automated scan of a subject FAILED to surface. Diagnose it. Reply with ONLY compact JSON {\"reason\":\"...\",\"fix\":\"...\"}: reason = the single most likely reason an automated scan missed this, one sentence; fix = ONE concrete, specific, implementable change to the scan pipeline that would catch this class of thing next time — name the data source, search, or check to add or adjust, one actionable sentence. No text outside the JSON.",
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

type Learning = { subject: string; label: string; kind: string; reason: string; fix: string; at: number };
const LEARN_REF = "learnings:v1";
async function listLearnings(organizationId: string): Promise<Learning[]> {
  const c = serviceCredentials();
  if (!c) return [];
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=payload&organization_id=eq.${encodeURIComponent(organizationId)}&ref=eq.${encodeURIComponent(LEARN_REF)}&kind=eq.learning&limit=1`, { headers: serviceHeaders(c.key), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const rows = await r.json();
    const items = rows?.[0]?.payload?.items;
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}
async function saveLearning(organizationId: string, entry: Learning): Promise<boolean> {
  const c = serviceCredentials();
  if (!c) return false;
  const items = [entry, ...(await listLearnings(organizationId))].slice(0, 60);
  try {
    const response = await fetch(`${c.url}/rest/v1/reports?on_conflict=organization_id,ref,kind`, { method: "POST", headers: serviceHeaders(c.key, { prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ organization_id: organizationId, ref: LEARN_REF, kind: "learning", query: "self-learning", payload: { items }, ts: new Date().toISOString() }), signal: AbortSignal.timeout(6000) });
    return response.ok;
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }

  const action = typeof req.query.action === "string" ? req.query.action : "";
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const type = (typeof req.query.type === "string" ? req.query.type : "").toLowerCase();
  const value = typeof req.query.value === "string" ? req.query.value.slice(0, 200) : "";
  const auth = await requireArgusAuth(
    req,
    res,
    action ? "owner" : type && value ? "analyst" : "viewer",
  );
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");

  // ── Admin actions ──
  if (action) {
    const secret = process.env.ARGUS_ADMIN_SECRET;
    if (!secret || req.query.secret !== secret) { res.status(403).json({ error: "forbidden" }); return; }
    if (action === "pending-all") { res.status(200).json({ ok: true, pending: await listAllPending(auth.organizationId) }); return; }
    if (action === "learnings") { res.status(200).json({ ok: true, learnings: await listLearnings(auth.organizationId) }); return; }
    if (action === "diagnose") {
      const ref2 = typeof req.query.ref === "string" ? req.query.ref : "";
      const id = typeof req.query.id === "string" ? req.query.id : "";
      const row = ref2 ? await loadRow(auth.organizationId, ref2) : null;
      const it = row?.items.find((i) => i.id === id) ?? null;
      if (!row || !it) { res.status(200).json({ ok: false, reason: "not found" }); return; }
      const dg = await diagnose(row.subject, it);
      if (dg) {
        const saved = await saveLearning(auth.organizationId, { subject: row.subject, label: it.label, kind: it.rel ? `link:${it.rel}` : it.type, reason: dg.reason, fix: dg.fix, at: Date.now() });
        if (!saved) { res.status(503).json({ ok: false, error: "learning_store_failed" }); return; }
      }
      res.status(200).json({ ok: true, diagnosis: dg });
      return;
    }
    if (action === "approve" || action === "deny") {
      const ref2 = typeof req.query.ref === "string" ? req.query.ref : "";
      const id = typeof req.query.id === "string" ? req.query.id : "";
      const row = ref2 ? await loadRow(auth.organizationId, ref2) : null;
      if (!row) { res.status(200).json({ ok: false, reason: "not found" }); return; }
      const target = row.items.find((i) => i.id === id) ?? null;
      const items2 = action === "approve"
        ? row.items.map((i) => (i.id === id ? { ...i, status: "live" as Status } : i))
        : row.items.filter((i) => i.id !== id);
      if (!await saveAug(auth.organizationId, ref2, row.subject, items2)) {
        res.status(503).json({ ok: false, error: "augmentation_store_failed" });
        return;
      }
      res.status(200).json({ ok: true, action, item: target ? { ...target, status: action === "approve" ? "live" : "denied" } : null });
      return;
    }
    res.status(400).json({ error: "unknown action" });
    return;
  }

  if (!subject) { res.status(400).json({ error: "subject required" }); return; }
  const ref = "aug:" + norm(subject).slice(0, 120);

  // List mode — return everything; the client shows live and counts pending.
  if (!type || !value) { res.status(200).json({ subject, items: await listAug(auth.organizationId, ref) }); return; }

  const TYPES = ["github", "website", "x", "contract", "wallet"];
  if (!TYPES.includes(type)) { res.status(200).json({ verified: false, reason: "unsupported type" }); return; }

  const v = await verify(type, value);
  if (!v || !v.ok) { res.status(200).json({ verified: false, reason: v?.reason ?? "could not verify" }); return; }

  const by = auth.displayName.trim().slice(0, 40) || "analyst";
  const rel = (typeof req.query.rel === "string" ? req.query.rel : "").trim().slice(0, 40);
  const effectiveType = rel ? "link" : type;

  // Corroborated → live; verified-but-unprovable → pending (+ notify).
  const corr = await corroborate(effectiveType, subject, v.graphKey);
  const status: Status = corr.ok ? "live" : "pending";
  const id = genId(effectiveType + (rel ? ":" + rel : ""), value);
  const base = { id, status, why: corr.why, value: value.trim(), label: v.label, url: v.url, detail: v.detail, graphKey: v.graphKey, by, at: Date.now() };
  const item: Augmentation = rel ? { ...base, type: "link", kind: type, rel } : { ...base, type };

  const items = await listAug(auth.organizationId, ref);
  // Replace any prior addition of the same type+value; keep newest first, cap 24.
  const deduped = [item, ...items.filter((i) => !((i.type === item.type || (i.type === "link" && item.type === "link" && i.rel === item.rel)) && norm(i.value) === norm(item.value)))].slice(0, 24);
  if (!await saveAug(auth.organizationId, ref, subject, deduped)) {
    res.status(503).json({ verified: true, status, error: "augmentation_store_failed" });
    return;
  }
  if (status === "pending") await notifyPending(subject, item);

  res.status(200).json({ verified: true, status, why: corr.why, item, items: deduped });
}
