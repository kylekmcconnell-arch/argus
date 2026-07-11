import { useCallback, useEffect, useState } from "react";
import { useArgusAuth } from "../auth-context";
import { recordForensicEntities } from "../graph/store";

// AdminOps: the owner approval inbox for analyst edits that could not be
// auto-proven. Approve publishes the edit (and bridges a pending link into the
// trust graph); deny preserves the decision in the augmentation audit trail.
type Pending = {
  id: string;
  subject: string;
  subjectKind: string;
  canonicalRef: string;
  subjectGraphKey?: string;
  type: string;
  kind?: string;
  rel?: string;
  value: string;
  label: string;
  url?: string;
  detail?: string;
  graphKey?: string;
  why?: string;
  by: string;
  at: number;
};
type Learning = { subject: string; label: string; kind: string; reason: string; fix: string; at: number };

const REL_EDGE: Record<string, string> = { same_operator: "SAME_OPERATOR", associate: "ASSOCIATES_WITH", runs: "FOUNDED", team: "TEAM", advisor: "ADVISED", other: "LINKED" };
const REL_LABEL: Record<string, string> = { same_operator: "same operator", associate: "associate", runs: "founded / runs", team: "team overlap", advisor: "advisor / backer", other: "connected" };
const NODE_TYPE: Record<string, string> = { x: "Person", website: "Company", contract: "Token", github: "Identity" };
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };

export function PendingEdits() {
  const { role } = useArgusAuth();
  const [items, setItems] = useState<Pending[]>([]);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (role !== "owner") return;
    setState("loading");
    setError("");
    try {
      const [pendingResponse, learningsResponse] = await Promise.all([
        fetch("/api/augment?view=pending", { signal }),
        fetch("/api/augment?view=learnings", { signal }),
      ]);
      const [pendingData, learningsData] = await Promise.all([
        pendingResponse.json().catch(() => ({})),
        learningsResponse.json().catch(() => ({})),
      ]);
      if (!pendingResponse.ok) throw new Error(pendingData?.error ?? "pending_edits_load_failed");
      if (!learningsResponse.ok) throw new Error(learningsData?.error ?? "augmentation_learnings_load_failed");
      setItems(Array.isArray(pendingData?.pending) ? pendingData.pending : []);
      setLearnings(Array.isArray(learningsData?.learnings) ? learningsData.learnings : []);
      setState("idle");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Could not load pending edits.");
    }
  }, [role]);

  useEffect(() => {
    if (role !== "owner") return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, role]);

  const refreshLearnings = async () => {
    try {
      const response = await fetch("/api/augment?view=learnings");
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data?.learnings)) setLearnings(data.learnings);
    } catch { /* diagnosis is best-effort */ }
  };

  const diagnose = async (id: string) => {
    try {
      const response = await fetch("/api/augment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "diagnose", id }),
      });
      if (response.ok) await refreshLearnings();
    } catch { /* diagnosis is best-effort */ }
  };

  const act = async (item: Pending, action: "approve" | "deny") => {
    setBusy(item.id);
    setError("");
    try {
      const response = await fetch("/api/augment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: item.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? "augmentation_review_failed");
      if (action === "approve") {
        if (item.type === "link" && item.graphKey) {
          recordForensicEntities(item.subjectGraphKey || item.canonicalRef, [{
            key: item.graphKey,
            type: NODE_TYPE[item.kind ?? ""] ?? "Company",
            edgeType: REL_EDGE[item.rel ?? "other"] ?? "LINKED",
            label: item.label,
          }]);
        }
        void diagnose(item.id);
      }
      setItems((previous) => previous.filter((candidate) => candidate.id !== item.id));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not review this edit.");
    } finally {
      setBusy(null);
    }
  };

  if (role !== "owner") return null;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Pending edits · awaiting approval</span>
        {items.length > 0 && <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "var(--color-caution)14", color: "var(--color-caution)" }}>{items.length}</span>}
        <button type="button" onClick={() => void load()} className="mono ml-auto text-[10.5px] text-ink-faint hover:text-ink">refresh</button>
      </div>

      {error && <p role="alert" className="mt-2 text-[11.5px]" style={{ color: "var(--color-caution)" }}>{error}</p>}
      {state === "loading" ? (
        <p className="mt-2 text-[12px] text-ink-faint">loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-faint">No edits pending. Additions ARGUS can auto-prove publish live; the rest land here.</p>
      ) : (
        <div className="mt-2 divide-y divide-line/60">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-[12px]">
              <span className="mono shrink-0 text-[10px] text-ink-faint">{item.subject}</span>
              <span className="mono rounded px-1 text-[9.5px]" style={{ background: "var(--color-line)", color: "var(--color-ink-dim)" }}>{item.type === "link" ? REL_LABEL[item.rel ?? "other"] ?? "link" : item.type}</span>
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="text-signal hover:underline">{item.label}</a> : <span className="text-ink">{item.label}</span>}
              {item.why && <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint">{item.why} · by {item.by} · {ago(item.at)}</span>}
              <span className="ml-auto flex shrink-0 gap-1.5">
                <button type="button" onClick={() => void act(item, "approve")} disabled={busy !== null} className="mono rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-40" style={{ borderColor: "var(--color-pass)", color: "var(--color-pass)" }}>approve</button>
                <button type="button" onClick={() => void act(item, "deny")} disabled={busy !== null} className="mono rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-faint transition hover:border-avoid hover:text-avoid disabled:opacity-40">deny</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* self-learning: what ARGUS concluded it missed + the fix it proposes */}
      {learnings.length > 0 && (
        <div className="mt-4 border-t border-line/60 pt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">What ARGUS learned · {learnings.length} proposed fix{learnings.length === 1 ? "" : "es"}</div>
          <div className="mt-2 space-y-2">
            {learnings.slice(0, 12).map((learning) => (
              <div key={`${learning.subject}:${learning.at}:${learning.label}`} className="rounded-lg border border-line bg-panel-2/30 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="mono text-[9.5px] text-ink-faint">{learning.subject}</span>
                  <span className="mono rounded px-1 text-[9px]" style={{ background: "var(--color-line)", color: "var(--color-ink-dim)" }}>{learning.kind}</span>
                  <span className="text-ink-dim">missed {learning.label}</span>
                  <span className="ml-auto text-[9.5px] text-ink-faint">{ago(learning.at)}</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-ink-faint"><span className="text-ink-dim">why:</span> {learning.reason}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: "var(--color-signal-dim)" }}><span className="text-ink-dim">fix:</span> {learning.fix}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
