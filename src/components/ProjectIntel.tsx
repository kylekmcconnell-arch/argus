import { useEffect, useRef, useState } from "react";

// Project intelligence: domain age (RDAP) + claimed-audit verification. Two
// signals a single page-scrape misses — a "years-old ecosystem" on a fresh
// domain, and an "Audited by CertiK" badge with no linkable report. Auto-runs on
// the investigation when a project domain is known. Keyless.
type Intel = {
  available: boolean;
  host?: string;
  domain?: { registered?: string; expires?: string; registrar?: string; ageMonths?: number } | null;
  domainNote?: string;
  audits?: { auditor: string; proof: string | null }[];
  auditNote?: string;
  pagesRead?: number;
};

export function ProjectIntel({ domain }: { domain: string }) {
  const [d, setD] = useState<Intel | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fetch(`/api/project-intel?domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((j: Intel) => { setD(j); setState(j?.available ? "ok" : "none"); })
      .catch(() => setState("none"));
  }, [domain]);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">checking domain age + audit claims…</div>;
  if (state === "none" || !d) return null;

  const youngDomain = (d.domain?.ageMonths ?? 99) < 3 && !!d.domain?.registered;
  const fakeAudit = (d.audits ?? []).some((a) => !a.proof);

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Project intelligence</div>

      {/* domain age */}
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium text-ink">Domain</span>
          <span className="mono text-[11.5px] text-ink-faint">{d.host}</span>
          {d.domain?.registered && (
            <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: youngDomain ? "rgba(220,38,38,.14)" : "rgba(22,163,74,.12)", color: youngDomain ? "var(--color-avoid)" : "var(--color-pass)" }}>
              {d.domain.ageMonths}mo old
            </span>
          )}
        </div>
        <p className={`mt-1 text-[12px] leading-relaxed ${youngDomain ? "text-avoid" : "text-ink-dim"}`}>{d.domainNote}</p>
      </div>

      {/* claimed audits */}
      <div className="mt-3 border-t border-line/60 pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium text-ink">Security audits</span>
          {(d.audits ?? []).map((a) => (
            <span key={a.auditor} className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: a.proof ? "rgba(22,163,74,.12)" : "rgba(220,38,38,.14)", color: a.proof ? "var(--color-pass)" : "var(--color-avoid)" }} title={a.proof ? "report link found" : "no linkable report"}>
              {a.auditor}{a.proof ? " ✓" : " ⚠"}
            </span>
          ))}
        </div>
        <p className={`mt-1 text-[12px] leading-relaxed ${fakeAudit ? "text-avoid" : "text-ink-dim"}`}>{d.auditNote}</p>
        {(d.audits ?? []).some((a) => a.proof) && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(d.audits ?? []).filter((a) => a.proof).map((a) => (
              <a key={a.auditor} href={a.proof!} target="_blank" rel="noreferrer" className="text-[10.5px] text-signal-dim underline-offset-2 hover:underline">{a.auditor} report ↗</a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
