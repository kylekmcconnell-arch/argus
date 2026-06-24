import { useEffect, useRef, useState } from "react";
import type { WebPerson } from "../lib/investigation";
import { recordContribution, projectPeopleContribution, getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { Avatar } from "./Avatar";
import { xAvatar } from "../lib/avatars";

const initial = (s: string) => (s.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();

// Dig everyone tied to a project by NAME (and domain if known), via the same
// web/LinkedIn/X search the recon uses. Name-only is fine for a bare venture.
async function fetchProjectPeople(name: string, domain?: string): Promise<WebPerson[]> {
  try {
    const qs = new URLSearchParams({ name });
    if (domain) qs.set("domain", domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
    const res = await fetch(`/api/recon-team?${qs}`);
    if (!res.ok) return [];
    const d = await res.json();
    return Array.isArray(d.people) ? (d.people as WebPerson[]) : [];
  } catch {
    return [];
  }
}

// Project-centric discovery: given a project (a venture/affiliation surfaced
// anywhere in the app), dig the web/LinkedIn/X for EVERYONE who worked on it —
// founders, team, contributors — even people never audited. Each is one click
// from a full audit, and the project + its people are recorded into the trust
// graph so the web compounds. This is what makes the forensics fluid: person ->
// their projects -> who else was involved -> those people -> their projects.
export function ProjectView({
  project,
  onAudit,
  onReset,
}: {
  project: { name: string; domain?: string };
  onAudit: (q: string) => void;
  onReset: () => void;
}) {
  const [people, setPeople] = useState<WebPerson[] | null>(null);
  const [loading, setLoading] = useState(true);
  const key = `${project.name}|${project.domain ?? ""}`;
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setLoading(true);
    setPeople(null);
    fetchProjectPeople(project.name, project.domain)
      .then((ppl) => {
        if (cancelled) return;
        setPeople(ppl);
        if (ppl.length) recordContribution(projectPeopleContribution(project.name, ppl));
      })
      .catch(() => !cancelled && setPeople([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [key, project.domain, project.name]);

  // Who else (from past audits) is already tied to this project?
  const connections = subjectConnections(project.name, getContributions());

  return (
    <div className="relative min-h-full pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Home
          </button>
          <span className="mono text-[11px] text-ink-faint">/ project</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5">
        <div className="mt-6">
          <h1 className="text-[24px] font-medium tracking-[-0.02em] text-ink">{project.name}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
            Everyone who worked on this project, dug from the web, LinkedIn, Crunchbase and X. Open anyone to run a
            full audit, then follow their other projects to keep pulling the thread.
          </p>
          {project.domain && <p className="mono mt-1 text-[11px] text-ink-faint">{project.domain}</p>}
        </div>

        {/* people who worked on it */}
        <div className="mt-5 rounded-xl border border-line bg-panel p-4">
          <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-ink-faint">
            People who worked on this {people && <span className="normal-case tracking-normal text-ink-faint">({people.length})</span>}
            {loading && <span className="normal-case tracking-normal text-ink-faint">· digging the web…</span>}
          </div>
          {people && people.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {people.map((p) => (
                <div key={p.handle ?? p.name} className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Avatar src={p.handle ? xAvatar(p.handle) : null} letter={initial(p.name)} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                    <span className="text-[12.5px] text-ink">{p.name}</span>
                    {p.handle && <span className="mono text-[11px] text-ink-faint">{p.handle}</span>}
                    <span className="text-[10.5px] text-ink-faint">{p.role}</span>
                    {p.linkedin && (
                      <a href={`https://${p.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="text-[10.5px] text-signal-dim underline-offset-2 hover:underline">LinkedIn ↗</a>
                    )}
                    {p.evidence && <span className="text-[10.5px] text-ink-faint">· {p.evidence}</span>}
                  </span>
                  {p.handle ? (
                    <button onClick={() => onAudit(p.handle!)} className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>audit →</button>
                  ) : (
                    <span className="mono shrink-0 text-[10.5px] text-ink-faint">no handle</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !loading && <p className="mt-2 text-[12.5px] text-ink-faint">No one could be tied to this project via web / LinkedIn / X search.</p>
          )}
        </div>

        {/* who else (from past audits) connects to this project */}
        {connections.length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-panel p-4">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Already in your graph</div>
            <div className="mt-2 space-y-1.5">
              {connections.map((c) => (
                <div key={c.other} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="mono text-[12.5px] text-ink">{c.other}</span>
                    {c.ties.length > 0 && <span className="ml-2 text-[11px] text-ink-faint">via {c.ties.map((t) => t.label).join(", ")}</span>}
                  </span>
                  <button onClick={() => onAudit(c.other)} className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>open →</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
