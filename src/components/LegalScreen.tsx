import { useEffect, useRef, useState } from "react";

// US legal-history screen for a resolved real name (CourtListener / RECAP). Runs
// ONLY when the audit resolved a real identity — searching a pseudonymous handle
// returns noise. A founder named as a party in a fraud suit / SEC action / bankruptcy
// is a strong, off-chain diligence signal; framed as leads to verify, not proof.
type Case = { caseName: string; court: string; date: string | null; docket: string | null; url: string | null; nameInCase: boolean };
type Data = { available: boolean; name?: string; total?: number; cases?: Case[]; asParty?: number; note?: string };

const yearOf = (d?: string | null) => (d ? d.slice(0, 4) : "");

export function LegalScreen({ name, resolved }: { name?: string | null; resolved: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "done">("loading");
  const ran = useRef(false);
  const realName = (name ?? "").trim();
  const screenable = resolved && realName.split(/\s+/).filter(Boolean).length >= 2;

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!screenable) return;
    (async () => {
      try {
        const r = await fetch(`/api/legal-screen?name=${encodeURIComponent(realName)}`);
        setData(await r.json());
      } catch { setData({ available: false, note: "Current CourtListener search is unavailable." }); }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!screenable || state === "loading" || !data) return null;
  if (data.available === false) {
    return (
      <div className="panel tint-caution px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim" role="status">
        <span className="font-medium text-ink">Current US legal screen unavailable.</span> {data.note ?? "No clean result was inferred."} The frozen report remains the source of truth.
      </div>
    );
  }
  const cases = data.cases ?? [];
  const asParty = data.asParty ?? 0;
  const flagged = asParty > 0;

  if (!cases.length) {
    return (
      <div className="panel px-4 py-3">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-pass)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
          <span className="eyebrow">Supplemental US legal screen</span>
          <span className="chip ml-auto">not scored</span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
          No matching record was returned for {realName} in the CourtListener / RECAP index at query time. Index coverage and name matching are not exhaustive.
        </p>
      </div>
    );
  }

  const color = flagged ? "var(--color-caution)" : "var(--color-ink-faint)";
  return (
    <div className={`panel p-4 ${flagged ? "tint-var" : ""}`} style={flagged ? ({ "--tint": color } as React.CSSProperties) : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M5 7h14M7 7l-3 6h6zM17 7l3 6h-6z" /></svg>
        <span className="eyebrow">Legal history</span>
        {flagged && <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}><span>{asParty} case{asParty === 1 ? "" : "s"} naming them as a party</span></span>}
        <a href={`https://www.courtlistener.com/?q=%22${encodeURIComponent(realName)}%22&type=r`} target="_blank" rel="noreferrer" className="link-ext mono ml-auto text-[11px]">CourtListener</a>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
        {data.total} US court record{data.total === 1 ? "" : "s"} mention "{realName}"{flagged ? ` — ${asParty} name them as a party` : ""}. Verify the identity match before drawing conclusions; a name is not a person.
      </p>
      <div className="mt-2 divide-y divide-line/60">
        {cases.slice(0, 6).map((c, i) => (
          <div key={i} className="flex items-center gap-2 py-1.5 text-[11.5px]">
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" style={{ color: c.nameInCase ? color : "var(--color-ink-dim)" }}>{c.caseName}</a>
            ) : (
              <span className="min-w-0 flex-1 truncate" style={{ color: c.nameInCase ? color : "var(--color-ink-dim)" }}>{c.caseName}</span>
            )}
            <span className="shrink-0 text-[11px] text-ink-faint">{c.court}{c.date ? ` · ${yearOf(c.date)}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
