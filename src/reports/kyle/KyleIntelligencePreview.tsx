import { useEffect } from "react";
import type { GithubAssessment } from "../../data/evidence";
import type { SocialActivitySnapshot } from "../../data/socialActivity";
import { ReportStickyTableOfContents, type ReportCanvasNavItem } from "../../components/ReportCanvasPrimitives";
import { KyleIntelligenceDecisionCanvas } from "./KyleIntelligenceDecisionCanvas";
import { KyleConnectionWorkspace } from "./KyleConnectionWorkspace";
import { KyleGithubSynthesis } from "./KyleGithubSynthesis";
import { KyleSocialSynthesis } from "./KyleSocialSynthesis";
import type { Dossier } from "../../data/dossier";

const socialPreview: SocialActivitySnapshot = {
  schemaVersion: 1,
  provider: "x-api-v2",
  state: "complete",
  capturedAt: "2026-08-26T12:00:00.000Z",
  sourceUrl: "https://x.com/search?q=fedi",
  queryBasis: { handle: "@fedibtc", projectName: "Fedi", query: "@fedibtc -is:retweet", excludesReposts: true },
  windows: {
    last24Hours: { start: "2026-08-25T12:00:00.000Z", end: "2026-08-26T12:00:00.000Z", postCount: 8, uniqueAccounts: 3, inspectedPosts: 8, authorCoverageComplete: true },
    previous24Hours: { start: "2026-08-24T12:00:00.000Z", end: "2026-08-25T12:00:00.000Z", postCount: 11, uniqueAccounts: 4, inspectedPosts: 11, authorCoverageComplete: true },
    last7Days: { start: "2026-08-19T12:00:00.000Z", end: "2026-08-26T12:00:00.000Z", postCount: 32, uniqueAccounts: 14, inspectedPosts: 32, authorCoverageComplete: true },
  },
  hourlyPostCounts: [],
  top10AccountSharePct: 72,
  activeDays: 5,
  activityScore: 24,
  scoreVersion: "social-activity-v1",
  collection: { countsRequestCompleted: true, searchRequests: 1, postReads: 32, maxPosts: 100, estimatedUsd: 0.1 },
  note: "Saved X search.",
  mentioners: [
    { postId: "1", handle: "@builder", text: "The Fedi wallet shipped a new privacy feature for community custody.", tweetUrl: "https://x.com/builder/status/1", createdAt: "2026-08-26T10:00:00.000Z", followers: 1200 },
    { postId: "2", handle: "@trader", text: "$FEDI could moon after this airdrop.", tweetUrl: "https://x.com/trader/status/2", createdAt: "2026-08-26T09:00:00.000Z", followers: 300 },
  ],
};

const githubPreview: GithubAssessment = {
  login: "fedibtc",
  confidence: "gold",
  publicRepos: 12,
  originalCount: 9,
  forkCount: 3,
  forkRatio: 0.25,
  totalStarsOnOriginals: 64,
  topLanguages: [{ language: "Rust", repos: 5 }],
  notableRepos: [],
  daysSinceActivity: 12,
  claimChecks: [],
  summary: "Recent original work is visible.",
};

const connectionPreviewDossier = {
  handle: "@anyonefdn",
  display_name: "ANyONe Protocol",
  resolved_name: "ANyONe Protocol",
  avatar: "A",
  avatar_url: "https://unavatar.io/x/anyonefdn",
  followers: "142K",
  report: { roles: ["PROJECT"] },
  graph: { nodes: [], edges: [] },
  webTeam: [
    { name: "Sergey Ilin", role: "Operations Lead", handle: "@SergeyIlin", source: "https://www.anyone.io/about-us", sourceUrl: "https://www.anyone.io/about-us", artifact_verified: true, avatarUrl: "https://unavatar.io/x/SergeyIlin" },
    { name: "Neuratic", role: "Operations & Product Lead", handle: "@neuratic", source: "https://www.anyone.io/about-us", sourceUrl: "https://www.anyone.io/about-us", artifact_verified: true, avatarUrl: "https://unavatar.io/x/neuratic" },
    { name: "Dr. Andrzej Tucholka", role: "Technical Advisor", source: "https://www.anyone.io/about-us", sourceUrl: "https://www.anyone.io/about-us", artifact_verified: true },
    { name: "Yurii Kovalchuk", role: "Engineer", source: "https://www.anyone.io/about-us", sourceUrl: "https://www.anyone.io/about-us", artifact_verified: true },
    { name: "Anon Morpho", role: "Strategy & Marketing Lead", source: "https://www.anyone.io/about-us", sourceUrl: "https://www.anyone.io/about-us", artifact_verified: true },
  ],
  projectToken: { verified: true, verification: "official_domain", name: "ANyONe Protocol", symbol: "ANYONE", rank: 1007, address: "0xFeAc2Eae96899709a43E252B6B92971D32F9C0F9", chain: "ethereum", sourceUrl: "https://docs.anyone.io/resources/token", capturedAt: "2026-08-27T00:00:00.000Z" },
} as unknown as Dossier;

const connectionPreviewNodes = [
  { type: "Company", key: "@anyonefdn", label: "ANyONe Protocol", subject: true },
  { type: "Person", key: "@SergeyIlin", label: "Sergey Ilin", role: "Operations Lead" },
  { type: "Person", key: "@neuratic", label: "Neuratic", role: "Operations & Product Lead" },
  { type: "Company", key: "EnigmaLand", label: "EnigmaLand" },
  { type: "Company", key: "Blixroute", label: "Blixroute" },
  { type: "Company", key: "rAEka Labs", label: "rAEka Labs" },
  { type: "Identity", subtype: "Wallet", key: "wallet:solana:9x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a", chain: "solana" },
  { type: "Identity", subtype: "Wallet", key: "wallet:ethereum:0x1f3a111111111111111111111111111111117b9e", chain: "ethereum" },
  { type: "Token", key: "token:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", label: "USDC", chain: "ethereum" },
];

const connectionPreviewEdges = [
  { src: "@anyonefdn", dst: "@SergeyIlin", type: "TEAM", source_url: "https://www.anyone.io/about-us" },
  { src: "@anyonefdn", dst: "@neuratic", type: "TEAM", source_url: "https://www.anyone.io/about-us" },
  { src: "@SergeyIlin", dst: "EnigmaLand", type: "WORKED_ON" },
  { src: "@neuratic", dst: "Blixroute", type: "WORKED_ON" },
  { src: "@neuratic", dst: "rAEka Labs", type: "WORKED_ON" },
  { src: "@anyonefdn", dst: "wallet:solana:9x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a", type: "CONTROLS_WALLET" },
  { src: "@anyonefdn", dst: "wallet:ethereum:0x1f3a111111111111111111111111111111117b9e", type: "CONTROLS_WALLET" },
  { src: "@anyonefdn", dst: "token:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", type: "LINKS" },
];

const previewNavItems: ReportCanvasNavItem[] = [
  { href: "#report-summary", label: "Decision" },
  { href: "#composition", label: "Score" },
  { href: "#dossier-product", label: "Web & product" },
  { href: "#identity-evidence", label: "People" },
  { href: "#social-activity", label: "Social" },
  { href: "#relationships", label: "Connections" },
  { href: "#evidence-ledger", label: "Evidence & method" },
];

export function KyleIntelligencePreview() {
  useEffect(() => {
    const previous = document.documentElement.dataset.reportLane;
    document.documentElement.dataset.reportLane = "kyle";
    return () => {
      if (previous) document.documentElement.dataset.reportLane = previous;
      else delete document.documentElement.dataset.reportLane;
    };
  }, []);

  return (
    <main className="min-h-screen bg-void px-5 py-8 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[1240px]" data-report-style="2">
        <ReportStickyTableOfContents items={previewNavItems} />
        <KyleIntelligenceDecisionCanvas
          subjectName="Fedi"
          subjectSummary="Fedi is a privacy-first Bitcoin wallet with chat, community custody, multispend accounts, and mini-app spaces designed for communities coordinating payments and local financial tools."
          reportSummary="Fedi clears ARGUS’s basic legitimacy tests, with named leadership, an active product, recent development activity and documented funding. Its result is governed primarily by limited independent validation around security, traction and partnerships, not by a major adverse event established in the current evidence."
          verdictLabel="Caution"
          score={55}
          scoreLabel="Project investigation"
          scoreContext="Team, product, token conduct, backers, traction and transparency."
          favorable={false}
          argument={{
            forLine: "Named leadership, a live wallet product, active repositories and documented funding establish operating credibility.",
            againstLine: "Independent security, adoption and partnership evidence remains limited.",
            moveLine: "A credible independent audit, verified adoption metrics, or evidence of an undocumented security incident would materially change the current assessment.",
          }}
          supports={[
            { label: "Leadership identity is strongly supported", detail: "Named founder Obi Nwosu, CTO Frank Hinek and multiple team members are tied to Fedi through source-backed role evidence." },
            { label: "The product is live and actively maintained", detail: "ARGUS verified the wallet product and active GitHub repositories with recent development activity." },
            { label: "Corporate identity is attributable", detail: "Fedi, Inc. is tied to the project through source-backed legal-entity evidence." },
          ]}
          concerns={[
            { label: "Independent security evidence is incomplete", detail: "ARGUS has not yet established a complete source-backed record of independent security reviews, incidents, losses or recovery events." },
            { label: "Funding is confirmed, but broader backer validation is limited", detail: "A $17M Series A is source-backed, while independent evidence on the wider investor and partnership network remains limited." },
            { label: "Usage remains difficult to independently validate", detail: "The product is live, but robust third-party adoption evidence remains thin." },
          ]}
          context={[
            { label: "Development is active, but external developer validation is modest", detail: "Recent original work is visible while repository adoption remains relatively limited." },
          ]}
          nextSteps={[
            { label: "Independent security review", detail: "A credible third-party audit or assessment would materially improve evidence quality." },
            { label: "Complete incident history", detail: "A documented record of material incidents or recovery events could raise or lower confidence." },
            { label: "Strong adoption evidence", detail: "Independent usage metrics would clarify whether current activity reflects meaningful traction." },
          ]}
          verified={[
            { label: "Project identity confirmed" },
            { label: "Live product confirmed" },
            { label: "Named leadership confirmed" },
          ]}
          coveragePercent={68}
          successful={7}
          applicable={7}
          capturedAt="Aug 26, 2026 · 2:13 PM"
          evidenceHref="#evidence-ledger"
          methodologyHref="#scan-methodology"
          challengeAnchorId="ask-report"
          checkScopeLabel="Required report checks"
          composition={[
            { axis: "team", label: "Team & leadership", score: 15, weight: 16, rationale: "Named founder, CTO and multiple team identities are supported by official and independent role evidence.", supportCount: 4 },
            { axis: "product", label: "Product & execution", score: 14, weight: 24, rationale: "A live wallet and active repositories are confirmed, while broader product-usage evidence remains limited.", supportCount: 2, questionCount: 1 },
            { axis: "backers", label: "Backers & partnerships", score: 8, weight: 14, rationale: "The $17M Series A is source-backed, but independent investor and partnership validation remains thin.", supportCount: 1, questionCount: 1 },
            { axis: "traction", label: "Traction & usage", score: 8, weight: 14, rationale: "Current operation is established, but independent adoption evidence remains limited.", supportCount: 2, questionCount: 2 },
            { axis: "transparency", label: "Transparency & integrity", score: 7, weight: 12, rationale: "Corporate identity and official surfaces are attributable, with several third-party questions still open.", supportCount: 2, questionCount: 1 },
            { axis: "token", label: "Token design & conduct", score: 3, weight: 20, rationale: "No canonical project token was established in this saved report.", supportCount: 1 },
          ]}
          secondaryScore={{
            label: "Token safety score",
            score: 84,
            verdictLabel: "Pass",
            context: "Contract, tradeability, liquidity, holders, market data and sanctions.",
            successful: 7,
            applicable: 7,
            checkScopeLabel: "Token safety checks",
            composition: [
              { axis: "onchain", label: "Onchain health", score: 12, weight: 14, rationale: "The saved contract checks found no critical control issue.", supportCount: 3 },
              { axis: "holders", label: "The holders", score: 10, weight: 14, rationale: "Holder evidence met the saved safety threshold.", supportCount: 2 },
              { axis: "token", label: "The token", score: 12, weight: 14, rationale: "Token mechanics and transfer behavior were measurable.", supportCount: 3 },
              { axis: "code", label: "Code & security", score: 19, weight: 24, rationale: "Automated contract checks were completed without a critical finding.", supportCount: 4 },
              { axis: "liquidity", label: "The liquidity", score: 18, weight: 20, rationale: "The saved market showed a measurable liquidity surface.", supportCount: 2 },
              { axis: "maturity", label: "Maturity & presence", score: 13, weight: 14, rationale: "The token and project surfaces were consistently linked.", supportCount: 3 },
            ],
          }}
        />
        <div data-report-experience-shell="true" className="space-y-10 py-16">
          <section id="dossier-product" className="story-chapter report-section scroll-mt-28" aria-labelledby="preview-product-title">
            <p className="eyebrow text-signal-lift">Web &amp; product</p>
            <h2 id="preview-product-title" className="story-chapter-title mt-2 text-ink">A live Bitcoin wallet built around private community coordination.</h2>
            <p className="story-chapter-description mt-3 max-w-3xl text-ink-dim">ARGUS keeps the official website, product surfaces, legal entity, funding record, and development evidence together here. The editorial conclusion sits above the same underlying checks and source links.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="panel p-4"><p className="eyebrow">Product</p><strong className="mt-2 block text-ink">Wallet, chat and community spaces</strong><p className="mt-2 text-[13px] leading-relaxed text-ink-dim">Community custody, multispend accounts and mini-app spaces are described on the live product surface.</p></div>
              <div className="panel p-4"><p className="eyebrow">Company</p><strong className="mt-2 block text-ink">Fedi, Inc.</strong><p className="mt-2 text-[13px] leading-relaxed text-ink-dim">A source-backed legal entity and a documented $17M Series A remain in the complete record.</p></div>
              <div className="panel p-4"><p className="eyebrow">Development</p><strong className="mt-2 block text-ink">Active original work</strong><p className="mt-2 text-[13px] leading-relaxed text-ink-dim">Recent repositories establish maintenance more clearly than ecosystem adoption.</p></div>
            </div>
            <KyleGithubSynthesis assessment={githubPreview} />
          </section>

          <section id="identity-evidence" className="story-chapter report-section scroll-mt-28" aria-labelledby="preview-people-title">
            <header className="report-section-heading">
              <div><p className="eyebrow text-signal-lift">People &amp; control</p><h2 id="preview-people-title" className="story-chapter-title mt-2 text-ink">Named leadership first. The complete roster remains underneath.</h2><p className="story-chapter-description mt-2 max-w-3xl text-ink-dim">The Kyle layer summarizes the team without deleting identity cards, role sources, continuity checks, or unresolved candidates.</p></div>
              <span className="verdict-pill tint-signal">11 verified · 3 to verify</span>
            </header>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                ["ON", "Obi Nwosu", "Founder", "Source-backed leadership identity"],
                ["FH", "Frank Hinek", "CTO", "Current technical leadership"],
                ["JM", "Justin Moon", "Cofounder", "Additional role verification open"],
              ].map(([initials, name, role, note]) => (
                <article key={name} className="panel flex gap-3 p-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-panel-2 text-[12px] font-semibold text-ink">{initials}</span>
                  <span><strong className="block text-ink">{name}</strong><small className="mt-0.5 block text-ink-dim">{role}</small><span className="mt-2 block text-[12px] leading-relaxed text-ink-faint">{note}</span></span>
                </article>
              ))}
            </div>
            <details open className="kyle-people-disclosure"><summary><span><strong>Complete people and control record</strong><small>Profiles, source links, continuity checks and unresolved leadership claims stay in the report.</small></span><span className="mono">14 records</span></summary><div className="panel p-4 text-[13px] leading-relaxed text-ink-dim">In a saved report, every original identity card and its underlying evidence renders here. This preview shows the presentation hierarchy without substituting fixture names for live scan evidence.</div></details>
          </section>

          <section id="social-activity" className="story-chapter report-section scroll-mt-28" aria-labelledby="preview-social-title">
            <p className="eyebrow text-signal-lift">Social activity</p>
            <h2 id="preview-social-title" className="story-chapter-title mt-2 text-ink">Interpretation first. Raw matched posts still follow.</h2>
            <KyleSocialSynthesis snapshot={socialPreview} />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(socialPreview.mentioners ?? []).map((post) => <article key={post.postId} className="panel p-4"><strong className="text-ink">{post.handle}</strong><p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{post.text}</p><a className="link-ext mt-3 inline-flex text-[12px]" href={post.tweetUrl}>Open source post</a></article>)}
            </div>
          </section>

          <section id="relationships" className="story-chapter report-section scroll-mt-28" aria-labelledby="preview-connections-title">
            <h2 id="preview-connections-title" className="sr-only">Connections</h2>
            <KyleConnectionWorkspace dossier={connectionPreviewDossier} nodes={connectionPreviewNodes} edges={connectionPreviewEdges} connections={[]} onAudit={() => undefined} onOpenProject={() => undefined} previewBalance={49_975} />
          </section>
        </div>
        <section id="evidence-ledger" className="story-chapter report-section scroll-mt-28 border-t border-line py-20"><p className="eyebrow text-signal-lift">Evidence &amp; method</p><h2 className="story-chapter-title mt-2 text-ink">The full forensic record is still the foundation.</h2><p className="story-chapter-description mt-2 max-w-3xl text-ink-dim">Saved sources, source problems, frozen evidence, scoring methodology and unanswered research questions remain available here.</p></section>
        <section id="scan-methodology" className="border-t border-line py-20"><p className="eyebrow">Methodology preview anchor</p></section>
        <section id="ask-report" className="border-t border-line py-20"><p className="eyebrow">Challenge preview anchor</p></section>
      </div>
    </main>
  );
}
