import { deadlineFetch } from "./providerDeadline.js";
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
import { getCost, withCostLedger, type AuditCost } from "./cost";
import { subjectConnections, type GraphContribution } from "../src/graph/network";
import type { RunnableTokenInput } from "../src/lib/resolveInput";
import { normalizeSubjectRef } from "../src/lib/subjectRef";
import { reportCompleteness } from "../src/lib/reports";
import { collectShippingSummary } from "./shippingSummary";

const MAX_TOKEN_CHECKS = 15; // bound one sweep's spend/time

interface WatchItem {
  id: string;
  kind: "person" | "token";
  label: string;
  chain?: string;
  via?: "evm" | "solana" | "dexscreener";
  snapshot?: { verdict?: string; score?: number | null; liquidityUsd?: number; shipping?: { grade: string; cadenceStatus: string; totalCommits: number; distinctHuman: number } };
}
export interface SweepAlert { subject: string; label: string; type: "drift" | "ring" | "stall"; detail: string; at: number }
export interface SweepResult {
  checked: number;
  alerts: SweepAlert[];
  note?: string;
  /** True when no backend answered at all; the caller must not report a completed sweep. */
  unavailable?: boolean;
  /** Token checks not attempted because the route's wall clock ran out. */
  deferred?: number;
  /** Provider spend of this sweep, isolated from any concurrent scan's ledger. */
  cost?: AuditCost;
}
export interface SweepOptions {
  /** Absolute wall-clock deadline; no token check starts once it is too close. */
  deadlineAt?: number;
}
/** Per-check budget the sweep needs left on the clock before it starts another token audit. */
const TOKEN_CHECK_RESERVE_MS = 20_000;
const SHIPPING_GRADES = new Set(["shipping-team", "shipping-solo"]);

// Same credential order as every other server module (api/_auth.ts,
// server/cache.ts, server/entityStore.ts): the sb_secret_* key first, the
// legacy service_role JWT as the documented migration fallback. Reading only
// the legacy variables made a rotated deployment sweep nothing while reporting
// success.
function creds(): { url: string; key: string } | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
// sb_secret_* keys are opaque and must never travel as a Bearer JWT.
const headers = (key: string): Record<string, string> => ({
  apikey: key,
  ...(key.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${key}` }),
  "content-type": "application/json",
});
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

async function pg(c: { url: string; key: string }, path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const r = await deadlineFetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { ...headers(c.key), ...(init?.headers as Record<string, string>) }, signal: AbortSignal.timeout(10000) });
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
    await deadlineFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* best-effort */ }
}

export function runSweep(organizationId: string, options: SweepOptions = {}): Promise<SweepResult> {
  // The sweep calls the token collector directly, so without its own ledger
  // its provider calls landed in the module-global fallback state and were
  // attributed to nobody.
  return withCostLedger(async () => {
    const result = await runSweepInLedger(organizationId, options);
    return { ...result, cost: getCost() };
  });
}

async function runSweepInLedger(organizationId: string, options: SweepOptions): Promise<SweepResult> {
  const c = creds();
  if (!c) return { checked: 0, alerts: [], note: "no backend configured", unavailable: true };
  if (!organizationId) return { checked: 0, alerts: [], note: "organization required", unavailable: true };
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
  let deferred = 0;
  const deadlineAt = options.deadlineAt;
  const remainingMs = () => (deadlineAt == null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now());

  for (const w of watches) {
    // ── on-chain drift (tokens only) ──
    // Fifteen sequential audits with no clock overran the function ceiling
    // and were killed before any alert persisted. Stop starting checks while
    // there is still time to persist what was found; the ring check below is
    // graph-only and still runs for every watch.
    const tokenCheckWanted = w.kind === "token" && openCases.has(normalizeSubjectRef(w.id)) && tokenChecks < MAX_TOKEN_CHECKS;
    if (tokenCheckWanted && remainingMs() < TOKEN_CHECK_RESERVE_MS) deferred++;
    if (tokenCheckWanted && remainingMs() >= TOKEN_CHECK_RESERVE_MS) {
      tokenChecks++;
      const input: RunnableTokenInput = { kind: "token", ref: w.id.includes(":") ? w.id.split(":")[1] : w.id, chain: w.chain, via: w.via ?? "evm" };
      const d = await auditToken(input, undefined, {
        skipSim: true,
        collectShipping: collectShippingSummary,
        ...(deadlineAt != null ? { deadlineAt: Math.min(deadlineAt - TOKEN_CHECK_RESERVE_MS / 2, Date.now() + 60_000) } : {}),
      }).catch(() => null);
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
        // ── development stall: the project was shipping at the last sweep and is not now ──
        if (s.shipping && d.shipping) {
          const was = s.shipping;
          const now = d.shipping;
          const stalled = SHIPPING_GRADES.has(was.grade) && (now.grade === "stalled" || now.grade === "thin" || now.cadenceStatus === "dormant" || now.cadenceStatus === "quiet");
          const halved = was.totalCommits >= 10 && now.totalCommits <= was.totalCommits * 0.4;
          const lost = was.distinctHuman >= 2 && now.distinctHuman <= Math.floor(was.distinctHuman / 2);
          if (stalled || halved || lost || now.leadDeparted) {
            const parts = [
              stalled ? `grade ${was.grade} → ${now.grade}` : "",
              halved ? `commits ${was.totalCommits} → ${now.totalCommits} per quarter` : "",
              lost ? `human committers ${was.distinctHuman} → ${now.distinctHuman}` : "",
              now.leadDeparted ? "lead committer has stopped" : "",
            ].filter(Boolean);
            found.push({ subject: w.id, label: w.label, type: "stall", detail: `development stalled: ${parts.join("; ")}`, at: Date.now() });
          }
        }
        // refresh the baseline so the same drift doesn't alert on every sweep
        const item = {
          ...w,
          snapshot: {
            verdict: d.verdict,
            score: d.score,
            completenessState: reportCompleteness("token", d),
            liquidityUsd: d.liquidityUsd,
            mcap: d.mcap,
            ...(d.shipping ? { shipping: { grade: d.shipping.grade, cadenceStatus: d.shipping.cadenceStatus, totalCommits: d.shipping.totalCommits, distinctHuman: d.shipping.distinctHuman, leadDeparted: d.shipping.leadDeparted } } : {}),
          },
        };
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
    await telegram(`ARGUS sweep: ${fresh.length} new alert${fresh.length === 1 ? "" : "s"}\n` + fresh.map((a) => `• ${a.label}: ${a.detail}`).join("\n"));
  }

  return { checked: watches.length, alerts: fresh, ...(deferred ? { deferred, note: `${deferred} token check${deferred === 1 ? "" : "s"} deferred: sweep time budget reached` } : {}) };
}
