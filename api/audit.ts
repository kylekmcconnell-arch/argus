// Vercel serverless function: GET /api/audit?handle=...
// Streams the collector's trace steps over SSE, then the final dossier. Mirrors
// the standalone server (server/index.ts) so local dev and prod share orchestrate.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAudit } from "./_collector.js";
import type { TraceStep } from "../src/data/evidence";

// curated replay runs ~7s; give the function headroom
export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = typeof req.query.handle === "string" ? req.query.handle : "";
  if (!handle) {
    res.status(400).json({ error: "handle required" });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const emit = (step: TraceStep) => send("step", step);

  try {
    const dossier = await runAudit(handle, emit);
    if (!dossier) send("error", { error: "not_found" });
    else send("done", dossier);
  } catch (e) {
    console.error("[api/audit] failed", e);
    send("error", { error: String(e) });
  }
  res.end();
}
