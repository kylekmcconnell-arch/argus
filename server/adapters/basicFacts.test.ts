import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFactLead } from "../../src/data/evidence";
import { SubjectClass, VentureOutcome } from "../../src/engine";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";
import type { CollectContext } from "./types";
import {
  collectBasicFacts,
  basicFactsResearchQuestions,
  discoverBasicFactLeads,
  discoverBasicFactLeadsDetailed,
  discoverGroundedBasicFactLeadsDetailed,
  discoverGrokBasicFactLeadsDetailed,
  parseBasicFactLeads,
  verifyBasicFactLead,
  overlappingNetworkAnswers,
} from "./basicFacts";
import { readEntityFacts } from "../entityStore";

vi.mock("../entityStore", () => ({ readEntityFacts: vi.fn(async () => null) }));

const NOW = "2026-07-12T12:00:00.000Z";

// Prompt-caching wraps the discovery prompt in a content-block array; tests
// read it back as plain text regardless of shape.
const promptText = (value: unknown): string => Array.isArray(value)
  ? value.map((block) => String((block as { text?: unknown }).text ?? "")).join("\n")
  : String(value ?? "");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
      promptText((body.messages as Array<{ content?: unknown }> | undefined)?.[0]?.content));
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

  it("reduces a role-suffixed identity answer to the atomic full name", () => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        question_id: "person.official_identity",
        subject: "Stani",
        predicate: "official_identity",
        value: "Stani Kulechov, Founder & CEO of Aave Labs",
        exact_excerpt: "Stani Kulechov, founder of Aave Labs, described the acquisition.",
        source_url: "https://aave.com/blog/stable-acquire",
      }],
    }), "Stani", "grok", [{
      id: "person.official_identity",
      audience: "person",
      batch: "identity",
      predicate: "official_identity",
      question: "What is this person's source-backed public identity?",
      critical: true,
    }])).toEqual([
      expect.objectContaining({
        predicate: "official_identity",
        value: "Stani Kulechov",
      }),
    ]);
  });

  it("does not turn a delimited roster into one identity", () => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Stani",
        predicate: "official_identity",
        value: "Stani Kulechov, and Alice Example",
        exact_excerpt: "Stani Kulechov and Alice Example spoke at the event.",
        source_url: "https://example.com/event",
      }],
    }))).toEqual([]);
  });

  it.each([
    "Stani Kulechov, alleged founder of Aave",
    "Stani Kulechov, claimed CEO of Aave Labs",
    "Stani Kulechov, speaker at an Aave event",
  ])("does not canonicalize a speculative or non-role identity suffix: %s", (value) => {
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        question_id: "person.official_identity",
        subject: "Stani",
        predicate: "official_identity",
        value,
        exact_excerpt: `${value}.`,
        source_url: "https://example.com/profile",
      }],
    }), "Stani", "grok", [{
      id: "person.official_identity",
      audience: "person",
      batch: "identity",
      predicate: "official_identity",
      question: "What is this person's source-backed public identity?",
      critical: true,
    }])).toEqual([]);
  });

  it("reduces descriptive official-token answers to their atomic symbol", () => {
    const parsed = parseBasicFactLeads(JSON.stringify({
      facts: [
        {
          question_id: "person.official_token",
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: "cbBTC · ERC20 token backed 1:1 by Bitcoin held by Coinbase",
          exact_excerpt: "Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase.",
          source_url: "https://www.coinbase.com/cbbtc",
        },
        {
          question_id: "person.official_token",
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: "cbETH (Coinbase Wrapped ETH) · ERC-20 token representing staked ETH issued by Coinbase",
          exact_excerpt: "cbETH: The trusted liquid staking token.",
          source_url: "https://www.coinbase.com/cbeth",
        },
      ],
    }));

    expect(parsed?.map((candidate) => candidate.value)).toEqual(["cbBTC", "cbETH"]);
  });

  it("does not truncate an ordinary multi-word token name into its first word", () => {
    const parsed = parseBasicFactLeads(JSON.stringify({
      facts: [{
        subject: "Acme",
        predicate: "official_token",
        value: "Acme Wrapped Bitcoin",
        exact_excerpt: "Acme Wrapped Bitcoin is Acme's official token.",
        source_url: "https://acme.example/token",
      }],
    }));

    expect(parsed?.[0]?.value).toBe("Acme Wrapped Bitcoin");
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
      prompts.push(promptText(body.messages?.[0]?.content));
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

describe("critical-gap search recovery", () => {
  it("records Grok as the governing provider after Claude primary search fails", async () => {
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
    const { ctx, evidence } = context();
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://api.anthropic.com/v1/messages") {
        return new Response(JSON.stringify({ error: "credits exhausted" }), { status: 400 });
      }
      if (url === "https://api.x.ai/v1/responses") {
        return new Response(JSON.stringify({
          output_text: '{"facts":[]}',
          output: [{ type: "web_search_call" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected provider URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await collectBasicFacts(ctx, {
      repair: async () => [],
      fetchSource: vi.fn(),
    });

    const primaryRuns = evidence.basicFactQuestionLedger
      ?.flatMap((entry) => entry.providerRuns)
      .filter((run) => run.phase === "primary") ?? [];
    const anthropicCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input) === "https://api.anthropic.com/v1/messages").length;
    const grokCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input) === "https://api.x.ai/v1/responses").length;

    expect(result.detail).toContain("primary grok:completed_empty");
    expect(new Set(primaryRuns.map((run) => run.provider))).toEqual(new Set(["grok"]));
    expect(primaryRuns.some((run) => run.provider === "claude-web-search")).toBe(false);
    expect(anthropicCalls).toBeGreaterThan(0);
    expect(grokCalls).toBeGreaterThan(0);
    expect(result.attempts).toBeGreaterThanOrEqual(anthropicCalls + grokCalls);
  });

  it("reports both physical Grok calls when compatibility retry follows a 400", async () => {
    const { ctx } = context();
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unsupported max_tool_calls" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: '{"facts":[]}',
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const questions = basicFactsResearchQuestions(ctx).filter((question) =>
      question.id === "project.product");

    const result = await discoverGrokBasicFactLeadsDetailed(
      ctx,
      questions,
      "repair",
      { bypassCache: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.questionStates).toEqual({ "project.product": "partial" });
  });

  it("uses a camel-cased handle only as an official-site identity search hint", async () => {
    const { ctx, evidence } = context("https://aave.com/");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.roles = [SubjectClass.FOUNDER];
    let prompt = "";
    const question = basicFactsResearchQuestions(ctx).filter((candidate) =>
      candidate.id === "person.official_identity");

    await discoverBasicFactLeadsDetailed(ctx, {
      request: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
        prompt = promptText(body.messages?.[0]?.content);
        return new Response(JSON.stringify({
          content: [{ type: "text", text: '{"facts":[]}' }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            server_tool_use: { web_search_requests: 1 },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, question, "repair");

    expect(prompt).toContain('Handle-derived full-name candidate: "Stani Kulechov"');
    expect(prompt).toContain('site:aave.com "Stani Kulechov"');
    expect(prompt).toContain("Use it to find evidence, never as evidence itself");
    expect(prompt).toContain("value must contain only the person's full public name");
  });

  it("checks a handle-derived full name against bounded first-party identity pages", async () => {
    const { ctx, evidence } = context("https://aave.com/");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.roles = [SubjectClass.FOUNDER];
    const aboutUrl = "https://aave.com/about";

    await collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async () => [],
      fetchSource: fetchDocuments({
        [aboutUrl]: document({
          url: aboutUrl,
          host: "aave.com",
          text: "<p>Aave Labs CEO Stani Kulechov leads the original protocol contributor.</p>",
        }),
      }),
    });

    expect(evidence.profile.resolved_name).toBe("Stani Kulechov");
    expect(evidence.profile.identity_confidence).toBe("Probable");
    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "official_identity",
      value: "Stani Kulechov",
      status: "verified",
      discoveryProvider: "argus-identity-bootstrap",
      sources: [expect.objectContaining({ url: aboutUrl, sourceClass: "official_subject" })],
    }));
    expect(evidence.basicFactLeads).toContainEqual(expect.objectContaining({
      predicate: "official_identity",
      value: "Stani Kulechov",
      evidence_origin: "deterministic_bootstrap",
      artifact_verified: false,
      provider: "argus-identity-bootstrap",
    }));
  });

  it("keeps an unfetched identity bootstrap candidate outside verified facts", async () => {
    const { ctx, evidence } = context("https://aave.com/");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.roles = [SubjectClass.FOUNDER];

    await collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async () => [],
      fetchSource: vi.fn(async (): Promise<PublicTextResult> => ({
        status: "failed",
        reason: "not_found",
      })),
    });

    expect(evidence.basicFactLeads).toContainEqual(expect.objectContaining({
      predicate: "official_identity",
      value: "Stani Kulechov",
      evidence_origin: "deterministic_bootstrap",
      artifact_verified: false,
      provider: "argus-identity-bootstrap",
    }));
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "official_identity")).toBe(false);
    expect(evidence.profile.resolved_name).toBe("Stani");
    expect(evidence.profile.identity_confidence).not.toBe("Probable");
  });

  it("binds a title-before-name caption to the exact public identity", () => {
    const fact = verifyBasicFactLead(
      lead({
        subject: "Stani",
        predicate: "official_identity",
        value: "Stani Kulechov",
        questionId: "person.official_identity",
        excerpt: "Stani Kulechov",
        sourceUrl: "https://aave.com/about",
      }),
      document({
        url: "https://aave.com/about",
        host: "aave.com",
        text: "<p>Aave Labs CEO Stani Kulechov at DeFi Summer Day.</p>",
      }),
      ["Stani", "@StaniKulechov"],
      "@StaniKulechov",
      ["https://aave.com/"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate: "official_identity",
      value: "Stani Kulechov",
      status: "verified",
    }));
  });

  it("does not borrow another nearby person's title for identity binding", () => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Stani",
        predicate: "official_identity",
        value: "Stani Kulechov",
        questionId: "person.official_identity",
        excerpt: "Stani Kulechov",
        sourceUrl: "https://aave.com/about",
      }),
      document({
        url: "https://aave.com/about",
        host: "aave.com",
        text: "<p>Aave Labs CEO Alice Example met Stani Kulechov at DeFi Summer Day.</p>",
      }),
      ["Stani", "@StaniKulechov"],
      "@StaniKulechov",
      ["https://aave.com/"],
    )).toBeNull();
  });

  it.each([
    "Alice Example is CEO and Stani Kulechov were photographed at the event.",
    "The CEO and Stani Kulechov spoke together.",
    "Stani Kulechov and CEO Alice Example spoke together.",
  ])("does not use a conjunction to transfer a title onto an identity: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Stani",
        predicate: "official_identity",
        value: "Stani Kulechov",
        questionId: "person.official_identity",
        excerpt: "Stani Kulechov",
        sourceUrl: "https://aave.com/about",
      }),
      document({
        url: "https://aave.com/about",
        host: "aave.com",
        text: `<p>${passage}</p>`,
      }),
      ["Stani", "@StaniKulechov"],
      "@StaniKulechov",
      ["https://aave.com/"],
    )).toBeNull();
  });

  it("gives every repair question its own attributable search", async () => {
    const { ctx } = context();
    const prompts: string[] = [];
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
      prompts.push(promptText(body.messages?.[0]?.content));
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
    const questions = basicFactsResearchQuestions(ctx).filter((question) =>
      question.predicate === "product" || question.predicate === "funding");

    const result = await discoverBasicFactLeadsDetailed(ctx, {
      request,
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, questions, "repair");

    expect(request).toHaveBeenCalledTimes(2);
    expect(prompts.filter((prompt) => prompt.includes("[project.product]")).every((prompt) =>
      !prompt.includes("[project.funding]"))).toBe(true);
    expect(prompts.filter((prompt) => prompt.includes("[project.funding]")).every((prompt) =>
      !prompt.includes("[project.product]"))).toBe(true);
    expect(result.questionStates).toEqual({
      "project.product": "completed_empty",
      "project.funding": "completed_empty",
    });
  });

  it("retries one malformed hosted-search response before giving up the gap", async () => {
    const { ctx } = context();
    const question = basicFactsResearchQuestions(ctx).filter((candidate) =>
      candidate.predicate === "product");
    let calls = 0;
    const result = await discoverBasicFactLeadsDetailed(ctx, {
      request: async () => {
        calls += 1;
        const text = calls === 1
          ? "I found Jupiter Swap but failed to format the response."
          : JSON.stringify({
              facts: [{
                question_id: "project.product",
                subject: "Jupiter",
                predicate: "product",
                value: "Jupiter Swap",
                exact_excerpt: "Jupiter operates Jupiter Swap as its live exchange product.",
                source_url: "https://jup.ag/swap",
              }],
            });
        return new Response(JSON.stringify({
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            server_tool_use: { web_search_requests: 1 },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, question, "repair");

    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.leads).toEqual([
      expect.objectContaining({
        questionId: "project.product",
        predicate: "product",
        value: "Jupiter Swap",
      }),
    ]);
  });

  it("caps repair at eight physical Claude calls across continuations and retries", async () => {
    const { ctx } = context();
    const questions = basicFactsResearchQuestions(ctx).filter((question) => question.critical).slice(0, 8);
    const request = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: "malformed" }],
      stop_reason: "pause_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await discoverBasicFactLeadsDetailed(ctx, {
      request,
      cacheRead: async () => null,
      cacheWrite: async () => undefined,
    }, questions, "repair");

    expect(questions).toHaveLength(8);
    expect(request).toHaveBeenCalledTimes(8);
    expect(result.attempts).toBe(8);
    expect(Object.keys(result.questionStates ?? {})).toHaveLength(8);
    expect(Object.values(result.questionStates ?? {})).not.toContain("completed_empty");
    expect(result.detail).toContain("repair provider-call budget exhausted at 8 calls");
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

  it("caps founder repair at eight decision-priority searches", async () => {
    const { ctx, evidence } = context("https://aave.com/");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.roles = [SubjectClass.FOUNDER];
    let repairQuestionIds: string[] = [];

    await collectBasicFacts(ctx, {
      discover: async () => [],
      repair: async (_repairContext, questions) => {
        repairQuestionIds = questions.map((question) => question.id);
        return [];
      },
      fetchSource: vi.fn(),
    });

    expect(repairQuestionIds).toEqual([
      "person.official_identity",
      "person.current_role",
      "person.founder",
      "person.product",
      "person.control",
      "person.legal_regulatory_event",
      "person.official_token",
      "person.public_security",
    ]);
  });

  it("repairs Stani's incomplete display identity, promotes Aave's official role source, and reuses the full name in the same pass", async () => {
    const { ctx, evidence } = context("https://aave.com");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.roles = [SubjectClass.FOUNDER];
    const aboutUrl = "https://aave.com/about";
    const identityUrl = "https://aave.com/blog/stable-acquire";
    const productUrl = "https://aave.com/history";
    const primary = [
      lead({
        subject: "Stani",
        predicate: "current_role",
        value: "CEO at Aave Labs",
        questionId: "person.current_role",
        excerpt: "Aave Labs CEO Stani Kulechov leads the original protocol contributor.",
        sourceUrl: aboutUrl,
      }),
      lead({
        subject: "Stani",
        predicate: "product",
        value: "Aave Protocol",
        questionId: "person.product",
        excerpt: "Stani Kulechov built the Aave Protocol.",
        sourceUrl: productUrl,
      }),
    ];
    const repairIds: string[] = [];

    await collectBasicFacts(ctx, {
      discover: async () => primary,
      repair: async (_repairContext, questions) => {
        repairIds.push(...questions.map((question) => question.id));
        return [lead({
          subject: "Stani",
          predicate: "official_identity",
          value: "Stani Kulechov",
          questionId: "person.official_identity",
          excerpt: "said Stani Kulechov, founder of Aave Labs.",
          sourceUrl: identityUrl,
        })];
      },
      fetchSource: fetchDocuments({
        [aboutUrl]: document({
          url: aboutUrl,
          host: "aave.com",
          text: "<p>Aave Labs CEO Stani Kulechov leads the original protocol contributor.</p>",
          contentHash: "a".repeat(64),
        }),
        [identityUrl]: document({
          url: identityUrl,
          host: "aave.com",
          text: "<p>This acquisition expands Aave's savings product, said Stani Kulechov, founder of Aave Labs.</p>",
          contentHash: "c".repeat(64),
        }),
        [productUrl]: document({
          url: productUrl,
          host: "aave.com",
          text: "<p>Stani Kulechov built the Aave Protocol.</p>",
          contentHash: "b".repeat(64),
        }),
      }),
    });

    expect(repairIds).not.toContain("person.official_identity");
    expect(evidence.profile.resolved_name).toBe("Stani Kulechov");
    expect(evidence.profile.identity_confidence).toBe("Probable");
    expect(evidence.basicFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        predicate: "official_identity",
        value: "Stani Kulechov",
        status: "verified",
      }),
      expect.objectContaining({
        predicate: "current_role",
        value: "CEO at Aave Labs",
        status: "verified",
      }),
      expect.objectContaining({
        predicate: "product",
        value: "Aave Protocol",
        status: "verified",
      }),
      expect.objectContaining({
        predicate: "founder",
        value: "Aave Labs",
        status: "verified",
      }),
    ]));
    expect(evidence.basicFactQuestionLedger?.find((entry) =>
      entry.questionId === "person.official_identity")).toEqual(expect.objectContaining({ status: "answered" }));
    expect(evidence.basicFactQuestionLedger?.find((entry) =>
      entry.questionId === "person.founder")).toEqual(expect.objectContaining({ status: "answered" }));
  });

  it("does not recover another person's founder title from a shared official passage", async () => {
    const { ctx, evidence } = context("https://aave.com");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.roles = [SubjectClass.FOUNDER];
    const identityUrl = "https://aave.com/profile/stani";
    const roleUrl = "https://aave.com/about";

    await collectBasicFacts(ctx, {
      discover: async () => [
        lead({
          subject: "Stani",
          predicate: "official_identity",
          value: "Stani Kulechov",
          questionId: "person.official_identity",
          excerpt: "Stani Kulechov is an entrepreneur.",
          sourceUrl: identityUrl,
        }),
        lead({
          subject: "Stani",
          predicate: "current_role",
          value: "CEO of Aave Labs",
          questionId: "person.current_role",
          excerpt: "Stani Kulechov is CEO of Aave Labs, while Alice Example is founder of Aave Labs.",
          sourceUrl: roleUrl,
        }),
      ],
      repair: async () => [],
      fetchSource: fetchDocuments({
        [identityUrl]: document({
          url: identityUrl,
          host: "aave.com",
          text: "<p>Stani Kulechov is an entrepreneur.</p>",
        }),
        [roleUrl]: document({
          url: roleUrl,
          host: "aave.com",
          text: "<p>Stani Kulechov is CEO of Aave Labs, while Alice Example is founder of Aave Labs.</p>",
        }),
      }),
    });

    expect(evidence.basicFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: "official_identity", value: "Stani Kulechov" }),
      expect.objectContaining({ predicate: "current_role", value: "CEO of Aave Labs" }),
    ]));
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "founder")).toBe(false);
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
    "Stani Kulechov is the founder and CEO of Aave.",
    "Stani Kulechov is the founder & CEO of Aave.",
    "Stani Kulechov, Founder of Aave, launched the protocol.",
  ])("verifies a bounded person-to-venture founder title: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Stani Kulechov",
        value: "Aave",
        excerpt: passage,
        sourceUrl: "https://press.example/stani-kulechov",
      }),
      document({
        url: "https://press.example/stani-kulechov",
        host: "press.example",
        text: `<p>${passage}</p>`,
      }),
      ["Stani Kulechov", "@StaniKulechov"],
      "@StaniKulechov",
    )).toEqual(expect.objectContaining({
      predicate: "founder",
      value: "Aave",
      status: "lead",
    }));
  });

  it("does not truncate a longer venture name into a founder relationship", () => {
    const passage = "Stani Kulechov founded Aave Labs Ventures.";
    expect(verifyBasicFactLead(
      lead({
        subject: "Stani Kulechov",
        predicate: "founder",
        value: "Aave Labs",
        questionId: "person.founder",
        excerpt: passage,
        sourceUrl: "https://aave.com/about",
      }),
      document({
        url: "https://aave.com/about",
        host: "aave.com",
        text: `<p>${passage}</p>`,
      }),
      ["Stani Kulechov", "@StaniKulechov"],
      "@StaniKulechov",
      ["https://aave.com/"],
    )).toBeNull();
  });

  it.each([
    ["current_role", "CEO at Aave Labs", "Aave Labs CEO Stani Kulechov leads the original protocol contributor."],
    ["founder", "Aave Protocol", "Stani Kulechov is the founder of the Aave Protocol."],
    ["founder", "Aave", "Stani Kulechov is the founder of Aave."],
  ] as const)("treats a previously verified Aave scope as authoritative for a bounded person %s relationship", (predicate, value, passage) => {
    const fact = verifyBasicFactLead(
      lead({
        subject: "Stani Kulechov",
        predicate,
        value,
        questionId: `person.${predicate}`,
        excerpt: passage,
        sourceUrl: "https://aave.com/about",
      }),
      document({
        url: "https://aave.com/about",
        host: "aave.com",
        text: `<p>${passage}</p>`,
      }),
      ["Stani Kulechov", "@StaniKulechov"],
      "@StaniKulechov",
      [],
      ["https://aave.com"],
    );

    expect(fact).toEqual(expect.objectContaining({
      predicate,
      value,
      status: "verified",
      sources: [expect.objectContaining({ sourceClass: "official_counterparty" })],
    }));
  });

  it.each([
    ["https://coindesk.com/stani", "coindesk.com", "Aave"],
    ["https://medium.com/aave/stani", "medium.com", "Aave"],
    ["https://aave.attacker.com/stani", "aave.attacker.com", "Aave"],
    ["https://lens.xyz/stani", "lens.xyz", "Aave"],
    ["https://aave.com/about", "aave.com", "Aave Capital"],
  ])("does not infer organization authority from an editorial, shared, lookalike, or mismatched host: %s", (url, host, value) => {
    const passage = `Stani Kulechov is the founder of ${value}.`;
    const fact = verifyBasicFactLead(
      lead({
        subject: "Stani Kulechov",
        predicate: "founder",
        value,
        questionId: "person.founder",
        excerpt: passage,
        sourceUrl: url,
      }),
      document({ url, host, text: `<p>${passage}</p>` }),
      ["Stani Kulechov", "@StaniKulechov"],
      "@StaniKulechov",
    );

    expect(fact).toEqual(expect.objectContaining({
      status: "lead",
      sources: [expect.objectContaining({ sourceClass: "independent_press" })],
    }));
  });

  it("rejects a model-combined Aave and ETHLend founder value instead of merging two ventures", () => {
    const { ctx, evidence } = context();
    ctx.handle = "@StaniKulechov";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    const questions = basicFactsResearchQuestions(ctx);
    expect(parseBasicFactLeads(JSON.stringify({
      facts: [{
        question_id: "person.founder",
        subject: "Stani Kulechov",
        predicate: "founder",
        value: "Aave (originally ETHLend)",
        exact_excerpt: "Stani Kulechov founded Aave, which was originally known as ETHLend.",
        source_url: "https://aave.com/about",
      }],
    }), "Stani", "claude-web-search", questions)).toEqual([]);
  });

  it.each([
    "Stani Kulechov is the founder and CEO of Lens. Alice is the founder of Aave.",
    "Stani Kulechov introduced Alice, Founder and CEO of Aave.",
    "Stani Kulechov, Founder of Lens, spoke with Aave CEO Alice.",
    "Stani Kulechov is the founder and CEO of Aave Capital.",
    "Stani Kulechov, Founder of Aave's Lens protocol, spoke at the event.",
  ])("does not transfer a bounded founder title from another person or venture: %s", (passage) => {
    expect(verifyBasicFactLead(
      lead({
        subject: "Stani Kulechov",
        value: "Aave",
        excerpt: passage,
        sourceUrl: "https://press.example/stani-kulechov",
      }),
      document({
        url: "https://press.example/stani-kulechov",
        host: "press.example",
        text: `<p>${passage}</p>`,
      }),
      ["Stani Kulechov", "@StaniKulechov"],
      "@StaniKulechov",
    )).toBeNull();
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
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
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
        [registryUrl]: {
          ...document({
            url: registryUrl,
            host: "www.sec.gov",
            contentType: "text/plain",
            text: [
              "Title: SEC company ticker and exchange registry",
              `URL Source: ${registryUrl}`,
              "Markdown Content:",
              JSON.stringify(registryPayload),
            ].join("\n"),
            contentHash: "9".repeat(64),
          }),
          retrievalProvider: "jina-reader",
        } as PublicTextDocument,
      }),
    });

    expect(repairQuestionIds).toContain("person.official_token");
    expect(repairQuestionIds).toContain("person.public_security");
    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "current_role",
      value: currentRoleValue,
      status: "verified",
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

  it("re-verifies Brian's cbBTC and cbETH leads after repair proves the Coinbase relationship", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.MEMBER];
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const boardUrl = "https://investor.coinbase.com/governance/board-of-directors/default.aspx";
    const xUrl = "https://x.com/brian_armstrong";
    const cbBtcUrl = "https://www.coinbase.com/blog/coinbase-wrapped-btc-cbbtc-is-now-live";
    const cbEthUrl = "https://help.coinbase.com/en/exchange/crypto-transfers/cbeth";
    const rolePassage = "Brian Armstrong is Co-founder and CEO at Coinbase.";
    const cbBtcPassage = "Coinbase is rolling out cbBTC, Coinbase Wrapped BTC, an ERC20 token backed 1:1 by Bitcoin held by Coinbase.";
    const cbEthPassage = "Coinbase Wrapped Staked ETH (cbETH) is a utility token that represents ETH staked through Coinbase.";

    await collectBasicFacts(ctx, {
      discover: async () => ({
        provider: "claude-web-search",
        state: "failed",
        leads: [],
        attempts: 1,
        completedBatches: 0,
        failedBatches: 3,
      }),
      repair: async () => ({
        provider: "grok",
        state: "succeeded",
        leads: [
          lead({
            subject: "Brian Armstrong",
            predicate: "current_role",
            value: "Co-founder and CEO at Coinbase",
            questionId: "person.current_role",
            excerpt: rolePassage,
            sourceUrl: boardUrl,
          }),
          lead({
            subject: "Brian Armstrong",
            predicate: "current_role",
            value: "Co-founder and CEO at Coinbase",
            questionId: "person.current_role",
            excerpt: rolePassage,
            sourceUrl: xUrl,
          }),
          lead({
            subject: "Brian Armstrong",
            predicate: "official_token",
            value: "cbBTC",
            questionId: "person.official_token",
            excerpt: cbBtcPassage,
            sourceUrl: cbBtcUrl,
          }),
          lead({
            subject: "Brian Armstrong",
            predicate: "official_token",
            value: "cbETH",
            questionId: "person.official_token",
            excerpt: cbEthPassage,
            sourceUrl: cbEthUrl,
          }),
        ],
        attempts: 1,
        completedBatches: 1,
        failedBatches: 0,
      }),
      fetchSource: fetchDocuments({
        [boardUrl]: document({
          url: boardUrl,
          host: "investor.coinbase.com",
          text: `<p>${rolePassage}</p>`,
          contentHash: "1".repeat(64),
        }),
        [xUrl]: document({
          url: xUrl,
          host: "x.com",
          text: `<p>${rolePassage}</p>`,
          contentHash: "2".repeat(64),
        }),
        [cbBtcUrl]: document({
          url: cbBtcUrl,
          host: "www.coinbase.com",
          text: `<p>${cbBtcPassage}</p>`,
          contentHash: "3".repeat(64),
        }),
        [cbEthUrl]: document({
          url: cbEthUrl,
          host: "help.coinbase.com",
          text: `<p>${cbEthPassage}</p>`,
          contentHash: "4".repeat(64),
        }),
      }),
    });

    expect(evidence.basicFacts).toContainEqual(expect.objectContaining({
      predicate: "current_role",
      value: "Co-founder and CEO at Coinbase",
      status: "verified",
    }));
    const tokens = evidence.basicFacts?.filter((fact) => fact.predicate === "official_token") ?? [];
    expect(tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: "cbBTC",
        status: "verified",
        sources: [expect.objectContaining({ url: cbBtcUrl, sourceClass: "official_counterparty" })],
      }),
      expect.objectContaining({
        value: "cbETH",
        status: "verified",
        sources: [expect.objectContaining({ url: cbEthUrl, sourceClass: "official_counterparty" })],
      }),
    ]));
    expect(tokens).toHaveLength(2);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({ status: "answered", answerRefs: expect.arrayContaining([
        expect.stringMatching(/^basic_v1_/),
      ]) }));
  });

  it("verifies the production-shaped Coinbase wrapped-asset pages without trusting the model description", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const cbBtcUrl = "https://www.coinbase.com/cbbtc";
    const cbEthUrl = "https://www.coinbase.com/cbeth";
    const questions = basicFactsResearchQuestions(ctx).filter((question) => question.id === "person.official_token");
    const leads = parseBasicFactLeads(JSON.stringify({
      facts: [
        {
          question_id: "person.official_token",
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: "cbBTC · ERC20 token backed 1:1 by Bitcoin held by Coinbase",
          exact_excerpt: "Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase.",
          source_title: "Coinbase cbBTC",
          source_url: cbBtcUrl,
        },
        {
          question_id: "person.official_token",
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: "cbETH · ERC-20 token representing staked ETH issued by Coinbase",
          exact_excerpt: "cbETH: The trusted liquid staking token.",
          source_title: "Coinbase cbETH",
          source_url: cbEthUrl,
        },
      ],
    }), "Brian Armstrong", "claude-web-search", questions) ?? [];

    const cbBtcReader = `Title: Coinbase cbBTC
URL Source: http://www.coinbase.com/cbbtc
Markdown Content:
## Benefits of Coinbase wrapped assets
Coinbase is pioneering a new era for DeFi with wrapped assets – a trusted and reputable wrapped version of your eligible assets that can be used onchain.
Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase – which has a 10+ year record of securely custodying crypto for institutions and customers.`;
    const cbEthReader = `Title: Coinbase cbETH
URL Source: http://www.coinbase.com/cbeth
Markdown Content:
## cbETH: The trusted liquid staking token.
cbETH lets you safely and easily use and earn rewards on your staked ETH.
Wrap your staked ETH to cbETH with just a few steps and zero fees. cbETH can be traded on Coinbase.
Coinbase's whitepaper provides in-depth details about cbETH's unique design and benefits.`;

    const fetchSource = fetchDocuments({
      [cbBtcUrl]: document({
        url: cbBtcUrl,
        host: "coinbase.com",
        contentType: "text/plain",
        text: cbBtcReader,
        contentHash: "8".repeat(64),
      }),
      [cbEthUrl]: document({
        url: cbEthUrl,
        host: "coinbase.com",
        contentType: "text/plain",
        text: cbEthReader,
        contentHash: "9".repeat(64),
      }),
    });

    await collectBasicFacts(ctx, {
      discover: async () => leads,
      repair: async () => [],
      fetchSource,
    });

    expect(leads.map((candidate) => candidate.value)).toEqual(["cbBTC", "cbETH"]);
    expect(evidence.basicFacts?.filter((fact) => fact.predicate === "official_token")).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "cbBTC", status: "verified" }),
      expect.objectContaining({ value: "cbETH", status: "verified" }),
    ]));
    expect(fetchSource).not.toHaveBeenCalledWith("https://www.coinbase.com/en-mx/cbbtc");
    expect(fetchSource).not.toHaveBeenCalledWith("https://www.coinbase.com/en-mx/cbeth");
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({ status: "answered" }));
  });

  it("verifies Coinbase wrapped assets after a same-host locale redirect returns direct HTML", async () => {
    const relationship = {
      name: "Coinbase",
      officialScopes: ["https://www.coinbase.com"],
    };
    const cases = [
      {
        symbol: "cbBTC",
        url: "https://www.coinbase.com/es-mx/cbbtc",
        excerpt: "Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase.",
        html: `<html><head><title>Coinbase cbBTC</title></head><body><h2>Benefits of Coinbase wrapped assets</h2><p>Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase.</p></body></html>`,
      },
      {
        symbol: "cbETH",
        url: "https://www.coinbase.com/es-mx/cbeth",
        excerpt: "cbETH: The trusted liquid staking token.",
        html: `<html><head><title>Coinbase cbETH</title></head><body><h1>cbETH: el token de participación líquida confiable.</h1><p>Wrap your staked ETH to cbETH with just a few steps and zero fees. cbETH can be traded on Coinbase.</p><p>Coinbase's whitepaper provides in-depth details about cbETH's unique design and benefits.</p></body></html>`,
      },
    ] as const;

    for (const candidate of cases) {
      const fact = verifyBasicFactLead(
        lead({
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: candidate.symbol,
          questionId: "person.official_token",
          excerpt: candidate.excerpt,
          sourceUrl: candidate.url,
          sourceTitle: `Coinbase ${candidate.symbol}`,
        }),
        document({
          url: candidate.url,
          host: "coinbase.com",
          contentType: "text/html",
          text: candidate.html,
        }),
        ["Brian Armstrong", "brian_armstrong"],
        "@brian_armstrong",
        [],
        ["https://www.coinbase.com"],
        [relationship],
      );

      expect(fact).toEqual(expect.objectContaining({
        predicate: "official_token",
        value: candidate.symbol,
        status: "verified",
      }));
    }
  });

  it("recovers canonical Coinbase wrapped-asset leads through the exact localized product pages", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const cbBtcUrl = "https://www.coinbase.com/cbbtc";
    const cbEthUrl = "https://www.coinbase.com/cbeth";
    const cbBtcLocalized = "https://www.coinbase.com/en-mx/cbbtc";
    const cbEthLocalized = "https://www.coinbase.com/en-mx/cbeth";
    const fetchSource = fetchDocuments({
      [cbBtcUrl]: document({
        url: "https://www.coinbase.com/en-us/cbbtc",
        host: "coinbase.com",
        text: "<html><head><title>Coinbase cbBTC</title></head><body>Coinbase offers many products.</body></html>",
      }),
      [cbEthUrl]: document({
        url: "https://www.coinbase.com/en-us/cbeth",
        host: "coinbase.com",
        text: "<html><head><title>Coinbase cbETH</title></head><body>Coinbase offers many products.</body></html>",
      }),
      [cbBtcLocalized]: document({
        url: cbBtcLocalized,
        host: "coinbase.com",
        contentType: "text/plain",
        text: `Title: Coinbase cbBTC
URL Source: ${cbBtcLocalized}
Markdown Content:
Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase.`,
      }),
      [cbEthLocalized]: document({
        url: cbEthLocalized,
        host: "coinbase.com",
        contentType: "text/plain",
        text: `Title: Coinbase cbETH
URL Source: ${cbEthLocalized}
Markdown Content:
cbETH: The trusted liquid staking token. Wrap your staked ETH to cbETH. cbETH can be traded on Coinbase. Coinbase's whitepaper provides in-depth details about cbETH's design.`,
      }),
    });

    await collectBasicFacts(ctx, {
      discover: async () => [
        lead({
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: "cbBTC",
          questionId: "person.official_token",
          excerpt: "Coinbase wrapped assets are backed 1:1 and held in custody by Coinbase.",
          sourceUrl: cbBtcUrl,
          sourceTitle: "Coinbase cbBTC",
        }),
        lead({
          subject: "Brian Armstrong",
          predicate: "official_token",
          value: "cbETH",
          questionId: "person.official_token",
          excerpt: "cbETH: The trusted liquid staking token.",
          sourceUrl: cbEthUrl,
          sourceTitle: "Coinbase cbETH",
        }),
      ],
      repair: async () => [],
      fetchSource,
    });

    expect(fetchSource).toHaveBeenCalledWith(cbBtcUrl);
    expect(fetchSource).toHaveBeenCalledWith(cbEthUrl);
    expect(fetchSource).toHaveBeenCalledWith(cbBtcLocalized);
    expect(fetchSource).toHaveBeenCalledWith(cbEthLocalized);
    const wrappedAssetCalls = fetchSource.mock.calls
      .map(([url]) => url)
      .filter((url) => [cbBtcUrl, cbEthUrl, cbBtcLocalized, cbEthLocalized].includes(url));
    expect(wrappedAssetCalls).toHaveLength(4);
    expect(evidence.basicFacts?.filter((fact) => fact.predicate === "official_token"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ value: "cbBTC", status: "verified" }),
        expect.objectContaining({ value: "cbETH", status: "verified" }),
      ]));
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({ status: "answered" }));
  });

  it("does not turn an official exchange listing page for someone else's token into a founder asset", async () => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const sourceUrl = "https://www.coinbase.com/wbtc";
    const passage = `Title: Coinbase WBTC
URL Source: https://www.coinbase.com/wbtc
Markdown Content:
WBTC is an ERC-20 wrapped token issued by BitGo. Coinbase customers can trade WBTC.`;

    await collectBasicFacts(ctx, {
      discover: async () => [lead({
        subject: "Brian Armstrong",
        predicate: "official_token",
        value: "WBTC",
        questionId: "person.official_token",
        excerpt: "WBTC is an ERC-20 wrapped token issued by BitGo.",
        sourceUrl,
      })],
      repair: async () => [],
      fetchSource: fetchDocuments({
        [sourceUrl]: document({
          url: sourceUrl,
          host: "coinbase.com",
          contentType: "text/plain",
          text: passage,
        }),
      }),
    });

    expect(evidence.basicFacts?.some((fact) => fact.predicate === "official_token")).toBe(false);
  });

  it("keeps a project's canonical official-token answer singular", async () => {
    const { ctx, evidence } = context("https://jup.ag");
    const jupUrl = "https://jup.ag/jup";
    const jlpUrl = "https://jup.ag/jlp";
    await collectBasicFacts(ctx, {
      discover: async () => [
        lead({
          predicate: "official_token",
          value: "JUP",
          questionId: "project.official_token",
          excerpt: "JUP is the official token of Jupiter.",
          sourceUrl: jupUrl,
        }),
        lead({
          predicate: "official_token",
          value: "JLP",
          questionId: "project.official_token",
          excerpt: "JLP is the official token of Jupiter.",
          sourceUrl: jlpUrl,
        }),
      ],
      fetchSource: fetchDocuments({
        [jupUrl]: document({
          url: jupUrl,
          host: "jup.ag",
          text: "<p>JUP is the official token of Jupiter.</p>",
          contentHash: "5".repeat(64),
        }),
        [jlpUrl]: document({
          url: jlpUrl,
          host: "jup.ag",
          text: "<p>JLP is the official token of Jupiter.</p>",
          contentHash: "6".repeat(64),
        }),
      }),
    });

    const tokens = evidence.basicFacts?.filter((fact) => fact.predicate === "official_token") ?? [];
    expect(tokens).toHaveLength(2);
    expect(tokens.every((fact) => fact.status === "conflicted")).toBe(true);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "project.official_token"))
      .toEqual(expect.objectContaining({ status: "unanswered", answerRefs: [] }));
  });

  it("treats overlapping network lists as corroboration, not conflict", () => {
    expect(overlappingNetworkAnswers([
      "Ethereum, Polygon, Avalanche, BNB Chain, Fantom",
      "22 chains incl. Ethereum, Plasma, Base, Arbitrum",
    ])).toBe(true);
    expect(overlappingNetworkAnswers([
      "Solana, Ethereum",
      "5 chains incl. Solana, Base, Arbitrum",
    ])).toBe(true);
  });

  it("keeps genuinely disjoint network answers conflicted", () => {
    expect(overlappingNetworkAnswers(["Solana", "Ethereum"])).toBe(false);
    expect(overlappingNetworkAnswers(["", "Ethereum"])).toBe(false);
  });

  it.each([
    ["WBTC", "Coinbase supports WBTC, an ERC-20 wrapped token issued by BitGo."],
    ["ARB", "Coinbase supports ARB, the governance token issued by Arbitrum Foundation."],
    ["ABC", "Coinbase supports ABC, a utility token created by Acme Labs."],
    ["XYZ", "Coinbase's official governance token support includes XYZ."],
    ["CUST", "Coinbase customers created CUST, a utility token."],
    ["CVA", "Coinbase Ventures created CVA, a governance token."],
    ["CVP", "Coinbase Ventures portfolio company Arbitrum created CVP, a governance token."],
    ["CUSO", "CUSO is a utility token created by Coinbase customers."],
    ["CVO", "CVO is a governance token issued by Coinbase Ventures."],
    ["CVPO", "CVPO is a governance token issued by Coinbase Ventures portfolio company Arbitrum."],
    ["FAK", "FAK is the fake governance token of Coinbase."],
    ["UNOF", "UNOF is the unofficial governance token of Coinbase."],
    ["PROP", "PROP is the proposed governance token of Coinbase."],
    ["POT", "POT is the potential governance token of Coinbase."],
    ["HYP", "HYP is the hypothetical governance token of Coinbase."],
    ["FORM", "FORM is the former governance token of Coinbase."],
    ["PLAN", "PLAN is the planned governance token of Coinbase."],
    ["UNLA", "UNLA is the unlaunched governance token of Coinbase."],
    ["NOTK", "NOTK is not the governance token of Coinbase."],
    ["NOTO", "NOTO is no governance token of Coinbase."],
    ["NEVR", "NEVR is never the governance token of Coinbase."],
    ["NOLG", "NOLG is no longer the governance token of Coinbase."],
    ["ALLG", "ALLG is the alleged governance token of Coinbase."],
    ["RUMR", "RUMR is the rumored governance token of Coinbase."],
    ["PURP", "PURP is the purported governance token of Coinbase."],
    ["CLMD", "CLMD is the claimed governance token of Coinbase."],
    ["POSS", "POSS is a possible governance token of Coinbase."],
    ["MAYB", "MAYB is maybe the governance token of Coinbase."],
    ["MAYT", "MAYT may become the governance token of Coinbase."],
    ["MIGH", "MIGH might become the governance token of Coinbase."],
    ["COUL", "COUL could become the governance token of Coinbase."],
    ["CAND", "CAND is a candidate governance token of Coinbase."],
    ["FUTR", "FUTR is the future governance token of Coinbase."],
    ["INTD", "INTD is the intended governance token of Coinbase."],
    ["COMP", "Coinbase's competitor's governance token is COMP."],
    ["RIVL", "Coinbase's rival's governance token is RIVL."],
    ["THRD", "Coinbase's third-party's governance token is THRD."],
    ["PART", "Coinbase's partner's governance token is PART."],
    ["SUBS", "Coinbase's subsidiary's governance token is SUBS."],
    ["AFFL", "Coinbase's affiliate's governance token is AFFL."],
    ["CST2", "Coinbase's customer's governance token is CST2."],
    ["CLNT", "Coinbase's client's governance token is CLNT."],
    ["VEND", "Coinbase's vendor's governance token is VEND."],
    ["PORT", "Coinbase's portfolio company's governance token is PORT."],
    ["TEST", "TEST is the test governance token of Coinbase."],
    ["TNET", "TNET is the testnet governance token of Coinbase."],
    ["DEMO", "DEMO is the demo governance token of Coinbase."],
    ["MOCK", "MOCK is the mock governance token of Coinbase."],
    ["EXPR", "EXPR is the experimental governance token of Coinbase."],
    ["DRFT", "DRFT is the draft governance token of Coinbase."],
    ["REPT", "REPT is reportedly the governance token of Coinbase."],
    ["SUPP", "SUPP is supposedly the governance token of Coinbase."],
    ["SOCL", "SOCL is the so-called governance token of Coinbase."],
    ["INVT", "Coinbase's investee's governance token is INVT."],
    ["BACK", "Coinbase's backed project's governance token is BACK."],
    ["CONT", "Coinbase's contractor's governance token is CONT."],
    ["JVEN", "Coinbase's joint venture's governance token is JVEN."],
    ["SCAM", "Coinbase Wrapped ETH (SCAM) is a utility token."],
    ["SCM2", "Coinbase Wrapped ETH (SCM2) is a utility token of Acme Labs."],
    ["xETH", "Coinbase Wrapped ETH (xETH) is a utility token of Acme Labs."],
    ["fakeETH", "Coinbase Wrapped ETH (fakeETH) is a fake token."],
    ["testETH", "Coinbase Wrapped ETH (testETH) is a test token."],
    ["netETH", "Coinbase Wrapped ETH (netETH) is a testnet token."],
    ["demoETH", "Coinbase Wrapped ETH (demoETH) is a demo token."],
    ["mockETH", "Coinbase Wrapped ETH (mockETH) is a mock token."],
    ["expETH", "Coinbase Wrapped ETH (expETH) is an experimental token."],
    ["draftETH", "Coinbase Wrapped ETH (draftETH) is a draft token."],
    ["formerETH", "Coinbase Wrapped ETH (formerETH) is a former token."],
    ["unofETH", "Coinbase Wrapped ETH (unofETH) is an unofficial token."],
    ["nliveETH", "Coinbase Wrapped ETH (nliveETH) is a non-live token."],
    ["uncETH", "Coinbase Wrapped ETH (uncETH) is an uncertain token."],
    ["xaETH", "Coinbase Wrapped ETH (xaETH) is an Acme Labs utility token."],
    ["xbETH", "Coinbase Wrapped ETH (xbETH) is Acme Labs’ utility token."],
    ["xcETH", "Coinbase Wrapped ETH (xcETH) is used as Acme Labs' utility token."],
    ["xvETH", "xvETH, Coinbase Wrapped ETH is an Acme Labs utility token."],
  ] as const)("does not bind token %s without exact venture ownership", async (symbol, passage) => {
    const { ctx, evidence } = context("https://brianarmstrong.org");
    ctx.handle = "@brian_armstrong";
    evidence.profile.handle = "@brian_armstrong";
    evidence.profile.display_name = "Brian Armstrong";
    evidence.profile.resolved_name = "Brian Armstrong";
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.ventures.push({
      project_name: "Coinbase",
      domain: "coinbase.com",
      role: "Co-founder and CEO",
      period: "2012-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const sourceUrl = `https://www.coinbase.com/assets/${symbol.toLowerCase()}`;

    await collectBasicFacts(ctx, {
      discover: async () => [lead({
        subject: "Brian Armstrong",
        predicate: "official_token",
        value: symbol,
        questionId: "person.official_token",
        excerpt: passage,
        sourceUrl,
      })],
      fetchSource: fetchDocuments({
        [sourceUrl]: document({
          url: sourceUrl,
          host: "www.coinbase.com",
          text: `<p>${passage}</p>`,
          contentHash: "7".repeat(64),
        }),
      }),
    });

    expect(evidence.basicFacts?.some((fact) =>
      fact.predicate === "official_token" && fact.value === symbol)).toBe(false);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "person.official_token"))
      .toEqual(expect.objectContaining({ status: "unanswered", answerRefs: [] }));
  });

  it.each([
    { label: "corroborated press role", includeOfficialRole: false, expectedRoleStatus: "corroborated" },
    { label: "verified role with a mixed press source", includeOfficialRole: true, expectedRoleStatus: "verified" },
  ] as const)("does not promote an organization-named press host from a $label", async ({
    includeOfficialRole,
    expectedRoleStatus,
  }) => {
    const { ctx, evidence } = context("https://stani.example");
    ctx.handle = "@StaniKulechov";
    evidence.profile.handle = "@StaniKulechov";
    evidence.profile.display_name = "Stani";
    evidence.profile.resolved_name = "Stani";
    evidence.roles = [SubjectClass.FOUNDER];
    const identityUrl = "https://stani.example/about";
    const officialRoleUrl = "https://stani.example/role";
    const misleadingHostUrl = "https://aave.net/stani";
    const pressUrl = "https://news.example/stani";
    const registryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
    const identityPassage = "Stani Kulechov is an entrepreneur and protocol builder.";
    const officialRolePassage = "Stani Kulechov is CEO at Aave.";
    const founderPassage = "Stani Kulechov is founder and CEO at Aave.";
    const pressRolePassage = "Stani Kulechov is CEO at Aave.";
    const leads = [
      lead({
        subject: "Stani Kulechov",
        predicate: "official_identity",
        value: "Stani Kulechov",
        questionId: "person.official_identity",
        excerpt: identityPassage,
        sourceUrl: identityUrl,
      }),
      lead({
        subject: "Stani Kulechov",
        predicate: "current_role",
        value: "CEO at Aave",
        questionId: "person.current_role",
        excerpt: founderPassage,
        sourceUrl: misleadingHostUrl,
      }),
      lead({
        subject: "Stani Kulechov",
        predicate: "current_role",
        value: "CEO at Aave",
        questionId: "person.current_role",
        excerpt: includeOfficialRole ? officialRolePassage : pressRolePassage,
        sourceUrl: includeOfficialRole ? officialRoleUrl : pressUrl,
      }),
    ];
    const fetchSource = fetchDocuments({
      [identityUrl]: document({
        url: identityUrl,
        host: "stani.example",
        text: `<p>${identityPassage}</p>`,
      }),
      [officialRoleUrl]: document({
        url: officialRoleUrl,
        host: "stani.example",
        text: `<p>${officialRolePassage}</p>`,
      }),
      [misleadingHostUrl]: document({
        url: misleadingHostUrl,
        host: "aave.net",
        text: `<p>${founderPassage}</p>`,
      }),
      [pressUrl]: document({
        url: pressUrl,
        host: "news.example",
        text: `<p>${pressRolePassage}</p>`,
      }),
    });

    await collectBasicFacts(ctx, {
      discover: async () => leads,
      repair: async () => [],
      fetchSource,
    });

    const role = evidence.basicFacts?.find((fact) =>
      fact.predicate === "current_role" && fact.value === "CEO at Aave");
    expect(role).toEqual(expect.objectContaining({ status: expectedRoleStatus }));
    expect(role?.sources.find((source) => source.url === misleadingHostUrl)?.sourceClass)
      .toBe("independent_press");
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "founder")).toBe(false);
    expect(fetchSource).not.toHaveBeenCalledWith(registryUrl);
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

describe("lead value core normalization", () => {
  const parseValue = (value: string, predicate = "founded", qualifier?: string) => {
    const { ctx } = context();
    ctx.handle = "@StaniKulechov";
    ctx.evidence.profile.display_name = "Stani";
    ctx.evidence.profile.resolved_name = "Stani";
    ctx.evidence.roles = [SubjectClass.FOUNDER];
    const parsed = parseBasicFactLeads(JSON.stringify({
      facts: [{
        question_id: `person.${predicate}`,
        subject: "Stani Kulechov",
        predicate,
        value,
        ...(qualifier ? { qualifier } : {}),
        exact_excerpt: "Stani Kulechov founded Aave.",
        source_url: "https://aave.com/about",
      }],
    }), "Stani", "claude-web-search", basicFactsResearchQuestions(ctx));
    return parsed?.[0];
  };

  it("reduces a benign trailing parenthetical so independent sources share one fact key", () => {
    const parsed = parseValue("Ethereum (conceived 2013, network launched 30 July 2015)");
    expect(parsed?.value).toBe("Ethereum");
    expect(parsed?.qualifier).toContain("conceived 2013");
  });

  it.each([
    "Ethereum (he was not a founder; the claim is disputed)",
    "Ethereum (alleged, unproven)",
    "Uniswap (a different Hayden Adams, not this account holder)",
    "Solana (proposed but never launched by this person)",
  ])("never strips a denial or disclaimer: %s", (value) => {
    const parsed = parseValue(value);
    if (parsed) expect(parsed.value).toBe(value);
  });

  it("keeps the organization attached to a role instead of stripping past a dash", () => {
    const parsed = parseValue("CEO \u2014 Binance, until he pleaded guilty in November 2023", "current_role");
    if (parsed) expect(parsed.value).toContain("Binance");
  });

  it("preserves stripped context even when the model supplies its own qualifier", () => {
    const parsed = parseValue("Ethereum (network launched 30 July 2015)", "founded", "DeFi protocol");
    expect(parsed?.value).toBe("Ethereum");
    expect(parsed?.qualifier).toContain("network launched");
  });
});

// Regression: @VitalikButerin published INCOMPLETE in the live pipeline because
// his pseudonymous display name ("vitalik.eth") never matched the "Vitalik
// Buterin" that sources use, so no fact verified and no role routed. The
// notability-gated reading alias is supposed to bridge that, but its only proof
// of authority was a >=10 notable-follower reverse-check, which under-observes
// for individuals (the curated reference set is org/fund accounts that do not
// follow a person, even a famous one). A mega follower count is an alternate,
// sufficient authority proof. This alias is READING ONLY and must never leak
// into resolved_name (which feeds name-based OFAC / court screening).
describe("pseudonymous mega-account name alias (Vitalik regression)", () => {
  function pseudonymousFounderCtx(followers: string) {
    const evidence = emptyEvidence("@VitalikButerin");
    evidence.profile.display_name = "vitalik.eth";
    evidence.profile.resolved_name = undefined;
    evidence.profile.followers = followers;
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.roles = [SubjectClass.FOUNDER];
    // The real full-pipeline state: the reverse-check found no notable followers.
    evidence.notableFollowers = [];
    const ctx: CollectContext = { handle: "@VitalikButerin", evidence, emit: vi.fn() };
    return { ctx, evidence };
  }

  const src1 = "https://ethereum.org/en/history/";
  const src2 = "https://www.coindesk.com/vitalik-ethereum";
  const founderLeads = async (): Promise<BasicFactLead[]> => [
    lead({ subject: "Vitalik Buterin", predicate: "founder", value: "Ethereum", questionId: "person.founder", excerpt: "Vitalik Buterin is the co-founder of Ethereum.", sourceUrl: src1, sourceTitle: "Ethereum history", provider: "claude-web-search" }),
    lead({ subject: "Vitalik Buterin", predicate: "founder", value: "Ethereum", questionId: "person.founder", excerpt: "Vitalik Buterin co-founded Ethereum in 2015.", sourceUrl: src2, sourceTitle: "Coindesk", provider: "claude-web-search" }),
  ];
  const founderDocs = () => fetchDocuments({
    [src1]: document({ url: src1, host: "ethereum.org", text: "<html><body><p>Vitalik Buterin is the co-founder of Ethereum.</p></body></html>", contentHash: "d".repeat(64) }),
    [src2]: document({ url: src2, host: "coindesk.com", text: "<html><body><p>Vitalik Buterin co-founded Ethereum in 2015.</p></body></html>", contentHash: "e".repeat(64) }),
  });

  const verifiedFounderOfEthereum = (evidence: ReturnType<typeof pseudonymousFounderCtx>["evidence"]): boolean =>
    (evidence.basicFacts ?? []).some((fact) =>
      fact.predicate === "founder" && fact.value === "Ethereum"
      && (fact.status === "verified" || fact.status === "corroborated"));

  it("verifies a founder fact for a mega-account with a pseudonymous display name", async () => {
    const { ctx, evidence } = pseudonymousFounderCtx("5.3M");
    await collectBasicFacts(ctx, { discover: founderLeads, fetchSource: founderDocs() });
    expect(verifiedFounderOfEthereum(evidence)).toBe(true);
    // Impersonation safety: the reading alias must never become resolved_name.
    expect(evidence.profile.resolved_name ?? "").not.toMatch(/Vitalik Buterin/);
    expect(evidence.profile.identity_confidence ?? "").not.toBe("Confirmed");
  });

  it("does NOT widen the alias for a sub-mega account with no notable followers", async () => {
    const { ctx, evidence } = pseudonymousFounderCtx("300K");
    await collectBasicFacts(ctx, { discover: founderLeads, fetchSource: founderDocs() });
    expect(verifiedFounderOfEthereum(evidence)).toBe(false);
  });
});

// The knowledge-base read-through: a fresh cache hit lets discovery skip the
// questions prior audits already answered, and the reused verified facts flow
// into evidence without re-fetching their sources.
describe("knowledge base read-through", () => {
  const cachedFounderFact = () => ({
    factId: "kb-founder", subjectKey: "alice", predicate: "founder" as const, value: "Acme",
    normalizedValue: "acme", status: "verified" as const, critical: true,
    sources: [{
      url: "https://alice.example/about", sourceClass: "official_subject" as const, relation: "supports" as const,
      excerpt: "Alice founded Acme.", contentHash: "z".repeat(64), capturedAt: NOW, provider: "public-web" as const, artifactVerified: true,
    }],
    evidence_origin: "deterministic" as const, artifact_verified: true, provider: "public-web" as const, questionId: "person.founder",
  });

  function founderCtx() {
    const evidence = emptyEvidence("@alice");
    evidence.profile.display_name = "Alice";
    evidence.profile.resolved_name = "Alice";
    evidence.profile.website = "https://alice.example";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.roles = [SubjectClass.FOUNDER];
    const ctx: CollectContext = { handle: "@alice", evidence, emit: vi.fn(), organizationId: "org1" };
    return { ctx, evidence };
  }

  const spyDiscover = (capture: (ids: string[]) => void) =>
    async (_c: CollectContext, qs: readonly { id: string }[]) => { capture(qs.map((q) => q.id)); return []; };

  it("reuses a cached verified fact and skips its discovery question", async () => {
    vi.stubEnv("ARGUS_ENTITY_REUSE", "on");
    vi.mocked(readEntityFacts).mockResolvedValueOnce({ facts: { basicFacts: [cachedFounderFact()] }, updatedAt: NOW, auditCount: 2, entityType: "FOUNDER" });
    const { ctx, evidence } = founderCtx();
    let discoveredIds: string[] = [];
    await collectBasicFacts(ctx, { discover: spyDiscover((ids) => { discoveredIds = ids; }), fetchSource: vi.fn() });

    expect(discoveredIds).not.toContain("person.founder");
    expect(discoveredIds.length).toBeGreaterThan(0);
    expect(evidence.basicFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: "founder", value: "Acme", status: "verified" }),
    ]));
  });

  it("never reuses provider-projection facts, marked or legacy-stored", async () => {
    vi.stubEnv("ARGUS_ENTITY_REUSE", "on");
    const marked = { ...cachedFounderFact(), factId: "kb-traction", predicate: "traction" as const, value: "CoinGecko rank #39 · $2.40B market cap", normalizedValue: "rank", providerProjection: true, questionId: "project.traction" };
    const legacyCapture = { ...cachedFounderFact(), factId: "kb-tvl", predicate: "traction" as const, value: "$3.18B total value locked", normalizedValue: "tvl", qualifier: "captured 2026-07-22", questionId: "project.traction" };
    const legacyLiveness = { ...cachedFounderFact(), factId: "kb-product", predicate: "product" as const, value: "Acme operates a live on-chain protocol; its canonical token ACME is established and actively traded ($1M market cap)", normalizedValue: "live", questionId: "project.product" };
    vi.mocked(readEntityFacts).mockResolvedValueOnce({
      facts: { basicFacts: [cachedFounderFact(), marked, legacyCapture, legacyLiveness] },
      updatedAt: NOW,
      auditCount: 3,
      entityType: "FOUNDER",
    });
    const { ctx, evidence } = founderCtx();
    let discoveredIds: string[] = [];
    await collectBasicFacts(ctx, { discover: spyDiscover((ids) => { discoveredIds = ids; }), fetchSource: vi.fn() });

    // The stable discovery fact still reuses; every projection capture is dropped.
    expect(discoveredIds).not.toContain("person.founder");
    const reusedIds = (evidence.basicFacts ?? []).map((fact) => fact.factId);
    expect(reusedIds).not.toEqual(expect.arrayContaining(["kb-traction"]));
    expect(reusedIds).not.toEqual(expect.arrayContaining(["kb-tvl"]));
    expect(reusedIds).not.toEqual(expect.arrayContaining(["kb-product"]));
  });

  it("ignores the knowledge base entirely when the flag is off", async () => {
    vi.mocked(readEntityFacts).mockClear();
    const { ctx } = founderCtx();
    let discoveredIds: string[] = [];
    await collectBasicFacts(ctx, { discover: spyDiscover((ids) => { discoveredIds = ids; }), fetchSource: vi.fn() });

    expect(discoveredIds).toContain("person.founder");
    expect(readEntityFacts).not.toHaveBeenCalled();
  });
});

// Prompt caching on the discovery path: the user prompt block always carries
// a cache breakpoint, and a pause_turn continuation decorates the last resent
// search-round block ONLY when its type is a known-cacheable one (an exotic
// block must pass through untouched rather than risk a 400 on the batch).
describe("discovery prompt caching", () => {
  it("marks the user prompt block and the resent search round for caching", async () => {
    const { ctx } = context();
    const requestBodies: Record<string, unknown>[] = [];
    let call = 0;
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      call += 1;
      const paused = call === 1;
      return new Response(JSON.stringify(paused
        ? {
          content: [
            { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "jupiter" } },
            { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
          ],
          stop_reason: "pause_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }
        : {
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

    expect(requestBodies.length).toBeGreaterThanOrEqual(2);
    for (const body of requestBodies) {
      const user = (body.messages as Array<{ content?: unknown }>)[0].content;
      expect(Array.isArray(user)).toBe(true);
      expect((user as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: "ephemeral" });
    }
    const continuation = requestBodies.find((body) => (body.messages as unknown[]).length === 2);
    expect(continuation).toBeDefined();
    const resent = (continuation!.messages as Array<{ content?: Array<Record<string, unknown>> }>)[1].content!;
    // Last block (web_search_tool_result) is cacheable and gets the marker;
    // the earlier server_tool_use block passes through untouched.
    expect(resent[resent.length - 1].cache_control).toEqual({ type: "ephemeral" });
    expect(resent[0].cache_control).toBeUndefined();
  });
});

// The grounded discovery lane: same prompt, same parser, same verification
// boundary; only the searcher changes (Serper + fetch + cheap extract instead
// of a Sonnet-priced native web_search loop). Unprovisioned grounded search
// must fall through to the normal chain, never degrade discovery.
describe("grounded discovery lane", () => {
  it("routes primary discovery through groundedSearch and labels leads grounded", async () => {
    vi.stubEnv("ARGUS_BASIC_FACTS_PRIMARY", "grounded");
    const grounded = await import("./groundedSearch");
    const spy = vi.spyOn(grounded, "groundedSearch").mockResolvedValue(JSON.stringify({
      facts: [{
        predicate: "founder",
        value: "Hayden Adams",
        source_url: "https://theblock.co/uniswap-founder",
        exact_excerpt: "Hayden Adams founded Uniswap",
        confidence: "high",
      }],
    }));
    try {
      const { ctx } = context();
      const questions = basicFactsResearchQuestions(ctx);
      const result = await discoverGroundedBasicFactLeadsDetailed(ctx, questions, "primary");
      expect(spy).toHaveBeenCalled();
      const [system, user] = spy.mock.calls[0];
      expect(system).toContain("basic-facts research scout");
      expect(user).toContain("@JupiterExchange");
      expect(result.provider).toBe("grounded");
      expect(result.state === "succeeded" || result.state === "partial").toBe(true);
      expect(result.leads.length).toBeGreaterThan(0);
      expect(result.leads.every((entry) => entry.provider === "grounded")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("reports skipped when grounded search is unprovisioned so the caller can fall back", async () => {
    const grounded = await import("./groundedSearch");
    const spy = vi.spyOn(grounded, "groundedSearch").mockResolvedValue(null);
    try {
      const { ctx } = context();
      const questions = basicFactsResearchQuestions(ctx);
      const result = await discoverGroundedBasicFactLeadsDetailed(ctx, questions, "primary");
      expect(result.state).toBe("skipped");
      expect(result.leads).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
