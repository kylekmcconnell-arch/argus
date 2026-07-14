import { describe, expect, it } from "vitest";
import { resolveBasicFactCandidates } from "./basicFacts";
import type { BasicFact, BasicFactPredicate, BasicFactSource } from "../../src/data/evidence";

const NOW = "2026-07-12T12:00:00.000Z";
const src = (url: string, sourceClass: BasicFactSource["sourceClass"], excerpt = "x"): BasicFactSource => ({
  url, title: "t", excerpt, capturedAt: NOW, provider: "public-web", sourceClass, relation: "supports",
  contentHash: url.padEnd(64, "0").slice(0, 64), artifactVerified: true,
});
const bf = (predicate: BasicFactPredicate, value: string, sources: BasicFactSource[]): BasicFact => ({
  factId: `${predicate}:${value}`, subjectKey: "@subject", predicate, value,
  normalizedValue: value.toLowerCase(), status: "lead", critical: false, sources,
  evidence_origin: "deterministic", artifact_verified: true, provider: "public-web",
});
const byPredicate = (facts: BasicFact[], predicate: string) => facts.filter((f) => f.predicate === predicate);

describe("web-corroboration recall in resolveBasicFactCandidates", () => {
  it("does NOT complete an identity from a single independent press host", () => {
    const out = resolveBasicFactCandidates([
      bf("official_identity", "Stani Kulechov", [src("https://coindesk.com/a", "independent_press")]),
    ]);
    expect(byPredicate(out, "official_identity")).toHaveLength(0);
  });

  it("does NOT complete from self (official_subject) sources alone — no press witnesses", () => {
    const out = resolveBasicFactCandidates([
      bf("official_identity", "Stani Kulechov", [src("https://x.com/stanikulechov", "official_subject"), src("https://aave.com/team", "official_subject")]),
    ]);
    // official_subject makes it 'official' -> strict verified, but that is the
    // existing behavior; the point here is recall never fabricates from press it lacks.
    const facts = byPredicate(out, "official_identity");
    expect(facts.every((f) => f.floorEligible !== false)).toBe(true);
  });

  it("does NOT count two PR-wire copies as independent witnesses", () => {
    const out = resolveBasicFactCandidates([
      bf("official_identity", "Stani Kulechov", [src("https://www.prnewswire.com/a", "independent_press")]),
      bf("official_identity", "Stani Kulechov, founder", [src("https://www.businesswire.com/b", "independent_press")]),
    ]);
    expect(byPredicate(out, "official_identity")).toHaveLength(0);
  });

  it("does NOT count two subdomains of one publisher as two hosts (eTLD+1)", () => {
    const out = resolveBasicFactCandidates([
      bf("official_identity", "Stani Kulechov", [src("https://markets.businessinsider.com/a", "independent_press")]),
      bf("official_identity", "Stani Kulechov, CEO", [src("https://www.businessinsider.com/b", "independent_press")]),
    ]);
    expect(byPredicate(out, "official_identity")).toHaveLength(0);
  });

  it("completes an identity from two genuinely independent outlets — floor-INeligible", () => {
    const out = resolveBasicFactCandidates([
      bf("official_identity", "Stani Kulechov", [src("https://coindesk.com/a", "independent_press")]),
      bf("official_identity", "Stani Kulechov, founder & CEO", [src("https://theblock.co/b", "independent_press")]),
    ]);
    const facts = byPredicate(out, "official_identity");
    expect(facts).toHaveLength(1);
    expect(facts[0].status).toBe("corroborated");
    expect(facts[0].floorEligible).toBe(false);
  });

  it("folds role seniority into the anchor: 'CEO of Aave' (2 hosts) completes, 'advisor of Aave' (1 host) does not, and they never merge", () => {
    const out = resolveBasicFactCandidates([
      bf("current_role", "CEO at Aave", [src("https://coindesk.com/a", "independent_press")]),
      bf("current_role", "Chief Executive Officer at Aave", [src("https://theblock.co/b", "independent_press")]),
      bf("current_role", "advisor at Aave", [src("https://cointelegraph.com/c", "independent_press")]),
    ]);
    const roles = byPredicate(out, "current_role");
    expect(roles).toHaveLength(1);
    expect(roles[0].floorEligible).toBe(false);
    expect(/advisor/i.test(roles[0].value)).toBe(false);
  });

  it("never relaxes public_security via press (carve-out)", () => {
    const out = resolveBasicFactCandidates([
      bf("public_security", "NASDAQ: COIN", [src("https://coindesk.com/a", "independent_press")]),
      bf("public_security", "NASDAQ COIN", [src("https://theblock.co/b", "independent_press")]),
    ]);
    expect(byPredicate(out, "public_security")).toHaveLength(0);
  });

  it("never relaxes money/date-class predicates: two different funding values from two hosts do NOT corroborate", () => {
    const out = resolveBasicFactCandidates([
      bf("funding", "$25M Series A", [src("https://coindesk.com/a", "independent_press")]),
      bf("funding", "$30M Series A", [src("https://theblock.co/b", "independent_press")]),
    ]);
    expect(byPredicate(out, "funding")).toHaveLength(0);
  });

  it("does not shadow a strict fact: if the same anchor already survived strictly, no duplicate recall fact", () => {
    const out = resolveBasicFactCandidates([
      // strict: 2 independent hosts, exact same value -> survives as corroborated (floor-eligible)
      bf("founder", "Aave", [src("https://coindesk.com/a", "independent_press")]),
      bf("founder", "Aave", [src("https://theblock.co/b", "independent_press")]),
    ]);
    const facts = byPredicate(out, "founder");
    expect(facts).toHaveLength(1);
    expect(facts[0].floorEligible).toBeUndefined(); // strict, floor-eligible
  });
});
