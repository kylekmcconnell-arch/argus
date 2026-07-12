import { useEffect, useRef, useState } from "react";
import { recordForensicEntities } from "../graph/store";

// Hard link: manually associate this subject with another entity the auto-scan
// didn't connect. Same verify-before-publish guard as Add-info (the target must
// exist on source), plus a relationship — and on success it writes a bridging
// EDGE into the trust graph (keyed canonically) so the connection web and ring
// alerts pick it up, and it bridges to any real audit of that entity.
type Link = { id: string; type: string; status?: "live" | "pending"; why?: string; kind?: string; value: string; label: string; url?: string; detail?: string; graphKey?: string; rel?: string; by: string; at: number };
type SubmitState = "idle" | "submitting" | "live" | "pending" | "rejected";
type SubjectKind = "person" | "token" | "investigation" | "site";

const TARGETS: { key: string; label: string; placeholder: string }[] = [
  { key: "x", label: "X account", placeholder: "@handle" },
  { key: "website", label: "Website", placeholder: "project.xyz" },
  { key: "contract", label: "Token", placeholder: "0x…  or  Solana mint" },
  { key: "github", label: "GitHub", placeholder: "github.com/username" },
];
const RELS: { key: string; label: string; edge: string }[] = [
  { key: "same_operator", label: "Same operator", edge: "SAME_OPERATOR" },
  { key: "associate", label: "Associate", edge: "ASSOCIATES_WITH" },
  { key: "runs", label: "Founded / runs", edge: "FOUNDED" },
  { key: "team", label: "Team overlap", edge: "TEAM" },
  { key: "advisor", label: "Advisor / backer", edge: "ADVISED" },
  { key: "other", label: "Connected", edge: "LINKED" },
];
const NODE_TYPE: Record<string, string> = { x: "Person", website: "Company", contract: "Token", github: "Identity" };

const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };

export function LinkEntity({ subject, subjectKind, canonicalRef, graphSubjectKey }: { subject: string; subjectKind: SubjectKind; canonicalRef: string; graphSubjectKey?: string }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("x");
  const [rel, setRel] = useState("same_operator");
  const [value, setValue] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [reason, setReason] = useState("");
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
  }, []);

  useEffect(() => {
    if (!subject || !canonicalRef) return;
    const controller = new AbortController();
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLinks([]);
      setState("idle");
      setReason("");
    });
    const params = new URLSearchParams({ subject, subjectKind, canonicalRef });
    fetch(`/api/augment?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setLinks((d?.items ?? []).filter((item: Link) => item.type === "link")))
      .catch(() => { /* offline or superseded */ });
    return () => controller.abort();
  }, [subject, subjectKind, canonicalRef]);

  const submit = async () => {
    const v = value.trim();
    if (!v || state === "submitting") return;
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    setState("submitting"); setReason("");
    try {
      const r = await fetch("/api/augment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, subjectKind, canonicalRef, subjectGraphKey: graphSubjectKey, type, value: v, rel }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.verified && d.item?.graphKey) {
        setLinks((d.items ?? []).filter((i: Link) => i.type === "link"));
        setValue("");
        if (d.status === "pending") {
          // A relationship claim can't be auto-proven — held for approval. The edge
          // is wired into the graph on approval (in AdminOps), not now.
          setState("pending"); setReason(d.why ?? "held for review");
        } else {
          const edge = RELS.find((x) => x.key === (d.item.rel ?? rel))?.edge ?? "LINKED";
          recordForensicEntities(graphSubjectKey || canonicalRef, [{ key: d.item.graphKey, type: NODE_TYPE[d.item.kind ?? type] ?? "Company", edgeType: edge, label: d.item.label }]);
          setState("live");
          feedbackTimer.current = window.setTimeout(() => {
            setState("idle");
            feedbackTimer.current = null;
          }, 2500);
        }
      } else {
        setState("rejected"); setReason(d?.reason ?? d?.error ?? "could not be verified");
      }
    } catch { setState("rejected"); setReason("network error"); }
  };

  const liveLinks = links.filter((l) => l.status !== "pending");
  const pendingLinks = links.filter((l) => l.status === "pending");

  return (
    <div className="panel">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
        <span className="eyebrow">Link to another entity</span>
        {liveLinks.length > 0 && <span className="chip tint-signal">{liveLinks.length} link{liveLinks.length === 1 ? "" : "s"}</span>}
        {pendingLinks.length > 0 && <span className="chip tint-caution">{pendingLinks.length} pending</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="border-t border-line/60 p-4">
          {liveLinks.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {liveLinks.map((it) => (
                <div key={it.id} className="flex items-center gap-2 text-[12.5px]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7" /></svg>
                  <span className="chip">{RELS.find((r) => r.key === it.rel)?.label ?? "linked"}</span>
                  {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="link-ext">{it.label}</a> : <span className="text-ink">{it.label}</span>}
                  {it.detail && <span className="text-[11px] text-ink-faint">{it.detail}</span>}
                  <span className="ml-auto text-[11px] text-ink-faint">by {it.by} · {ago(it.at)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Relationship" value={rel} onChange={(e) => setRel(e.target.value)} className="field px-2 py-1.5 text-[12.5px]">
              {RELS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <div className="flex overflow-hidden rounded-lg border border-line">
              {TARGETS.map((t) => (
                <button type="button" aria-pressed={type === t.key} key={t.key} onClick={() => setType(t.key)} className={`px-2.5 py-1.5 text-[12.5px] transition ${type === t.key ? "bg-signal text-white" : "text-ink-dim"}`}>{t.label}</button>
              ))}
            </div>
            <input
              value={value}
              aria-label={`${TARGETS.find((t) => t.key === type)?.label ?? "Entity"} to link`}
              onChange={(e) => { setValue(e.target.value); if (state === "rejected") setState("idle"); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={TARGETS.find((t) => t.key === type)?.placeholder}
              className="field mono min-w-0 flex-1 px-2.5 py-1.5 text-[12.5px]"
            />
            <button type="button" onClick={submit} disabled={state === "submitting" || !value.trim()} className="btn-primary shrink-0 px-3 py-1.5 text-[12.5px] font-medium">
              {state === "submitting" ? "verifying…" : "Link"}
            </button>
          </div>

          <div aria-live="polite">
            {state === "submitting" && <p className="mt-2 text-[12.5px] text-ink-faint">Submitted. Verifying the entity exists before linking…</p>}
            {state === "live" && <p className="mt-2 text-[12.5px] text-pass">Linked and bridged into the trust graph.</p>}
            {state === "pending" && <p className="mt-2 text-[12.5px] text-caution">Queued for owner review: {reason}. The target is verified real, but the relationship remains unpublished and outside the graph until an owner approves it in AdminOps.</p>}
            {state === "rejected" && <p className="mt-2 text-[12.5px] text-caution">Not linked: {reason}. The target must be a real, verifiable entity.</p>}
          </div>
          {state === "idle" && <p className="mt-2 text-[11px] leading-snug text-ink-faint">Hand-link a connection the scan missed. The target is verified on source; a provable link goes live, a relationship claim is held for your approval, then it's wired as an edge in the trust graph. It appears in the connection web and triggers a ring alert if that entity is (or becomes) flagged.</p>}
        </div>
      )}
    </div>
  );
}
