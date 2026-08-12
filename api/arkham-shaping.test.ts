import { describe, expect, it } from "vitest";
import { shapeMoneyFlowEvents } from "./arkham-money-flow";
import { shapeArkhamHolderGroups } from "./arkham-token-holders";

describe("Arkham holder entity shaping", () => {
  it("groups visible holder wallets by entity without treating custody as one owner", () => {
    const payload = {
      addressTopHolders: {
        ethereum: [
          { address: { address: "0x1", arkhamEntity: { id: "alpha", name: "Alpha Fund" } } },
          { address: { address: "0x2", arkhamEntity: { id: "alpha", name: "Alpha Fund" } } },
          { address: { address: "0x3", arkhamEntity: { id: "binance", name: "Binance" } } },
        ],
      },
      entityTopHolders: {
        ethereum: [
          {
            balance: 18_000,
            pctOfCap: 0.18,
            usd: 900_000,
            entity: {
              id: "alpha",
              name: "Alpha Fund",
              type: "fund",
              service: false,
              addresses: { ethereum: ["0x1", "0x2", "0x4"] },
              populatedTags: [{ id: "whale", label: "Whale", rank: 1 }],
            },
          },
          {
            balance: 12_000,
            pctOfCap: 0.12,
            usd: 600_000,
            entity: {
              id: "binance",
              name: "Binance",
              type: "cex",
              service: true,
              addresses: { ethereum: ["0x3"] },
            },
          },
        ],
      },
    };

    const result = shapeArkhamHolderGroups(payload);

    expect(result.entities[0]).toMatchObject({
      id: "alpha",
      percent: 18,
      observedWallets: 2,
      knownWallets: 3,
      isService: false,
      tags: ["Whale"],
    });
    expect(result.entities[1]).toMatchObject({ id: "binance", percent: 12, isService: true });
    expect(result.knownEntityPercent).toBe(30);
    expect(result.groupedEntityCount).toBe(1);
    expect(result.largestNonService?.id).toBe("alpha");
  });
});

describe("Arkham transfer shaping", () => {
  it("turns enriched transfers into stable, named incoming and outgoing events", () => {
    const base = "0xAbCd000000000000000000000000000000001234";
    const payload = {
      transfers: [
        {
          blockTimestamp: "2026-07-20T12:00:00Z",
          chain: "ethereum",
          fromAddress: { address: base },
          toAddress: {
            address: "0x9999000000000000000000000000000000000000",
            depositServiceID: "binance",
            arkhamEntity: {
              id: "binance",
              name: "Binance",
              type: "cex",
              populatedTags: [{ label: "Exchange", rank: 1 }],
            },
          },
          historicalUSD: 250_000,
          tokenSymbol: "USDC",
          transactionHash: "0xout",
          unitValue: 250_000,
        },
        {
          blockTimestamp: "2026-07-19T12:00:00Z",
          chain: "ethereum",
          fromAddress: {
            address: "0x7777000000000000000000000000000000000000",
            arkhamEntity: { id: "fund", name: "Example Fund", type: "fund" },
          },
          toAddress: { address: base.toLowerCase() },
          historicalUSD: 75_000,
          tokenSymbol: "ETH",
          transactionHash: "0xin",
          unitValue: 20,
        },
      ],
    };

    const result = shapeMoneyFlowEvents(payload, base);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      direction: "out",
      counterparty: "Binance",
      isExchange: true,
      usd: 250_000,
      token: "USDC",
    });
    expect(result[1]).toMatchObject({
      direction: "in",
      counterparty: "Example Fund",
      isExchange: false,
      usd: 75_000,
    });
  });
});
