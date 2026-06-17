import { useState, useCallback, useEffect, useRef } from "react";
import { runRecon, type Recon } from "../collect/recon";
import type { RetrievalStage } from "../collect/retrieve";
import { logAudit } from "../lib/auditlog";

const TONE: Record<string, string> = {
  good: "var(--color-pass)",
  warn: "var(--color-caution)",
  bad: "var(--color-avoid)",
  gap: "var(--color-unverifiable)",
};
const GLYPH: Record<string, string> = { good: "✓", warn: "▲", bad: "✗", gap: "◌" };

const OUTCOME_TONE: Record<string, string> = {
  ok: "var(--color-pass)", "spa-stub": "var(--color-caution)",
  blocked: "var(--color-caution)", unreachable: "var(--color-avoid)",
};

const COVERAGE: Record<string, { label: string; color: string; blurb: string }> = {
  rendered: { label: "FULL COVERAGE", color: "var(--color-pass)", blurb: "Page retrieved directly." },
  recovered: { label: "RECOVERED", color: "var(--color-caution)", blurb: "Direct fetch failed; content recovered by rendering the JS app." },
  gap: { label: "COVERAGE GAP", color: "var(--color-unverifiable)", blurb: "Site could not be retrieved or rendered. No content claims are made." },
};

const EXAMPLES = ["neuro-mesh.io", "stripe.com"];

export function ReconPage({ initialUrl }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [stages, setStages] = useState<RetrievalStage[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [running, setRunning] = useState(false);
  const ran = useRef(false);

  const run = useCallback(async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    setUrl(target);
    setRunning(true);
    setRecon(null);
    setStages([]);
    const r = await runRecon(target, (s) => setStages((prev) => [...prev, s]));
    setRecon(r);
    setRunning(false);
    logAudit({
      kind: "site",
      query: r.retrieval.url,
      verdict: r.retrieval.status,
      coverage: r.retrieval.status,
      summary: r.identityLine,
      flags: [
        r.retrieval.status === "gap" ? "coverage-gap" : "",
        r.team.state === "unnamed-section" ? "team-unnamed" : "",
        r.team.state === "named" ? "team-named" : "",
        r.tokenSignals.length >= 2 ? "token-project" : "",
      ].filter(Boolean),
    });
  }, []);

  // Auto-run when opened with a URL from the main search bar.
  useEffect(() => {
    if (ran.current || !initialUrl) return;
    ran.current = true;
    run(initialUrl);
  }, [initialUrl, run]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-[28px] font-medium tracking-[-0.02em] text-ink">Site recon</h1>
      <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-dim">
        Point ARGUS at a project's website. It fetches, and when a site is a JavaScript app that returns only a
        shell, it escalates to a rendering crawler instead of guessing. Crucially, when it cannot see something it
        says so: a failed fetch becomes a coverage gap, never a confident "anonymous team."
      </p>

      {/* input */}
      <div className="mt-5 flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-line bg-white px-3">
          <span className="mono text-[12px] text-ink-faint">https://</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(url); }}
            placeholder="project-site.io"
            className="mono w-full bg-transparent px-1.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <button
          onClick={() => run(url)}
          disabled={running}
          className="btn-primary shrink-0 px-4 py-2.5 text-[13px] font-medium disabled:opacity-50"
        >
          {running ? "running…" : "Run recon"}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-faint">
        <span>try</span>
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => run(e)} className="mono rounded border border-line bg-white px-1.5 py-0.5 text-ink-dim transition hover:text-ink">{e}</button>
        ))}
      </div>

      {/* retrieval trace — the fail -> escalate routing, shown */}
      {stages.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
          <div className="border-b border-line px-4 py-2 text-[10.5px] uppercase tracking-wider text-ink-faint">Retrieval</div>
          {stages.map((s, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <span className="mono mt-0.5 shrink-0 text-[10px] text-ink-faint">{i + 1}</span>
              <span className="mono shrink-0 text-[12px] text-ink">{s.method}</span>
              <span className="mono shrink-0 rounded px-1.5 text-[10.5px] font-semibold" style={{ color: OUTCOME_TONE[s.outcome] ?? "var(--color-ink-faint)", background: (OUTCOME_TONE[s.outcome] ?? "#888") + "14" }}>
                {s.outcome}
              </span>
              <span className="flex-1 text-[12px] leading-snug text-ink-dim">{s.note}</span>
              {s.chars > 0 && <span className="mono shrink-0 text-[10.5px] text-ink-faint">{s.chars.toLocaleString()} ch</span>}
            </div>
          ))}
        </div>
      )}

      {/* result */}
      {recon && (
        <>
          {/* coverage + identity */}
          <div className="mt-4 rounded-xl border bg-white p-4" style={{ borderColor: COVERAGE[recon.retrieval.status].color + "66" }}>
            <div className="flex items-center gap-2">
              <span className="mono rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ color: COVERAGE[recon.retrieval.status].color, background: COVERAGE[recon.retrieval.status].color + "14" }}>
                {COVERAGE[recon.retrieval.status].label}
              </span>
              {recon.title && <span className="truncate text-[13px] text-ink">{recon.title}</span>}
            </div>
            <p className="mt-2 text-[14px] font-medium leading-relaxed text-ink">{recon.identityLine}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{COVERAGE[recon.retrieval.status].blurb}</p>
          </div>

          {/* findings */}
          <div className="mt-3 rounded-xl border border-line bg-white p-4">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Findings</div>
            <div className="mt-2 space-y-2">
              {recon.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mono mt-0.5 shrink-0 text-[12px]" style={{ color: TONE[f.tone] }}>{GLYPH[f.tone]}</span>
                  <span className="text-[13px] leading-snug text-ink-dim">{f.claim}</span>
                </div>
              ))}
            </div>
          </div>

          {/* extracted entities */}
          {(recon.socials.length > 0 || recon.funding.length > 0 || recon.tokenSignals.length > 0) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {recon.socials.length > 0 && (
                <Card title="Socials">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.socials.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim transition hover:text-ink">{s.label}</a>
                    ))}
                  </div>
                </Card>
              )}
              {recon.funding.length > 0 && (
                <Card title="Funding claims (unverified)">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.funding.map((f) => <span key={f} className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim">{f}</span>)}
                  </div>
                </Card>
              )}
              {recon.tokenSignals.length > 0 && (
                <Card title="Token signals">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.tokenSignals.map((t) => <span key={t} className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim">{t}</span>)}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-6 rounded-xl border border-line bg-panel/40 p-4 text-[12.5px] leading-relaxed text-ink-faint">
        <span className="text-ink-dim">Why this exists:</span> an earlier audit fetched only a site's JavaScript
        shell, never saw the team section, and reported "anonymous team." That was an overstatement — the honest
        line was "could not render the site." Retrieval now escalates on failure, and absence is only ever asserted
        from content actually rendered.
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-2 text-[10.5px] uppercase tracking-wider text-ink-faint">{title}</div>
      {children}
    </div>
  );
}
