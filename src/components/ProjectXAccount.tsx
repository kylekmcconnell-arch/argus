import { useEffect, useState } from "react";

// Find + break down a project's official X account (/api/x-find). Searches X for
// the project by name, resolves the profile, and cross-checks the match (does the
// account's own site link back to the project's domain?). One click audits it in
// full. Auto-runs on Site recon.
type Found = {
  available: boolean;
  found?: boolean;
  handle?: string;
  name?: string | null;
  bio?: string | null;
  followers?: number | null;
  following?: number | null;
  tweets?: number | null;
  created?: string | null;
  verified?: boolean;
  website?: string | null;
  avatar?: string | null;
  confidence?: "high" | "medium" | "low";
  matchReason?: string;
  siteMatches?: boolean;
  note?: string;
};

const fmt = (n?: number | null) => (n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
const joined = (s?: string | null) => { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", year: "numeric" }); };
const CONF: Record<string, string> = { high: "var(--color-pass)", medium: "var(--color-caution)", low: "var(--color-ink-faint)" };
const HANDLE = /^@?[A-Za-z0-9_]{2,30}$/;

function keylessSeed(seedHandle?: string): Found | null {
  if (!seedHandle || !HANDLE.test(seedHandle)) return null;
  return {
    available: true,
    found: true,
    handle: `@${seedHandle.replace(/^@/, "")}`,
    confidence: "high",
    matchReason: "the handle was found on the project's own site",
  };
}

export function ProjectXAccount({ name, domain, seedHandle, panelCostToken, onAudit }: { name: string; domain: string; seedHandle?: string; panelCostToken?: string; onAudit?: (q: string) => void }) {
  const fallback = keylessSeed(seedHandle);
  const [resolved, setResolved] = useState<{ token: string; result: Found | null } | null>(null);

  useEffect(() => {
    if (!panelCostToken) return;

    const controller = new AbortController();
    const qs = new URLSearchParams({ name: name ?? "", domain: domain ?? "", handle: seedHandle ?? "" });
    fetch(`/api/x-find?${qs}`, {
      signal: controller.signal,
      headers: {
        "x-argus-panel-context": "required",
        "x-argus-panel-token": panelCostToken,
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`x-find ${response.status}`);
        return await response.json() as Found;
      })
      .then((result) => {
        setResolved({ token: panelCostToken, result: result?.available && result.found ? result : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolved({ token: panelCostToken, result: null });
      });
    return () => controller.abort();
  }, [domain, name, panelCostToken, seedHandle]);

  const paidResult = resolved && resolved.token === panelCostToken ? resolved.result : null;
  const d = paidResult ?? fallback;
  if (panelCostToken && resolved?.token !== panelCostToken && !fallback) return <div className="panel p-4 text-[12.5px] text-ink-faint">searching X for the project's account…</div>;
  if (!d?.handle) return null;

  const conf = d.confidence ?? "low";
  const followRatio = d.followers && d.following ? d.followers / d.following : null;

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <span className="eyebrow">Project X account</span>
        {d.confidence && (
          <span className="chip tint-var" style={{ "--tint": CONF[conf] } as React.CSSProperties} title={d.matchReason}>{conf} confidence</span>
        )}
      </div>

      <div className="mt-2.5 flex items-start gap-3">
        {d.avatar && <img src={d.avatar} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full border border-line object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-ink">{d.name ?? d.handle}</span>
            {d.verified && <span className="text-[11px] text-signal-lift" title="Verified">✔</span>}
            <a href={`https://x.com/${d.handle.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="mono text-[11px] text-ink-faint hover:text-signal-lift">{d.handle}</a>
          </div>
          {d.bio && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-dim">{d.bio}</p>}
          <div className="mono mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
            {d.followers != null && <span><span className="text-ink-dim">{fmt(d.followers)}</span> followers</span>}
            {d.following != null && <span>{fmt(d.following)} following</span>}
            {d.tweets != null && <span>{fmt(d.tweets)} posts</span>}
            {d.created && <span>joined {joined(d.created)}</span>}
            {followRatio != null && followRatio < 0.3 && <span className="text-caution">follows {(1 / followRatio).toFixed(0)}× more than follow it</span>}
          </div>
          {d.website && (
            <div className="mt-1 text-[11px]">
              <span className="text-ink-faint">links to </span>
              <a href={d.website} target="_blank" rel="noreferrer" className="link-ext mono">{d.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
              {d.siteMatches && <span className="ml-1 text-pass">✓ matches this site</span>}
            </div>
          )}
        </div>
        {onAudit && (
          <button onClick={() => onAudit(d.handle!)} className="btn-chip tint-signal shrink-0">
            full audit →
          </button>
        )}
      </div>

      {conf === "low" && <p className="mt-2 text-[11px] text-ink-faint">{d.matchReason} — confirm this is the right account before relying on it.</p>}
    </div>
  );
}
