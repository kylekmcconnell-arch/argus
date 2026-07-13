import { describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFactLead } from "../../src/data/evidence";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";
import type { CollectContext } from "./types";
import {
  collectBasicFacts,
  parseBasicFactLeads,
  verifyBasicFactLead,
} from "./basicFacts";

const NOW = "2026-07-12T12:00:00.000Z";

const lead = (overrides: Partial<BasicFactLead> = {}): BasicFactLead => ({
  subject: "Jupiter",
  predicate: "founder",
  value: "Meow",
  excerpt: "Jupiter was founded by Meow in 2021.",
  sourceUrl: "https://jup.ag/about",
  sourceTitle: "About Jupiter",
  evidence_origin: "model_lead",
  artifact_verified: false,
  provider: "claude-web-search",
  ...overrides,
});

const document = (overrides: Partial<PublicTextDocument> = {}): PublicTextDocument => ({
  status: "ok",
  url: "https://jup.ag/about",
  host: "jup.ag",
  contentType: "text/html",
  text: "<html><body><p>Jupiter was founded by Meow in 2021.</p></body></html>",
  contentHash: "a".repeat(64),
  capturedAt: NOW,
  ...overrides,
});

function context(website: string | undefined = "https://jup.ag") {
  const evidence = emptyEvidence("@JupiterExchange");
  evidence.profile.display_name = "Jupiter";
  evidence.profile.resolved_name = "Jupiter";
  evidence.profile.website = website;
  const ctx: CollectContext = {
    handle: "@JupiterExchange",
    evidence,
    emit: vi.fn(),
  };
  return { ctx, evidence };
}

const fetchDocuments = (documents: Record<string, PublicTextDocument>) =>
  vi.fn(async (url: string): Promise<PublicTextResult> => documents[url] ?? {
    status: "failed",
    reason: "not_found",
  });

describe("basic-facts lead parsing", () => {
  it.each([
    "Meow and Siong",
    "Meow, Siong",
  ])("rejects a combined founder list: %s", (value) => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Jupiter",
        predicate: "founder",
        value,
        exact_excerpt: `Jupiter was founded by ${value}.`,
        source_url: "https://jup.ag/about",
      }],
    }))).toEqual([]);
  });

  it.each([
    "http://127.0.0.1/private",
    "https://localhost/private",
    "https://user:secret@example.com/private",
    "https://example.com/private?X-Amz-Signature=secret",
  ])("rejects an unsafe candidate URL: %s", (sourceUrl) => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Jupiter",
        predicate: "founder",
        value: "Meow",
        exact_excerpt: "Jupiter was founded by Meow.",
        source_url: sourceUrl,
      }],
    }))).toEqual([]);
  });
});

describe("basic-facts source verification", () => {
  it("promotes an exact first-party source to verified", async () => {
    const { ctx, evidence } = context();
    const result = await collectBasicFacts(ctx, {
      discover: async () => [lead()],
      fetchSource: fetchDocuments({ "https://jup.ag/about": document() }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "founder",
        value: "Meow",
        status: "verified",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "public-web",
        sources: [expect.objectContaining({
          sourceClass: "official_subject",
          artifactVerified: true,
        })],
      }),
    ]);
  });

  it("keeps one independent source as a non-scoreable lead", async () => {
    const { ctx, evidence } = context();
    const independentLead = lead({ sourceUrl: "https://coindesk.com/jupiter" });
    const result = await collectBasicFacts(ctx, {
      discover: async () => [independentLead],
      fetchSource: fetchDocuments({
        "https://coindesk.com/jupiter": document({
          url: "https://coindesk.com/jupiter",
          host: "coindesk.com",
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "partial" }));
    expect(evidence.basicFactLeads).toEqual([independentLead]);
    expect(evidence.basicFacts).toEqual([]);
  });

  it("corroborates the same atomic fact across two independent hosts", async () => {
    const firstUrl = "https://coindesk.com/jupiter";
    const secondUrl = "https://decrypt.co/jupiter";
    const { ctx, evidence } = context();
    const result = await collectBasicFacts(ctx, {
      discover: async () => [lead({ sourceUrl: firstUrl }), lead({ sourceUrl: secondUrl })],
      fetchSource: fetchDocuments({
        [firstUrl]: document({ url: firstUrl, host: "coindesk.com", contentHash: "b".repeat(64) }),
        [secondUrl]: document({ url: secondUrl, host: "decrypt.co", contentHash: "c".repeat(64) }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "founder",
        value: "Meow",
        status: "corroborated",
        sources: [
          expect.objectContaining({ url: firstUrl, sourceClass: "independent_press" }),
          expect.objectContaining({ url: secondUrl, sourceClass: "independent_press" }),
        ],
      }),
    ]);
  });

  it("rejects a hallucinated quote that is absent from the fetched artifact", () => {
    expect(verifyBasicFactLead(
      lead(),
      document({ text: "<html><body><p>Jupiter is a Solana liquidity aggregator.</p></body></html>" }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    )).toBeNull();
  });

  it("does not treat another tenant on a shared host as first-party", () => {
    const source = document({
      url: "https://attacker.vercel.app/jupiter",
      host: "attacker.vercel.app",
    });
    expect(verifyBasicFactLead(
      lead({ sourceUrl: source.url }),
      source,
      ["Jupiter"],
      "@JupiterExchange",
      ["jupiter.vercel.app"],
    )).toEqual(expect.objectContaining({
      status: "lead",
      sources: [expect.objectContaining({ sourceClass: "independent_press" })],
    }));
  });
});
