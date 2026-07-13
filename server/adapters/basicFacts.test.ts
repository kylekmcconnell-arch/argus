import { describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFactLead } from "../../src/data/evidence";
import { SubjectClass, VentureOutcome } from "../../src/engine";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";
import type { CollectContext } from "./types";
import {
  collectBasicFacts,
  basicFactsResearchQuestions,
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
  evidence.roles = [SubjectClass.PROJECT];
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
    const requestBodies: Record<string, unknown>[] = [];
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
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

    expect(requestBodies).toHaveLength(3);
    const prompts = requestBodies.map((body) =>
      ((body.messages as Array<{ content?: string }> | undefined)?.[0]?.content ?? ""));
    expect(prompts.every((prompt) => prompt.includes(
      "copy the source's exact as-of date or reporting period into qualifier",
    ))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes("Never infer, normalize, or invent a date"))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes("traction as-of/reporting period present in exact_excerpt"))).toBe(true);
    expect(prompts.join("\n")).toContain("[project.founder]");
    expect(prompts.join("\n")).toContain("[project.official_token]");
    expect(prompts.join("\n")).toContain("publicly traded equity or debt security");
    expect(prompts.join("\n")).toContain("attributed_entity and event_status");
  });

  it("uses different question ledgers for projects, founders, and investors", () => {
    const { ctx } = context();
    const project = basicFactsResearchQuestions(ctx);
    expect(project.map((question) => question.id)).toEqual(expect.arrayContaining([
      "project.founder",
      "project.product",
      "project.official_token",
    ]));
    expect(project.some((question) => question.id === "project.current_role")).toBe(false);
    expect(project.filter((question) => question.critical).map((question) => question.id)).toEqual(expect.arrayContaining([
      "project.launched",
      "project.network",
      "project.funding",
      "project.repository",
      "project.traction",
      "project.legal_entity",
      "project.governance",
      "project.audit",
    ]));

    ctx.evidence.roles = [SubjectClass.FOUNDER];
    const founder = basicFactsResearchQuestions(ctx);
    expect(founder.map((question) => question.id)).toEqual(expect.arrayContaining([
      "person.current_role",
      "person.prior_role",
      "person.education",
      "person.exit",
      "person.track_record",
      "person.official_token",
      "person.public_security",
      "person.legal_regulatory_event",
      "person.control",
      "person.conflict_of_interest",
    ]));
    expect(founder.find((question) => question.id === "person.founder")?.critical).toBe(true);
    expect(founder.find((question) => question.id === "person.track_record")?.critical).toBe(true);

    ctx.evidence.roles = [SubjectClass.INVESTOR, SubjectClass.FOUNDER];
    const investor = basicFactsResearchQuestions(ctx);
    expect(investor.map((question) => question.id)).toEqual(expect.arrayContaining([
      "investor.current_role",
      "investor.founder",
      "investor.investor",
      "investor.track_record",
      "investor.legal_regulatory_event",
    ]));
    expect(investor.find((question) => question.id === "investor.investor")?.critical).toBe(true);
    expect(investor.find((question) => question.id === "investor.founder")?.critical).toBe(true);
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

  it("keeps a legitimate combined title as one current-role relationship", () => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Chair and CEO at Coinbase",
        exact_excerpt: "Brian Armstrong is Chair and CEO at Coinbase.",
        source_url: "https://www.coinbase.com/about",
      }],
    }))).toEqual([
      expect.objectContaining({
        predicate: "current_role",
        value: "Chair and CEO at Coinbase",
      }),
    ]);
  });

  it("rejects legal-event leads without exact entity and status fields", () => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Hayden Adams",
        predicate: "legal_regulatory_event",
        value: "CFTC settlement",
        exact_excerpt: "Uniswap Labs settled a CFTC matter.",
        source_url: "https://www.cftc.gov/example",
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

  it("binds each model answer to a matching role-aware question", () => {
    const { ctx } = context();
    const questions = basicFactsResearchQuestions(ctx).filter((question) =>
      ["project.founder", "project.official_token"].includes(question.id));
    const parsed = parseBasicFactLeads(JSON.stringify({
      facts: [
        {
          question_id: "project.founder",
          subject: "Jupiter",
          predicate: "founder",
          value: "Meow",
          exact_excerpt: "Jupiter was founded by Meow.",
          source_url: "https://jup.ag/about",
        },
        {
          question_id: "project.official_token",
          subject: "Jupiter",
          predicate: "founder",
          value: "Wrong predicate",
          exact_excerpt: "Jupiter was founded by Wrong predicate.",
          source_url: "https://jup.ag/wrong",
        },
      ],
    }), "Jupiter", "claude-web-search", questions);

    expect(parsed).toEqual([
      expect.objectContaining({ questionId: "project.founder", predicate: "founder", value: "Meow" }),
    ]);
  });

  it("keeps required due-diligence categories when more than 28 facts are returned", () => {
    const founders = Array.from({ length: 28 }, (_, index) => ({
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

    expect(parsed).toHaveLength(28);
    expect(parsed?.map((fact) => fact.predicate)).toEqual([
      ...Array.from({ length: 22 }, () => "founder"),
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
  it("marks an explicit completed no-match without calling the provider unavailable", async () => {
    const { ctx, evidence } = context();
    const result = await collectBasicFacts(ctx, {
      discover: async () => [],
      fetchSource: vi.fn(),
    });

    expect(result).toEqual(expect.objectContaining({
      state: "partial",
      detail: expect.stringContaining("search completed"),
      explicitEmptyChecks: ["project-transparency"],
    }));
    expect(evidence.basicFactLeads).toEqual([]);
    expect(evidence.basicFacts).toEqual([]);
    expect(evidence.basicFactQuestionLedger?.every((entry) =>
      entry.providerRuns[0]?.state === "completed_empty")).toBe(true);
  });

  it("repairs only critical questions that remain unanswered after source verification", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    const primaryUrl = "https://alice.example/about";
    const repairUrl = "https://alice.example/work";
    let repairQuestions: readonly { id: string; critical: boolean }[] = [];

    const result = await collectBasicFacts(ctx, {
      discover: async () => [lead({
        subject: "Alice",
        predicate: "current_role",
        value: "CEO at Acme",
        questionId: "person.current_role",
        excerpt: "Alice currently serves as CEO at Acme.",
        sourceUrl: primaryUrl,
      })],
      repair: async (_repairContext, questions) => {
        repairQuestions = questions;
        return [lead({
          subject: "Alice",
          predicate: "founder",
          value: "Acme",
          questionId: "person.founder",
          excerpt: "Alice founded Acme.",
          sourceUrl: repairUrl,
          provider: "grok",
        })];
      },
      fetchSource: fetchDocuments({
        [primaryUrl]: document({
          url: primaryUrl,
          host: "alice.example",
          text: "<html><body><p>Alice currently serves as CEO at Acme.</p></body></html>",
          contentHash: "b".repeat(64),
        }),
        [repairUrl]: document({
          url: repairUrl,
          host: "alice.example",
          text: "<html><body><p>Alice founded Acme.</p></body></html>",
          contentHash: "c".repeat(64),
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(repairQuestions.length).toBeGreaterThan(0);
    expect(repairQuestions.every((question) => question.critical)).toBe(true);
    expect(repairQuestions.map((question) => question.id)).toContain("person.founder");
    expect(repairQuestions.map((question) => question.id)).not.toContain("person.current_role");
    expect(evidence.basicFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: "current_role", value: "CEO at Acme", questionId: "person.current_role" }),
      expect.objectContaining({ predicate: "founder", value: "Acme", questionId: "person.founder" }),
    ]));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.current_role"))
      .toEqual(expect.objectContaining({ status: "answered", providerRuns: [expect.objectContaining({ phase: "primary" })] }));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.founder"))
      .toEqual(expect.objectContaining({
        status: "answered",
        providerRuns: [
          expect.objectContaining({ phase: "primary" }),
          expect.objectContaining({ phase: "repair", state: "succeeded" }),
        ],
      }));
  });

  it("does not let a thin Jupiter pass suppress repair of obvious project facts", async () => {
    const { ctx } = context();
    const primary = [
      lead({
        predicate: "official_identity",
        value: "Jupiter",
        questionId: "project.official_identity",
        excerpt: "Jupiter is the official Solana exchange project.",
        sourceUrl: "https://jup.ag/identity",
      }),
      lead({ questionId: "project.founder" }),
      lead({
        predicate: "executive",
        value: "Siong Ong",
        questionId: "project.executive",
        excerpt: "Jupiter CEO Siong Ong leads the exchange project.",
        sourceUrl: "https://jup.ag/executive",
      }),
      lead({
        predicate: "product",
        value: "Jupiter Swap",
        questionId: "project.product",
        excerpt: "Jupiter Swap is Jupiter's live exchange product.",
        sourceUrl: "https://jup.ag/product",
      }),
      lead({
        predicate: "official_token",
        value: "JUP",
        questionId: "project.official_token",
        excerpt: "Jupiter's official token is JUP.",
        sourceUrl: "https://jup.ag/token",
      }),
    ];
    const repairIds: string[] = [];
    await collectBasicFacts(ctx, {
      discover: async () => primary,
      repair: async (_repairContext, questions) => {
        repairIds.push(...questions.map((question) => question.id));
        return [];
      },
      fetchSource: fetchDocuments(Object.fromEntries(primary.map((fact, index) => [
        fact.sourceUrl,
        document({
          url: fact.sourceUrl,
          text: `<html><body><p>${fact.excerpt}</p></body></html>`,
          contentHash: String(index + 1).repeat(64),
        }),
      ]))),
    });

    expect(repairIds).toEqual(expect.arrayContaining([
      "project.launched",
      "project.network",
      "project.funding",
      "project.repository",
      "project.traction",
      "project.legal_entity",
      "project.governance",
      "project.audit",
    ]));
  });

  it("does not turn a failed provider pass into an explicit empty result", async () => {
    const { ctx, evidence } = context();
    const result = await collectBasicFacts(ctx, {
      discover: async () => ({
        provider: "claude-web-search",
        state: "failed",
        leads: [],
        attempts: 1,
        completedBatches: 0,
        failedBatches: 3,
      }),
      fetchSource: vi.fn(),
    });

    expect(result).toEqual(expect.objectContaining({ state: "failed" }));
    expect(result).not.toHaveProperty("explicitEmptyChecks");
    expect(evidence.basicFactQuestionLedger?.every((entry) =>
      entry.providerRuns[0]?.state === "failed")).toBe(true);
  });

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

  it("treats a leading ticker dollar sign as formatting, not a token conflict", async () => {
    const { ctx, evidence } = context();
    const plainUrl = "https://jup.ag/token";
    const prefixedUrl = "https://docs.jup.ag/token";
    const result = await collectBasicFacts(ctx, {
      discover: async () => [
        lead({
          predicate: "official_token",
          value: "JUP",
          excerpt: "Jupiter's official token is JUP.",
          sourceUrl: plainUrl,
        }),
        lead({
          predicate: "official_token",
          value: "$JUP",
          excerpt: "The official Jupiter token is $JUP.",
          sourceUrl: prefixedUrl,
        }),
      ],
      fetchSource: fetchDocuments({
        [plainUrl]: document({
          url: plainUrl,
          text: "<html><body><p>Jupiter's official token is JUP.</p></body></html>",
          contentHash: "b".repeat(64),
        }),
        [prefixedUrl]: document({
          url: prefixedUrl,
          host: "docs.jup.ag",
          text: "<html><body><p>The official Jupiter token is $JUP.</p></body></html>",
          contentHash: "c".repeat(64),
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "official_token",
        value: "JUP",
        normalizedValue: "jup",
        status: "verified",
        sources: [
          expect.objectContaining({ url: plainUrl }),
          expect.objectContaining({ url: prefixedUrl }),
        ],
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
    expect(fetchSource).toHaveBeenCalledTimes(32);
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

  it("preserves legal-event status and attribution only when the fetched passage states both", () => {
    const supported = verifyBasicFactLead(
      lead({
        subject: "Acme",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        questionId: "project.legal_regulatory_event",
        eventStatus: "resolved",
        attributedEntity: "Acme",
        excerpt: "Acme entered an SEC settlement, and the matter is resolved.",
        sourceUrl: "https://acme.example/legal",
      }),
      document({
        url: "https://acme.example/legal",
        host: "acme.example",
        text: "<html><body><p>Acme entered an SEC settlement, and the matter is resolved.</p></body></html>",
      }),
      ["Acme"],
      "@acme",
      ["acme.example"],
    );
    const inventedStatus = verifyBasicFactLead(
      lead({
        subject: "Acme",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        eventStatus: "dismissed",
        attributedEntity: "Acme",
        excerpt: "Acme entered an SEC settlement, and the matter is resolved.",
        sourceUrl: "https://acme.example/legal",
      }),
      document({
        url: "https://acme.example/legal",
        host: "acme.example",
        text: "<html><body><p>Acme entered an SEC settlement, and the matter is resolved.</p></body></html>",
      }),
      ["Acme"],
      "@acme",
      ["acme.example"],
    );

    expect(supported).toEqual(expect.objectContaining({
      questionId: "project.legal_regulatory_event",
      eventStatus: "resolved",
      attributedEntity: "Acme",
      attributionScope: "direct_subject",
    }));
    expect(inventedStatus).toBeNull();
  });

  it("keeps a company legal event that mentions the founder as related-entity context", () => {
    const fact = verifyBasicFactLead(
      lead({
        subject: "Hayden Adams",
        predicate: "legal_regulatory_event",
        value: "CFTC settlement",
        eventStatus: "settled",
        attributedEntity: "Uniswap Labs",
        excerpt: "Uniswap Labs, founded by Hayden Adams, settled the CFTC settlement.",
        sourceUrl: "https://www.cftc.gov/uniswap-labs",
      }),
      document({
        url: "https://www.cftc.gov/uniswap-labs",
        host: "www.cftc.gov",
        text: "<html><body><p>Uniswap Labs, founded by Hayden Adams, settled the CFTC settlement.</p></body></html>",
      }),
      ["Hayden Adams", "@haydenadams"],
      "@haydenadams",
    );

    expect(fact).toEqual(expect.objectContaining({
      status: "verified",
      attributedEntity: "Uniswap Labs",
      eventStatus: "settled",
      attributionScope: "related_entity",
    }));
  });

  it("keeps conflicting statuses for the same attributed legal event separate and conflicted", async () => {
    const { ctx, evidence } = context("https://hayden.example");
    evidence.profile.display_name = "Hayden Adams";
    evidence.profile.resolved_name = "Hayden Adams";
    evidence.roles = [SubjectClass.FOUNDER];
    const pendingUrl = "https://www.cftc.gov/hayden-pending";
    const closedUrl = "https://www.sec.gov/hayden-closed";
    await collectBasicFacts(ctx, {
      discover: async () => [
        lead({
          subject: "Hayden Adams",
          predicate: "legal_regulatory_event",
          value: "CFTC investigation",
          questionId: "person.legal_regulatory_event",
          eventStatus: "pending",
          attributedEntity: "Hayden Adams",
          excerpt: "Hayden Adams CFTC investigation is pending.",
          sourceUrl: pendingUrl,
        }),
        lead({
          subject: "Hayden Adams",
          predicate: "legal_regulatory_event",
          value: "CFTC investigation",
          questionId: "person.legal_regulatory_event",
          eventStatus: "closed",
          attributedEntity: "Hayden Adams",
          excerpt: "Hayden Adams CFTC investigation is closed.",
          sourceUrl: closedUrl,
        }),
      ],
      fetchSource: fetchDocuments({
        [pendingUrl]: document({
          url: pendingUrl,
          host: "www.cftc.gov",
          text: "<html><body><p>Hayden Adams CFTC investigation is pending.</p></body></html>",
          contentHash: "d".repeat(64),
        }),
        [closedUrl]: document({
          url: closedUrl,
          host: "www.sec.gov",
          text: "<html><body><p>Hayden Adams CFTC investigation is closed.</p></body></html>",
          contentHash: "e".repeat(64),
        }),
      }),
    });

    const events = evidence.basicFacts?.filter((fact) => fact.predicate === "legal_regulatory_event") ?? [];
    expect(events).toHaveLength(2);
    expect(new Set(events.map((fact) => fact.factId)).size).toBe(2);
    expect(events.map((fact) => fact.eventStatus).sort()).toEqual(["closed", "pending"]);
    expect(events.every((fact) => fact.status === "conflicted")).toBe(true);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.legal_regulatory_event"))
      .toEqual(expect.objectContaining({ status: "unanswered", answerRefs: [] }));
  });

  it("accepts a verified venture's first-party page as official counterparty evidence", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.MEMBER];
    evidence.ventures.push({
      project_name: "Acme",
      domain: "acme.example",
      role: "Advisor",
      period: "2020 to 2022",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://acme.example/team",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const sourceUrl = "https://acme.example/team";
    const result = await collectBasicFacts(ctx, {
      discover: async () => [lead({
        subject: "Alice",
        predicate: "prior_role",
        value: "Advisor at Acme",
        questionId: "person.prior_role",
        excerpt: "Alice previously served as Advisor at Acme.",
        sourceUrl,
      })],
      fetchSource: fetchDocuments({
        [sourceUrl]: document({
          url: sourceUrl,
          host: "acme.example",
          text: "<html><body><p>Alice previously served as Advisor at Acme.</p></body></html>",
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "prior_role",
        status: "verified",
        sources: [expect.objectContaining({ sourceClass: "official_counterparty" })],
      }),
    ]);
  });

  it("treats an exact regulator passage as primary legal evidence", () => {
    const fact = verifyBasicFactLead(
      lead({
        subject: "Acme",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        eventStatus: "settled",
        attributedEntity: "Acme",
        excerpt: "The SEC announced that Acme settled the SEC settlement.",
        sourceUrl: "https://www.sec.gov/newsroom/acme",
      }),
      document({
        url: "https://www.sec.gov/newsroom/acme",
        host: "www.sec.gov",
        text: "<html><body><p>The SEC announced that Acme settled the SEC settlement.</p></body></html>",
      }),
      ["Acme"],
      "@acme",
      ["acme.example"],
    );

    expect(fact).toEqual(expect.objectContaining({
      status: "verified",
      eventStatus: "settled",
      attributedEntity: "Acme",
      sources: [expect.objectContaining({ sourceClass: "regulatory_or_onchain" })],
    }));
  });

  it("does not transfer a company-only legal event to its founder", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Alice",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        eventStatus: "settled",
        attributedEntity: "Alice",
        excerpt: "Acme entered an SEC settlement.",
        sourceUrl: "https://www.sec.gov/newsroom/acme",
      }),
      document({
        url: "https://www.sec.gov/newsroom/acme",
        host: "www.sec.gov",
        text: "<html><body><p>Acme entered an SEC settlement.</p></body></html>",
      }),
      ["Alice"],
      "@alice",
      ["alice.example"],
    )).toBeNull();
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
