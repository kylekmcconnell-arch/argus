import { describe, expect, it } from "vitest";
import { buildEntityContinuityQueries, normalizeEntityContinuity } from "./entityContinuity";

const DOCS = "https://docs.anyone.io/resources/token";
const ROADMAP = "https://docs.anyone.io/resources/roadmap";
const KUCOIN = "https://www.kucoin.com/announcement/en-kucoin-will-support-the-rebranding-of-ator-protocol-ator-to-anyone-protocol-anyone-20240627";
const MEXC = "https://www.mexc.com/ko-KR/announcements/tag/contract-swaps-38?page=44";

describe("entity continuity", () => {
  it("always asks the plain-language history questions", () => {
    expect(buildEntityContinuityQueries("ANyONe Protocol", "ANYONE")).toEqual([
      "what happened to ANyONe Protocol",
      "ANyONe Protocol formerly rebrand predecessor",
      "ANyONe Protocol ANYONE token migration swap",
      "ANyONe Protocol ANYONE old contract new contract",
      "ANyONe Protocol ANYONE migration contract exchange support",
    ]);
  });

  it("recovers the complete ATOR to ANYONE lineage and continuous market identity", () => {
    const raw = JSON.stringify({
      historicalAliases: ["ATOR Protocol", "ATOR"],
      predecessorName: "ATOR Protocol",
      oldTicker: "ATOR",
      oldContract: "0x0f7b3f5a8fed821c5eb60049538a548db2d479ce",
      migrationRatio: "1 ATOR = 1 ANYONE",
      migrationDate: "2024-06-27",
      replacementContract: "0xFeAc2Eae96899709a43E252B6B92971D32F9C0F9",
      migrationContract: "0x38F5dbBbb65BE0af97f5e7c9E89E1012c0dc0163",
      currentStatus: "ATOR was replaced by ANYONE; the project continues as ANyONe Protocol.",
      architectureChanges: ["The project moved from ATOR-era Tor relay integration toward its own Anyone privacy network."],
      exchangeHandling: ["KuCoin converted eligible ATOR balances to ANYONE at 1:1 after its June 27, 2024 snapshot."],
      tokenLineage: [
        { name: "ATOR Protocol", ticker: "ATOR", contract: "0x0f7b3f5a8fed821c5eb60049538a548db2d479ce", chain: "ethereum", status: "predecessor", validFrom: null, validTo: "2024-06-27", sourceUrls: [MEXC] },
        { name: "ANYONE Migration Contract", ticker: null, contract: "0x38F5dbBbb65BE0af97f5e7c9E89E1012c0dc0163", chain: "ethereum", status: "migration", validFrom: "2024-06-27", validTo: null, sourceUrls: [DOCS] },
        { name: "ANyONe Protocol", ticker: "ANYONE", contract: "0xFeAc2Eae96899709a43E252B6B92971D32F9C0F9", chain: "ethereum", status: "current", validFrom: "2024-06-27", validTo: null, sourceUrls: [DOCS] },
      ],
      events: [
        { date: "2024-06-27", kind: "rebrand", title: "ATOR became ANyONe", detail: "The project completed its Q2 2024 rebrand.", sourceUrls: [ROADMAP] },
        { date: "2024-06-27", kind: "token_migration", title: "ATOR holders moved 1:1", detail: "KuCoin converted 1 ATOR into 1 ANYONE.", sourceUrls: [KUCOIN] },
        { date: "2024-06-27", kind: "contract_replacement", title: "The Ethereum contract changed", detail: "The ATOR contract was replaced by the ANYONE contract through the published migration contract.", sourceUrls: [DOCS, MEXC] },
      ],
    });
    const snapshot = normalizeEntityContinuity(raw, "ANyONe Protocol", [
      { title: "Token Reference", url: DOCS, snippet: "" },
      { title: "Roadmap", url: ROADMAP, snippet: "" },
      { title: "KuCoin swap", url: KUCOIN, snippet: "" },
      { title: "MEXC swap", url: MEXC, snippet: "" },
    ], new Set(["anyone.io", "docs.anyone.io"]), {
      name: "ANyONe Protocol",
      ticker: "ANYONE",
      contract: "0xFeAc2Eae96899709a43E252B6B92971D32F9C0F9",
      chain: "ethereum",
    });

    expect(snapshot?.coverage.state).toBe("complete");
    expect(snapshot?.historicalAliases).toEqual(expect.arrayContaining(["ATOR Protocol", "ATOR"]));
    expect(snapshot?.migrationRatio).toBe("1 ATOR = 1 ANYONE");
    expect(snapshot?.oldContract?.toLowerCase()).toBe("0x0f7b3f5a8fed821c5eb60049538a548db2d479ce");
    expect(snapshot?.replacementContract?.toLowerCase()).toBe("0xfeac2eae96899709a43e252b6b92971d32f9c0f9");
    expect(snapshot?.migrationContract?.toLowerCase()).toBe("0x38f5dbbbb65be0af97f5e7c9e89e1012c0dc0163");
    expect(snapshot?.marketHistory.map((segment) => segment.status)).toEqual(["predecessor", "current"]);
  });

  it("rejects lineage claims whose URLs were not returned by search", () => {
    const snapshot = normalizeEntityContinuity(JSON.stringify({
      historicalAliases: ["ATOR"],
      migrationRatio: "1:1",
      tokenLineage: [{ name: "ATOR", ticker: "ATOR", contract: "0xfake", chain: "ethereum", status: "predecessor", validFrom: null, validTo: null, sourceUrls: ["https://invented.example/claim"] }],
      events: [],
    }), "ANyONe Protocol", [{ title: "Roadmap", url: ROADMAP, snippet: "" }], new Set(["docs.anyone.io"]));

    expect(snapshot?.tokenLineage).toHaveLength(0);
    expect(snapshot?.coverage.state).toBe("partial");
  });
});
