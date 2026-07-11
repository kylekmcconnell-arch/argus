import { useEffect, useState } from "react";

// Project documents & resources: the whitepaper, security audits, and the pages a
// real operation publishes about itself — API / developer docs, About, a named
// Team page, press / newsroom, blog, tokenomics, governance. Their presence builds
// a picture; a fundraising project with none of it is a flag. Auto-runs on token,
// investigation, and site reports (on-site nav crawl + Grok web/X, 24h-cached).
type Audit = { auditor: string; url: string; date: string | null };
type Resource = { category: string; title: string; url: string };
type Data = {
  available: boolean;
  whitepaper?: { url: string; kind: string } | null;
  resources?: Resource[];
  audits?: Audit[];
  hasTeamPage?: boolean;
  note?: string;
};

const enc = encodeURIComponent;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// Category → section label + display order.
const CAT_LABEL: Record<string, string> = {
  api: "API / Developer docs", docs: "Documentation", about: "About", team: "Team",
  press: "Press & media", blog: "Blog / News", tokenomics: "Tokenomics",
  governance: "Governance", roadmap: "Roadmap", careers: "Careers", faq: "FAQ / Support", legal: "Legal",
};
const CAT_ORDER = Object.keys(CAT_LABEL);

export function ProjectDocs({
  name,
  symbol,
  domain,
  panelCostToken,
}: {
  name?: string | null;
  symbol?: string | null;
  domain?: string | null;
  panelCostToken?: string;
}) {
  const requestKey = [name ?? "", symbol ?? "", domain ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; data: Data | null } | null>(null);

  useEffect(() => {
    if (!name && !symbol && !domain) return;
    const controller = new AbortController();
    (async () => {
      let nextData: Data | null = null;
      try {
        const qs = [name && `name=${enc(name)}`, symbol && `symbol=${enc(symbol)}`, domain && `domain=${enc(domain)}`].filter(Boolean).join("&");
        const r = await fetch(`/api/project-docs?${qs}`, {
          signal: controller.signal,
          ...(panelCostToken ? { headers: { "x-argus-panel-token": panelCostToken } } : {}),
        });
        if (r.ok) nextData = await r.json();
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) setResult({ key: requestKey, data: nextData });
    })();
    return () => controller.abort();
  }, [domain, name, panelCostToken, requestKey, symbol]);

  const settled = !name && !symbol && !domain || result?.key === requestKey;
  const data = result?.key === requestKey ? result.data : null;

  if (!settled) return <div className="rounded-xl border border-line bg-panel p-4 text-[11.5px] text-ink-faint">finding documents &amp; resources…</div>;
  if (!data || data.available === false) return null;

  const wp = data.whitepaper;
  const audits = data.audits ?? [];
  const resources = data.resources ?? [];
  const nothing = !wp && !resources.length && !audits.length;

  // Group resources by category, preserving the canonical section order.
  const groups = CAT_ORDER
    .map((cat) => ({ cat, items: resources.filter((r) => r.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: nothing ? "var(--color-caution)55" : "var(--color-line)", background: nothing ? "var(--color-caution)0d" : "var(--color-panel)" }}>
      <div className="flex items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Documents &amp; resources</span>
        {data.hasTeamPage && (
          <span className="mono ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "var(--color-pass)14", color: "var(--color-pass)" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>named team page
          </span>
        )}
      </div>

      {nothing ? (
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--color-caution)" }}>
          {data.note ?? "No whitepaper, documentation, or security audit found — for a project raising money, that absence is itself a flag."}
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

          {groups.map((g) => (
            <div key={g.cat}>
              <div className="text-[10px] uppercase tracking-wide text-ink-faint">{CAT_LABEL[g.cat]}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {g.items.map((x) => (
                  <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.url} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink transition hover:border-signal hover:text-signal">
                    <span className="font-medium">{x.title}</span>
                    <span className="mono text-[9.5px] text-ink-faint">{hostOf(x.url)}</span>
                    <span className="text-ink-faint">↗</span>
                  </a>
                ))}
              </div>
            </div>
          ))}

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
