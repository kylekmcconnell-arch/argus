// Analyst augmentations: add a missing piece to a scan, verify it, publish it.
//   GET /api/augment?subject=<key>                                   → list published additions
//   GET /api/augment?subject=<key>&type=<t>&value=<v>&by=<who>       → verify + (if valid) publish
//
// Enigma's memo: after a scan, the analyst should be able to add something ARGUS
// missed ("here's his GitHub"), have it verified, then pushed live. The rule that
// keeps this from being a manipulation vector: ARGUS INDEPENDENTLY verifies the
// submission EXISTS on-source (the GitHub account resolves, the site loads, the
// contract trades) — it never trusts the claim itself. Only verified additions
// persist, shared across analysts via the reports table.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const norm = (s: string) => s.trim().toLowerCase().replace(/^[@$]/, "").replace(/\/$/, "");

function creds() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });

type Augmentation = { type: string; value: string; label: string; url?: string; detail?: string; by: string; at: number };

async function listAug(ref: string): Promise<Augmentation[]> {
  const c = creds();
  if (!c) return [];
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=payload&ref=eq.${encodeURIComponent(ref)}&kind=eq.augmentation&limit=1`, { headers: headers(c.key), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const rows = await r.json();
    const items = rows?.[0]?.payload?.items;
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}

async function saveAug(ref: string, subject: string, items: Augmentation[]): Promise<void> {
  const c = creds();
  if (!c) return;
  try {
    await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ref, kind: "augmentation", query: subject.slice(0, 180), payload: { items }, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* best-effort */ }
}

// ── independent verification per type ──────────────────────────────────────
async function verify(type: string, value: string): Promise<{ ok: boolean; label: string; url?: string; detail?: string; reason?: string } | null> {
  const v = value.trim();
  try {
    if (type === "github") {
      const login = v.match(/github\.com\/([A-Za-z0-9-]{1,39})/i)?.[1] || v.replace(/^@/, "");
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) return { ok: false, label: login, reason: "not a valid GitHub username" };
      const key = process.env.GITHUB_TOKEN;
      const r = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, label: login, reason: "no GitHub account at that username" };
      const u = (await r.json()) as { login: string; name?: string; public_repos?: number; followers?: number; html_url?: string };
      return { ok: true, label: `github.com/${u.login}`, url: u.html_url ?? `https://github.com/${u.login}`, detail: `${u.public_repos ?? 0} repos · ${u.followers ?? 0} followers${u.name ? ` · ${u.name}` : ""}` };
    }
    if (type === "website") {
      let url = v; if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      let host = ""; try { host = new URL(url).hostname; } catch { return { ok: false, label: v, reason: "not a valid URL" }; }
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (ARGUS)" } });
      if (!r.ok) return { ok: false, label: host, reason: `site returned ${r.status}` };
      return { ok: true, label: host.replace(/^www\./, ""), url: `https://${host}`, detail: "resolves live" };
    }
    if (type === "x") {
      const h = v.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,30})/i)?.[1] || v.replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,30}$/.test(h)) return { ok: false, label: h, reason: "not a valid X handle" };
      const r = await fetch(`https://unavatar.io/x/${h}?fallback=false`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, label: `@${h}`, reason: "no X account at that handle" };
      return { ok: true, label: `@${h}`, url: `https://x.com/${h}`, detail: "account exists" };
    }
    if (type === "contract" || type === "wallet") {
      const addr = v.replace(/^\s+|\s+$/g, "");
      const isEvm = /^0x[a-fA-F0-9]{40}$/.test(addr);
      const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
      if (!isEvm && !isSol) return { ok: false, label: addr, reason: "not a valid contract/wallet address" };
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(addr)}`, { signal: AbortSignal.timeout(8000) });
      const d = r.ok ? ((await r.json()) as { pairs?: { chainId?: string; baseToken?: { symbol?: string } }[] }) : null;
      const pair = d?.pairs?.[0];
      if (pair) return { ok: true, label: pair.baseToken?.symbol ? `$${pair.baseToken.symbol}` : addr.slice(0, 8) + "…", url: `https://dexscreener.com/${pair.chainId}/${addr}`, detail: `trades on ${pair.chainId}` };
      return { ok: false, label: addr.slice(0, 8) + "…", reason: "no on-chain token found for this address" };
    }
    return { ok: false, label: v, reason: "unsupported type" };
  } catch (e) {
    return { ok: false, label: v, reason: "verification failed (" + String(e).slice(0, 60) + ")" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  if (!subject) { res.status(400).json({ error: "subject required" }); return; }
  const ref = "aug:" + norm(subject).slice(0, 120);
  const type = (typeof req.query.type === "string" ? req.query.type : "").toLowerCase();
  const value = typeof req.query.value === "string" ? req.query.value.slice(0, 200) : "";

  // List mode.
  if (!type || !value) { res.status(200).json({ subject, items: await listAug(ref) }); return; }

  const TYPES = ["github", "website", "x", "contract", "wallet"];
  if (!TYPES.includes(type)) { res.status(200).json({ verified: false, reason: "unsupported type" }); return; }

  const v = await verify(type, value);
  if (!v || !v.ok) { res.status(200).json({ verified: false, reason: v?.reason ?? "could not verify" }); return; }

  const by = (typeof req.query.by === "string" ? req.query.by : "").trim().slice(0, 40) || "analyst";
  const item: Augmentation = { type, value: value.trim(), label: v.label, url: v.url, detail: v.detail, by, at: Date.now() };
  const items = await listAug(ref);
  // Replace any prior addition of the same type+value; keep newest first, cap 20.
  const deduped = [item, ...items.filter((i) => !(i.type === item.type && norm(i.value) === norm(item.value)))].slice(0, 20);
  await saveAug(ref, subject, deduped);
  res.status(200).json({ verified: true, item, items: deduped });
}
