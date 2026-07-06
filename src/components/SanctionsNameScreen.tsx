import { useEffect, useRef, useState } from "react";

// OFAC SDN name screen for a resolved real person. Complements the address-level
// sanctions screen on token reports: this asks "is this *person* sanctioned?"
// Runs only on a resolved real name (a pseudonym can't be on a government list),
// exact-match only, so a clean result is trustworthy and a hit is a hard stop.
type Data = { available: boolean; name?: string; sanctioned?: boolean; listSize?: number; list?: string; note?: string };

export function SanctionsNameScreen({ name, resolved }: { name?: string | null; resolved: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const ran = useRef(false);
  const realName = (name ?? "").trim();
  const screenable = resolved && realName.split(/\s+/).filter(Boolean).length >= 2;

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!screenable) return;
    (async () => {
      try {
        const r = await fetch(`/api/sanctions-name?name=${encodeURIComponent(realName)}`);
        setData(await r.json());
      } catch { /* non-fatal */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!screenable || !data || data.available === false) return null;

  if (data.sanctioned) {
    const c = "var(--color-fail)";
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: `${c}66`, background: `${c}12` }}>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M4.9 4.9l14.2 14.2" /></svg>
          <span className="text-[13px] font-semibold" style={{ color: c }}>⛔ Name matches the OFAC SDN sanctions list</span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">
          "{realName}" exactly matches an individual on the US Treasury OFAC Specially Designated Nationals list. Transacting with a sanctioned person is a federal offense. Verify the identity match — a name is not a person — but treat this as a hard stop until cleared.
          <a href={`https://sanctionssearch.ofac.treas.gov/`} target="_blank" rel="noreferrer" className="mono ml-1 text-signal-dim hover:underline">OFAC search ↗</a>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-2.5">
      <div className="flex items-center gap-2 text-[11.5px] text-ink-faint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-pass)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
        <span>Screened against the US Treasury OFAC SDN list ({data.listSize?.toLocaleString()} sanctioned individuals) — <span className="text-ink-dim">no match</span>.</span>
      </div>
    </div>
  );
}
