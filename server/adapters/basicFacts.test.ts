import { describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFactLead } from "../../src/data/evidence";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";
import type { CollectContext } from "./types";
import {
  collectBasicFacts,
  discoverBasicFactLeads,
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
  it("asks discovery to copy only source-stated traction reporting periods", async () => {
    const { ctx } = context();
    let requestBody: Record<string, unknown> | undefined;
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [{ type: "text", text: '{"facts":[]}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await discoverBasicFactLeads(ctx, {
      request,
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    });

    const messages = requestBody?.messages as Array<{ content?: string }> | undefined;
    expect(messages?.[0]?.content).toContain(
      "copy the source's exact as-of date or reporting period into qualifier",
    );
    expect(messages?.[0]?.content).toContain("Never infer, normalize, or invent a date");
    expect(messages?.[0]?.content).toContain("traction as-of/reporting period present in exact_excerpt");
  });

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

  it("keeps safe corroborating URLs and drops unsafe or duplicate candidates", () => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Jupiter",
        predicate: "founder",
        value: "Meow",
        exact_excerpt: "Jupiter was founded by Meow.",
        source_url: "https://coindesk.com/jupiter",
        candidate_urls: [
          "https://decrypt.co/jupiter",
          "https://localhost/private",
          "https://coindesk.com/jupiter",
          "https://decrypt.co/jupiter",
        ],
      }],
    }))?.[0]).toEqual(expect.objectContaining({
      candidateUrls: ["https://decrypt.co/jupiter"],
    }));
  });

  it("keeps required due-diligence categories when more than 16 facts are returned", () => {
    const founders = Array.from({ length: 16 }, (_, index) => ({
      subject: "Jupiter",
      predicate: "founder",
      value: `Founder ${index + 1}`,
      exact_excerpt: `Jupiter was founded by Founder ${index + 1}.`,
      source_url: `https://jup.ag/team/founder-${index + 1}`,
    }));
    const required = [
      ["product", "Jupiter Swap", "Jupiter Swap is the core exchange product."],
      ["tokenomics", "50% community allocation", "Jupiter tokenomics specify a 50% community allocation."],
      ["vesting", "two-year contributor vesting", "Jupiter publishes two-year contributor vesting."],
      ["treasury", "Jupiter DAO treasury", "Jupiter discloses the Jupiter DAO treasury."],
      ["audit", "OtterSec audit", "Jupiter completed an OtterSec security audit."],
      ["traction", "$1B monthly volume", "Jupiter processed $1B in monthly trading volume."],
    ].map(([predicate, value, exact_excerpt]) => ({
      subject: "Jupiter",
      predicate,
      value,
      exact_excerpt,
      source_url: `https://jup.ag/${predicate}`,
    }));

    const parsed = parseBasicFactLeads(JSON.stringify({ facts: [...founders, ...required] }));

    expect(parsed).toHaveLength(16);
    expect(parsed?.map((fact) => fact.predicate)).toEqual([
      ...Array.from({ length: 10 }, () => "founder"),
      "product",
      "tokenomics",
      "vesting",
      "treasury",
      "audit",
      "traction",
    ]);
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

  it("fetches every selected category primary before early corroborating URLs consume the source cap", async () => {
    const { ctx, evidence } = context();
    const founders = Array.from({ length: 16 }, (_, index) => lead({
      value: `Founder ${index + 1}`,
      excerpt: `Jupiter was founded by Founder ${index + 1}.`,
      sourceUrl: `https://jup.ag/team/founder-${index + 1}`,
      candidateUrls: Array.from({ length: 3 }, (_unused, candidateIndex) =>
        `https://docs.jup.ag/team/founder-${index + 1}-${candidateIndex + 1}`),
    }));
    const required = [
      lead({
        predicate: "product",
        value: "Jupiter Swap",
        excerpt: "Jupiter Swap is the core exchange product.",
        sourceUrl: "https://jup.ag/product",
      }),
      lead({
        predicate: "tokenomics",
        value: "50% community allocation",
        excerpt: "Jupiter tokenomics specify a 50% community allocation.",
        sourceUrl: "https://jup.ag/tokenomics",
      }),
      lead({
        predicate: "vesting",
        value: "two-year contributor vesting",
        excerpt: "Jupiter publishes two-year contributor vesting.",
        sourceUrl: "https://jup.ag/vesting",
      }),
      lead({
        predicate: "treasury",
        value: "Jupiter DAO treasury",
        excerpt: "Jupiter discloses the Jupiter DAO treasury.",
        sourceUrl: "https://jup.ag/treasury",
      }),
      lead({
        predicate: "audit",
        value: "OtterSec audit",
        excerpt: "Jupiter completed an OtterSec audit and security review.",
        sourceUrl: "https://jup.ag/audit",
      }),
      lead({
        predicate: "traction",
        value: "$1B monthly volume",
        excerpt: "Jupiter reported $1B monthly volume across the exchange.",
        sourceUrl: "https://jup.ag/traction",
      }),
    ];
    const requiredDocuments = Object.fromEntries(required.map((fact, index) => [
      fact.sourceUrl,
      document({
        url: fact.sourceUrl,
        text: `<html><body><p>${fact.excerpt}</p></body></html>`,
        contentHash: String(index + 1).repeat(64),
      }),
    ]));
    const fetchSource = fetchDocuments(requiredDocuments);

    const result = await collectBasicFacts(ctx, {
      discover: async () => [...founders, ...required],
      fetchSource,
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(fetchSource).toHaveBeenCalledTimes(24);
    required.forEach((fact) => expect(fetchSource).toHaveBeenCalledWith(fact.sourceUrl));
    expect(evidence.basicFacts?.map((fact) => fact.predicate)).toEqual([
      "product",
      "tokenomics",
      "vesting",
      "treasury",
      "audit",
      "traction",
    ]);
  });

  it("stores the fetched supporting passage when search-snippet wording and page markup differ", () => {
    const fact = verifyBasicFactLead(
      lead({
        excerpt: "Jupiter, founded by Meow, launched in 2021.",
        qualifier: "Core team founder",
      }),
      document({
        text: "<html><body><h1>Jupiter</h1><p>In 2021, <a href='/team'>Meow</a> founded the protocol.</p></body></html>",
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    );

    expect(fact).toEqual(expect.objectContaining({
      status: "verified",
      value: "Meow",
      sources: [expect.objectContaining({
        excerpt: expect.stringContaining("In 2021, Meow founded the protocol"),
      })],
    }));
    // An unsupported model qualifier is not copied into the verified artifact.
    expect(fact).not.toHaveProperty("qualifier");
  });

  it("freezes a traction reporting period only when the fetched passage states it", () => {
    const supported = verifyBasicFactLead(
      lead({
        predicate: "traction",
        value: "$1B monthly volume",
        qualifier: "Q2 2026",
        excerpt: "Jupiter reported $1B monthly volume in Q2 2026.",
        sourceUrl: "https://jup.ag/traction",
      }),
      document({
        url: "https://jup.ag/traction",
        text: "<html><body><p>Jupiter reported $1B monthly volume in Q2 2026.</p></body></html>",
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    );
    const invented = verifyBasicFactLead(
      lead({
        predicate: "traction",
        value: "$1B monthly volume",
        qualifier: "as of July 12, 2026",
        excerpt: "Jupiter reported $1B monthly volume in Q2 2026.",
        sourceUrl: "https://jup.ag/traction",
      }),
      document({
        url: "https://jup.ag/traction",
        text: "<html><body><p>Jupiter reported $1B monthly volume in Q2 2026.</p></body></html>",
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    );

    expect(supported).toEqual(expect.objectContaining({ qualifier: "Q2 2026" }));
    expect(invented).not.toHaveProperty("qualifier");
  });

  it("accepts common chain wording on a fetched official page", () => {
    expect(verifyBasicFactLead(
      lead({
        predicate: "network",
        value: "Solana",
        excerpt: "Jupiter is a decentralized exchange on the Solana blockchain.",
      }),
      document({ text: "<html><body><h1>Jupiter</h1><p>The exchange is built for Solana.</p></body></html>" }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    )).toEqual(expect.objectContaining({
      predicate: "network",
      value: "Solana",
      status: "verified",
    }));
  });

  it.each([
    ["tokenomics", "50% community allocation", "Jupiter tokenomics specify a 50% community allocation."],
    ["vesting", "two-year contributor vesting", "Jupiter publishes two-year contributor vesting with a defined unlock schedule."],
    ["treasury", "Jupiter DAO treasury", "Jupiter discloses the Jupiter DAO treasury and its multisig controls."],
  ] as const)("verifies an official %s disclosure as a first-class fact", (predicate, value, sentence) => {
    expect(verifyBasicFactLead(
      lead({
        predicate,
        value,
        excerpt: sentence,
        sourceUrl: `https://jup.ag/${predicate}`,
      }),
      document({
        url: `https://jup.ag/${predicate}`,
        text: `<html><body><p>${sentence}</p></body></html>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    )).toEqual(expect.objectContaining({
      predicate,
      value,
      status: "verified",
    }));
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
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining("1/1 leads matched subject, value, and predicate language"),
    }));
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

  it("uses candidate URLs to corroborate one discovered atomic fact", async () => {
    const firstUrl = "https://coindesk.com/jupiter";
    const secondUrl = "https://decrypt.co/jupiter";
    const { ctx, evidence } = context();
    const result = await collectBasicFacts(ctx, {
      discover: async () => [lead({ sourceUrl: firstUrl, candidateUrls: [secondUrl] })],
      fetchSource: fetchDocuments({
        [firstUrl]: document({ url: firstUrl, host: "coindesk.com", contentHash: "b".repeat(64) }),
        [secondUrl]: document({
          url: secondUrl,
          host: "decrypt.co",
          text: "<html><body><h1>Jupiter</h1><p>The protocol was co-founded by Meow in 2021.</p></body></html>",
          contentHash: "c".repeat(64),
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "founder",
        value: "Meow",
        status: "corroborated",
        sources: [
          expect.objectContaining({ url: firstUrl }),
          expect.objectContaining({ url: secondUrl }),
        ],
      }),
    ]);
  });

  it("reuses an already verified first-party team URL as a source candidate", async () => {
    const { ctx, evidence } = context();
    evidence.webTeam = [{
      name: "Meow",
      role: "Co-founder",
      evidence: "direct role statement on https://docs.jup.ag/tokenomics",
      source: "Jupiter tokenomics",
      sourceUrl: "https://docs.jup.ag/tokenomics",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "team-page",
    }];
    const result = await collectBasicFacts(ctx, {
      discover: async () => [lead({ sourceUrl: "https://bitget.com/jupiter-founders" })],
      fetchSource: fetchDocuments({
        "https://docs.jup.ag/tokenomics": document({
          url: "https://docs.jup.ag/tokenomics",
          host: "docs.jup.ag",
          text: "<html><body><h1>Jupiter tokenomics</h1><p>Jupiter was co-founded by Meow to improve swaps on Solana.</p></body></html>",
          contentHash: "d".repeat(64),
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "founder",
        value: "Meow",
        status: "verified",
        sources: [expect.objectContaining({
          url: "https://docs.jup.ag/tokenomics",
          sourceClass: "official_subject",
        })],
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

  it("does not stitch subject, value, and predicate from distant page sections", () => {
    expect(verifyBasicFactLead(
      lead(),
      document({
        text: `<html><body><h1>Jupiter</h1>${"<p>Market data was discussed without naming a team.</p>".repeat(20)}<p>Meow founded another company.</p></body></html>`,
      }),
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
