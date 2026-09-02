import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { emptyEvidence, type CollectedEvidence, type EntityContinuitySnapshot } from "../src/data/evidence";
import type { ScanCheck } from "../src/lib/scanChecklist";
import { deriveTokenApplicability } from "./tokenApplicability";

const tokenCheck = (status: ScanCheck["status"], note: string): ScanCheck => ({
  checkId: "project-token-identity",
  label: "Project token identity",
  status,
  note,
});

const project = (handle: string, what: string): CollectedEvidence => {
  const evidence = emptyEvidence(handle);
  evidence.roles = [SubjectClass.PROJECT];
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.website = `https://${handle.replace(/^@/, "")}.example`;
  evidence.subjectOrientation = {
    kind: "PROJECT",
    what,
    audience: "",
    boundHandle: handle,
    boundDomain: evidence.profile.website,
    sourceUrls: [evidence.profile.website],
  };
  return evidence;
};

const anyoneLineage = (): EntityContinuitySnapshot => ({
  subject: "ANyONe Protocol",
  historicalAliases: ["ATOR Protocol"],
  predecessorName: "ATOR Protocol",
  oldTicker: "ATOR",
  oldContract: "0xator",
  migrationRatio: "1:1",
  migrationDate: "2024-07-01",
  replacementContract: "0xanyone",
  migrationContract: null,
  currentStatus: "ANYONE token live",
  architectureChanges: [],
  exchangeHandling: ["Exchanges completed the swap"],
  tokenLineage: [
    { name: "ATOR", ticker: "ATOR", contract: "0xator", chain: "ethereum", status: "predecessor", validFrom: null, validTo: "2024-07-01", sourceUrls: [] },
    { name: "ANYONE", ticker: "ANYONE", contract: "0xanyone", chain: "ethereum", status: "current", validFrom: "2024-07-01", validTo: null, sourceUrls: [] },
  ],
  events: [],
  sources: [],
  aliasSearches: [],
  marketHistory: [],
  coverage: {
    required: true,
    state: "complete",
    reason: "ATOR to ANYONE migration verified through primary and exchange records.",
    primarySourceCount: 2,
    searchedAt: "2026-08-27T00:00:00.000Z",
  },
});

describe("deriveTokenApplicability", () => {
  it("classifies Fedi's wallet/app business as confirmed tokenless after a completed search", () => {
    const evidence = project("@fedibtc", "Fedi is a privacy-first Bitcoin wallet with chat and community spaces.");
    expect(deriveTokenApplicability(evidence, [tokenCheck("checked-empty", "No token linked to Fedi's official identity.")]))
      .toMatchObject({ state: "confirmed_tokenless", axisTreatment: "not_applicable" });
  });

  it("does not penalize an early tokenless startup", () => {
    const evidence = project("@earlyco", "An early-stage Bitcoin custody business for institutions.");
    expect(deriveTokenApplicability(evidence, [tokenCheck("checked-empty", "No attributable token found.")]))
      .toMatchObject({ state: "confirmed_tokenless", axisTreatment: "not_applicable" });
  });

  it("defers a first-party prelaunch token without treating it as absent conduct", () => {
    const evidence = project("@prelaunch", "Developer network with a token launch planned after mainnet.");
    expect(deriveTokenApplicability(evidence, [tokenCheck("checked-empty", "No live token found.")]))
      .toMatchObject({ state: "prelaunch_token_deferred", axisTreatment: "deferred" });
  });

  it("rejects a resolved namesake token without making it the project's token", () => {
    const evidence = project("@namesake", "A live payments application for small businesses.");
    expect(deriveTokenApplicability(evidence, [tokenCheck(
      "finding",
      "Two tokens trade under a matching name, but neither links to the official handle or domain.",
    )])).toMatchObject({ state: "confirmed_tokenless", axisTreatment: "not_applicable" });
  });

  it("keeps the ATOR to ANYONE lineage applicable", () => {
    const evidence = project("@anyonefdn", "A decentralized privacy network.");
    evidence.entityContinuity = anyoneLineage();
    expect(deriveTokenApplicability(evidence, [tokenCheck("confirmed", "ANYONE identity resolved.")]))
      .toMatchObject({ state: "historical_token_lineage", axisTreatment: "assess" });
  });

  it("keeps an unresolved token candidate provisional", () => {
    const evidence = project("@ambiguous", "A consumer finance application.");
    expect(deriveTokenApplicability(evidence, [tokenCheck("unavailable", "Candidate contract could not be attributed.")]))
      .toMatchObject({ state: "unresolved_token_identity", axisTreatment: "provisional" });
  });

  it("keeps an official bio contract with no resolved market provisional", () => {
    const evidence = project("@declared", "A project with an official contract in its profile.");
    expect(deriveTokenApplicability(evidence, [tokenCheck(
      "finding",
      "The official X bio declared a contract, but DexScreener returned no market for that exact address.",
    )])).toMatchObject({ state: "unresolved_token_identity", axisTreatment: "provisional" });
  });

  it("assesses token conduct once a live canonical token is bound", () => {
    const evidence = project("@altcoinist", "Social-trading infrastructure with a public Base token.");
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Altcoinist Token",
      symbol: "ALTT",
      rank: 1730,
      address: "0x1b5ce2a593a840e3ad3549a34d7b3dec697c114d",
      chain: "base",
      officialX: "@altcoinist",
      homepage: "https://www.altcoinist.com/",
      sourceUrl: "https://www.coingecko.com/en/coins/altcoinist-token",
      capturedAt: "2026-09-02T00:00:00.000Z",
    };
    expect(deriveTokenApplicability(evidence, [tokenCheck(
      "confirmed",
      "$ALTT matched this project through its official X account and canonical base contract",
    )])).toMatchObject({ state: "verified_live_token", axisTreatment: "assess" });
  });

  it("withholds the overall score while token identity is still unavailable", () => {
    const evidence = project("@altcoinist", "Social-trading infrastructure with a public Base token.");
    expect(deriveTokenApplicability(evidence, [tokenCheck(
      "unavailable",
      "token-identity registries could not be fully read on this scan (CoinGecko search failed); this is a provider gap, not an assessed result, and a rescan can close it",
    )])).toMatchObject({ state: "unresolved_token_identity", axisTreatment: "provisional" });
  });
});
