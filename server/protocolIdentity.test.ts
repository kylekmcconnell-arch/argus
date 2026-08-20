import { describe, expect, it } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import type { ProtocolIdentity } from "./adapters/defiLlama";
import {
  canonicalProjectProtocolAnchors,
  matchProtocolIdentity,
  type CanonicalProjectProtocolAnchors,
} from "./protocolIdentity";

const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const identity = (over: Partial<ProtocolIdentity> = {}): ProtocolIdentity => ({
  slug: "project",
  name: "Project",
  symbol: "PROJECT",
  geckoId: null,
  contracts: [],
  officialX: null,
  website: null,
  sourceUrl: "https://defillama.com/protocol/project",
  capturedAt: "2026-08-20T12:00:00.000Z",
  ...over,
});

const anchors = (
  over: Partial<CanonicalProjectProtocolAnchors> = {},
): CanonicalProjectProtocolAnchors => ({
  officialHandle: "realproject",
  officialDomains: ["realproject.example"],
  token: {
    chain: "base",
    address: TOKEN,
    coingeckoId: null,
  },
  ...over,
});

describe("matchProtocolIdentity", () => {
  it("binds a CoinGecko-less DEX token through exact chain and contract", () => {
    const match = matchProtocolIdentity(
      anchors(),
      identity({ contracts: [{ chain: "base", address: TOKEN.toUpperCase().replace("0X", "0x") }] }),
    );
    expect(match).toEqual({
      state: "matched",
      binding: {
        method: "matched_chain_contract",
        scope: "project_and_token",
        protocolSlug: "project",
        canonicalChain: "base",
        canonicalAddress: TOKEN,
        providerChain: "base",
        providerAddress: TOKEN.toUpperCase().replace("0X", "0x"),
      },
    });
  });

  it("requires the exact chain even when an EVM address is identical", () => {
    const match = matchProtocolIdentity(
      anchors(),
      identity({ contracts: [{ chain: "ethereum", address: TOKEN }] }),
    );
    expect(match).toMatchObject({ state: "unbound" });
  });

  it("keeps Solana address comparison case-sensitive", () => {
    const solana = "So11111111111111111111111111111111111111112";
    const match = matchProtocolIdentity(
      anchors({
        token: { chain: "solana", address: solana, coingeckoId: null },
      }),
      identity({
        contracts: [{ chain: "solana", address: solana.toLowerCase() }],
      }),
    );
    expect(match).toMatchObject({ state: "unbound" });
  });

  it("keeps the exact CoinGecko bridge when no canonical-chain contract conflicts", () => {
    const match = matchProtocolIdentity(
      anchors({
        token: { chain: "base", address: TOKEN, coingeckoId: "project-token" },
      }),
      identity({
        geckoId: "PROJECT-TOKEN",
        contracts: [{ chain: "ethereum", address: OTHER }],
      }),
    );
    expect(match).toMatchObject({
      state: "matched",
      binding: {
        method: "matched_protocol_gecko_id",
        scope: "project_and_token",
      },
    });
  });

  it("fails closed when CoinGecko matches but the canonical-chain contract conflicts", () => {
    const match = matchProtocolIdentity(
      anchors({
        token: { chain: "base", address: TOKEN, coingeckoId: "project-token" },
      }),
      identity({
        geckoId: "project-token",
        contracts: [{ chain: "base", address: OTHER }],
      }),
    );
    expect(match).toEqual({
      state: "unbound",
      reason: "hard_anchor_conflict",
      detail: expect.stringContaining("explicit contract"),
    });
  });

  it("binds a verified tokenless project by exact official X and domain only", () => {
    const match = matchProtocolIdentity(
      anchors({ token: null }),
      identity({
        officialX: "@RealProject",
        website: "https://app.realproject.example/docs",
      }),
    );
    expect(match).toEqual({
      state: "matched",
      binding: {
        method: "matched_official_x_and_domain",
        scope: "project",
        protocolSlug: "project",
        canonicalHandle: "realproject",
        canonicalDomain: "realproject.example",
        providerHandle: "realproject",
        providerDomain: "app.realproject.example",
      },
    });
  });

  it("does not widen a verified subdomain scope to its parent domain", () => {
    const match = matchProtocolIdentity(
      anchors({
        officialDomains: ["launch.realproject.example"],
        token: null,
      }),
      identity({
        officialX: "@realproject",
        website: "https://realproject.example",
      }),
    );
    expect(match).toMatchObject({ state: "unbound" });
  });

  it.each([
    ["matching X only", { officialX: "@realproject", website: "https://copycat.example" }],
    ["matching domain only", { officialX: "@copycat", website: "https://realproject.example" }],
    ["same name and symbol only", { name: "Project", symbol: "PROJECT" }],
  ])("rejects %s", (_label, provider) => {
    const match = matchProtocolIdentity(
      anchors({ token: null }),
      identity(provider),
    );
    expect(match).toMatchObject({ state: "unbound" });
  });

  it("rejects a same-name row with a different project and token identity", () => {
    const match = matchProtocolIdentity(
      anchors(),
      identity({
        name: "Project",
        symbol: "PROJECT",
        officialX: "@copycat",
        website: "https://copycat.example",
        contracts: [{ chain: "base", address: OTHER }],
      }),
    );
    expect(match).toMatchObject({ state: "unbound" });
  });
});

describe("canonicalProjectProtocolAnchors", () => {
  it("uses only a provider-resolved profile website as an official project anchor", () => {
    const evidence = emptyEvidence("@realproject");
    evidence.profile.website = "https://realproject.example/app";
    expect(canonicalProjectProtocolAnchors(evidence)).toMatchObject({
      officialHandle: null,
      officialDomains: [],
    });

    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-20T12:00:00.000Z";
    expect(canonicalProjectProtocolAnchors(evidence)).toMatchObject({
      officialHandle: "realproject",
      officialDomains: ["realproject.example"],
    });
  });
});
