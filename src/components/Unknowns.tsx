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
  if (!d.safety.available) g.push("ARGUS could not check the token contract on this network. The score uses market data only.");
  else if (evm && !d.safety.openSource) g.push("The contract code is not public or verified, so ARGUS cannot fully inspect what it can do.");
  if (evm && d.safety.available && !d.safety.simChecked) g.push("ARGUS did not test a real buy and sell. Fees and sellability come from contract settings instead.");
  if (!d.deployer) g.push("ARGUS could not identify the wallet that created the token, so it could not trace its funding or other launches.");
  if (!d.cg) g.push("CoinGecko does not list this token, so ARGUS could not confirm its market through that independent source.");
  if (!d.projectX) g.push("No official X/social account was found linked to the token.");
  if (!d.topHolders.length) g.push("Holder distribution is unavailable. Concentration can't be assessed.");
  return g;
}

export function Unknowns({ dossier }: { dossier: TokenDossier }) {
  const items = gaps(dossier);
  if (!items.length) return null;
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 3.5" /><path d="M12 17h.01" /></svg>
        <span className="eyebrow">What we couldn't verify</span>
        <span className="mono ml-auto text-[11px] text-ink-faint">{items.length} gap{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-dim">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">These are unanswered checks, not accusations against the token. Missing information is still a reason to be careful.</p>
    </div>
  );
}
