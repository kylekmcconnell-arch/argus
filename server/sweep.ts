// On-demand watchlist sweep — runs ONLY when explicitly triggered (the "Sweep
// now" button); there is deliberately no cron and no background monitoring.
//
// For every watched subject (shared across analysts via the reports table,
// kind='watch'):
//   - tokens: re-audit on-chain (fast scan) and diff against the saved snapshot
//     -> verdict flips, score drops, liquidity drains become alerts
//   - everyone: ring-check against the shared trust graph -> a NEW connection
//     to a FAIL/AVOID subject becomes an alert
// Alerts are stored as reports rows (kind='alert', ref hashed on content, so an
// unchanged situation never re-alerts). Optionally pushes each NEW alert to
// Telegram when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set — otherwise the
// in-app Alerts feed is the only output.
import { createHash } from "node:crypto";
import { env } from "./config";
import { auditToken } from "../src/token/audit";
import { subjectConnections, type GraphContribution } from "../src/graph/network";
import type { RunnableTokenInput } from "../src/lib/resolveInput";
import { normalizeSubjectRef } from "../src/lib/subjectRef";

const MAX_TOKEN_CHECKS = 15; // bound one sweep's spend/time

interface WatchItem {
  id: string;
  kind: "person" | "token";
  label: string;
  chain?: string;
  via?: "evm" | "solana" | "dexscreener";
  snapshot?: { verdict?: string; score?: number | null; liquidityUsd?: number };
}
export interface SweepAlert { subject: string; label: string; type: "drift" | "ring"; detail: string; at: number }

function creds(): { url: string; key: string } | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

async function pg(c: { url: string; key: string }, path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { ...headers(c.key), ...(init?.headers as Record<string, string>) }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch {
    return null;
  }
}

async function telegram(text: string): Promise<void> {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return; // push delivery is strictly opt-in
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* best-effort */ }
}

export async function runSweep(organizationId: string): Promise<{ checked: number; alerts: SweepAlert[]; note?: string }> {
  const c = creds();
  if (!c) return { checked: 0, alerts: [], note: "no backend configured" };
  if (!organizationId) return { checked: 0, alerts: [], note: "organization required" };
  const orgFilter = `organization_id=eq.${encodeURIComponent(organizationId)}`;

  const watchRows = (await pg(c, `reports?select=ref,payload&${orgFilter}&kind=eq.watch&order=ts.desc&limit=100`)) as { ref: string; payload?: { item?: WatchItem } }[] | null;
  const watches = (watchRows ?? []).map((r) => r.payload?.item).filter(Boolean) as WatchItem[];
  if (!watches.length) return { checked: 0, alerts: [], note: "watchlist empty" };

  const graphRows = (await pg(c, `graph_contributions?select=handle,verdict,nodes,edges&${orgFilter}&order=updated_at.desc&limit=300`)) as Array<{
    handle: string;
    verdict?: string | null;
    nodes?: GraphContribution["nodes"];
    edges?: GraphContribution["edges"];
  }> | null;
  const contributions: GraphContribution[] = (graphRows ?? []).map((x) => ({ handle: x.handle, verdict: x.verdict ?? undefined, nodes: x.nodes ?? [], edges: x.edges ?? [] }));
  const openCaseRows = (await pg(c, `cases?select=canonical_ref&${orgFilter}&status=eq.open&kind=in.(person,token,investigation)&limit=500`)) as { canonical_ref?: string }[] | null;
  const openCases = new Set((openCaseRows ?? [])
    .map((row) => normalizeSubjectRef(row.canonical_ref))
    .filter(Boolean));

  const found: SweepAlert[] = [];
  let tokenChecks = 0;

  for (const w of watches) {
    // ── on-chain drift (tokens only) ──
    if (w.kind === "token" && openCases.has(normalizeSubjectRef(w.id)) && tokenChecks < MAX_TOKEN_CHECKS) {
      tokenChecks++;
      const input: RunnableTokenInput = { kind: "token", ref: w.id, via: w.via ?? "evm" };
      const d = await auditToken(input, undefined, { skipSim: true }).catch(() => null);
      if (d && w.snapshot) {
        const s = w.snapshot;
        if (s.verdict && d.verdict !== s.verdict) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `verdict ${s.verdict} → ${d.verdict}${d.score != null ? ` (${d.score})` : ""}`, at: Date.now() });
        } else if (typeof s.score === "number" && typeof d.score === "number" && s.score - d.score >= 12) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `score dropped ${s.score} → ${d.score}`, at: Date.now() });
        }
        if (typeof s.liquidityUsd === "number" && s.liquidityUsd > 5000 && (d.liquidityUsd ?? 0) < s.liquidityUsd * 0.5) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `liquidity halved: $${Math.round(s.liquidityUsd).toLocaleString()} → $${Math.round(d.liquidityUsd ?? 0).toLocaleString()}`, at: Date.now() });
        }
        // refresh the baseline so the same drift doesn't alert on every sweep
        const item = { ...w, snapshot: { verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, mcap: d.mcap } };
        await pg(c, "reports?on_conflict=organization_id,ref,kind", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ organization_id: organizationId, ref: normalizeSubjectRef(w.id), kind: "watch", query: w.label, payload: { item }, ts: new Date().toISOString() }),
        });
      }
    }

    // ── ring check (everyone): connections to flagged subjects in the shared graph ──
    const bad = subjectConnections(w.id, contributions, 24).filter((x) => x.otherVerdict === "FAIL" || x.otherVerdict === "AVOID");
    if (bad.length) {
      const key = bad.map((b) => b.other).sort().join(",");
      found.push({ subject: w.id, label: w.label, type: "ring", detail: `connected to ${bad.map((b) => `${b.other} (${b.otherVerdict})`).join(", ")}${bad[0].ties.length ? ` via ${bad[0].ties.slice(0, 3).map((t) => t.label).join(", ")}` : ""}::${sha(key)}`, at: Date.now() });
    }
  }

  // Persist alerts content-hashed: an unchanged situation upserts onto the same
  // row (ignore-duplicates), so only genuinely NEW alerts come back — those are
  // the ones worth a push.
  const fresh: SweepAlert[] = [];
  for (const a of found) {
    const detail = a.detail.split("::")[0];
    const ref = "al:" + sha(`${a.subject}|${a.type}|${a.detail}`);
    const inserted = await pg(c, "reports?on_conflict=organization_id,ref,kind", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ organization_id: organizationId, ref, kind: "alert", query: a.label, payload: { subject: a.subject, label: a.label, type: a.type, detail, at: a.at }, ts: new Date().toISOString() }),
    });
    if (Array.isArray(inserted) && inserted.length > 0) fresh.push({ ...a, detail });
  }

  if (fresh.length) {
    await telegram(`ARGUS sweep: ${fresh.length} new alert${fresh.length === 1 ? "" : "s"}\n` + fresh.map((a) => `• ${a.label} — ${a.detail}`).join("\n"));
  }

  return { checked: watches.length, alerts: fresh };
}
