import { useEffect, useRef, useState } from "react";
import { GithubForensics } from "./GithubForensics";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// A person's code footprint. A report only knows the subject's X handle / name /
// bio, so this resolves their GitHub account first (via /api/resolve-github —
// bio link, same-username with a back-link, or an X-handle-in-bio search), then
// runs the existing commit forensics on it. Answers Enigma's memo: an audit of a
// person who claims to be a long-time builder should actually check their GitHub.
type Resolved = { available: boolean; login?: string; followers?: number; repos?: number; url?: string; why?: string[]; confidence?: string };

const enc = encodeURIComponent;

export function PersonGithub({ handle, name, bio, className, panelCostToken, record = true }: { handle: string; name?: string | null; bio?: string | null; className?: string; panelCostToken?: string; record?: boolean }) {
  const requestKey = [handle, name ?? "", bio ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; data: Resolved | null; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === requestKey || !handle || !panelCostToken) return;
    ran.current = requestKey;
    let live = true;
    (async () => {
      try {
        const qs = [`handle=${enc(handle)}`, name && `name=${enc(name)}`, bio && `bio=${enc(bio.slice(0, 400))}`].filter(Boolean).join("&");
        const data = await fetchPanelJson<Resolved>(`/api/resolve-github?${qs}`, { headers: requiredPanelHeaders(panelCostToken) });
        if (live) setResult({ key: requestKey, data });
      } catch (error) {
        if (live) setResult({ key: requestKey, data: null, failure: panelRequestFailure(error) });
      }
    })();
    return () => { live = false; };
  }, [bio, handle, name, panelCostToken, requestKey]);

  const current = result?.key === requestKey ? result : null;
  if (current?.failure) return <PanelRequestNotice failure={current.failure} label="GitHub identity resolution" className={className} />;
  const data = current?.data;
  if (!data || !data.available || !data.login) return null;
  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="eyebrow">Code footprint · github.com/{data.login}</span>
        {data.confidence && <span className={`chip ${data.confidence === "high" ? "tint-pass" : "tint-caution"}`}>{data.confidence}-confidence match</span>}
        {data.why && data.why.length > 0 && <span className="text-[11px] text-ink-faint">· {data.why[0]}</span>}
      </div>
      <GithubForensics login={data.login} subjectKey={handle} panelCostToken={panelCostToken} record={record} />
    </div>
  );
}
