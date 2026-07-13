import { describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFactLead } from "../../src/data/evidence";
import { SubjectClass, VentureOutcome } from "../../src/engine";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";
import type { CollectContext } from "./types";
import {
  collectBasicFacts,
  basicFactsResearchQuestions,
  discoverBasicFactLeads,
  discoverBasicFactLeadsDetailed,
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
    expect(founder.find((question) => question.id === "person.public_security")?.critical).toBe(true);
    expect(founder.find((question) => question.id === "person.official_token")?.critical).toBe(true);

    // Founder routing can crystallize from the facts collected in this pass.
    // The generic-person ledger must therefore repair the two asset questions
    // before that later routing decision, rather than discovering them too late.
    ctx.evidence.roles = [SubjectClass.MEMBER];
    const person = basicFactsResearchQuestions(ctx);
    expect(person.find((question) => question.id === "person.public_security")?.critical).toBe(true);
    expect(person.find((question) => question.id === "person.official_token")?.critical).toBe(true);

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
    expect(investor.find((question) => question.id === "investor.public_security")?.critical).toBe(true);
    expect(investor.find((question) => question.id === "investor.official_token")?.critical).toBe(true);
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

  it.each([
    ["official_token", "none"],
    ["official_token", "No official token"],
    ["public_security", "not applicable"],
  ] as const)("does not publish %s placeholder value %s as an asset lead", (predicate, value) => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        question_id: `person.${predicate}`,
        subject: "Alice",
        predicate,
        value,
        exact_excerpt: `A search article reported ${value}.`,
        source_url: "https://news.example/asset-search",
      }],
    }), "Alice", "claude-web-search", [{
      id: `person.${predicate}`,
      audience: "person",
      batch: "structure_risk",
      predicate,
      question: "Targeted asset question",
      critical: true,
    }])).toEqual([]);
  });
});

describe("question-specific asset search", () => {
  it("records completed-empty only after separate attributable web searches", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    const prompts: string[] = [];
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
      prompts.push(body.messages?.[0]?.content ?? "");
      return new Response(JSON.stringify({
        content: [{ type: "text", text: '{"facts":[]}' }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          server_tool_use: { web_search_requests: 1 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const assetQuestions = basicFactsResearchQuestions(ctx).filter((question) =>
      question.predicate === "public_security" || question.predicate === "official_token");

    const result = await discoverBasicFactLeadsDetailed(ctx, {
      request,
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, assetQuestions, "repair");

    expect(request).toHaveBeenCalledTimes(2);
    expect(prompts).toHaveLength(2);
    expect(prompts.filter((prompt) => prompt.includes("[person.public_security]")).every((prompt) =>
      !prompt.includes("[person.official_token]"))).toBe(true);
    expect(prompts.filter((prompt) => prompt.includes("[person.official_token]")).every((prompt) =>
      !prompt.includes("[person.public_security]"))).toBe(true);
    expect(prompts.join("\n")).toContain("issuer's investor-relations site or an official regulator filing");
    expect(prompts.join("\n")).toContain("never serialize none, no token");
    expect(result.questionStates).toEqual({
      "person.public_security": "completed_empty",
      "person.official_token": "completed_empty",
    });
    expect(result.questionProviders).toEqual({
      "person.public_security": "claude-web-search",
      "person.official_token": "claude-web-search",
    });
  });

  it("keeps an empty model answer unresolved when no web-search use is attributable", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    const question = basicFactsResearchQuestions(ctx).filter((candidate) =>
      candidate.predicate === "official_token");
    const result = await discoverBasicFactLeadsDetailed(ctx, {
      request: async () => new Response(JSON.stringify({
        content: [{ type: "text", text: '{"facts":[]}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, question, "repair");

    expect(result.questionStates).toEqual({ "person.official_token": "partial" });
  });

  it("does not call a nonempty raw answer completed-empty when every row is filtered", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    const question = basicFactsResearchQuestions(ctx).filter((candidate) =>
      candidate.predicate === "official_token");
    const result = await discoverBasicFactLeadsDetailed(ctx, {
      request: async () => new Response(JSON.stringify({
        content: [{
          type: "text",
          text: JSON.stringify({
            facts: [{
              question_id: "person.official_token",
              subject: "Alice",
              predicate: "official_token",
              value: "none",
              exact_excerpt: "A news article said no official token was planned.",
              source_url: "https://news.example/no-token-plan",
            }],
          }),
        }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          server_tool_use: { web_search_requests: 1 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, question, "repair");

    expect(result.leads).toEqual([]);
    expect(result.questionStates).toEqual({ "person.official_token": "partial" });
    expect(result.detail).toContain("partial_1_raw_facts_filtered");
  });
});

describe("basic-facts source verification", () => {
  it("does not turn one empty batch into a checked-empty result for every question", async () => {
    const { ctx, evidence } = context();
    const result = await collectBasicFacts(ctx, {
      discover: async () => [],
      fetchSource: vi.fn(),
    });

    expect(result).toEqual(expect.objectContaining({
      state: "partial",
      detail: expect.stringContaining("individual questions remain unresolved"),
    }));
    expect(result).not.toHaveProperty("explicitEmptyChecks");
    expect(evidence.basicFactLeads).toEqual([]);
    expect(evidence.basicFacts).toEqual([]);
    expect(evidence.basicFactQuestionLedger?.every((entry) =>
      entry.providerRuns[0]?.state === "partial")).toBe(true);
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

  it("verifies a live-shaped role when the official title reorders the same structured value", () => {
    const sourceUrl = "https://investor.coinbase.com/news/news-details/2025/Coinbase-to-Host-X-Spaces-With-Co-Founder-and-CEO-Brian-Armstrong-and-CFO-Alesia-Haas/default.aspx";
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Co-Founder and CEO, Coinbase",
        excerpt: "Coinbase to Host X Spaces With Co-Founder and CEO Brian Armstrong and CFO Alesia Haas",
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: "<html><head><title>Coinbase to Host X Spaces With Co-Founder and CEO Brian Armstrong and CFO Alesia Haas</title></head><body></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "current_role",
      value: "Co-Founder and CEO, Coinbase",
      status: "verified",
    }));
  });

  it("does not assign the CFO in a shared leadership title to Brian Armstrong", () => {
    const sourceUrl = "https://investor.coinbase.com/news/leadership-event";
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "CFO, Coinbase",
        excerpt: "Coinbase to Host X Spaces With Co-Founder and CEO Brian Armstrong and CFO Alesia Haas.",
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: "<html><body><h1>Coinbase to Host X Spaces With Co-Founder and CEO Brian Armstrong and CFO Alesia Haas.</h1></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    )).toBeNull();
  });

  it("binds coordinated executive titles by the source's respectively ordering", () => {
    const passage = "Brian Armstrong and Alesia Haas are CEO and CFO of Coinbase, respectively.";
    const sourceUrl = "https://investor.coinbase.com/governance/leadership";
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "CEO, Coinbase",
        excerpt: passage,
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: `<p>${passage}</p>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["https://investor.coinbase.com"],
    )).toEqual(expect.objectContaining({
      predicate: "current_role",
      value: "CEO, Coinbase",
      status: "verified",
    }));
  });

  it("verifies the common Chief Executive title without requiring the word Officer", () => {
    const passage = "Brian Armstrong is the Chief Executive of Coinbase.";
    const sourceUrl = "https://investor.coinbase.com/governance/leadership";
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Chief Executive, Coinbase",
        excerpt: passage,
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: `<p>${passage}</p>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["https://investor.coinbase.com"],
    )).toEqual(expect.objectContaining({
      predicate: "current_role",
      value: "Chief Executive, Coinbase",
      status: "verified",
    }));
  });

  it("binds expanded executive titles and does not hardcode one company name", () => {
    const brian = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "CEO, Coinbase",
        excerpt: "Brian Armstrong currently serves as the Chief Executive Officer of Coinbase.",
        sourceUrl: "https://investor.coinbase.com/leadership",
      }),
      document({
        url: "https://investor.coinbase.com/leadership",
        host: "investor.coinbase.com",
        text: "<p>Brian Armstrong currently serves as the Chief Executive Officer of Coinbase.</p>",
      }),
      ["Brian Armstrong"],
      "@brian_armstrong",
      ["https://investor.coinbase.com"],
    );
    const alice = verifyBasicFactLead(
      lead({
        subject: "Alice Smith",
        predicate: "current_role",
        value: "CEO, Acme Labs",
        excerpt: "Alice Smith is Acme Labs CEO.",
        sourceUrl: "https://acme.example/team",
      }),
      document({
        url: "https://acme.example/team",
        host: "acme.example",
        text: "<p>Alice Smith is Acme Labs CEO.</p>",
      }),
      ["Alice Smith"],
      "@alice",
      ["https://acme.example"],
    );

    expect(brian).toEqual(expect.objectContaining({ value: "CEO, Coinbase", status: "verified" }));
    expect(alice).toEqual(expect.objectContaining({ value: "CEO, Acme Labs", status: "verified" }));
  });

  it("binds single-name crypto leaders to their own role", () => {
    const passage = "Jupiter leadership: Founder Meow, CTO Siong.";
    const source = document({ text: `<p>${passage}</p>` });
    const meowFounder = lead({
      subject: "Meow",
      predicate: "current_role",
      value: "Founder, Jupiter",
      excerpt: passage,
    });
    const meowCto = { ...meowFounder, value: "CTO, Jupiter" };

    expect(verifyBasicFactLead(meowFounder, source, ["Meow"], "@weremeow", ["https://jup.ag"]))
      .toEqual(expect.objectContaining({ value: "Founder, Jupiter", status: "verified" }));
    expect(verifyBasicFactLead(meowCto, source, ["Meow"], "@weremeow", ["https://jup.ag"]))
      .toBeNull();
  });

  it("binds each project executive's name and title as one pair", () => {
    const passage = "Jupiter leadership: CEO Meow, CTO Siong.";
    const source = document({ text: `<p>${passage}</p>` });
    const executive = (value: string) => verifyBasicFactLead(
      lead({ predicate: "executive", value, excerpt: passage }),
      source,
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    );

    expect(executive("CEO Meow")).toEqual(expect.objectContaining({ value: "CEO Meow" }));
    expect(executive("CTO Siong")).toEqual(expect.objectContaining({ value: "CTO Siong" }));
    expect(executive("CTO Meow")).toBeNull();
    expect(executive("CEO Siong")).toBeNull();
  });

  it("attributes a verified reader-recovered passage without replacing its evidence URL", () => {
    const sourceUrl = "https://investor.coinbase.com/governance/board-of-directors/default.aspx";
    const recovered = {
      ...document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        contentType: "text/plain",
        text: "Brian Armstrong is the co-founder and CEO of Coinbase.",
      }),
      retrievalMethod: "reader_recovery" as const,
      retrievalProvider: "jina-reader" as const,
      retrievalUrl: `https://r.jina.ai/${sourceUrl}`,
    };

    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Co-Founder and CEO, Coinbase",
        excerpt: "Brian Armstrong is the co-founder and CEO of Coinbase.",
        sourceUrl,
      }),
      recovered,
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact?.sources[0]).toEqual(expect.objectContaining({
      url: sourceUrl,
      provider: "jina-reader",
      artifactVerified: true,
    }));
  });

  it("verifies an official biography role despite connective words and punctuation", () => {
    const sourceUrl = "https://investor.coinbase.com/governance/board-of-directors/default.aspx";
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "prior_role",
        value: "Software engineer, Airbnb",
        excerpt: "Brian Armstrong. Before our founding, Mr. Armstrong served as a software engineer at Airbnb, Inc.",
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: "<html><body><h2>Brian Armstrong</h2><p>Before our founding, Mr. Armstrong served as a software engineer at Airbnb, Inc.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "prior_role",
      value: "Software engineer, Airbnb",
      status: "verified",
    }));
  });

  it("verifies a Coinbase-board-shaped biography from bounded JSON-LD", () => {
    const sourceUrl = "https://investor.coinbase.com/governance/board-of-directors/default.aspx";
    const schema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Brian Armstrong",
      jobTitle: "Co-Founder, Chief Executive Officer and Chairman of the Board",
      description: "<p>Brian Armstrong is our co-founder and has served as our Chief Executive Officer since our inception in May 2012. Before our founding, Mr. Armstrong served as a software engineer at Airbnb, Inc., from May 2011 to June 2012.</p>",
    });
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "prior_role",
        value: "Software engineer, Airbnb",
        excerpt: "Before our founding, Mr. Armstrong served as a software engineer at Airbnb, Inc., from May 2011 to June 2012.",
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: `<html><body><script type="application/ld+json">${schema}</script><div id="app"></div></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "prior_role",
      value: "Software engineer, Airbnb",
      status: "verified",
      sources: [expect.objectContaining({
        excerpt: expect.stringContaining("software engineer at Airbnb"),
      })],
    }));
    expect(fact?.sources[0]?.excerpt).not.toContain("<p");
  });

  it("never treats an arbitrary executable script as evidence text", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "prior_role",
        value: "Software engineer, Airbnb",
        excerpt: "Brian Armstrong served as a software engineer at Airbnb.",
      }),
      document({
        text: "<html><body><script>window.fake = 'Brian Armstrong served as a software engineer at Airbnb.'</script><div id='app'></div></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["jup.ag"],
    )).toBeNull();
  });

  it("never joins separate JSON-LD people into one role claim", () => {
    const schema = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Person",
          name: "Brian Armstrong",
          description: "Brian Armstrong works at Coinbase.",
        },
        {
          "@type": "Person",
          name: "Alesia Haas",
          jobTitle: "Chief Financial Officer",
        },
      ],
    });

    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Chief Financial Officer, Coinbase",
        excerpt: "Brian Armstrong works at Coinbase. Alesia Haas is Chief Financial Officer.",
        sourceUrl: "https://investor.coinbase.com/governance/leadership/default.aspx",
      }),
      document({
        url: "https://investor.coinbase.com/governance/leadership/default.aspx",
        host: "investor.coinbase.com",
        text: `<html><body><script type="application/ld+json">${schema}</script></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    )).toBeNull();
  });

  it("accepts co-founder and inception language for a dated founding fact", () => {
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "founded",
        value: "Coinbase (May 2012)",
        excerpt: "Brian Armstrong was a Coinbase co-founder at its inception in May 2012.",
        sourceUrl: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      }),
      document({
        url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
        host: "investor.coinbase.com",
        text: "<html><body><p>Brian Armstrong was a Coinbase co-founder at its inception in May 2012.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "founded",
      value: "Coinbase (May 2012)",
      status: "verified",
    }));
  });

  it("uses a verified counterparty host only for a missing organization anchor", () => {
    const sourceUrl = "https://investor.coinbase.com/governance/board-of-directors/default.aspx";
    const passage = "Brian Armstrong is our co-founder and has served since our inception in May 2012.";
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "founded",
        value: "Coinbase (May 2012)",
        excerpt: passage,
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: "investor.coinbase.com",
        text: `<html><body><p>${passage}</p></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      [],
      ["coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "founded",
      value: "Coinbase (May 2012)",
      status: "verified",
      sources: [expect.objectContaining({ sourceClass: "official_counterparty" })],
    }));
  });

  it("never supplies a missing organization anchor from an unrelated host", () => {
    const passage = "Brian Armstrong is our co-founder and has served since our inception in May 2012.";
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "founded",
        value: "Coinbase (May 2012)",
        excerpt: passage,
        sourceUrl: "https://coinbase-report.example/brian",
      }),
      document({
        url: "https://coinbase-report.example/brian",
        host: "coinbase-report.example",
        text: `<html><body><p>${passage}</p></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      [],
      ["coinbase.com"],
    )).toBeNull();
  });

  it.each([
    [
      "product",
      "Coinbase cryptocurrency exchange platform",
      "Brian Armstrong built Coinbase, a cryptocurrency exchange used by customers globally.",
    ],
    [
      "exit",
      "Coinbase direct listing on Nasdaq (April 14, 2021)",
      "Brian Armstrong took Coinbase public through a direct listing on Nasdaq on April 14, 2021.",
    ],
    [
      "track_record",
      "Coinbase 108 million users (2023)",
      "Brian Armstrong led Coinbase as it reported 108 million users in 2023.",
    ],
    [
      "public_security",
      "COIN (Coinbase Global, Inc. Class A common stock, NASDAQ)",
      "Brian Armstrong is Coinbase's co-founder. Coinbase went public on Nasdaq under ticker COIN.",
    ],
  ] as const)("verifies a live-shaped %s value from the same fetched passage", (predicate, value, sentence) => {
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate,
        value,
        excerpt: sentence,
        sourceUrl: "https://investor.coinbase.com/evidence",
      }),
      document({
        url: "https://investor.coinbase.com/evidence",
        host: "investor.coinbase.com",
        text: `<html><body><p>${sentence}</p></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({ predicate, status: "verified" }));
    if (predicate === "public_security") {
      expect(fact?.value).toBe("COIN (Coinbase, NASDAQ-listed security)");
      expect(fact?.value).not.toContain("Class A");
    } else {
      expect(fact?.value).toBe(value);
    }
  });

  it("does not join one person's organization with another person's title", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "CEO, Coinbase",
        excerpt: "Brian Armstrong co-founded Coinbase. Alesia Haas is CEO.",
        sourceUrl: "https://example.com/leadership",
      }),
      document({
        url: "https://example.com/leadership",
        host: "example.com",
        text: "<html><body><p>Brian Armstrong co-founded Coinbase. Alesia Haas is CEO.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
    )).toBeNull();
  });

  it("binds a project founder to founder grammar, not another name in the sentence", () => {
    const passage = "Jupiter was founded by Meow and engineering is led by Siong.";
    const source = document({ text: `<html><body><p>${passage}</p></body></html>` });
    expect(verifyBasicFactLead(
      lead({ value: "Meow", excerpt: passage }),
      source,
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    )).toEqual(expect.objectContaining({ value: "Meow", status: "verified" }));
    expect(verifyBasicFactLead(
      lead({ value: "Siong", excerpt: passage }),
      source,
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["jup.ag"],
    )).toBeNull();
  });

  it("accepts each atomic member of an explicit founder list", () => {
    const passage = "Jupiter founders include Meow and Siong.";
    const source = document({ text: `<p>${passage}</p>` });
    for (const value of ["Meow", "Siong"]) {
      expect(verifyBasicFactLead(
        lead({ value, excerpt: passage }),
        source,
        ["Jupiter", "@JupiterExchange"],
        "@JupiterExchange",
        ["https://jup.ag"],
      )).toEqual(expect.objectContaining({ value, status: "verified" }));
    }
  });

  it.each([
    "Jupiter co-founder Meow introduced the protocol.",
    "Jupiter's co-founder is Meow.",
    "Meow, co-founder of Jupiter, introduced the protocol.",
    "Jupiter co-founders Meow and Siong introduced the protocol.",
  ])("verifies a common explicit founder construction: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({ value: "Meow", excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toEqual(expect.objectContaining({
      predicate: "founder",
      value: "Meow",
      status: "verified",
    }));
  });

  it.each([
    ["advisor", "Jupiter founders: Meow and advisor Siong."],
    ["investor", "Jupiter founders include Meow and investor Siong."],
    ["employee", "Jupiter founders are Meow and employee Siong."],
    ["director", "Jupiter founders include Meow and director Siong."],
  ] as const)("does not turn a listed %s into a founder", (_role, passage) => {
    expect(verifyBasicFactLead(
      lead({ value: "Siong", excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it.each([
    "Jupiter founder Meow interviewed Siong.",
    "Jupiter founder Meow said Siong leads engineering.",
    "Jupiter founder allegations named Siong in a complaint.",
  ])("does not turn a later unrelated person into the project's founder: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({ value: "Siong", excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it("does not transfer another company's metric through a shared sentence", () => {
    const passage = "Brian Armstrong leads Coinbase, while ResearchHub reported 108 million users in 2023.";
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "track_record",
        value: "Coinbase 108 million users (2023)",
        excerpt: passage,
        sourceUrl: "https://example.com/metrics",
      }),
      document({
        url: "https://example.com/metrics",
        host: "example.com",
        text: `<html><body><p>${passage}</p></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
    )).toBeNull();
  });

  it.each([
    ["official_token", "UNI", "Jupiter competes with Uniswap. Uniswap official token is UNI."],
    ["traction", "$1B monthly volume", "Jupiter competes with Acme. Acme reported $1B monthly volume."],
    ["funding", "$100 million Series A", "Jupiter competes with Acme. Acme raised a $100 million Series A."],
    ["audit", "Trail of Bits audit", "Jupiter competes with Acme. Acme completed a Trail of Bits audit."],
    ["network", "Ethereum", "Jupiter competes with Acme. Acme is deployed on Ethereum."],
    ["governance", "Acme DAO", "Jupiter competes with Acme. Acme governance is managed by the Acme DAO."],
    ["repository", "github.com/acme/repo", "Jupiter competes with Acme. Acme source code is at github.com/acme/repo."],
  ] as const)("does not transfer another project's %s fact", (predicate, value, passage) => {
    expect(verifyBasicFactLead(
      lead({ predicate, value, excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it("does not turn a nearby token denial into another project's token", () => {
    const passage = "Jupiter has no token. Uniswap official token is UNI.";
    expect(verifyBasicFactLead(
      lead({ predicate: "official_token", value: "UNI", excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it.each([
    ["funding", "$100 million Series A", "Jupiter and Acme Labs raised a $100 million Series A."],
    ["traction", "$1B monthly volume", "Jupiter partner Acme Labs reported $1B monthly volume."],
    ["funding", "$100 million Series A", "Jupiter partner Acme Labs raised a $100 million Series A."],
    ["funding", "$100 million Series A", "Jupiter announced Acme Labs raised a $100 million Series A."],
    ["audit", "Trail of Bits audit", "Jupiter portfolio company Acme Labs completed a Trail of Bits audit."],
    ["network", "Ethereum", "Jupiter integration partner Acme Labs is deployed on Ethereum."],
    ["governance", "Acme DAO", "Jupiter partner Acme Labs governance is managed by the Acme DAO."],
    ["official_token", "ACME", "Jupiter partner Acme Labs official token is ACME."],
    ["traction", "$1B monthly volume", "Jupiter said Acme Labs reported $1B monthly volume."],
  ] as const)("does not transfer a named related company's %s claim to the project", (predicate, value, passage) => {
    expect(verifyBasicFactLead(
      lead({ predicate, value, excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it.each([
    ["traction", "$1B monthly volume", "Jupiter partner acme labs reported $1B monthly volume."],
    ["traction", "$1B monthly volume", "Jupiter partner dYdX reported $1B monthly volume."],
    ["funding", "$100 million Series A", "Jupiter announced acme labs raised a $100 million Series A."],
    ["official_token", "ACME", "Jupiter partner acme labs official token is ACME."],
    ["funding", "$100 million Series A", "Jupiter announced that Acme Labs raised a $100 million Series A."],
    ["traction", "$1B monthly volume", "Jupiter said that Acme Labs reported $1B monthly volume."],
    ["funding", "$100 million Series A", "Jupiter reported that Acme Labs raised a $100 million Series A."],
    ["funding", "$100 million Series A", "Jupiter confirmed that Acme Labs raised a $100 million Series A."],
    ["funding", "$100 million Series A", "According to Jupiter, Acme Labs raised a $100 million Series A."],
    ["funding", "$100 million Series A", "Jupiter's partner, Acme Labs, raised a $100 million Series A."],
    ["traction", "$1B monthly volume", "Jupiter's portfolio company, Acme Labs, reported $1B monthly volume."],
    ["funding", "$100 million Series A", "Jupiter's announcement says Acme Labs raised a $100 million Series A."],
    ["official_token", "ACME", "Jupiter partner's official token is ACME."],
    ["official_token", "ACME", "Jupiter's subsidiary's official token is ACME."],
    ["funding", "$100 million Series A", "A $100 million Series A was raised by Acme Labs, according to Jupiter."],
    ["official_token", "ACME", "ACME is the official token of Acme Labs, Jupiter said."],
    ["traction", "$1B monthly volume", "Acme Labs reported $1B monthly volume, Jupiter confirmed."],
    ["audit", "Trail of Bits audit", "Acme Labs completed a Trail of Bits audit, Jupiter announced."],
    ["traction", "$1B monthly volume", "Jupiter reported $1B monthly volume for Acme Labs."],
    ["traction", "$1B monthly volume", "Jupiter reported $1B monthly volume generated by Acme Labs."],
    ["funding", "$100 million funding round", "Jupiter announced a $100 million funding round for Acme Labs."],
    ["audit", "Trail of Bits audit", "Jupiter completed a Trail of Bits audit for Acme Labs."],
    ["traction", "$1B monthly volume", "Jupiter reported that volume for Acme Labs reached $1B monthly volume."],
  ] as const)("does not transfer a lowercase, reported, appositive, or trailing-attribution %s claim", (predicate, value, passage) => {
    expect(verifyBasicFactLead(
      lead({ predicate, value, excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it.each([
    [
      "public_security",
      "COIN (Coinbase, NASDAQ)",
      "Brian Armstrong founded Coinbase. Coinbase partner Acme Global is publicly traded on Nasdaq under ticker COIN.",
    ],
    [
      "track_record",
      "Coinbase 108 million users",
      "Brian Armstrong led Coinbase. Coinbase partner Acme Global reported 108 million users.",
    ],
    [
      "track_record",
      "Coinbase 108 million users",
      "Brian Armstrong led Coinbase. Coinbase portfolio company Acme Global reported 108 million users.",
    ],
    [
      "track_record",
      "Coinbase 108 million users",
      "Brian Armstrong led Coinbase. Coinbase reported 108 million users for Acme Labs.",
    ],
  ] as const)("does not transfer a related company's %s through the subject's relationship anchor", (predicate, value, passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate,
        value,
        excerpt: passage,
        sourceUrl: "https://brianarmstrong.org/portfolio",
      }),
      document({
        url: "https://brianarmstrong.org/portfolio",
        host: "brianarmstrong.org",
        text: `<p>${passage}</p>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["https://brianarmstrong.org"],
    )).toBeNull();
  });

  it.each([
    ["audit", "Trail of Bits audit", "Jupiter announced the completion of its Trail of Bits audit."],
    ["traction", "$1B monthly volume", "Jupiter reported a record $1B monthly volume."],
    ["governance", "Proposal 42", "Jupiter announced the approval of governance Proposal 42."],
  ] as const)("preserves a clear subject-owned %s announcement", (predicate, value, passage) => {
    expect(verifyBasicFactLead(
      lead({ predicate, value, excerpt: passage }),
      document({ text: `<p>${passage}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toEqual(expect.objectContaining({ predicate, value, status: "verified" }));
  });

  it.each([
    ["funding", "$100 million funding round", "We announced that Acme Labs raised a $100 million funding round."],
    ["traction", "$1B monthly volume", "Our company partner Acme Labs reported $1B monthly volume."],
  ] as const)("does not transfer a peer's %s claim through official first-person context", (predicate, value, sentence) => {
    const passage = `Jupiter. ${sentence}`;
    expect(verifyBasicFactLead(
      lead({ predicate, value, excerpt: passage }),
      document({ text: `<h1>Jupiter</h1><p>${sentence}</p>` }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it.each([
    "Brian Armstrong leads Coinbase. Unlike Coinbase, ResearchHub reported 108 million users in 2023.",
    "Brian Armstrong leads Coinbase. Coinbase competitor ResearchHub reported 108 million users in 2023.",
  ])("does not transfer a competitor metric through an anchor mention", (passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "track_record",
        value: "Coinbase 108 million users (2023)",
        excerpt: passage,
      }),
      document({ text: `<p>${passage}</p>` }),
      ["Brian Armstrong"],
      "@brian_armstrong",
      ["https://brianarmstrong.org"],
    )).toBeNull();
  });

  it("does not transfer a competitor's listing to Coinbase", () => {
    const passage = "Brian Armstrong leads Coinbase. Unlike Coinbase, ResearchHub is listed on Nasdaq under ticker COIN.";
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "public_security",
        value: "COIN (Coinbase, NASDAQ)",
        excerpt: passage,
      }),
      document({ text: `<p>${passage}</p>` }),
      ["Brian Armstrong"],
      "@brian_armstrong",
      ["https://brianarmstrong.org"],
    )).toBeNull();
  });

  it("never inherits parent JSON-LD narrative into a nested person's role", () => {
    const schema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Coinbase",
      description: "Brian Armstrong works at Coinbase.",
      founder: {
        "@type": "Person",
        name: "Alesia Haas",
        jobTitle: "Chief Financial Officer",
      },
    });

    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Chief Financial Officer, Coinbase",
        excerpt: "Brian Armstrong works at Coinbase. Alesia Haas is Chief Financial Officer.",
        sourceUrl: "https://investor.coinbase.com/leadership",
      }),
      document({
        url: "https://investor.coinbase.com/leadership",
        host: "investor.coinbase.com",
        text: `<html><body><script type="application/ld+json">${schema}</script></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    )).toBeNull();
  });

  it("does not treat an unlabeled currency code as a public-security ticker", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "public_security",
        value: "USD (Coinbase, NASDAQ)",
        excerpt: "Coinbase reports revenue in USD and is publicly traded on Nasdaq.",
        sourceUrl: "https://investor.coinbase.com/results",
      }),
      document({
        url: "https://investor.coinbase.com/results",
        host: "investor.coinbase.com",
        text: "<html><body><p>Brian Armstrong co-founded Coinbase. Coinbase reports revenue in USD and is publicly traded on Nasdaq.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    )).toBeNull();
  });

  it("rejects a claimed exchange when the fetched source names a different venue", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "public_security",
        value: "COIN (Coinbase, NYSE)",
        excerpt: "Coinbase went public on Nasdaq under ticker COIN.",
        sourceUrl: "https://investor.coinbase.com/listing",
      }),
      document({
        url: "https://investor.coinbase.com/listing",
        host: "investor.coinbase.com",
        text: "<html><body><p>Brian Armstrong co-founded Coinbase. Coinbase went public on Nasdaq under ticker COIN.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    )).toBeNull();
  });

  it("accepts standard issuer-first exchange ticker notation without freezing unsupported class detail", () => {
    const passage = "Brian Armstrong co-founded Coinbase. Coinbase Global, Inc. (NASDAQ: COIN) is publicly traded.";
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "public_security",
        value: "Coinbase Global, Inc. (NASDAQ: COIN)",
        excerpt: passage,
        sourceUrl: "https://investor.coinbase.com/listing",
      }),
      document({
        url: "https://investor.coinbase.com/listing",
        host: "investor.coinbase.com",
        text: `<html><body><p>${passage}</p></body></html>`,
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["investor.coinbase.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "public_security",
      value: "COIN (Coinbase, NASDAQ-listed security)",
      status: "verified",
    }));
  });

  it("does not borrow a security class from another issuer", () => {
    const passage = "Brian Armstrong co-founded Coinbase. Coinbase went public on Nasdaq under ticker COIN. Acme has Class A common stock.";
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "public_security",
        value: "COIN (Coinbase Class A common stock, NASDAQ)",
        excerpt: passage,
      }),
      document({ text: `<p>${passage}</p>` }),
      ["Brian Armstrong"],
      "@brian_armstrong",
      ["https://brianarmstrong.org"],
    );
    expect(fact?.value).toBe("COIN (Coinbase, NASDAQ-listed security)");
  });

  it("does not borrow a metric qualifier from another company", () => {
    const passage = "Brian Armstrong led Coinbase as it reported 108 million users. ResearchHub launched in 2023.";
    const fact = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "track_record",
        value: "Coinbase 108 million users",
        qualifier: "2023",
        excerpt: passage,
      }),
      document({ text: `<p>${passage}</p>` }),
      ["Brian Armstrong"],
      "@brian_armstrong",
      ["https://brianarmstrong.org"],
    );
    expect(fact).toEqual(expect.objectContaining({ value: "Coinbase 108 million users" }));
    expect(fact).not.toHaveProperty("qualifier");
  });

  it("does not let fuzzy role structure substitute a different organization", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "Co-Founder and CEO, Coinbase",
        excerpt: "Brian Armstrong is co-founder and CEO of ResearchHub.",
        sourceUrl: "https://brianarmstrong.org/bio",
      }),
      document({
        url: "https://brianarmstrong.org/bio",
        host: "brianarmstrong.org",
        text: "<html><body><p>Brian Armstrong is co-founder and CEO of ResearchHub.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["brianarmstrong.org"],
    )).toBeNull();
  });

  it("does not let fuzzy track-record matching change a claimed metric", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "track_record",
        value: "Coinbase 108 million users (2023)",
        excerpt: "Brian Armstrong led Coinbase as it reported 98 million users in 2023.",
        sourceUrl: "https://coinbase.example/metrics",
      }),
      document({
        url: "https://coinbase.example/metrics",
        host: "coinbase.example",
        text: "<html><body><p>Brian Armstrong led Coinbase as it reported 98 million users in 2023.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["coinbase.example"],
    )).toBeNull();
  });

  it("does not let the same track-record numbers substitute a different metric", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "track_record",
        value: "Coinbase 108 million users (2023)",
        excerpt: "Brian Armstrong led Coinbase as it reported 108 million in trading volume in 2023.",
        sourceUrl: "https://coinbase.example/metrics",
      }),
      document({
        url: "https://coinbase.example/metrics",
        host: "coinbase.example",
        text: "<html><body><p>Brian Armstrong led Coinbase as it reported 108 million in trading volume in 2023.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["coinbase.example"],
    )).toBeNull();
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

  it("binds a related public security only through a verified current-control relationship and authoritative issuer evidence", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://coinbase.com",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "peopledatalabs",
    });
    const pressUrl = "https://forbes.example/coinbase";
    const issuerUrl = "https://investor.coinbase.com/";
    const securityLead = lead({
      subject: "Brian Armstrong",
      predicate: "public_security",
      value: "COIN (Coinbase Global, Inc., NASDAQ)",
      questionId: "person.public_security",
      excerpt: "Coinbase Global, Inc. is publicly traded on Nasdaq under ticker COIN.",
      sourceUrl: pressUrl,
      candidateUrls: [issuerUrl],
    });

    const result = await collectBasicFacts(ctx, {
      discover: async () => ({
        provider: "claude-web-search",
        state: "succeeded",
        leads: [securityLead],
        attempts: 1,
        completedBatches: 1,
        failedBatches: 0,
        batchStates: { structure_risk: "succeeded" },
      }),
      repair: async () => ({
        provider: "test",
        state: "partial",
        leads: [],
        attempts: 1,
        completedBatches: 1,
        failedBatches: 0,
        questionStates: { "person.official_token": "completed_empty" },
        questionProviders: { "person.official_token": "test" },
      }),
      fetchSource: fetchDocuments({
        [pressUrl]: document({
          url: pressUrl,
          host: "forbes.example",
          text: `<p>${securityLead.excerpt}</p>`,
          contentHash: "f".repeat(64),
        }),
        [issuerUrl]: document({
          url: issuerUrl,
          host: "investor.coinbase.com",
          text: "<p>Coinbase Global, Inc. (NASDAQ: COIN) is publicly traded.</p>",
          contentHash: "c".repeat(64),
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "public_security",
      value: "COIN (Coinbase, NASDAQ-listed security)",
      status: "verified",
      sources: expect.arrayContaining([
        expect.objectContaining({ url: issuerUrl, sourceClass: "official_counterparty" }),
      ]),
    }));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.public_security"))
      .toEqual(expect.objectContaining({ status: "answered" }));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({
        status: "unanswered",
        providerRuns: expect.arrayContaining([
          expect.objectContaining({ phase: "repair", state: "completed_empty" }),
        ]),
      }));
  });

  it("recovers Brian's COIN distinction from the SEC registry when model discovery fails", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    // Deliberately begin as a generic person. This mirrors the live failure in
    // which founder routing and the verified company relationship became
    // definitive only from repair-produced facts.
    evidence.roles = [SubjectClass.MEMBER];
    const boardUrl = "https://investor.coinbase.com/governance/board-of-directors/default.aspx";
    const xUrl = "https://x.com/brian_armstrong";
    const currentRoleValue = "Co-founder and CEO at Coinbase";
    const registryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
    const registryPayload = {
      fields: ["cik", "name", "ticker", "exchange"],
      data: [[1679788, "Coinbase Global, Inc.", "COIN", "Nasdaq"]],
    };
    let repairQuestionIds: string[] = [];

    await collectBasicFacts(ctx, {
      discover: async () => ({
        provider: "claude-web-search",
        state: "failed",
        leads: [],
        attempts: 1,
        completedBatches: 0,
        failedBatches: 3,
        batchStates: { identity: "failed", track_record: "failed", structure_risk: "failed" },
      }),
      repair: async (_repairContext, questions) => {
        repairQuestionIds = questions.map((question) => question.id);
        return {
          provider: "grok",
          state: "partial",
          leads: [
            lead({
              subject: "Brian Armstrong",
              predicate: "current_role",
              value: currentRoleValue,
              questionId: "person.current_role",
              excerpt: "At Coinbase, Brian Armstrong is our co-founder and has served as our Chief Executive Officer since 2012.",
              sourceUrl: boardUrl,
              provider: "grok",
            }),
            lead({
              subject: "Brian Armstrong",
              predicate: "current_role",
              value: currentRoleValue,
              questionId: "person.current_role",
              excerpt: "Brian Armstrong is Co-founder and CEO at Coinbase.",
              sourceUrl: xUrl,
              provider: "grok",
            }),
          ],
          attempts: 2,
          completedBatches: 1,
          failedBatches: 1,
          batchStates: { identity: "succeeded", structure_risk: "partial" },
          questionStates: { "person.official_token": "completed_empty" },
          questionProviders: { "person.official_token": "claude-web-search" },
        };
      },
      fetchSource: fetchDocuments({
        [boardUrl]: document({
          url: boardUrl,
          host: "investor.coinbase.com",
          text: "<p>At Coinbase, Brian Armstrong is our co-founder and has served as our Chief Executive Officer since 2012.</p>",
          contentHash: "7".repeat(64),
        }),
        [xUrl]: document({
          url: xUrl,
          host: "x.com",
          text: "<p>Brian Armstrong is Co-founder and CEO at Coinbase.</p>",
          contentHash: "8".repeat(64),
        }),
        [registryUrl]: document({
          url: registryUrl,
          host: "www.sec.gov",
          contentType: "application/json",
          text: JSON.stringify(registryPayload),
          contentHash: "9".repeat(64),
        }),
      }),
    });

    expect(repairQuestionIds).toContain("person.official_token");
    expect(repairQuestionIds).toContain("person.public_security");
    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "current_role",
      value: currentRoleValue,
      status: "corroborated",
    }));
    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "public_security",
      value: "COIN (Coinbase, NASDAQ-listed security)",
      status: "verified",
      critical: true,
      sources: [expect.objectContaining({
        url: registryUrl,
        sourceClass: "regulatory_or_onchain",
        relation: "supports",
        excerpt: JSON.stringify(registryPayload.data[0]),
      })],
    }));
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "official_token")).toBe(false);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.public_security"))
      .toEqual(expect.objectContaining({ status: "answered" }));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({
        status: "unanswered",
        providerRuns: expect.arrayContaining([
          expect.objectContaining({
            phase: "repair",
            provider: "claude-web-search",
            state: "completed_empty",
          }),
        ]),
      }));
  });

  it("does not treat an organization-named attacker subdomain as first-party scope", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.MEMBER];
    const attackerUrl = "https://coinbase.attacker.com/leadership";
    const secondUrl = "https://research.example.net/brian-armstrong";
    const registryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
    const passage = "Brian Armstrong is Co-founder and CEO at Coinbase.";
    const fetchSource = fetchDocuments({
      [attackerUrl]: document({
        url: attackerUrl,
        host: "coinbase.attacker.com",
        text: `<p>${passage}</p>`,
        contentHash: "a".repeat(64),
      }),
      [secondUrl]: document({
        url: secondUrl,
        host: "research.example.net",
        text: `<p>${passage}</p>`,
        contentHash: "b".repeat(64),
      }),
      [registryUrl]: document({
        url: registryUrl,
        host: "www.sec.gov",
        contentType: "application/json",
        text: JSON.stringify({
          fields: ["cik", "name", "ticker", "exchange"],
          data: [[1679788, "Coinbase Global, Inc.", "COIN", "Nasdaq"]],
        }),
      }),
    });

    await collectBasicFacts(ctx, {
      discover: async () => [
        lead({
          subject: "Brian Armstrong",
          predicate: "current_role",
          value: "Co-founder and CEO at Coinbase",
          questionId: "person.current_role",
          excerpt: passage,
          sourceUrl: attackerUrl,
        }),
        lead({
          subject: "Brian Armstrong",
          predicate: "current_role",
          value: "Co-founder and CEO at Coinbase",
          questionId: "person.current_role",
          excerpt: passage,
          sourceUrl: secondUrl,
        }),
      ],
      repair: async () => [],
      fetchSource,
    });

    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "current_role",
      value: "Co-founder and CEO at Coinbase",
      status: "corroborated",
    }));
    expect(fetchSource).not.toHaveBeenCalledWith(registryUrl);
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "public_security")).toBe(false);
  });

  it("does not collapse different material issuer qualifiers into one SEC identity", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Acme Global",
      domain: "acmeglobal.example",
      role: "Founder and CEO",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://acmeglobal.example/team",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const registryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
    const fetchSource = fetchDocuments({
      [registryUrl]: document({
        url: registryUrl,
        host: "www.sec.gov",
        contentType: "application/json",
        text: JSON.stringify({
          fields: ["cik", "name", "ticker", "exchange"],
          data: [[111, "Acme Holdings, Inc.", "ACMH", "Nasdaq"]],
        }),
      }),
    });

    await collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async () => [],
      fetchSource,
    });

    expect(fetchSource).toHaveBeenCalledWith(registryUrl);
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "public_security")).toBe(false);
  });

  it("fails closed when the SEC registry issuer match is ambiguous", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Acme",
      domain: "acme.example",
      role: "Founder and CEO",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://acme.example/team",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const registryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
    await collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async () => [],
      fetchSource: fetchDocuments({
        [registryUrl]: document({
          url: registryUrl,
          host: "www.sec.gov",
          contentType: "application/json",
          text: JSON.stringify({
            fields: ["cik", "name", "ticker", "exchange"],
            data: [
              [111, "Acme Global, Inc.", "ACM", "Nasdaq"],
              [222, "Acme Holdings, Inc.", "ACME", "NYSE"],
            ],
          }),
        }),
      }),
    });

    expect(evidence.basicFacts?.some((fact) => fact.predicate === "public_security")).toBe(false);
  });

  it("never queries or binds the SEC registry without a verified current-control relationship", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://coinbase.com",
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
    });
    const fetchSource = vi.fn(async (): Promise<PublicTextResult> => ({ status: "failed", reason: "not_found" }));

    await collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async () => [],
      fetchSource,
    });

    expect(fetchSource).not.toHaveBeenCalledWith("https://www.sec.gov/files/company_tickers_exchange.json");
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "public_security")).toBe(false);
  });

  it("binds a founder's official token through a verified current venture and that venture's fetched first-party docs", async () => {
    const { ctx, evidence } = context("https://haydenadams.com");
    ctx.handle = "@haydenzadams";
    evidence.profile.handle = "@haydenzadams";
    evidence.profile.display_name = "Hayden Adams";
    evidence.profile.resolved_name = "Hayden Adams";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Uniswap",
      domain: "uniswap.org",
      role: "Founder",
      period: "2018-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://uniswap.org/about",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const pressUrl = "https://press.example/uniswap-token";
    const docsUrl = "https://docs.uniswap.org/concepts/governance/overview";
    const passage = "UNI is the governance token of Uniswap.";
    const tokenLead = lead({
      subject: "Hayden Adams",
      predicate: "official_token",
      value: "UNI",
      questionId: "person.official_token",
      excerpt: passage,
      sourceUrl: pressUrl,
      candidateUrls: [docsUrl],
    });

    const result = await collectBasicFacts(ctx, {
      discover: async () => [tokenLead],
      repair: async () => [],
      fetchSource: fetchDocuments({
        [pressUrl]: document({
          url: pressUrl,
          host: "press.example",
          text: `<p>${passage}</p>`,
          contentHash: "4".repeat(64),
        }),
        [docsUrl]: document({
          url: docsUrl,
          host: "docs.uniswap.org",
          text: `<p>${passage}</p>`,
          contentHash: "5".repeat(64),
        }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ state: "executed" }));
    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "official_token",
      value: "UNI",
      status: "verified",
      sources: expect.arrayContaining([
        expect.objectContaining({ url: docsUrl, sourceClass: "official_counterparty" }),
      ]),
    }));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({ status: "answered" }));
  });

  it.each([
    [
      "another venture's official page",
      "AAVE",
      "AAVE is the governance token of Aave.",
      "https://docs.aave.com/governance/token",
    ],
    [
      "independent press without the founder",
      "UNI",
      "UNI is the governance token of Uniswap.",
      "https://press.example/uniswap-uni",
    ],
    [
      "the venture's stock ticker",
      "UNI",
      "Uniswap Global is publicly traded on Nasdaq under ticker UNI.",
      "https://docs.uniswap.org/company/listing",
    ],
  ] as const)("does not bind %s as the founder's official token", async (_label, value, passage, sourceUrl) => {
    const { ctx, evidence } = context("https://haydenadams.com");
    ctx.handle = "@haydenzadams";
    evidence.profile.handle = "@haydenzadams";
    evidence.profile.display_name = "Hayden Adams";
    evidence.profile.resolved_name = "Hayden Adams";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Uniswap",
      domain: "uniswap.org",
      role: "Founder",
      period: "2018-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://uniswap.org/about",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    await collectBasicFacts(ctx, {
      discover: async () => [lead({
        subject: "Hayden Adams",
        predicate: "official_token",
        value,
        questionId: "person.official_token",
        excerpt: passage,
        sourceUrl,
      })],
      repair: async () => [],
      fetchSource: fetchDocuments({
        [sourceUrl]: document({
          url: sourceUrl,
          host: new URL(sourceUrl).hostname,
          text: `<p>${passage}</p>`,
          contentHash: "6".repeat(64),
        }),
      }),
    });

    expect(evidence.basicFacts?.some((fact) => fact.predicate === "official_token")).toBe(false);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({ status: "unanswered" }));
  });

  it("does not establish a public security from press corroboration without issuer or regulator evidence", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      // A deterministic relationship may itself have been discovered in the
      // press. That citation cannot turn the press host into first-party scope.
      evidence_url: "https://press-one.example/coin",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const passage = "Brian Armstrong leads Coinbase, which is publicly traded on Nasdaq under ticker COIN.";
    const urls = ["https://press-one.example/coin", "https://press-two.example/coin"];
    await collectBasicFacts(ctx, {
      discover: async () => urls.map((sourceUrl) => lead({
        subject: "Brian Armstrong",
        predicate: "public_security",
        value: "COIN (Coinbase, NASDAQ)",
        questionId: "person.public_security",
        excerpt: passage,
        sourceUrl,
      })),
      repair: async () => [],
      fetchSource: fetchDocuments(Object.fromEntries(urls.map((url, index) => [
        url,
        document({
          url,
          host: new URL(url).hostname,
          text: `<p>${passage}</p>`,
          contentHash: String(index + 7).repeat(64),
        }),
      ]))),
    });

    expect(evidence.basicFacts?.some((fact) => fact.predicate === "public_security")).toBe(false);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.public_security"))
      .toEqual(expect.objectContaining({ status: "unanswered" }));
  });

  it("does not bind an issuer-only security page to a person without a verified current-control relationship", () => {
    const issuerUrl = "https://investor.acme.example/listing";
    const passage = "Acme Global, Inc. (NASDAQ: ACME) is publicly traded.";
    expect(verifyBasicFactLead(
      lead({
        subject: "Alice",
        predicate: "public_security",
        value: "ACME (Acme Global, Inc., NASDAQ)",
        questionId: "person.public_security",
        excerpt: passage,
        sourceUrl: issuerUrl,
      }),
      document({
        url: issuerUrl,
        host: "investor.acme.example",
        text: `<p>${passage}</p>`,
      }),
      ["Alice"],
      "@alice",
      [],
      ["acme.example"],
    )).toBeNull();
  });

  it("fails closed on malformed shared-host venture paths instead of aborting collection", async () => {
    const { ctx, evidence } = context("https://alice.example");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Alice Labs",
      role: "Founder",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://github.com/%ZZ",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });

    await expect(collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async () => [],
      fetchSource: fetchDocuments({}),
    })).resolves.toEqual(expect.objectContaining({ state: "partial" }));
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

  it("does not transfer an adjacent company settlement to a named founder", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Alice",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        eventStatus: "settled",
        attributedEntity: "Alice",
        excerpt: "Alice founded Acme. Acme settled an SEC settlement.",
        sourceUrl: "https://www.sec.gov/newsroom/acme",
      }),
      document({
        url: "https://www.sec.gov/newsroom/acme",
        host: "www.sec.gov",
        text: "<html><body><p>Alice founded Acme. Acme settled an SEC settlement.</p></body></html>",
      }),
      ["Alice"],
      "@alice",
      ["alice.example"],
    )).toBeNull();
  });

  it.each([
    "The company founded by Alice, Acme, settled an SEC settlement and the matter is resolved.",
    "Alice-founded Acme settled an SEC settlement and the matter is resolved.",
    "Alice's company Acme settled an SEC settlement and the matter is resolved.",
  ])("does not grammatically transfer a company event to its founder: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Alice",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        questionId: "person.legal_regulatory_event",
        eventStatus: "resolved",
        attributedEntity: "Alice",
        excerpt: passage,
        sourceUrl: "https://www.sec.gov/newsroom/acme",
      }),
      document({
        url: "https://www.sec.gov/newsroom/acme",
        host: "www.sec.gov",
        text: `<p>${passage}</p>`,
      }),
      ["Alice"],
      "@alice",
      ["https://alice.example"],
      ["acme.com"],
    )).toBeNull();
  });

  it("does not attribute a lowercase related entity's legal event to the audited project", () => {
    const passage = "Jupiter and acme labs settled an SEC settlement and the matter is resolved.";
    expect(verifyBasicFactLead(
      lead({
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        questionId: "project.legal_regulatory_event",
        eventStatus: "resolved",
        attributedEntity: "Jupiter",
        excerpt: passage,
        sourceUrl: "https://jup.ag/legal",
      }),
      document({
        url: "https://jup.ag/legal",
        host: "jup.ag",
        text: `<p>${passage}</p>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it("does not attribute a peer settlement to a project merely quoted after the event", () => {
    const passage = "The SEC settlement against Acme Labs was resolved, according to Jupiter.";
    expect(verifyBasicFactLead(
      lead({
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        questionId: "project.legal_regulatory_event",
        eventStatus: "resolved",
        attributedEntity: "Jupiter",
        excerpt: passage,
        sourceUrl: "https://jup.ag/legal",
      }),
      document({
        url: "https://jup.ag/legal",
        host: "jup.ag",
        text: `<p>${passage}</p>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it("accepts passive funding language that binds the round to the subject", () => {
    const passage = "A $100 million Series A was raised by Jupiter.";
    expect(verifyBasicFactLead(
      lead({
        predicate: "funding",
        value: "$100 million Series A",
        questionId: "project.funding",
        excerpt: passage,
        sourceUrl: "https://jup.ag/news/series-a",
      }),
      document({
        url: "https://jup.ag/news/series-a",
        host: "jup.ag",
        text: `<p>${passage}</p>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toEqual(expect.objectContaining({ predicate: "funding", status: "verified" }));
  });

  it("accepts an official token construction whose subject follows the predicate", () => {
    const passage = "JUP is the official token of Jupiter.";
    expect(verifyBasicFactLead(
      lead({
        predicate: "official_token",
        value: "JUP",
        questionId: "project.official_token",
        excerpt: passage,
        sourceUrl: "https://jup.ag/jup",
      }),
      document({
        url: "https://jup.ag/jup",
        host: "jup.ag",
        text: `<p>${passage}</p>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toEqual(expect.objectContaining({ predicate: "official_token", status: "verified" }));
  });

  it("keeps dated reporting periods attached to the subject metric", () => {
    const passage = "Jupiter reported $1B monthly volume for the quarter ended June 30, 2026.";
    expect(verifyBasicFactLead(
      lead({
        predicate: "traction",
        value: "$1B monthly volume",
        questionId: "project.traction",
        excerpt: passage,
        sourceUrl: "https://jup.ag/quarterly-report",
      }),
      document({
        url: "https://jup.ag/quarterly-report",
        host: "jup.ag",
        text: `<p>${passage}</p>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toEqual(expect.objectContaining({ predicate: "traction", status: "verified" }));
  });

  it("does not assign an adverse legal event to the organization that merely reported it", () => {
    const passage = "Jupiter reported an SEC settlement against Acme Labs and the matter is resolved.";
    expect(verifyBasicFactLead(
      lead({
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        questionId: "project.legal_regulatory_event",
        eventStatus: "resolved",
        attributedEntity: "Jupiter",
        excerpt: passage,
        sourceUrl: "https://jup.ag/legal",
      }),
      document({
        url: "https://jup.ag/legal",
        host: "jup.ag",
        text: `<p>${passage}</p>`,
      }),
      ["Jupiter", "@JupiterExchange"],
      "@JupiterExchange",
      ["https://jup.ag"],
    )).toBeNull();
  });

  it("does not let a shared-host tenant become an official source", () => {
    const fact = verifyBasicFactLead(
      lead({
        predicate: "official_token",
        value: "SCAM",
        excerpt: "Jupiter official token is SCAM.",
        sourceUrl: "https://github.com/attacker/fake-jupiter",
      }),
      document({
        url: "https://github.com/attacker/fake-jupiter",
        host: "github.com",
        text: "<p>Jupiter official token is SCAM.</p>",
      }),
      ["Jupiter"],
      "@JupiterExchange",
      ["https://github.com/jupiterexchange"],
    );
    expect(fact).toEqual(expect.objectContaining({ status: "lead" }));
    expect(fact?.sources[0]?.sourceClass).toBe("independent_press");
  });

  it("does not let another subdomain of a shared host bypass configured path ownership", () => {
    const fact = verifyBasicFactLead(
      lead({
        predicate: "official_token",
        value: "SCAM",
        excerpt: "Jupiter official token is SCAM.",
        sourceUrl: "https://gist.github.com/attacker/fake-jupiter",
      }),
      document({
        url: "https://gist.github.com/attacker/fake-jupiter",
        host: "gist.github.com",
        text: "<p>Jupiter official token is SCAM.</p>",
      }),
      ["Jupiter"],
      "@JupiterExchange",
      ["https://github.com/jupiterexchange"],
    );
    expect(fact).toEqual(expect.objectContaining({ status: "lead" }));
    expect(fact?.sources[0]?.sourceClass).toBe("independent_press");
  });

  it.each([
    [
      "https://github.com/jupiterexchange",
      "https://github.com/JupiterExchange/repository",
    ],
    [
      "https://x.com/JupiterExchange",
      "https://x.com/jupiterexchange/status/123456789",
    ],
  ] as const)("recognizes case-insensitive shared-host account ownership for %s", (officialScope, sourceUrl) => {
    const fact = verifyBasicFactLead(
      lead({
        predicate: "official_token",
        value: "JUP",
        excerpt: "Jupiter official token is JUP.",
        sourceUrl,
      }),
      document({
        url: sourceUrl,
        host: new URL(sourceUrl).hostname,
        text: "<p>Jupiter official token is JUP.</p>",
      }),
      ["Jupiter"],
      "@JupiterExchange",
      [officialScope],
    );
    expect(fact).toEqual(expect.objectContaining({ status: "verified" }));
    expect(fact?.sources[0]?.sourceClass).toBe("official_subject");
  });

  it.each([
    "Brian Armstrong is our CEO at the ResearchHub.",
    "Brian Armstrong serves as our CEO for the ResearchHub.",
    "Brian Armstrong is our CEO, ResearchHub.",
  ])("does not let an official hostname override an explicit company: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "current_role",
        value: "CEO, Coinbase",
        excerpt: passage,
        sourceUrl: "https://investor.coinbase.com/leadership",
      }),
      document({
        url: "https://investor.coinbase.com/leadership",
        host: "investor.coinbase.com",
        text: `<p>${passage}</p>`,
      }),
      ["Brian Armstrong"],
      "@brian_armstrong",
      ["https://investor.coinbase.com"],
    )).toBeNull();
  });

  it("keeps an exact-name regulator event out of person scoring until identity is bound", () => {
    const unresolved = verifyBasicFactLead(
      lead({
        subject: "Brian Armstrong",
        predicate: "legal_regulatory_event",
        value: "SEC settlement",
        questionId: "person.legal_regulatory_event",
        eventStatus: "resolved",
        attributedEntity: "Brian Armstrong",
        excerpt: "Brian Armstrong entered an SEC settlement and the matter is resolved.",
        sourceUrl: "https://www.sec.gov/newsroom/example",
      }),
      document({
        url: "https://www.sec.gov/newsroom/example",
        host: "www.sec.gov",
        text: "<html><body><p>Brian Armstrong entered an SEC settlement and the matter is resolved.</p></body></html>",
      }),
      ["Brian Armstrong", "@brian_armstrong"],
      "@brian_armstrong",
      ["brianarmstrong.org"],
      ["coinbase.com"],
    );

    expect(unresolved).toEqual(expect.objectContaining({
      status: "verified",
      attributionScope: "identity_unresolved",
    }));
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
