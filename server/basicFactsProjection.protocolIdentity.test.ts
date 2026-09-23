import { describe, expect, it } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { indexedProtocolRecordMatch, protocolRecordMatchesOfficialIdentity } from "./basicFactsProjection";

function resolvedProfile(website: string | null) {
  const evidence = emptyEvidence("@ammalgam");
  evidence.profile.website = website ?? undefined;
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  return evidence;
}

describe("protocolRecordMatchesOfficialIdentity", () => {
  it("binds a tokenless protocol by its exact X handle", () => {
    const evidence = resolvedProfile("https://ammalgam.xyz/");
    expect(protocolRecordMatchesOfficialIdentity(
      { officialTwitter: "ammalgam", officialUrl: "https://ammalgam.xyz/" },
      "@ammalgam",
      evidence.profile,
    )).toBe(true);
  });

  it("binds by official-domain apex when the record lists no handle", () => {
    const evidence = resolvedProfile("https://ammalgam.xyz/");
    expect(protocolRecordMatchesOfficialIdentity(
      { officialTwitter: null, officialUrl: "https://www.ammalgam.xyz" },
      "@ammalgam",
      evidence.profile,
    )).toBe(true);
  });

  it("never binds on a contradiction between the two surfaces", () => {
    const evidence = resolvedProfile("https://ammalgam.xyz/");
    // Domain agrees but the record names a DIFFERENT X account: ambiguous
    // identity, fail closed.
    expect(protocolRecordMatchesOfficialIdentity(
      { officialTwitter: "someoneelse", officialUrl: "https://ammalgam.xyz/" },
      "@ammalgam",
      evidence.profile,
    )).toBe(false);
    // Handle agrees but the record's site is a different apex.
    expect(protocolRecordMatchesOfficialIdentity(
      { officialTwitter: "ammalgam", officialUrl: "https://not-ammalgam.example/" },
      "@ammalgam",
      evidence.profile,
    )).toBe(false);
  });

  it("requires a provider-resolved profile before the domain surface can bind", () => {
    const evidence = emptyEvidence("@ammalgam");
    evidence.profile.website = "https://ammalgam.xyz/";
    // Unresolved profile: the website field is not provider-frozen identity.
    expect(protocolRecordMatchesOfficialIdentity(
      { officialTwitter: null, officialUrl: "https://ammalgam.xyz/" },
      "@ammalgam",
      evidence.profile,
    )).toBe(false);
  });

  it("does not bind an unrelated protocol", () => {
    const evidence = resolvedProfile("https://ammalgam.xyz/");
    expect(protocolRecordMatchesOfficialIdentity(
      { officialTwitter: "greenwoodrh_", officialUrl: "https://playgreenwood.xyz/" },
      "@ammalgam",
      evidence.profile,
    )).toBe(false);
  });
});

describe("indexedProtocolRecordMatch", () => {
  it("accepts the CoinGecko-id join and the official-identity join, and nothing else", () => {
    const evidence = resolvedProfile("https://ammalgam.xyz/");
    expect(indexedProtocolRecordMatch(evidence, {
      geckoId: null,
      officialTwitter: "ammalgam",
      officialUrl: "https://ammalgam.xyz/",
    })).toBe(true);
    expect(indexedProtocolRecordMatch(evidence, {
      geckoId: "some-protocol",
      officialTwitter: null,
      officialUrl: null,
    })).toBe(false);
    expect(indexedProtocolRecordMatch(evidence, undefined)).toBe(false);
  });
});
