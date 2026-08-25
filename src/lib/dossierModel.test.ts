import { describe, expect, it } from "vitest";
import { buildDossier } from "./dossierModel";

const subject = {
  handle: "@dynexcoin",
  display_name: "Dynex",
  website: "https://dynexcoin.org/",
  joined: "Sep 2022",
  followers: "39.4K",
  headline: "Dynex shows a publicly identifiable team…",
  report: { verdict: "CAUTION", score_total: 63 },
};

const source = (url: string, excerpt: string) => ({
  url, excerpt, relation: "supports", artifactVerified: true,
  capturedAt: "2026-08-16T04:52:55.451Z", sourceClass: "regulatory_or_onchain",
});

describe("dossier model", () => {
  it("refuses to treat a shared display name as binding evidence", () => {
    // The four SEC filings behind the live @dynexcoin report say "Dynex Capital,
    // Inc., a Virginia corporation" and nothing else about the subject. The
    // string "Dynex" appears in all of them, which is exactly why the display
    // name must not count: it is the collision, not the confirmation.
    const dossier = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "legal_entity", value: "Dynex Capital, Inc.", status: "verified",
        sources: [
          source("https://www.sec.gov/Archives/edgar/data/826675/a.htm", "…by Dynex Capital, Inc., a Virginia corporation…"),
          source("https://www.sec.gov/Archives/edgar/data/826675/b.htm", "…by Dynex Capital, Inc., a Virginia corporation…"),
        ],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });

    const perimeter = dossier.beats.find((b) => b.id === "perimeter")!;
    const entity = perimeter.figures[0];
    expect(entity.provenance.tier).toBe("unestablished");
    expect(entity.unboundNote).toContain("sec.gov");
    expect(entity.unboundNote).toContain("none naming this subject");
    expect(perimeter.heading).toBe("Dynex Capital, Inc. belongs to someone else.");
  });

  it("demotes a fact the ledger called verified when nothing binds it", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "legal_entity", value: "Someone Else Ltd", status: "verified",
        sources: [source("https://registry.example/filing", "Someone Else Ltd is a company.")],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    // The declared status was the strongest available; binding overrides it.
    expect(dossier.beats.find((b) => b.id === "perimeter")!.figures[0].provenance.tier).toBe("unestablished");
  });

  it("binds on the subject's own host and on its handle, not on its name", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [
        { predicate: "product", value: "Dynex Marketplace", status: "verified",
          sources: [source("https://dynexcoin.org/roadmap", "Since the launch of the Dynex Marketplace…")] },
        { predicate: "repository", value: "github.com/dynexcoin", status: "verified",
          sources: [source("https://github.com/dynexcoin", "GitHub github.com/dynexcoin links back to this X handle.")] },
      ],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    const product = dossier.beats.find((b) => b.id === "product")!;
    expect(product.figures.map((f) => f.provenance.tier)).toEqual(["sourced", "sourced"]);
    expect(product.figures.every((f) => f.unboundNote === null)).toBe(true);
    expect(product.heading).toBe("1 product is on file. 1 repository is on file.");
  });

  it("records a missing binding step as 'never' in the chain of custody", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "legal_entity", value: "Dynex Capital, Inc.", status: "verified",
        sources: [source("https://www.sec.gov/Archives/edgar/data/826675/a.htm", "…a Virginia corporation…")],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    const chain = dossier.beats.find((b) => b.id === "perimeter")!.figures[0].receipt!.chain;
    expect(chain).toEqual([
      ["Fetched", "04:52:55"],
      ["Bound to this subject", "never"],
    ]);
    expect(chain.filter(([, when]) => when === "04:52:55")).toHaveLength(1);
  });

  it("states counts rather than characterising what open checks mean", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [],
      checkRuns: [
        { checkId: "project-product-substance", label: "Product", status: "confirmed" },
        { checkId: "code-footprint-github", label: "Code", status: "confirmed" },
        { checkId: "project-transparency", label: "Disclosures", status: "unknown" },
        { checkId: "us-legal-history", label: "Legal", status: "not-applicable" },
      ],
      basicFactLeads: [], providerFailures: [],
    });
    // not-applicable is excluded entirely; it is not an open question.
    expect(dossier.beats.find((b) => b.id === "product")!.heading)
      .toBe("A live product was verified. No product name or repository was recorded.");
  });

  it("never turns an unbound network name into a Product headline", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "network", value: "Robinhood", status: "verified",
        sources: [source("https://example.com/robinhood", "Robinhood is a network.")],
      }],
      checkRuns: [{ checkId: "project-product-substance", label: "Product", status: "unknown" }],
      basicFactLeads: [], providerFailures: [],
    });

    const heading = dossier.beats.find((b) => b.id === "product")!.heading;
    expect(heading).toBe("No product or repository was verified in this section.");
    expect(heading).not.toContain("belongs to someone else");
  });

  it("names a first-party creator as a creator instead of a generic person", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [], checkRuns: [{ checkId: "project-team-identity", status: "confirmed" }],
      basicFactLeads: [], providerFailures: [],
      webTeamLeads: [{
        name: "Tharmas", role: "creator", handle: "@0xTharmas",
        handleProvenance: "subject_first_party", artifactVerified: true,
      }],
    });

    expect(dossier.beats.find((b) => b.id === "team")!.heading)
      .toBe("The project named 1 creator. 1 is independently confirmed.");
  });

  it("summarises unresolved coverage from leads, open checks and dead providers", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [],
      checkRuns: [{ checkId: "adverse-screen", label: "Adverse sweep", status: "unavailable" }],
      basicFactLeads: [{}, {}, {}],
      providerFailures: [{}, {}],
    });
    const coverage = dossier.beats.find((b) => b.id === "coverage")!;
    expect(coverage.heading).toBe("3 leads. 1 research question still needs evidence.");
  });

  it("does not call a completed no-result search an open question", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [],
      checkRuns: [{ checkId: "supplemental-search", label: "Supplemental search", status: "checked-empty" }],
      basicFactLeads: [], providerFailures: [],
    });

    expect(dossier.beats.find((b) => b.id === "coverage")!.heading)
      .toBe("0 leads. No research questions still need evidence.");
    expect(dossier.openQuestions).toEqual([]);
  });

  it("keeps the coverage heading count aligned with the open-question list", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [],
      checkRuns: [{ checkId: "supplemental-search", label: "Supplemental search", status: "checked-empty" }],
      basicFactLeads: [],
      providerFailures: [],
      intelligence: {
        signals: [{
          kind: "coverage_gap",
          finding: "The frozen scoring analyst recorded 4 unresolved questions: who operates the project.",
        }],
      },
      researchPlan: {
        tasks: [
          { capability: "people_and_control", state: "unavailable", question: "Who operates and controls the project?" },
          { capability: "project_fundamentals", state: "partial", question: "Is there a live product?" },
          { capability: "token_and_market", state: "planned", question: "What is the official token?" },
          { capability: "legal_and_adverse", state: "unavailable", question: "Are there verified legal actions?" },
          { capability: "analyst_synthesis", state: "partial", question: "What conclusion follows?" },
        ],
      },
    });
    const coverage = dossier.beats.find((b) => b.id === "coverage")!;
    const count = dossier.openQuestions.length;

    expect(count).toBeGreaterThan(0);
    expect(coverage.heading).toBe(`0 leads. ${count} research questions still need evidence.`);
    expect(coverage.heading).not.toContain("No research questions still need evidence");
    expect(dossier.openQuestions.join(" ")).not.toMatch(/frozen scoring analyst|scorer-packet|fail-closed/i);
  });

  it("does not print unbound aggregator funding as a raised figure or led-by", () => {
    // Display name is not a bind key. A DeFiLlama /protocol/{name} slug is the
    // same namesake collision as Dynex Capital on the SEC filings: it must not
    // become a raised figure or a "led by" on this subject.
    const dossier = buildDossier({
      handle: "@satoshi_builds",
      display_name: "Uniswap",
      website: null,
      report: { verdict: "PASS", score_total: 80 },
      basicFacts: [{
        predicate: "funding", value: "Series B", status: "corroborated",
        sources: [{
          url: "https://news.example/2022/10/13/uniswap-series-b",
          title: "Uniswap Labs Raises $165M in Polychain Capital-Led Round",
          excerpt: "Uniswap Labs raised $165 million in a Series B led by Polychain Capital.",
          relation: "supports", sourceClass: "independent_press", artifactVerified: true,
          capturedAt: "2026-07-23T19:43:00.102Z",
        }],
      }, {
        predicate: "funding",
        value: "2 public funding rounds · $11.0M raised · led by BlackRock",
        status: "verified",
        providerProjection: true,
        sources: [{
          url: "https://defillama.com/protocol/uniswap",
          title: "DeFiLlama funding record",
          excerpt: "Uniswap raised $11.0M across 2 public funding rounds, led by BlackRock.",
          provider: "defillama",
          relation: "supports", sourceClass: "other_public", artifactVerified: true,
          capturedAt: "2026-07-23T19:43:00.102Z",
        }],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    const text = JSON.stringify(dossier);
    expect(text).not.toContain("BlackRock");
    expect(text).not.toContain("2 public funding rounds");
    expect(text).not.toContain("$11.0M");
    const activity = dossier.beats.find((b) => b.id === "activity");
    expect(activity?.figures.some((f) => f.label === "funding" && f.value === "Series B")).toBe(true);
    expect(activity?.heading).toBe("No bound funding is on file.");
    expect(activity?.heading).not.toMatch(/BlackRock|led by|\$11/);
  });
});


  it("treats a conflicted bound fact as sourced and contested", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "product", value: "Dynex Marketplace", status: "conflicted",
        sources: [source("https://dynexcoin.org/roadmap", "Since the launch of the Dynex Marketplace…")],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    const fig = dossier.beats.find((b) => b.id === "product")!.figures[0];
    expect(fig.provenance).toEqual({ tier: "sourced", contested: true });
    expect(fig.unboundNote).toBeNull();
  });

describe("team enrichment boundary", () => {
  const withTeam = (leads: Array<Record<string, unknown>>) => buildDossier({
    ...subject, basicFacts: [], checkRuns: [], basicFactLeads: [], providerFailures: [],
    webTeamLeads: leads,
  });

  it("keeps a face on a person the subject's own account named", () => {
    const [m] = withTeam([{
      name: "@DynexMoonshots", role: "co-founder", handle: "@DynexMoonshots",
      handleProvenance: "subject_first_party",
      avatarUrl: "https://pbs.twimg.com/x.jpg", avatarCapturedAt: "2026-08-16T04:51:31.270Z",
    }]).team;
    expect(m.firstParty).toBe(true);
    expect(m.independentlyConfirmed).toBe(false);
    expect(m.avatarUrl).toBe("https://pbs.twimg.com/x.jpg");
    expect(m.avatarCapturedAt).toBe("2026-08-16T04:51:31.270Z");
  });

  it("recognises a handle bound through the following or amplification lane", () => {
    // The collector marks these first-party too. An earlier draft matched the
    // source string for "post role-scan" and would have dropped their avatars.
    const [m] = withTeam([{
      name: "@proph3ttt", role: "advisor", handle: "@proph3ttt",
      handleProvenance: "subject_first_party", source: "amplification edge",
      avatarUrl: "https://pbs.twimg.com/y.jpg", avatarCapturedAt: "2026-08-16T04:51:31.270Z",
    }]).team;
    expect(m.firstParty).toBe(true);
    expect(m.avatarUrl).toBe("https://pbs.twimg.com/y.jpg");
  });

  it("refuses a face on a person found only by web search, even when one is offered", () => {
    // Attaching a photograph to a handle nobody confirmed is the namesake error
    // in a more persuasive form: the reader now has a face to trust.
    const [m] = withTeam([{
      name: "Daniela Herrmann", role: "CEO & Co-Founder",
      source: "web/LinkedIn search", avatarUrl: "https://example.org/someone.jpg",
      avatarCapturedAt: "2026-08-16T04:51:31.270Z",
    }]).team;
    expect(m.firstParty).toBe(false);
    expect(m.independentlyConfirmed).toBe(false);
    expect(m.avatarUrl).toBeNull();
    expect(m.avatarCapturedAt).toBeNull();
  });
});

describe("live report field names", () => {
  it("reads composite_verdict and governing_score when the fixture pair is absent", () => {
    const dossier = buildDossier({
      handle: "@clutchmarkets",
      display_name: "CLUTCH",
      website: "https://clutch.markets/",
      report: { composite_verdict: "CAUTION", governing_score: 61 },
      basicFacts: [],
      checkRuns: [],
      basicFactLeads: [],
      providerFailures: [],
    });
    expect(dossier.verdict.call).toBe("CAUTION");
    expect(dossier.verdict.score).toBe(61);
    expect(dossier.beats.find((b) => b.id === "verdict")!.heading).toBe("CAUTION · 61/100");
  });

  it("unions grounded webTeam without inventing first-party from a face or a name", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [],
      checkRuns: [],
      basicFactLeads: [],
      providerFailures: [],
      webTeam: [{
        name: "Official Site Person",
        role: "Engineer",
        avatarUrl: "https://example.org/face.jpg",
        artifact_verified: true,
        evidence_origin: "deterministic",
      }],
    });
    expect(dossier.team).toHaveLength(1);
    expect(dossier.team[0].firstParty).toBe(false);
    expect(dossier.team[0].independentlyConfirmed).toBe(true);
    expect(dossier.team[0].avatarUrl).toBeNull();
  });

  it("never hardcodes the Loom fiction line", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [],
      checkRuns: [],
      basicFactLeads: [],
      providerFailures: [],
    });
    const text = JSON.stringify(dossier);
    expect(text).not.toContain("Fourteen people");
    expect(text).not.toContain("Nine of them proven");
  });
});

describe("count-true headings", () => {
  it("names the audited handle and whether an official site is bound", () => {
    const bound = buildDossier({
      handle: "@alice",
      display_name: "Alice Project",
      website: "https://alice.example/",
      report: { verdict: "PASS", score_total: 70 },
      basicFacts: [],
      checkRuns: [{ checkId: "identity-resolution", label: "Identity", status: "confirmed", note: "Posting steady (~2.0d gap, last post 12d ago)" }],
      basicFactLeads: [],
      providerFailures: [],
    });
    expect(bound.beats.find((b) => b.id === "subject")!.heading).toBe("This is the @alice we audited. The site is bound.");
    expect(bound.beats.find((b) => b.id === "subject")!.heading).not.toContain("Posting steady");
    expect(bound.beats.find((b) => b.id === "subject")!.heading).not.toContain("Alice Project");

    const unbound = buildDossier({
      handle: "@alice",
      display_name: "Alice Project",
      website: null,
      report: { verdict: "PASS", score_total: 70 },
      basicFacts: [],
      checkRuns: [{ checkId: "identity-resolution", label: "Identity", status: "confirmed" }],
      basicFactLeads: [],
      providerFailures: [],
    });
    expect(unbound.beats.find((b) => b.id === "subject")!.heading).toBe("This is the @alice we audited. No official site is bound.");
  });

  it("splits first-party naming from independent confirmation on the team beat", () => {
    const oneNamed = buildDossier({
      handle: "@alice",
      display_name: "Alice Project",
      website: "https://alice.example/",
      report: { verdict: "CAUTION", score_total: 50 },
      basicFacts: [],
      checkRuns: [{ checkId: "project-team-identity", label: "Team", status: "confirmed", note: "Two people named on the official site." }],
      basicFactLeads: [],
      providerFailures: [],
      webTeamLeads: [{
        name: "Ada", role: "founder", handle: "@ada",
        handleProvenance: "subject_first_party",
      }],
    });
    expect(oneNamed.beats.find((b) => b.id === "team")!.heading).toBe("The project named 1 founder. Nobody else confirmed them.");
    expect(oneNamed.beats.find((b) => b.id === "team")!.heading).not.toContain("Two people named");

    const mixed = buildDossier({
      handle: "@alice",
      display_name: "Alice Project",
      website: "https://alice.example/",
      report: { verdict: "CAUTION", score_total: 50 },
      basicFacts: [],
      checkRuns: [{ checkId: "project-team-identity", label: "Team", status: "confirmed" }],
      basicFactLeads: [],
      providerFailures: [],
      webTeamLeads: [
        { name: "Ada", role: "engineer", handle: "@ada", handleProvenance: "subject_first_party" },
        { name: "Bea", role: "engineer", handle: "@bea", handleProvenance: "subject_first_party" },
        { name: "Cara", role: "engineer", handle: "@cara", handleProvenance: "subject_first_party", artifact_verified: true },
      ],
    });
    expect(mixed.beats.find((b) => b.id === "team")!.heading).toBe("The project named 3 people. 1 is independently confirmed.");
    expect(JSON.stringify(mixed)).not.toContain("Fourteen people");
    expect(JSON.stringify(mixed)).not.toContain("Nine of them proven");
  });

  it("renders one person when search and first-party labels resolve to Jun Song", () => {
    const dossier = buildDossier({
      handle: "@0xsupergemma",
      display_name: "SuperGemma",
      website: "https://supergemma.example/",
      report: { verdict: "INCOMPLETE", score_total: null },
      basicFacts: [],
      checkRuns: [{ checkId: "project-team-identity", label: "Team", status: "confirmed" }],
      basicFactLeads: [],
      providerFailures: [],
      webTeamLeads: [{
        name: "Jun Song Independent",
        role: "builder",
        artifact_verified: true,
      }],
      webTeam: [{
        name: "Jun Song",
        handle: "@jun_song",
        role: "builder",
        handleProvenance: "subject_first_party",
        avatarUrl: "https://pbs.twimg.com/jun.jpg",
      }],
    });

    expect(dossier.team).toEqual([
      expect.objectContaining({
        name: "Jun Song",
        role: "builder",
        firstParty: true,
        independentlyConfirmed: true,
        avatarUrl: "https://pbs.twimg.com/jun.jpg",
      }),
    ]);
    expect(dossier.beats.find((beat) => beat.id === "team")?.heading)
      .toBe("The project named 1 person. 1 is independently confirmed.");
  });

  it("keeps the recorded verdict call and does not invent a thesis", () => {
    const dossier = buildDossier({
      handle: "@alice",
      display_name: "Alice Project",
      website: null,
      headline: "A Grok forensic thesis about the operator graph.",
      report: { verdict: "CAUTION", score_total: 61 },
      basicFacts: [],
      checkRuns: [],
      basicFactLeads: [],
      providerFailures: [],
    });
    expect(dossier.beats.find((b) => b.id === "verdict")!.heading).toBe("CAUTION · 61/100");
    expect(dossier.beats.find((b) => b.id === "verdict")!.heading).not.toContain("operator graph");
  });
});

describe("dossier sources and receipts", () => {
  it("emits source rows with citation counts from two facts on one URL and one on another", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [
        { predicate: "product", value: "Dynex Marketplace", status: "verified",
          sources: [source("https://dynexcoin.org/docs", "Since the launch of the Dynex Marketplace…")] },
        { predicate: "repository", value: "github.com/dynexcoin", status: "verified",
          sources: [source("https://dynexcoin.org/docs?utm=preview", "Repository listed on the same document.")] },
        { predicate: "traction", value: "posts daily", status: "verified",
          sources: [source("https://x.com/dynexcoin/status/1", "The @dynexcoin account posts daily.")] },
      ],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    expect(dossier.sources).toHaveLength(2);
    expect(dossier.sources[0]).toMatchObject({
      label: "dynexcoin.org · regulatory_or_onchain",
      factsCited: 2,
      lastCaptured: "04:52:55",
      citedLabels: ["product", "repository"],
      established: true,
    });
    expect(dossier.sources[1]).toMatchObject({
      label: "x.com · regulatory_or_onchain",
      factsCited: 1,
      citedLabels: ["traction"],
      established: true,
    });
    expect(dossier.sources.map((s) => s.url).every((url) => url.startsWith("http"))).toBe(true);
  });

  it("keeps one Fetched clock and records bind state without inventing custody times", () => {
    const bound = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "product", value: "Dynex Marketplace", status: "verified",
        sources: [source("https://dynexcoin.org/roadmap", "Since the launch of the Dynex Marketplace…")],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    expect(bound.beats.find((b) => b.id === "product")!.figures[0].receipt!.chain).toEqual([
      ["Fetched", "04:52:55"],
      ["Bound to this subject", "recorded"],
    ]);
  });

  it("lists every supporting source on the receipt, bound document first", () => {
    const dossier = buildDossier({
      ...subject,
      basicFacts: [{
        predicate: "product", value: "Dynex Marketplace", status: "verified",
        sources: [
          source("https://www.sec.gov/Archives/edgar/data/826675/a.htm", "Unrelated filing."),
          source("https://dynexcoin.org/roadmap", "Since the launch of the Dynex Marketplace…"),
        ],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    const receipt = dossier.beats.find((b) => b.id === "product")!.figures[0].receipt!;
    expect(receipt.sources).toHaveLength(2);
    expect(receipt.url).toBe("https://dynexcoin.org/roadmap");
    expect(receipt.sources[0].url).toBe("https://dynexcoin.org/roadmap");
    expect(receipt.sources[1].url).toBe("https://www.sec.gov/Archives/edgar/data/826675/a.htm");
  });

  it("does not invent a source row for skipped aggregator funding", () => {
    const dossier = buildDossier({
      handle: "@satoshi_builds",
      display_name: "Uniswap",
      website: null,
      report: { verdict: "PASS", score_total: 80 },
      basicFacts: [{
        predicate: "funding",
        value: "2 public funding rounds · $11.0M raised · led by BlackRock",
        status: "verified",
        providerProjection: true,
        sources: [{
          url: "https://defillama.com/protocol/uniswap",
          title: "DeFiLlama funding record",
          excerpt: "Uniswap raised $11.0M across 2 public funding rounds, led by BlackRock.",
          provider: "defillama",
          relation: "supports", sourceClass: "other_public", artifactVerified: true,
          capturedAt: "2026-07-23T19:43:00.102Z",
        }],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    expect(JSON.stringify(dossier)).not.toContain("BlackRock");
    expect(dossier.sources).toEqual([]);
  });
});
