import { useEffect, useRef, useState } from "react";
import { shortAddr, explorerAddr } from "../lib/addressLabels";

// OFAC sanctions screen for a token's key wallets (deployer + top holders). A
// sanctioned wallet is the hardest possible signal — an instant AVOID and a real
// legal-exposure flag. Loud when there's a hit; quietly reassuring when clean (the
// check ran); silent only if it couldn't run. Free (OFAC SDN list via 0xB10C).
type Data = { available: boolean; checked?: number; listSize?: number; sanctioned?: string[]; note?: string };

export function SanctionsScreen({ addresses, chain }: { addresses: { address: string; role: string }[]; chain: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "done">("loading");
  const ran = useRef(false);

  // Dedup the wallets to screen (deployer + holders often overlap nothing, but be safe).
  const roleOf = new Map(addresses.map((a) => [a.address.toLowerCase(), a.role]));
  const uniq = [...new Set(addresses.map((a) => a.address).filter(Boolean))];

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!uniq.length) { setState("done"); return; }
    (async () => {
      try {
        const r = await fetch(`/api/sanctions?addresses=${encodeURIComponent(uniq.join(","))}&chain=${encodeURIComponent(chain)}`);
        setData(await r.json());
      } catch { /* non-fatal */ }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading" || !data || data.available === false) return null;
  const hits = data.sanctioned ?? [];

  if (hits.length) {
    return (
      <div className="finding tint-avoid p-4">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-avoid">
          <span className="text-[15px]">⛔</span>
          OFAC-sanctioned wallet{hits.length === 1 ? "" : "s"} — do not interact
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
          {hits.length} of this token's key wallets {hits.length === 1 ? "is" : "are"} on the US Treasury OFAC sanctions list. Transacting with a sanctioned address is a legal violation, not just a risk.
        </p>
        <div className="mt-2 space-y-1">
          {hits.map((a) => (
            <div key={a} className="flex items-center gap-2 text-[12.5px]">
              <a href={explorerAddr(a, chain)} target="_blank" rel="noreferrer" className="link-ext mono font-medium text-avoid">{shortAddr(a)}</a>
              <span className="text-[11px] text-ink-faint">{roleOf.get(a.toLowerCase()) ?? "wallet"}</span>
              <span className="chip tint-avoid">OFAC SDN</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Clean — a quiet line confirming the check ran (diligence users want to see it did).
  return (
    <div className="panel px-4 py-2.5">
      <div className="flex items-center gap-2 text-[12.5px] text-ink-faint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-pass)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
        <span><span className="text-ink-dim">{data.checked}</span> key wallet{data.checked === 1 ? "" : "s"} screened against the OFAC sanctions list — none sanctioned.</span>
      </div>
    </div>
  );
}
