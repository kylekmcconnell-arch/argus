// Vercel serverless function: GET /api/audit?handle=...
// Streams the collector's trace steps over SSE, then the final dossier. Mirrors
// the standalone server (server/index.ts) so local dev and prod share orchestrate.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAudit } from "./_collector.js";
import type { TraceStep } from "../src/data/evidence";

// Live collection fans out to several agentic providers (Grok web+X search,
// Claude analyst, on-chain), each multi-second. Give the streaming function real
// headroom so even a heavy (VC-portfolio) audit finalizes and emits `done`.
export const config = { maxDuration: 180 };

// Server-side safety-net persistence. An audit is ~80s and costs real money; if
// the client's long-lived SSE connection is cut before `done` arrives (proxy,
// extension, tab-throttle), the result would otherwise be lost and nothing saved.
// So the SERVER upserts the finished dossier to the same reports store the client
// uses — the client then recovers it via /api/report even when its stream drops.
// Mirrors api/report.ts's POST upsert (kept inline: api functions can't import
// sibling .ts modules on Vercel).
const normRef = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
async function persistDossier(handle: string, dossier: any): Promise<void> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !dossier) return;
  const ref = normRef(dossier.handle || handle);
  if (!ref) return;
  const row = {
    ref,
    kind: "person",
    query: typeof dossier.handle === "string" ? dossier.handle.slice(0, 200) : ref,
    contributor: "auto", // saved by the server; the client overwrites with the analyst name on its own done
    payload: dossier,
    verdict: typeof dossier?.report?.composite_verdict === "string" ? dossier.report.composite_verdict.slice(0, 40) : null,
    score: typeof dossier?.report?.governing_score === "number" ? dossier.report.governing_score : null,
    ts: new Date().toISOString(),
  };
  await fetch(`${url}/rest/v1/reports?on_conflict=ref,kind`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  }).catch(() => { /* best-effort */ });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = typeof req.query.handle === "string" ? req.query.handle : "";
  if (!handle) {
    res.status(400).json({ error: "handle required" });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no", // ask any proxy in front not to buffer the stream
    connection: "keep-alive",
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client gone — the server-side persist below is the safety net */ }
  };
  const emit = (step: TraceStep) => send("step", step);

  try {
    const dossier = await runAudit(handle, emit);
    if (!dossier) {
      send("error", { error: "not_found" });
    } else {
      // Persist BEFORE signalling done, so a completed audit is saved even if the
      // client already disconnected and never receives (or acts on) `done`.
      await persistDossier(handle, dossier);
      send("done", dossier);
    }
  } catch (e) {
    console.error("[api/audit] failed", e);
    send("error", { error: String(e) });
  }
  res.end();
}
