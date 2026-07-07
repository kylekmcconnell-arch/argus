import { useEffect, useRef, useState } from "react";
import { recordForensicEntities } from "../graph/store";

// AdminOps: the approval inbox for analyst edits that couldn't be auto-proven.
// A pending edit is verified-to-exist but not corroborated as the subject's, so a
// human decides. Approve → it publishes (and a pending LINK gets wired into the
// trust graph); Deny → it's dropped. Gated by the shared admin secret (stored
// locally, sent as ?secret= — matches the two-trusted-analysts model).
type Pending = { id: string; ref: string; subject: string; type: string; kind?: string; rel?: string; value: string; label: string; url?: string; detail?: string; graphKey?: string; why?: string; by: string; at: number };

const REL_EDGE: Record<string, string> = { same_operator: "SAME_OPERATOR", associate: "ASSOCIATES_WITH", runs: "FOUNDED", team: "TEAM", advisor: "ADVISED", other: "LINKED" };
const REL_LABEL: Record<string, string> = { same_operator: "same operator", associate: "associate", runs: "founded / runs", team: "team overlap", advisor: "advisor / backer", other: "connected" };
const NODE_TYPE: Record<string, string> = { x: "Person", website: "Company", contract: "Company", github: "Identity" };
const enc = encodeURIComponent;
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };

export function PendingEdits() {
  const [secret, setSecret] = useState(() => { try { return localStorage.getItem("argus:adminsecret") ?? ""; } catch { return ""; } });
  const [input, setInput] = useState("");
  const [items, setItems] = useState<Pending[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "denied" | "error">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const ran = useRef(false);

  const load = async (s: string) => {
    if (!s) return;
    setState("loading");
    try {
      const r = await fetch(`/api/augment?action=pending-all&secret=${enc(s)}`);
      if (r.status === 403) { setState("denied"); return; }
      const d = await r.json();
      setItems(Array.isArray(d?.pending) ? d.pending : []);
      setState("idle");
    } catch { setState("error"); }
  };

  useEffect(() => { if (ran.current || !secret) return; ran.current = true; load(secret); }, [secret]);

  const saveSecret = () => { const s = input.trim(); if (!s) return; try { localStorage.setItem("argus:adminsecret", s); } catch { /* */ } setSecret(s); ran.current = true; load(s); };

  const act = async (it: Pending, action: "approve" | "deny") => {
    setBusy(it.id);
    try {
      const r = await fetch(`/api/augment?action=${action}&ref=${enc(it.ref)}&id=${enc(it.id)}&secret=${enc(secret)}`);
      const d = await r.json();
      if (d?.ok) {
        // Approving a LINK publishes the bridging edge into the trust graph now.
        if (action === "approve" && it.type === "link" && it.graphKey) {
          recordForensicEntities(it.subject, [{ key: it.graphKey, type: NODE_TYPE[it.kind ?? ""] ?? "Company", edgeType: REL_EDGE[it.rel ?? "other"] ?? "LINKED", label: it.label }]);
        }
        setItems((prev) => prev.filter((x) => !(x.ref === it.ref && x.id === it.id)));
      }
    } catch { /* leave it */ }
    setBusy(null);
  };

  if (!secret || state === "denied") {
    return (
      <div className="rounded-xl border border-line bg-panel p-4">
        <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Pending edits · admin</div>
        <p className="mt-1.5 text-[12px] text-ink-dim">Enter the admin secret to review analyst edits awaiting approval.{state === "denied" ? " (that secret was rejected)" : ""}</p>
        <div className="mt-2 flex gap-2">
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveSecret(); }} placeholder="ARGUS_ADMIN_SECRET" className="mono flex-1 rounded-lg border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12px] text-ink outline-none" />
          <button onClick={saveSecret} className="btn-primary rounded-lg px-3 py-1.5 text-[12px]">Unlock</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Pending edits · awaiting approval</span>
        {items.length > 0 && <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "var(--color-caution)14", color: "var(--color-caution)" }}>{items.length}</span>}
        <button onClick={() => load(secret)} className="mono ml-auto text-[10.5px] text-ink-faint hover:text-ink">refresh</button>
      </div>

      {state === "loading" ? (
        <p className="mt-2 text-[12px] text-ink-faint">loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-faint">No edits pending. Additions ARGUS can auto-prove publish live; the rest land here.</p>
      ) : (
        <div className="mt-2 divide-y divide-line/60">
          {items.map((it) => (
            <div key={it.ref + it.id} className="flex flex-wrap items-center gap-2 py-2 text-[12px]">
              <span className="mono shrink-0 text-[10px] text-ink-faint">{it.subject}</span>
              <span className="mono rounded px-1 text-[9.5px]" style={{ background: "var(--color-line)", color: "var(--color-ink-dim)" }}>{it.type === "link" ? REL_LABEL[it.rel ?? "other"] ?? "link" : it.type}</span>
              {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-signal hover:underline">{it.label}</a> : <span className="text-ink">{it.label}</span>}
              {it.why && <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint">{it.why} · by {it.by} · {ago(it.at)}</span>}
              <span className="ml-auto flex shrink-0 gap-1.5">
                <button onClick={() => act(it, "approve")} disabled={busy === it.id} className="mono rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-40" style={{ borderColor: "var(--color-pass)", color: "var(--color-pass)" }}>approve</button>
                <button onClick={() => act(it, "deny")} disabled={busy === it.id} className="mono rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-faint transition hover:border-avoid hover:text-avoid disabled:opacity-40">deny</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
