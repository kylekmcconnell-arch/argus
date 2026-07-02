import { useEffect, useRef, useState } from "react";
import { recordForensicEntities } from "../graph/store";

// Past-identity sweep (/api/identity-sweep): prior X handles (rebrands) + the same
// username found on GitHub / Farcaster / Reddit / Telegram, tying a pseudonym to a
// dated footprint elsewhere. On-click. Same-username is a LEAD, not proof — the
// per-hit detail (repos, followers, account age) is there so a human can judge.
type Hit = { platform: string; username: string; url: string; detail: string };

export function IdentitySweep({ handle, auto }: { handle: string; auto?: boolean }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const ran = useRef(false);
  const run = async () => {
    if (loading || data) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/identity-sweep?handle=${encodeURIComponent(handle.replace(/^@/, ""))}`);
      const d = await r.json();
      setData(d);
      // Record prior handles (rebrands) + cross-platform footprint into the graph
      // so the same identity bridges across audits.
      const prior: string[] = d?.priorHandles ?? [];
      const footprint: { platform: string; username: string }[] = d?.footprint ?? [];
      const ents = [
        ...prior.map((p) => ({ key: `@${p.replace(/^@/, "").toLowerCase()}`, type: "Person", edgeType: "REBRAND_FROM", label: `@${p}` })),
        ...footprint.map((h) => ({ key: `${h.platform.toLowerCase()}:${h.username.toLowerCase()}`, type: "Identity", subtype: "Account", edgeType: "SAME_USERNAME", label: `${h.platform} @${h.username}` })),
      ];
      if (ents.length) recordForensicEntities(handle, ents);
    } catch {
      setData({ note: "Identity sweep failed." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auto && !ran.current) { ran.current = true; void run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, handle]);

  if (!data) {
    return (
      <div className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Past-identity sweep</span>
          <button onClick={run} disabled={loading} className="mono rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-dim transition hover:text-ink disabled:opacity-50">
            {loading ? "tracing identities…" : "trace past identities →"}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
          Prior X handles (rebrands hide a past) and the same username across GitHub / Farcaster / Reddit / Telegram —
          tying this pseudonym to dated accounts elsewhere.
        </p>
      </div>
    );
  }

  const prior: string[] = data.priorHandles ?? [];
  const footprint: Hit[] = data.footprint ?? [];
  const bios: { handle: string; year: string; bio: string }[] = data.archivedBios ?? [];
  const flag = prior.length > 0;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Past-identity sweep</span>
        {data.firstSeen && <span className="mono text-[10px] text-ink-faint">account seen since {data.firstSeen}</span>}
      </div>
      {data.note && <div className={`mt-1.5 text-[12px] leading-relaxed ${flag ? "text-caution" : "text-ink-dim"}`}>{data.note}</div>}

      {prior.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Prior handles (rebrand)</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {prior.map((p) => <span key={p} className="mono rounded border border-caution/40 px-1.5 py-0.5 text-[10px] text-caution">@{p}</span>)}
          </div>
        </div>
      )}

      {footprint.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Cross-platform footprint ({footprint.length})</div>
          <div className="mt-1 space-y-1">
            {footprint.map((h) => (
              <div key={`${h.platform}:${h.username}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <a href={h.url} target="_blank" rel="noreferrer" className="mono shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-signal hover:underline">{h.platform} @{h.username}</a>
                <span className="min-w-0 text-[11px] text-ink-dim">{h.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {bios.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Archived bios (prior handles)</div>
          <div className="mt-1 space-y-1">
            {bios.map((b) => (
              <div key={b.handle} className="text-[11.5px] text-ink-dim">
                <span className="mono text-ink-faint">@{b.handle} · {b.year}:</span> {b.bio}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
