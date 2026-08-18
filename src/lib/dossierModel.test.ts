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
    expect(chain).toContainEqual(["Bound to this subject", "never"]);
    expect(chain).toContainEqual(["Artifact verified", "04:52:55"]);
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
    expect(dossier.beats.find((b) => b.id === "product")!.heading).toBe("2 confirmed, 1 still open.");
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
    expect(coverage.heading).toBe("3 leads, 1 open check, 2 providers that never answered.");
  });
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
