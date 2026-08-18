// Development-only visual harness for the provenance ramp (DESIGN.md 2.1).
// Renders the real BasicFactsPanel with one fact in every evidence state, so the
// origin-of-value vocabulary can be read at production type sizes rather than
// judged from swatches. Reached at ?design-preview=provenance in dev only.
import { BasicFactsPanel, type BasicFactView, type BasicFactLeadView } from "../components/BasicFactsPanel";
import { ProvenanceTag } from "../components/ProvenanceTag";

const src = (title: string, url: string) => [{ url, title, excerpt: "…the relevant passage as fetched and checked…" }];

const FACTS: BasicFactView[] = [
  {
    factId: "f1",
    predicate: "identity",
    question: "Is identity and current authority verified?",
    value: "Stani Kulechov, founder and CEO, Aave Labs",
    status: "verified",
    critical: true,
    sources: src("aave.com/team", "https://aave.com/team"),
  },
  {
    factId: "f2",
    predicate: "role",
    question: "Which companies and current roles are verified?",
    value: "Founder, Aave (2017–present); previously ETHLend",
    status: "corroborated",
    sources: [
      ...src("aave.com", "https://aave.com"),
      ...src("Companies House filing", "https://find-and-update.company-information.service.gov.uk"),
    ],
  },
  {
    factId: "f3",
    predicate: "raise_total",
    question: "How much has the venture raised in total?",
    value: "$49,000,000",
    status: "conflicted",
    sources: [
      ...src("DeFiLlama raises", "https://defillama.com/raises"),
      ...src("press release, Oct 2024", "https://example.org/press"),
    ],
  },
  {
    factId: "f4",
    predicate: "sanctions_screen",
    question: "Does the subject appear on any consolidated sanctions list?",
    value: "No match returned",
    status: "checked_empty",
    critical: true,
    sources: src("OFAC SDN search", "https://sanctionssearch.ofac.treas.gov"),
  },
  {
    factId: "f5",
    predicate: "net_worth",
    question: "What is the disclosed net worth behind the guarantee?",
    value: "Not established",
    status: "unresolved",
  },
];

const LEADS: BasicFactLeadView[] = [
  {
    predicate: "prior_exit",
    value: "Possible prior exit, 2016 — named in a single secondary summary, never fetched",
    sources: src("search result, unfetched", "https://example.org/secondary"),
  } as BasicFactLeadView,
];

export function ProvenancePreview() {
  return (
    <div className="min-h-screen bg-void px-6 py-10 text-ink">
      <div className="mx-auto max-w-3xl">
        <p className="mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">Design preview</p>
        <h1 className="display mt-1 text-[24px] text-ink">Provenance ramp</h1>
        <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
          Colour answers how grounded a value is. The mark answers what kind of state it is in.
          Neither answers whether the news is good — that stays with the verdict palette.
        </p>

        <div className="panel mt-6 px-4 py-4">
          <p className="mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">The three tiers</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ProvenanceTag state={{ tier: "sourced" }} />
            <ProvenanceTag state={{ tier: "sourced", contested: true }} />
            <ProvenanceTag state={{ tier: "derived" }} />
            <ProvenanceTag state={{ tier: "unestablished" }} />
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">
            The hollow dot is a contradiction between two fetched sources. It stays in the
            sourced tier because it is better grounded than a calculation, not worse.
          </p>
        </div>

        <div className="panel mt-6 px-4 py-4">
          <p className="mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            Against the verdict palette, for contrast
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="chip tint-pass text-pass normal-case tracking-normal">Pass</span>
            <span className="chip tint-caution text-caution normal-case tracking-normal">Caution</span>
            <span className="chip tint-avoid text-avoid normal-case tracking-normal">Avoid</span>
            <span className="mono text-[11px] text-ink-faint">← good/bad</span>
            <span className="mx-2 text-ink-faint">·</span>
            <ProvenanceTag state={{ tier: "sourced" }} />
            <span className="mono text-[11px] text-ink-faint">← where it came from</span>
          </div>
        </div>

        <div className="mt-8">
          <p className="mono mb-3 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            The real panel, one fact per state
          </p>
          <BasicFactsPanel facts={FACTS} leads={LEADS} audience="founder" />
        </div>
      </div>
    </div>
  );
}
