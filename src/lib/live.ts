// Client for the collector backend. Detects whether the server is up and
// streams an audit over Server-Sent Events.

import type { TraceStep } from "../data/evidence";
import type { Dossier } from "../data/dossier";

export interface ProviderStatus {
  id: string;
  label: string;
  free: boolean;
  feeds: string;
  configured: boolean;
}

// Returns provider status if the backend is reachable, else null.
export async function probeBackend(timeoutMs = 1200): Promise<ProviderStatus[] | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("/api/providers", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as { providers: ProviderStatus[] };
    return data.providers;
  } catch {
    return null;
  }
}

export interface LiveHandlers {
  onStep: (step: TraceStep) => void;
  onDone: (dossier: Dossier) => void;
  onError: (err: string) => void;
}

// Streams /api/audit via fetch + manual SSE parsing (EventSource can't be
// aborted as cleanly and we want a single GET). Returns an abort function.
export function streamAudit(handle: string, h: LiveHandlers): () => void {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/audit?handle=${encodeURIComponent(handle)}`, {
        signal: ctrl.signal,
        headers: { accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        h.onError("backend error");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const ev = /event: (.+)/.exec(chunk)?.[1];
          const dataLine = /data: ([\s\S]+)/.exec(chunk)?.[1];
          if (!ev || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (ev === "step") h.onStep(data as TraceStep);
          else if (ev === "done") h.onDone(data as Dossier);
          else if (ev === "error") h.onError(data?.error ?? "error");
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") h.onError(String(e));
    }
  })();
  return () => ctrl.abort();
}
