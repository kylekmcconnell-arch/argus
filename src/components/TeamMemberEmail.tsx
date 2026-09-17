import { useEffect, useRef, useState } from "react";

// A roster person's evidenced contact email: the address itself, a copy button
// that puts it on the clipboard, and a mail button that opens the reader's own
// email app addressed to that person. Renders only when the first-party page
// tied the address to this person; never a guessed pattern.

export function TeamMemberEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
      resetRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied; the address stays visible to select manually.
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="team-member-email">
      <span className="mono text-[11.5px] text-ink-dim">{email}</span>
      <button
        type="button"
        className="btn-chip px-1.5 py-0.5 text-[10.5px]"
        aria-label={`Copy ${email}`}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <a
        href={`mailto:${encodeURIComponent(email)}`}
        className="btn-chip px-1.5 py-0.5 text-[11px] no-underline"
        aria-label={`Email ${email}`}
        title={`Email ${email}`}
      >
        ✉
      </a>
    </span>
  );
}
