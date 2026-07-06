import type { TokenDossier } from "../token/audit";

// Negative space: what the scan COULDN'T confirm. For diligence, the unknowns are
// signal — a token whose source isn't verified, whose deployer won't resolve, and
// that no exchange lists is a very different risk from one where all of that
// checked out clean, even at the same score. We make the gaps explicit rather than
// letting silence read as safety. Derived from what the audit already computed;
// whitepaper/audit gaps live in the Documents panel.
function gaps(d: TokenDossier): string[] {
  const g: string[] = [];
  const evm = d.chain !== "solana";
  if (!d.safety.available) g.push("On-chain contract safety couldn't be verified (no keyless source on this chain) — scored on market data alone.");
  else if (evm && !d.safety.openSource) g.push("The contract source is not verified/public — its real behavior can't be read, only its deployed bytecode.");
  if (evm && d.safety.available && !d.safety.simChecked) g.push("A live buy/sell wasn't simulated — taxes and sellability are from static flags, not a real trade.");
  if (!d.deployer) g.push("The deployer wallet couldn't be resolved — no funding trail or serial-launch check is possible.");
  if (!d.cg) g.push("Not listed on CoinGecko — no exchange or independent market corroboration.");
  if (!d.projectX) g.push("No official X/social account was found linked to the token.");
  if (!d.topHolders.length) g.push("Holder distribution is unavailable — concentration can't be assessed.");
  return g;
}

export function Unknowns({ dossier }: { dossier: TokenDossier }) {
  const items = gaps(dossier);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 3.5" /><path d="M12 17h.01" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">What we couldn't verify</span>
        <span className="mono ml-auto text-[10px] text-ink-faint">{items.length} gap{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-dim">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">These are gaps in coverage, not findings against the token — but a scan you can't complete is itself a reason for caution.</p>
    </div>
  );
}
