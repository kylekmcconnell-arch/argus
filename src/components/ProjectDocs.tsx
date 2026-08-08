import { useEffect, useState } from "react";
import { FileText, MagnifyingGlass } from "@phosphor-icons/react";

// Project documents & resources: the whitepaper, security audits, and the pages a
// real operation publishes about itself — API / developer docs, About, a named
// Team page, press / newsroom, blog, tokenomics, governance. Their presence builds
// a picture; a fundraising project with none of it is a flag. Auto-runs on token,
// investigation, and site reports (on-site nav crawl + Grok web/X, 24h-cached).
type Audit = { auditor: string; url: string; date: string | null };
type Resource = { category: string; title: string; url: string };
type Data = {
  available: boolean;
  completed?: boolean;
  partial?: boolean;
  truncated?: boolean;
  providerFailed?: boolean;
  whitepaper?: { url: string; kind: string } | null;
  resources?: Resource[];
  audits?: Audit[];
  hasTeamPage?: boolean | null;
  hasAbout?: boolean | null;
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

  if (!settled) return <div className="panel p-4 text-[12.5px] text-ink-faint">finding documents &amp; resources…</div>;
  if (!data || data.available === false) return null;

  const wp = data.whitepaper;
  const audits = data.audits ?? [];
  const resources = data.resources ?? [];
  const nothing = !wp && !resources.length && !audits.length;
  const absenceEstablished = data.completed === true;

  // Group resources by category, preserving the canonical section order.
  const groups = CAT_ORDER
    .map((cat) => ({ cat, items: resources.filter((r) => r.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className={`panel p-4 ${nothing && absenceEstablished ? "tint-caution" : ""}`}>
      <div className="flex items-center gap-2">
        <FileText aria-hidden="true" size={15} weight="regular" className="text-ink-faint" />
        <span className="eyebrow">Documents &amp; resources</span>
        {data.hasTeamPage && (
          <span className="chip tint-signal ml-auto">
            <MagnifyingGlass aria-hidden="true" size={10} weight="bold" />team link surfaced
          </span>
        )}
      </div>

      {nothing ? (
        <p className={`mt-2 text-[12.5px] leading-relaxed ${absenceEstablished ? "text-caution" : "text-ink-dim"}`}>
          {data.note ?? (absenceEstablished
            ? "The completed bounded discovery read surfaced no whitepaper, documentation, or security audit."
            : "Document discovery did not complete, so missing resources were not ruled out.")}
        </p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {data.note && (
            <p className="text-[11px] leading-snug text-ink-dim">{data.note}</p>
          )}
          {wp && (
            <div>
              <div className="eyebrow">{wp.kind === "docs" || wp.kind === "gitbook" ? "Docs" : wp.kind === "litepaper" ? "Litepaper" : "Whitepaper"}</div>
              <a href={wp.url} target="_blank" rel="noreferrer" className="link-ext mono mt-0.5 inline-flex max-w-full items-center gap-1 text-[12.5px]">
                <span className="truncate">{hostOf(wp.url)}</span>
              </a>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.cat}>
              <div className="eyebrow">{CAT_LABEL[g.cat]}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {g.items.map((x) => (
                  <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.url} className="link-ext inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px]">
                    <span className="font-medium">{x.title}</span>
                    <span className="mono text-[11px] text-ink-faint">{hostOf(x.url)}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}

          {audits.length > 0 && (
            <div>
              <div className="eyebrow">Security audits ({audits.length})</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {audits.map((a) => (
                  <a key={a.auditor + a.url} href={a.url} target="_blank" rel="noreferrer" title={a.url} className="link-ext inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px]">
                    <span className="font-medium">{a.auditor}</span>
                    {a.date && <span className="mono text-[11px] text-ink-faint">{a.date}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
          {wp && !audits.length && absenceEstablished && (
            <p className="text-[11px] leading-snug text-caution">Whitepaper found, but no security audit surfaced. Confirm this before trusting the contract.</p>
          )}
        </div>
      )}
    </div>
  );
}
