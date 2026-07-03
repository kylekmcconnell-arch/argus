import { useEffect, useRef, useState } from "react";

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

export function ProjectXAccount({ name, domain, seedHandle, onAudit }: { name: string; domain: string; seedHandle?: string; onAudit?: (q: string) => void }) {
  const [d, setD] = useState<Found | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const qs = new URLSearchParams({ name: name ?? "", domain: domain ?? "", handle: seedHandle ?? "" });
    fetch(`/api/x-find?${qs}`)
      .then((r) => r.json())
      .then((j: Found) => { if (j?.available && j.found) { setD(j); setState("ok"); } else setState("none"); })
      .catch(() => setState("none"));
  }, [name, domain, seedHandle]);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">searching X for the project's account…</div>;
  if (state === "none" || !d?.handle) return null;

  const conf = d.confidence ?? "low";
  const followRatio = d.followers && d.following ? d.followers / d.following : null;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Project X account</span>
        {d.confidence && (
          <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: `${CONF[conf]}1a`, color: CONF[conf] }} title={d.matchReason}>{conf} confidence</span>
        )}
      </div>

      <div className="mt-2.5 flex items-start gap-3">
        {d.avatar && <img src={d.avatar} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full border border-line object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-ink">{d.name ?? d.handle}</span>
            {d.verified && <span className="text-[11px]" style={{ color: "var(--color-signal)" }} title="Verified">✔</span>}
            <a href={`https://x.com/${d.handle.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="mono text-[11.5px] text-ink-faint hover:text-signal-dim">{d.handle}</a>
          </div>
          {d.bio && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-dim">{d.bio}</p>}
          <div className="mono mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
            {d.followers != null && <span><span className="text-ink-dim">{fmt(d.followers)}</span> followers</span>}
            {d.following != null && <span>{fmt(d.following)} following</span>}
            {d.tweets != null && <span>{fmt(d.tweets)} posts</span>}
            {d.created && <span>joined {joined(d.created)}</span>}
            {followRatio != null && followRatio < 0.3 && <span style={{ color: "var(--color-caution)" }}>follows {(1 / followRatio).toFixed(0)}× more than follow it</span>}
          </div>
          {d.website && (
            <div className="mt-1 text-[11px]">
              <span className="text-ink-faint">links to </span>
              <a href={d.website} target="_blank" rel="noreferrer" className="mono text-signal-dim hover:underline">{d.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
              {d.siteMatches && <span className="ml-1" style={{ color: "var(--color-pass)" }}>✓ matches this site</span>}
            </div>
          )}
        </div>
        {onAudit && (
          <button onClick={() => onAudit(d.handle!)} className="mono shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
            full audit →
          </button>
        )}
      </div>

      {conf === "low" && <p className="mt-2 text-[11px] text-ink-faint">{d.matchReason} — confirm this is the right account before relying on it.</p>}
    </div>
  );
}
