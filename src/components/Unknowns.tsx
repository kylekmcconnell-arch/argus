import type { TokenDossier } from "../token/audit";
import { tokenDataGaps } from "../lib/tokenStory";

// Negative space: what the scan could not confirm. For diligence, the unknowns
// are signal. A token whose source is not verified, whose deployer will not
// resolve, and that no exchange lists is a different risk from one where all of
// that checked out clean, even at the same score. The list is owned by
// tokenDataGaps so this panel and the token story cannot disagree.

export function Unknowns({ dossier }: { dossier: TokenDossier }) {
  const items = tokenDataGaps(dossier);
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
