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
      } catch { setData({ available: false, note: "Current OFAC name screen is unavailable." }); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!screenable || !data) return null;
  if (data.available === false) {
    return (
      <div className="panel tint-caution px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim" role="status">
        <span className="font-medium text-ink">Current sanctions screen unavailable.</span> {data.note ?? "No clean result was inferred."} The frozen report remains the source of truth.
      </div>
    );
  }

  if (data.sanctioned) {
    const c = "var(--color-avoid)";
    return (
      <div className="finding tint-avoid p-4">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M4.9 4.9l14.2 14.2" /></svg>
          <span className="text-[13.5px] font-semibold text-avoid">⛔ Name matches the OFAC SDN sanctions list</span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
          "{realName}" exactly matches an individual on the US Treasury OFAC Specially Designated Nationals list. Transacting with a sanctioned person is a federal offense. Verify the identity match — a name is not a person — but treat this as a hard stop until cleared.
          <a href={`https://sanctionssearch.ofac.treas.gov/`} target="_blank" rel="noreferrer" className="link-ext mono ml-1">OFAC search</a>
        </p>
      </div>
    );
  }

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-pass)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
        <span className="eyebrow">Supplemental sanctions screen</span>
        <span className="chip ml-auto">not scored</span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
        No exact name match returned from the checked US Treasury OFAC SDN list
        {data.listSize ? ` (${data.listSize.toLocaleString()} listed individuals)` : ""} at query time. This does not establish identity or clear every sanctions regime.
      </p>
    </div>
  );
}
