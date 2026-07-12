import { useState } from "react";
import { recordForensicEntities } from "../graph/store";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// GitHub commit forensics (/api/github-forensics): the real people behind a repo
// or org, recovered from commit-author metadata. Personal-email leaks tie a
// pseudonymous project to real identities; forks reveal copied code. On-click
// (a few API calls), like the other deep tools.
type Ident = { name: string; email: string; login?: string; commits: number; kind: "personal" | "corporate" | "unknown" };
type GithubData = {
  available?: boolean;
  note?: string;
  emailLeaks?: Ident[];
  identities?: Ident[];
  forks?: { repo: string; parent: string }[];
};

export function GithubForensics({ org, login, subjectKey, panelCostToken, record = true }: { org?: string; login?: string; subjectKey?: string; panelCostToken?: string; record?: boolean }) {
  const [data, setData] = useState<GithubData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ key: string; failure: PanelRequestFailure } | null>(null);
  const requestKey = [org ?? "", login ?? "", panelCostToken ?? ""].join("\u0000");
  const currentFailure = failure?.key === requestKey ? failure.failure : null;
  const label = org ? `github.com/${org}` : `github.com/${login}`;
  const run = async () => {
    if (loading || data || currentFailure || !panelCostToken) return;
    setLoading(true);
    try {
      const qs = org ? `org=${encodeURIComponent(org)}` : `login=${encodeURIComponent(login ?? "")}`;
      const d = await fetchPanelJson<GithubData>(`/api/github-forensics?${qs}`, { headers: requiredPanelHeaders(panelCostToken) });
      setData(d?.available === false ? { note: d.note ?? "GitHub forensics unavailable (no GITHUB_TOKEN)." } : d);
      // A leaked dev email is the strongest bridge key — two projects sharing one
      // are the same team. Record them so the graph connects them automatically.
      const leaks = Array.isArray(d.emailLeaks) ? d.emailLeaks : [];
      const key = subjectKey || org || login;
      if (record && key && leaks.length) {
        recordForensicEntities(key, leaks.map((leak) => ({ key: `email:${leak.email.toLowerCase()}`, type: "Identity", subtype: "Email", edgeType: "COMMIT_EMAIL", label: `${leak.name} · ${leak.email}` })));
      }
    } catch (error) {
      setFailure({ key: requestKey, failure: panelRequestFailure(error) });
    } finally {
      setLoading(false);
    }
  };

  if (currentFailure) return <PanelRequestNotice failure={currentFailure} label="GitHub commit forensics" className="mt-3" />;
  if (!data) {
    return (
      <div className="mt-3 panel p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">Commit forensics · {label}</span>
          <button onClick={run} disabled={loading || !panelCostToken} className="btn-chip tint-signal disabled:opacity-50">
            {loading ? "mining commits…" : panelCostToken ? "reveal the devs →" : "saved report required"}
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">
          Mine commit-author metadata for real names and personal emails the team left in git history — the identities
          behind a pseudonymous project.
        </p>
      </div>
    );
  }

  const leaks: Ident[] = data.emailLeaks ?? [];
  const idents: Ident[] = data.identities ?? [];
  const forks: { repo: string; parent: string }[] = data.forks ?? [];
  const others = idents.filter((i) => i.kind !== "personal");

  return (
    <div className="mt-3 panel p-4">
      <div className="eyebrow">Commit forensics · {label}</div>
      {data.note && <div className={`mt-1.5 text-[12.5px] leading-relaxed ${leaks.length ? "text-avoid" : "text-ink-dim"}`}>{data.note}</div>}

      {leaks.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">Real-identity leaks ({leaks.length})</div>
          <div className="mt-1 space-y-1">
            {leaks.map((p) => (
              <div key={p.email} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12.5px] text-ink">{p.name}</span>
                <a href={`mailto:${p.email}`} className="mono text-[11px] text-signal-lift underline-offset-2 hover:underline">{p.email}</a>
                {p.login && <a href={`https://github.com/${p.login}`} target="_blank" rel="noreferrer" className="link-ext mono text-[11px]">@{p.login}</a>}
                <span className="mono text-[11px] text-ink-faint">{p.commits} commits</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">Other committers ({others.length})</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {others.slice(0, 16).map((p) => (
              <span key={p.email || p.name} className="mono rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-dim" title={`${p.email} · ${p.commits} commits`}>
                {p.name || p.email}
              </span>
            ))}
          </div>
        </div>
      )}

      {forks.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">Forked / copied code ({forks.length})</div>
          <div className="mt-1 space-y-0.5">
            {forks.slice(0, 6).map((f) => (
              <div key={f.repo} className="mono text-[11px] text-ink-dim">
                {f.repo.split("/")[1]} <span className="text-ink-faint">← forked from</span>{" "}
                <a href={`https://github.com/${f.parent}`} target="_blank" rel="noreferrer" className="link-ext">{f.parent}</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
