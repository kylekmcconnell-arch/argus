import { describe, expect, it } from "vitest";
import type { ProjectTokenSnapshot } from "../data/evidence";
import type { TokenDossier } from "../token/audit";
import {
  boundTokenUniqueIds,
  normalizeOfficialX,
  uniqueIdHeading,
  uniqueIdsForInvestigation,
  uniqueIdsFromProjectToken,
  uniqueIdsFromTokenDossier,
} from "./tokenNativeSpine";

const clutchToken = (): ProjectTokenSnapshot => ({
  verified: true,
  verification: "official_x",
  name: "STONKBROKER",
  symbol: "STONKBROKER",
  coingeckoId: "stonkbroker",
  rank: 2103,
  address: "0xe934e36a439c94017b64a3fece66af12099abf50",
  chain: "robinhood",
  homepage: "https://stonkbroker.example/",
  officialX: "ClutchMarkets",
  sourceUrl: "https://www.coingecko.com/en/coins/stonkbroker",
  capturedAt: "2026-08-19T00:00:00.000Z",
});

describe("boundTokenUniqueIds", () => {
  it("emits only recorded launched-product ids, in the outline order", () => {
    const rows = uniqueIdsFromProjectToken(clutchToken());
    expect(rows.map((row) => [row.kind, row.value])).toEqual([
      ["contract", "0xe934e36a439c94017b64a3fece66af12099abf50"],
      ["chain", "robinhood"],
      ["coingecko", "stonkbroker"],
      ["official_x", "@ClutchMarkets"],
      ["official_site", "stonkbroker.example"],
    ]);
    expect(uniqueIdHeading(rows.length)).toBe("5 bound unique-ids.");
    expect(rows.every((row) => row.provenance.tier === "sourced")).toBe(true);
  });

  it("does not transfer a company handle or company site onto the token", () => {
    const rows = uniqueIdsFromProjectToken({
      ...clutchToken(),
      officialX: undefined,
      homepage: undefined,
    });
    expect(rows.map((row) => row.kind)).toEqual(["contract", "chain", "coingecko"]);
    expect(JSON.stringify(rows)).not.toContain("clutchmarkets");
    expect(JSON.stringify(rows)).not.toContain("clutch.markets");
    expect(JSON.stringify(rows)).not.toContain("CLUTCH");
  });

  it("prints nothing from an unverified snapshot", () => {
    const unverified = { ...clutchToken(), verified: false } as unknown as ProjectTokenSnapshot;
    expect(uniqueIdsFromProjectToken(unverified)).toEqual([]);
    expect(boundTokenUniqueIds({
      verified: false,
      address: clutchToken().address,
      chain: "robinhood",
      coingeckoId: "stonkbroker",
    }, { requireVerified: true })).toEqual([]);
  });

  it("omits blank and invented fields instead of filling them", () => {
    const rows = boundTokenUniqueIds({
      verified: true,
      address: "  ",
      chain: "solana",
      coingeckoId: "",
      officialX: "not a handle!!!",
      officialSite: "stonkbroker.example",
    }, { requireVerified: true });
    expect(rows.map((row) => row.kind)).toEqual(["chain"]);
    expect(uniqueIdHeading(1)).toBe("1 bound unique-id.");
  });
});

describe("unique-id identity rules", () => {
  it("normalizes a recorded X screen name and rejects a URL-shaped stand-in", () => {
    expect(normalizeOfficialX("ClutchMarkets")).toBe("@ClutchMarkets");
    expect(normalizeOfficialX("@ClutchMarkets")).toBe("@ClutchMarkets");
    expect(normalizeOfficialX("x.com/ClutchMarkets")).toBe("@ClutchMarkets");
    expect(normalizeOfficialX("https://clutch.markets/")).toBeNull();
  });

  it("keeps founder, company, and launched product as separate ids on an investigation", () => {
    const token = {
      address: clutchToken().address,
      chain: "robinhood",
      projectX: null,
      socials: [],
      cg: { id: "stonkbroker", twitter: null, homepage: null },
    } as unknown as TokenDossier;

    const rows = uniqueIdsForInvestigation({
      token,
      projectToken: clutchToken(),
    });
    expect(rows.find((row) => row.kind === "official_x")?.value).toBe("@ClutchMarkets");
    expect(rows.some((row) => row.value === "@clutchmarkets")).toBe(false);

    const companyOnlyScan = uniqueIdsForInvestigation({
      token: {
        ...token,
        projectX: null,
        cg: { id: null, twitter: null, homepage: null },
      } as unknown as TokenDossier,
      projectToken: { ...clutchToken(), officialX: undefined, homepage: undefined },
    });
    expect(companyOnlyScan.find((row) => row.kind === "official_x")).toBeUndefined();
  });

  it("uses the token dossier's own recorded X, never a caller-supplied company handle", () => {
    const rows = uniqueIdsFromTokenDossier({
      address: clutchToken().address,
      chain: "robinhood",
      projectX: "ClutchMarkets",
      socials: [{ label: "site", url: "https://stonkbroker.example/" }],
      cg: { id: "stonkbroker", twitter: "ClutchMarkets", homepage: "https://stonkbroker.example/" },
    } as unknown as TokenDossier);
    expect(rows.find((row) => row.kind === "official_x")?.value).toBe("@ClutchMarkets");
    expect(rows.find((row) => row.kind === "official_site")?.href).toBe("https://stonkbroker.example/");
  });
});
