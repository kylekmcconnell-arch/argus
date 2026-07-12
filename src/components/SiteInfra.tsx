import { useEffect, useRef, useState } from "react";
import { recordForensicEntities } from "../graph/store";

// Off-chain operator linking for a project's website. The on-chain suite links
// operators by shared wallets; this does it by shared web infrastructure —
// analytics / monetization IDs pulled from the page, co-registered domains from
// Certificate Transparency, and hosting neighbours. Each shared print is written
// to the trust graph as a bridge node, so two audited sites that carry the same
// Google Analytics property (or AdSense payout account, or dedicated IP) collapse
// into one operator automatically — the serial-scammer signal, off-chain.
type FP = { kind: string; id: string; label: string };
type Data = {
  available: boolean;
  host?: string;
  fingerprints?: FP[];
  siblings?: string[];
  subdomainCount?: number;
  hosting?: { ip?: string; asn?: string; server?: string; cdn?: boolean; neighbors?: string[] };
  hasLinks?: boolean;
};

// The fingerprints strong enough to bridge operators (an analytics/monetization
// account you control) vs. the circumstantial ones (a favicon).
const HARD = new Set(["ga", "gtm", "adsense", "fbpixel"]);

export function SiteInfra({ domain, record, onAudit }: { domain: string; record: boolean; onAudit?: (q: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "done">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !domain) return;
    ran.current = true;
    (async () => {
      try {
        const r = await fetch(`/api/site-infra?domain=${encodeURIComponent(domain)}`);
        const d: Data = await r.json();
        setData(d);
        // Write the shared prints into the graph so co-operated sites bridge.
        if (record && d.available) {
          const ent: { key: string; type: string; edgeType: string; label: string }[] = [];
          for (const f of d.fingerprints ?? []) {
            const key = `${f.kind}:${f.id}`;
            ent.push({ key, type: "Identity", edgeType: HARD.has(f.kind) ? "USES_ID" : "USES", label: `${f.label} ${f.id}`.slice(0, 40) });
          }
          if (d.hosting?.ip && !d.hosting.cdn) ent.push({ key: `ip:${d.hosting.ip}`, type: "Identity", edgeType: "HOSTED_AT", label: `IP ${d.hosting.ip}` });
          for (const s of d.siblings ?? []) ent.push({ key: s, type: "Company", edgeType: "CO_REGISTERED", label: s });
          if (ent.length) recordForensicEntities(d.host ?? domain, ent);
        }
      } catch { /* non-fatal */ }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  if (state === "loading" || !data || !data.available) return null;
  const fps = (data.fingerprints ?? []).filter((f) => f.kind !== "favicon");
  const favicon = (data.fingerprints ?? []).find((f) => f.kind === "favicon");
  const siblings = data.siblings ?? [];
  const h = data.hosting;
  const neighbors = h?.neighbors ?? [];

  // Nothing pivotable at all — a quiet, honest one-liner beats an empty panel.
  if (!fps.length && !siblings.length && !neighbors.length) {
    return (
      <div className="mt-3 panel px-4 py-2.5 text-[12.5px] text-ink-faint">
        No shared web infrastructure surfaced — no third-party analytics IDs, co-registered domains, or hosting neighbours to link this site to another operator.
      </div>
    );
  }

  const hard = fps.some((f) => HARD.has(f.kind));
  return (
    <div className="mt-3 panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M12 15v-2M9.5 14l-3 3M14.5 14l3 3" /></svg>
        <span className="eyebrow">Infrastructure links</span>
        {hard && <span className="chip tint-signal">shared operator ID</span>}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
        Web prints that tie this site to other operations. A shared analytics or monetization ID is a hard operator link; a co-registered domain or shared host is a lead. These bridge automatically to any other site ARGUS audits that carries the same print.
      </p>

      {/* analytics / monetization IDs — the strongest off-chain operator tie */}
      {fps.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow">Analytics &amp; monetization</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {fps.map((f) => (
              <span key={f.kind + f.id} className={`mono rounded-md border px-1.5 py-0.5 text-[11px] text-ink-dim ${HARD.has(f.kind) ? "border-signal/40" : "border-line"}`}>
                <span className="text-ink-faint">{f.label}</span> {f.id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* co-registered sibling domains from Certificate Transparency */}
      {siblings.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow">Co-registered domains · CT logs</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {siblings.map((s) => (
              <button key={s} onClick={() => onAudit?.(s)} className="btn-chip">{s} →</button>
            ))}
          </div>
        </div>
      )}

      {/* hosting: IP / ASN, and neighbours when it isn't a shared CDN */}
      {h?.ip && (
        <div className="mt-3">
          <div className="eyebrow">Hosting</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="mono rounded-md border border-line px-1.5 py-0.5 text-ink-dim"><span className="text-ink-faint">IP</span> {h.ip}</span>
            {h.asn && <span className="mono rounded-md border border-line px-1.5 py-0.5 text-ink-dim">{h.asn}</span>}
            {h.cdn && <span className="text-[11px] text-ink-faint">behind a shared CDN — neighbours not meaningful</span>}
          </div>
          {neighbors.length > 0 && (
            <div className="mt-1.5">
              <div className="text-[11px] text-ink-faint">Other sites on this dedicated IP:</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {neighbors.map((n) => (
                  <button key={n} onClick={() => onAudit?.(n)} className="btn-chip">{n} →</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(favicon || (data.subdomainCount ?? 0) > 0) && (
        <div className="mt-3 border-t border-line/60 pt-2 text-[11px] text-ink-faint">
          {favicon && <span className="mono">favicon {favicon.id}</span>}
          {favicon && (data.subdomainCount ?? 0) > 0 && <span> · </span>}
          {(data.subdomainCount ?? 0) > 0 && <span>{data.subdomainCount} subdomains in CT logs</span>}
        </div>
      )}
    </div>
  );
}
