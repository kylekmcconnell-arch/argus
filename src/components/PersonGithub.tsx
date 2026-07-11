import { useEffect, useRef, useState } from "react";
import { GithubForensics } from "./GithubForensics";

// A person's code footprint. A report only knows the subject's X handle / name /
// bio, so this resolves their GitHub account first (via /api/resolve-github —
// bio link, same-username with a back-link, or an X-handle-in-bio search), then
// runs the existing commit forensics on it. Answers Enigma's memo: an audit of a
// person who claims to be a long-time builder should actually check their GitHub.
type Resolved = { available: boolean; login?: string; followers?: number; repos?: number; url?: string; why?: string[]; confidence?: string };

const enc = encodeURIComponent;

export function PersonGithub({ handle, name, bio, className, record = true }: { handle: string; name?: string | null; bio?: string | null; className?: string; record?: boolean }) {
  const [data, setData] = useState<Resolved | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !handle) return;
    ran.current = true;
    (async () => {
      try {
        const qs = [`handle=${enc(handle)}`, name && `name=${enc(name)}`, bio && `bio=${enc(bio.slice(0, 400))}`].filter(Boolean).join("&");
        const r = await fetch(`/api/resolve-github?${qs}`);
        setData(await r.json());
      } catch { /* non-fatal */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data || !data.available || !data.login) return null;
  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Code footprint · github.com/{data.login}</span>
        {data.confidence && <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: data.confidence === "high" ? "var(--color-pass)14" : "var(--color-caution)14", color: data.confidence === "high" ? "var(--color-pass)" : "var(--color-caution)" }}>{data.confidence}-confidence match</span>}
        {data.why && data.why.length > 0 && <span className="text-[10px] text-ink-faint">· {data.why[0]}</span>}
      </div>
      <GithubForensics login={data.login} subjectKey={handle} record={record} />
    </div>
  );
}
