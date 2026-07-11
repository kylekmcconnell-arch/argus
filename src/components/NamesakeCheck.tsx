import { useEffect, useRef, useState } from "react";

// Who is this token named after, and did they actually create/endorse it — or
// is it a fan token riding a famous name (or worse, faking the affiliation)?
// Auto-runs on the investigation via /api/namesake (Grok web+X search).
type Namesake = {
  available: boolean;
  named_after?: string | null;
  x_handle?: string | null;
  who?: string | null;
  relationship?: string;
  evidence?: string | null;
  note?: string | null;
};

const REL_META: Record<string, { label: string; color: string; blurb: string }> = {
  created: { label: "created by namesake", color: "var(--color-caution)", blurb: "launched by the person it's named after — their track record IS the token's provenance" },
  endorsed: { label: "endorsed", color: "var(--color-pass)", blurb: "the namesake publicly backed this specific token" },
  acknowledged: { label: "acknowledged only", color: "var(--color-caution)", blurb: "mentioned by the namesake, but not endorsed" },
  denied: { label: "publicly denied", color: "var(--color-avoid)", blurb: "the namesake disavowed this token — any implied affiliation is fake" },
  unaffiliated: { label: "no affiliation", color: "var(--color-caution)", blurb: "a fan/namesake token: the person it's named after has no public connection to it" },
  not_a_person: { label: "not person-named", color: "var(--color-ink-faint)", blurb: "" },
  unclear: { label: "unclear", color: "var(--color-ink-faint)", blurb: "" },
};

export function NamesakeCheck({ symbol, name, contract, chain, reportVersionId, onAudit }: { symbol: string; name?: string; contract?: string; chain?: string; reportVersionId?: string; onAudit?: (q: string) => void }) {
  const [d, setD] = useState<Namesake | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const qs = new URLSearchParams({ symbol, name: name ?? "", contract: contract ?? "", chain: chain ?? "" });
    if (reportVersionId) qs.set("reportVersionId", reportVersionId);
    fetch(`/api/namesake?${qs}`)
      .then((r) => r.json())
      .then((j: Namesake) => {
        if (j?.available === false) { setState("none"); return; }
        setD(j);
        setState("ok");
      })
      .catch(() => setState("none"));
  }, [symbol, name, contract, chain, reportVersionId]);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">tracing who the token is named after and whether they're actually behind it…</div>;
  if (state === "none" || !d) return null;

  const rel = REL_META[d.relationship ?? "unclear"] ?? REL_META.unclear;
  if (d.relationship === "not_a_person" && !d.named_after) return null;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Namesake check</span>
        <span className="mono rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${rel.color}1a`, color: rel.color }}>{rel.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-medium text-ink">{d.named_after ?? "—"}</span>
        {d.x_handle && <span className="mono text-[11.5px] text-ink-faint">{d.x_handle}</span>}
        {d.x_handle && onAudit && (
          <button onClick={() => onAudit(d.x_handle!)} className="mono rounded-md border px-2 py-0.5 text-[11px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
            audit them →
          </button>
        )}
      </div>
      {d.who && <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{d.who}</p>}
      {(d.note || rel.blurb) && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: d.relationship === "denied" ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>
          {d.note ?? rel.blurb}
        </p>
      )}
      {d.evidence && <p className="mono mt-1.5 rounded-lg border border-line bg-panel-2/50 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-faint">{d.evidence}</p>}
    </div>
  );
}
