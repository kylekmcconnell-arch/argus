// Development-only prototype of the interactive-dossier report experience
// (docs/REPORT-EXPERIENCE-BRIEF-2026-08-17.md, steps 4-6). ?design-preview=dossier
//
// Built on the REAL @dynexcoin report — version 7c51822f, captured 2026-08-16,
// CAUTION 63/100. Every figure, source URL, passage and capture time below is
// copied from that frozen payload; nothing here is invented. The one deliberate
// departure is noted inline: `legal_entity` is rendered as unestablished, which
// is what the evidence supports, where the live report published it as verified.
//
// Mechanics decoded from the reference implementation: one pinned stage held
// across several screens, the report authored as named beats, a document of
// named slots that writes itself in the order a person would write it. Reveal is
// attribute-driven and fully off under prefers-reduced-motion. Scroll position is
// read directly rather than through requestAnimationFrame, which is paused in a
// backgrounded tab and silently freezes the whole thing.
import { useEffect, useRef, useState } from "react";
import { ProvenanceTag } from "../components/ProvenanceTag";

type Tier = "sourced" | "derived" | "unestablished";

const BEATS = [
  {
    id: "subject", label: "The subject", kicker: "What you are looking at",
    heading: "A neuromorphic computing project, live since 2022.",
    body: "Dynex trades as DNX and runs at dynexcoin.org. The account has posted steadily for three years. Everything in the file was fetched on 16 August 2026, and every line says where it came from.",
  },
  {
    id: "who", label: "Who is behind it", kicker: "Team",
    heading: "Two identities confirmed. The rest are claims.",
    body: "The official account itself names a co-founder and an advisor, and the GitHub organisation links back to the handle. A CEO name appears in web and LinkedIn search but nothing first-party confirms it, so it stays a lead.",
  },
  {
    id: "built", label: "What is built", kicker: "Product",
    heading: "A shipped product with revenue on the record.",
    body: "The marketplace launched in December and the project's own roadmap reports revenue against it. A third-party audit exists and is independently reachable. These are the strongest facts in the file.",
  },
  {
    id: "name", label: "The name problem", kicker: "Attribution",
    heading: "Four SEC filings, none of them about this company.",
    body: "The file carries a legal entity backed by regulatory filings. The filings are real. They belong to a different company that shares the word Dynex. Because nothing binds a legal entity, the sanctions screen never ran.",
  },
  {
    id: "open", label: "What is unresolved", kicker: "Coverage",
    heading: "Twenty-eight leads and two providers that never answered.",
    body: "The canonical token is not bound to the account. The adverse sweep returned nothing readable. Press searches came back empty. None of that is evidence of wrongdoing, and none of it is evidence of safety either.",
  },
  {
    id: "verdict", label: "The call", kicker: "Verdict",
    heading: "Caution. Real product, unproven perimeter.",
    body: "What is built is verifiable. What surrounds it — the entity, the partnerships, the usage scale, the market conduct — is largely not. The score reflects the gap, not a finding against the project.",
  },
] as const;

type BeatId = (typeof BEATS)[number]["id"];

const WRITTEN_BY: Record<BeatId, string[]> = {
  subject: ["mast", "facts"],
  who: ["mast", "facts", "team"],
  built: ["mast", "facts", "team", "product"],
  name: ["mast", "facts", "team", "product", "entity"],
  open: ["mast", "facts", "team", "product", "entity", "open"],
  verdict: ["mast", "facts", "team", "product", "entity", "open", "verdict"],
};

/** Receipts, verbatim from the frozen payload. */
const RECEIPTS: Record<string, { passage: string; source: string; url: string; chain: [string, string][] }> = {
  marketplace: {
    passage: "Since the official product launch of the Dynex Marketplace on December 13th, revenues of almost 60k DNX had been generated…",
    source: "dynexcoin.org/roadmap · official subject",
    url: "https://dynexcoin.org/roadmap",
    chain: [["Fetched and hashed", "04:53:22"], ["Artifact verified", "04:53:22"]],
  },
  audit: {
    passage: "The most recent audit, conducted by Cyberscope, was successfully completed with no critical or medium-level findings…",
    source: "dynexcoin.org/learn/tokenomics + cyberscope.io/audits/dnx",
    url: "https://www.cyberscope.io/audits/dnx",
    chain: [["Fetched from the subject's own site", "04:52:55"], ["Corroborated against the auditor", "04:53:27"]],
  },
  repo: {
    passage: "GitHub github.com/dynexcoin (Dynex [DNX]) links back to this X handle.",
    source: "github.com/dynexcoin · resolved through the X handle field",
    url: "https://github.com/dynexcoin",
    chain: [["Fetched and hashed", "04:51:31"], ["Back-link to the audited handle confirmed", "04:51:31"]],
  },
  entity: {
    passage: "This Restricted Stock Unit Award Agreement … is made … by Dynex Capital, Inc., a Virginia corporation (the \"Company\"), to a Non-Employee Director of the Company.",
    source: "sec.gov · EDGAR CIK 826675 · 4 filings",
    url: "https://www.sec.gov/Archives/edgar/data/826675/000082667525000118/exhibit10419formofrsuagree.htm",
    chain: [
      ["Fetched and hashed", "04:52:55"],
      ["Artifact verified — the filing is genuine", "04:52:55"],
      ["Bound to @dynexcoin", "never"],
    ],
  },
  token: {
    passage: "The DNX Utility Coin: The Dynex coin (DNX) serves as a versatile utility token within the Dynex blockchain ecosystem…",
    source: "dynexcoin.org/learn/ecosystem · official subject",
    url: "https://dynexcoin.org/learn/ecosystem",
    chain: [["Fetched and hashed", "04:53:22"], ["Corroborated in independent press", "04:53:26"], ["Bound to the account as canonical", "never"]],
  },
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(q.matches);
    on(); q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

function Fig({ children, tier, receipt, warn }: {
  children: React.ReactNode; tier: Tier; receipt?: keyof typeof RECEIPTS; warn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detail = receipt ? RECEIPTS[receipt] : null;
  const tint = tier === "sourced" ? "text-sourced" : tier === "derived" ? "text-derived" : "text-unverifiable";
  return (
    <span className="relative inline-block">
      <button
        type="button" onClick={() => detail && setOpen(!open)} aria-expanded={detail ? open : undefined}
        className={`mono text-[12.5px] ${tint} ${detail ? "cursor-pointer underline decoration-dotted underline-offset-4" : "cursor-default"}`}
      >
        {children}
      </button>
      {open && detail && (
        <span className="panel absolute right-0 bottom-full z-20 mb-2 block w-[330px] px-3.5 py-3 text-left shadow-lg">
          <span className="mono block text-[10px] uppercase tracking-[0.12em] text-ink-faint">Provenance</span>
          <span className="mt-2 block text-[12px] italic leading-relaxed text-ink-dim">“{detail.passage}”</span>
          <span className="mono mt-2 block break-all text-[10.5px] text-ink-faint">{detail.source}</span>
          <span className="mt-2.5 block border-t border-line pt-2">
            {detail.chain.map(([what, when]) => (
              <span key={what} className="mt-1 flex items-baseline justify-between gap-3">
                <span className={`text-[11.5px] ${when === "never" ? "text-unverifiable" : "text-ink-dim"}`}>{what}</span>
                <span className={`mono text-[10.5px] ${when === "never" ? "text-unverifiable" : "text-ink-faint"}`}>{when}</span>
              </span>
            ))}
          </span>
          {warn && (
            <span className="mt-2.5 block border-t border-line pt-2 text-[11.5px] leading-relaxed text-unverifiable">
              The passage is genuine. It is about a different company. Nothing in these four filings
              mentions DNX, dynexcoin.org, or neuromorphic computing.
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function Block({ id, written, children }: { id: string; written: string[]; children: React.ReactNode }) {
  return (
    <div data-cs={id} data-settled={written.includes(id) ? "true" : "false"} className="dossier-block">
      {children}
    </div>
  );
}

export function DossierPreview() {
  const [current, setCurrent] = useState<BeatId>("subject");
  const reduced = useReducedMotion();
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const pick = () => {
      const centre = window.innerHeight / 2;
      let best: BeatId | null = null, bestDist = Infinity;
      for (const [id, el] of Object.entries(refs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - centre);
        if (d < bestDist) { bestDist = d; best = id as BeatId }
      }
      if (best) setCurrent(best);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick, { passive: true });
    return () => { window.removeEventListener("scroll", pick); window.removeEventListener("resize", pick) };
  }, []);

  const written = reduced ? WRITTEN_BY.verdict : WRITTEN_BY[current];
  const beat = BEATS.find((b) => b.id === current)!;
  const idx = BEATS.findIndex((b) => b.id === current) + 1;

  return (
    <div className={`dossier-preview min-h-screen bg-void text-ink ${reduced ? "reduced" : ""}`}>
      <header className="border-b border-line px-6 py-2.5">
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Design preview · interactive dossier · real report 7c51822f · captured 16 Aug 2026
        </p>
      </header>

      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,470px)]">
        <div>
          {BEATS.map((b) => (
            <section
              key={b.id} data-beat={b.id} data-screen-label={b.label}
              ref={(el) => { refs.current[b.id] = el }}
              className="flex min-h-[80vh] flex-col justify-center py-10"
            >
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-signal-lift">{b.kicker}</p>
              <h2 className="display mt-3 max-w-[20ch] text-[32px] leading-[1.14] text-ink">{b.heading}</h2>
              <p className="mt-4 max-w-[54ch] text-[14px] leading-relaxed text-ink-dim">{b.body}</p>
            </section>
          ))}
          <div className="h-[28vh]" />
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-8 h-[calc(100vh-4rem)] py-8">
            <div className="panel flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">The file</span>
                <span className="mono text-[10px] text-ink-faint">{idx} / {BEATS.length}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <Block id="mast" written={written}>
                  <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Project · X account</p>
                  <h3 className="display mt-1 text-[24px] text-ink">Dynex</h3>
                  <p className="mono mt-1 text-[11px] text-ink-faint">@dynexcoin · since Sep 2022 · 39.4K followers</p>
                </Block>

                <Block id="facts" written={written}>
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-3.5">
                    <Row k="Identity"><Fig tier="sourced">Dynex</Fig></Row>
                    <Row k="Site"><Fig tier="sourced">dynexcoin.org</Fig></Row>
                    <Row k="Token"><Fig tier="unestablished" receipt="token">DNX · unbound</Fig></Row>
                    <Row k="Account status"><Fig tier="sourced">active</Fig></Row>
                  </div>
                </Block>

                <Block id="team" written={written}>
                  <Section title="Team">
                    <Line><Fig tier="sourced">@DynexMoonshots</Fig> named co-founder by the official account.</Line>
                    <Line><Fig tier="sourced">@proph3ttt</Fig> named advisor, same source.</Line>
                    <Line><Fig tier="unestablished">Daniela Herrmann, CEO</Fig> — web and LinkedIn search only.</Line>
                    <Line><Fig tier="unestablished">Leadership still current</Fig> — no employment record.</Line>
                  </Section>
                </Block>

                <Block id="product" written={written}>
                  <Section title="Product">
                    <Line><Fig tier="sourced" receipt="marketplace">Dynex Marketplace</Fig> — ~60k DNX revenue since 13 Dec.</Line>
                    <Line><Fig tier="sourced" receipt="audit">Cyberscope audit</Fig> — no critical or medium findings.</Line>
                    <Line><Fig tier="sourced" receipt="repo">github.com/dynexcoin</Fig> links back to the handle.</Line>
                  </Section>
                </Block>

                <Block id="entity" written={written}>
                  <div className="mt-4 border-t border-unverifiable/40 pt-3.5">
                    <p className="mono text-[10px] uppercase tracking-[0.12em] text-unverifiable">Legal entity · not bound</p>
                    <div className="mt-1.5 space-y-1.5">
                      <Line>
                        <Fig tier="unestablished" receipt="entity" warn>Dynex Capital, Inc.</Fig> — 4 SEC filings, CIK 826675.
                      </Line>
                      <Line>A Virginia corporation that shares only the word Dynex.</Line>
                      <Line><Fig tier="unestablished">OFAC screen</Fig> never ran: no entity to screen.</Line>
                    </div>
                    <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-faint">
                      The live report publishes this as <span className="text-pass">verified</span>. On the
                      evidence it is a namesake match, which is what this ramp makes visible.
                    </p>
                  </div>
                </Block>

                <Block id="open" written={written}>
                  <Section title="Unresolved">
                    <Line><Fig tier="unestablished">28 leads</Fig> across founder, funding, traction, control.</Line>
                    <Line><Fig tier="unestablished">Adverse sweep</Fig> returned nothing readable.</Line>
                    <Line><Fig tier="unestablished">Press</Fig> — exact-name searches came back empty.</Line>
                    <Line><Fig tier="unestablished">2 providers</Fig> failed: monid blocked, coingecko 401.</Line>
                  </Section>
                </Block>

                <Block id="verdict" written={written}>
                  <div className="mt-4 border-t border-line pt-3.5">
                    <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Verdict</p>
                    <div className="mt-2 flex items-baseline gap-2.5">
                      <span className="display text-[32px] text-caution">CAUTION</span>
                      <span className="mono text-[15px] text-ink-dim">63/100</span>
                    </div>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
                      Publicly identifiable team, a live audited product with documented early revenue.
                      Independent corroboration of partnerships, usage scale and market conduct remains limited.
                    </p>
                  </div>
                </Block>

                <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                  <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Origin</span>
                  <ProvenanceTag state={{ tier: "sourced" }} />
                  <ProvenanceTag state={{ tier: "derived" }} />
                  <ProvenanceTag state={{ tier: "unestablished" }} />
                </div>
              </div>

              <div className="border-t border-line px-4 py-2">
                <p className="mono text-[10px] text-ink-faint">{beat.label} · dotted values open their receipt</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{k}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-line pt-3.5">
      <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{title}</p>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-ink-dim">{children}</p>;
}
