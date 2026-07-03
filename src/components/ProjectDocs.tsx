import { useEffect, useRef, useState } from "react";

// Project documents: the whitepaper and security audits, with real links. A serious
// project has both; their ABSENCE is diligence signal in itself. Auto-runs on token,
// investigation, and site reports (Grok web+X search, 24h-cached server-side).
type Audit = { auditor: string; url: string; date: string | null };
type Data = { available: boolean; whitepaper?: { url: string; kind: string } | null; audits?: Audit[]; note?: string };

const enc = encodeURIComponent;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export function ProjectDocs({ name, symbol, domain }: { name?: string | null; symbol?: string | null; domain?: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "done">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!name && !symbol && !domain) { setState("done"); return; }
    (async () => {
      try {
        const qs = [name && `name=${enc(name)}`, symbol && `symbol=${enc(symbol)}`, domain && `domain=${enc(domain)}`].filter(Boolean).join("&");
        const r = await fetch(`/api/project-docs?${qs}`);
        setData(await r.json());
      } catch { /* non-fatal */ }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[11.5px] text-ink-faint">finding the whitepaper &amp; audits…</div>;
  if (!data || data.available === false) return null;

  const wp = data.whitepaper;
  const audits = data.audits ?? [];
  const nothing = !wp && !audits.length;

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: nothing ? "var(--color-caution)55" : "var(--color-line)", background: nothing ? "var(--color-caution)0d" : "var(--color-panel)" }}>
      <div className="flex items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Documents</span>
      </div>

      {nothing ? (
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--color-caution)" }}>
          {data.note ?? "No whitepaper or security audit found — for a project raising money, that absence is itself a flag."}
        </p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {wp && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-faint">{wp.kind === "docs" || wp.kind === "gitbook" ? "Docs" : wp.kind === "litepaper" ? "Litepaper" : "Whitepaper"}</div>
              <a href={wp.url} target="_blank" rel="noreferrer" className="mono mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[12.5px] text-signal hover:underline">
                {hostOf(wp.url)} <span className="text-ink-faint">↗</span>
              </a>
            </div>
          )}
          {audits.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-faint">Security audits ({audits.length})</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {audits.map((a) => (
                  <a key={a.auditor + a.url} href={a.url} target="_blank" rel="noreferrer" title={a.url} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink transition hover:border-signal hover:text-signal">
                    <span className="font-medium">{a.auditor}</span>
                    {a.date && <span className="mono text-[9.5px] text-ink-faint">{a.date}</span>}
                    <span className="text-ink-faint">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {wp && !audits.length && (
            <p className="text-[10.5px] leading-snug" style={{ color: "var(--color-caution)" }}>Whitepaper found, but no security audit surfaced — worth confirming before trusting the contract.</p>
          )}
        </div>
      )}
    </div>
  );
}
