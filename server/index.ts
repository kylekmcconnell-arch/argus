// ARGUS collector server. Two endpoints:
//   GET /api/providers        -> which data providers are configured (no secrets)
//   GET /api/audit?handle=... -> SSE stream of trace steps, then the final dossier
//
// The client uses /api/providers to decide whether to run live, and consumes the
// SSE stream to render the live audit console. Run: npm run server.

import "./loadenv"; // must be first: loads .env before config/adapters read env
import { createServer } from "node:http";
import { providerStatus } from "./config";
import { runAudit } from "./orchestrate";
import type { TraceStep } from "./adapters/types";

const PORT = Number(process.env.ARGUS_PORT || 8787);

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(s);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/providers") {
    return json(res, 200, { providers: providerStatus() });
  }

  if (url.pathname === "/api/audit") {
    const handle = url.searchParams.get("handle");
    if (!handle) return json(res, 400, { error: "handle required" });

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
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
      console.error("[audit] failed", e);
      send("error", { error: String(e) });
    }
    res.end();
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[argus] collector server on http://localhost:${PORT}`);
  const configured = providerStatus().filter((p) => p.configured).map((p) => p.id);
  console.log(`[argus] configured providers: ${configured.length ? configured.join(", ") : "none (fixture fallback mode)"}`);
});
