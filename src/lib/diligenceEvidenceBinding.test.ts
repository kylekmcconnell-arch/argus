import { describe, expect, it } from "vitest";
import {
  describeProtocolBinding,
  validateProtocolEvidenceBinding,
  type ProtocolBindingContext,
} from "./diligenceEvidenceBinding";

const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const tokenContext = (coingeckoId: string | null = null): ProtocolBindingContext => ({
  projectToken: {
    verified: true,
    verification: "official_x",
    name: "Fixture",
    symbol: "FIX",
    ...(coingeckoId ? { coingeckoId } : {}),
    rank: null,
    address: TOKEN,
    chain: "base",
    sourceUrl: "https://dexscreener.com/base/fixture",
    capturedAt: "2026-08-20T12:00:00.000Z",
    providers: ["dexscreener"],
  },
  officialHandle: "@fixture",
  officialWebsites: ["https://fixture.xyz/"],
});

describe("validateProtocolEvidenceBinding", () => {
  it("keeps a legacy exact-CoinGecko TVL row backward-compatible", () => {
    const result = validateProtocolEvidenceBinding(
      tokenContext("fixture-token"),
      { slug: "fixture", geckoId: " FIXTURE-TOKEN " },
    );
    expect(result).toMatchObject({
      state: "matched",
      legacy: true,
      binding: {
        method: "matched_protocol_gecko_id",
        scope: "project_and_token",
        canonicalGeckoId: "fixture-token",
      },
    });
  });

  it("admits a CoinGecko-less token only through the exact chain and contract receipt", () => {
    const result = validateProtocolEvidenceBinding(
      tokenContext(),
      {
        slug: "fixture",
        geckoId: null,
        binding: {
          method: "matched_chain_contract",
          scope: "project_and_token",
          protocolSlug: "fixture",
          canonicalChain: "base",
          canonicalAddress: TOKEN,
          providerChain: "base",
          providerAddress: TOKEN.toUpperCase().replace("0X", "0x"),
        },
      },
    );
    expect(result).toMatchObject({
      state: "matched",
      binding: { method: "matched_chain_contract", scope: "project_and_token" },
    });
    if (result.state !== "matched") throw new Error("expected matched receipt");
    expect(describeProtocolBinding(result.binding)).toContain("exact base contract");
  });

  it("admits an exact official-X plus domain receipt at project scope without inventing a token", () => {
    const result = validateProtocolEvidenceBinding(
      {
        officialHandle: "@fixture",
        officialWebsites: ["https://fixture.xyz/app"],
      },
      {
        slug: "fixture",
        geckoId: null,
        binding: {
          method: "matched_official_x_and_domain",
          scope: "project",
          protocolSlug: "fixture",
          canonicalHandle: "fixture",
          canonicalDomain: "fixture.xyz",
          providerHandle: "fixture",
          providerDomain: "app.fixture.xyz",
        },
      },
    );
    expect(result).toMatchObject({
      state: "matched",
      binding: { method: "matched_official_x_and_domain", scope: "project" },
    });
    if (result.state !== "matched") throw new Error("expected matched receipt");
    expect(describeProtocolBinding(result.binding)).toContain("no token linkage");
  });

  it("rejects a conflicting chain-contract receipt even when the slug and name are plausible", () => {
    const result = validateProtocolEvidenceBinding(
      tokenContext(),
      {
        slug: "fixture",
        geckoId: null,
        binding: {
          method: "matched_chain_contract",
          scope: "project_and_token",
          protocolSlug: "fixture",
          canonicalChain: "base",
          canonicalAddress: TOKEN,
          providerChain: "base",
          providerAddress: OTHER,
        },
      },
    );
    expect(result).toMatchObject({
      state: "unbound",
      reason: "provider_identity_conflict",
    });
  });

  it("rejects a matching-looking chain receipt when the frozen addresses are malformed", () => {
    const context = tokenContext();
    context.projectToken = context.projectToken
      ? { ...context.projectToken, address: "not-a-contract" }
      : null;
    const result = validateProtocolEvidenceBinding(
      context,
      {
        slug: "fixture",
        geckoId: null,
        binding: {
          method: "matched_chain_contract",
          scope: "project_and_token",
          protocolSlug: "fixture",
          canonicalChain: "base",
          canonicalAddress: "not-a-contract",
          providerChain: "base",
          providerAddress: "not-a-contract",
        },
      },
    );
    expect(result).toMatchObject({
      state: "unbound",
      reason: "incomplete_receipt",
    });
  });

  it("requires both the official X and canonical domain for a project-only receipt", () => {
    const result = validateProtocolEvidenceBinding(
      {
        officialHandle: "@fixture",
        officialWebsites: ["https://fixture.xyz/"],
      },
      {
        slug: "fixture",
        geckoId: null,
        binding: {
          method: "matched_official_x_and_domain",
          scope: "project",
          protocolSlug: "fixture",
          canonicalHandle: "fixture",
          canonicalDomain: "fixture.xyz",
          providerHandle: "copycat",
          providerDomain: "fixture.xyz",
        },
      },
    );
    expect(result).toMatchObject({
      state: "unbound",
      reason: "canonical_identity_conflict",
    });
  });

  it("accepts a legacy fee receipt only with a same-slug validated protocol row", () => {
    const fee = {
      slug: "fixture",
      binding: {
        method: "matched_protocol_gecko_id" as const,
        protocolSlug: "fixture",
        canonicalGeckoId: "fixture-token",
      },
    };
    expect(validateProtocolEvidenceBinding(tokenContext("fixture-token"), fee)).toMatchObject({
      state: "unbound",
      reason: "incomplete_receipt",
    });
    expect(validateProtocolEvidenceBinding(
      tokenContext("fixture-token"),
      fee,
      { corroboratedProtocolSlugs: new Set(["fixture"]) },
    )).toMatchObject({ state: "matched", legacy: true });
  });
});
