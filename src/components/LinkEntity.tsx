import { useEffect, useRef, useState } from "react";
import { recordForensicEntities } from "../graph/store";

// Hard link: manually associate this subject with another entity the auto-scan
// didn't connect. Same verify-before-publish guard as Add-info (the target must
// exist on source), plus a relationship — and on success it writes a bridging
// EDGE into the trust graph (keyed canonically) so the connection web and ring
// alerts pick it up, and it bridges to any real audit of that entity.
type Link = { type: string; kind?: string; value: string; label: string; url?: string; detail?: string; graphKey?: string; rel?: string; by: string; at: number };
type SubmitState = "idle" | "submitting" | "verified" | "rejected";

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
const NODE_TYPE: Record<string, string> = { x: "Person", website: "Company", contract: "Company", github: "Identity" };

const enc = encodeURIComponent;
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };

export function LinkEntity({ subject }: { subject: string }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("x");
  const [rel, setRel] = useState("same_operator");
  const [value, setValue] = useState("");
  const [by, setBy] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [reason, setReason] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !subject) return;
    ran.current = true;
    fetch(`/api/augment?subject=${enc(subject)}`).then((r) => r.json()).then((d) => setLinks((d?.items ?? []).filter((i: Link) => i.type === "link"))).catch(() => { /* offline */ });
  }, [subject]);

  const submit = async () => {
    const v = value.trim();
    if (!v || state === "submitting") return;
    setState("submitting"); setReason("");
    try {
      const r = await fetch(`/api/augment?subject=${enc(subject)}&type=${enc(type)}&value=${enc(v)}&rel=${enc(rel)}${by.trim() ? `&by=${enc(by.trim())}` : ""}`);
      const d = await r.json();
      if (d?.verified && d.item?.graphKey) {
        // Publish the bridging edge into the trust graph.
        const edge = RELS.find((x) => x.key === (d.item.rel ?? rel))?.edge ?? "LINKED";
        recordForensicEntities(subject, [{ key: d.item.graphKey, type: NODE_TYPE[d.item.kind ?? type] ?? "Company", edgeType: edge, label: d.item.label }]);
        setLinks((d.items ?? []).filter((i: Link) => i.type === "link"));
        setState("verified"); setValue("");
        setTimeout(() => setState("idle"), 2500);
      } else {
        setState("rejected"); setReason(d?.reason ?? "could not be verified");
      }
    } catch { setState("rejected"); setReason("network error"); }
  };

  return (
    <div className="rounded-xl border border-line bg-panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Link to another entity</span>
        {links.length > 0 && <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "var(--color-signal)14", color: "var(--color-signal)" }}>{links.length} link{links.length === 1 ? "" : "s"}</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="border-t border-line/60 p-4">
          {links.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {links.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7" /></svg>
                  <span className="mono rounded px-1 text-[9.5px]" style={{ background: "var(--color-line)", color: "var(--color-ink-dim)" }}>{RELS.find((r) => r.key === it.rel)?.label ?? "linked"}</span>
                  {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-signal hover:underline">{it.label}</a> : <span className="text-ink">{it.label}</span>}
                  {it.detail && <span className="text-[10.5px] text-ink-faint">{it.detail}</span>}
                  <span className="ml-auto text-[10px] text-ink-faint">by {it.by} · {ago(it.at)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select value={rel} onChange={(e) => setRel(e.target.value)} className="rounded-lg border border-line bg-panel-2/40 px-2 py-1.5 text-[11.5px] text-ink outline-none">
              {RELS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <div className="flex overflow-hidden rounded-lg border border-line">
              {TARGETS.map((t) => (
                <button key={t.key} onClick={() => setType(t.key)} className="px-2.5 py-1.5 text-[11.5px] transition" style={type === t.key ? { background: "var(--color-signal)", color: "#fff" } : { color: "var(--color-ink-dim)" }}>{t.label}</button>
              ))}
            </div>
            <input
              value={value}
              onChange={(e) => { setValue(e.target.value); if (state === "rejected") setState("idle"); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={TARGETS.find((t) => t.key === type)?.placeholder}
              className="mono min-w-0 flex-1 rounded-lg border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-2"
            />
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="you" className="w-20 rounded-lg border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint" />
            <button onClick={submit} disabled={state === "submitting" || !value.trim()} className="btn-primary shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">
              {state === "submitting" ? "verifying…" : "Link"}
            </button>
          </div>

          {state === "submitting" && <p className="mt-2 text-[11.5px] text-ink-faint">Submitted — verifying the entity exists before linking…</p>}
          {state === "verified" && <p className="mt-2 text-[11.5px]" style={{ color: "var(--color-pass)" }}>✓ Linked and bridged into the trust graph.</p>}
          {state === "rejected" && <p className="mt-2 text-[11.5px]" style={{ color: "var(--color-caution)" }}>⚠ Not linked — {reason}. The target must be a real, verifiable entity.</p>}
          {state === "idle" && <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">Hand-link a connection the scan missed. The target is verified on source, then wired as an edge in the trust graph — it shows in the connection web and triggers a ring alert if that entity is (or becomes) a flagged subject.</p>}
        </div>
      )}
    </div>
  );
}
