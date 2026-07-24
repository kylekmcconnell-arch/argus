// AI analyst agent. The engine needs axis scores with rationales, venture
// outcome classifications, and a one-line headline. Raw provider data is messy;
// this is the step where judgement lives. Every provider is constrained to the
// same JSON schema and every result passes the same deterministic validators.

import { createHash } from "node:crypto";
import { ANALYST_MODEL, env, providerFallbacksEnabled } from "./config";
import { addClaudeUsage, addGrokUsage } from "./cost";
import type {
  AxisEvidenceRecord,
  Contradiction,
  ProjectStrengthBandRecord,
  ProjectStrengthTier,
} from "../src/data/evidence";
import { isStrictFundScaleArtifact } from "../src/lib/fundScaleEvidence";
import { ANALYST_REPAIR_TIMEOUT_MS, ANALYST_SCORING_TIMEOUT_MS } from "../src/lib/investigationRuntime";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const SCHEMA_COMPILATION_ERROR = /compiled grammar is too large|schema is too complex for compilation/i;
const failureMeta = (error: unknown, timeoutMs: number, fallback: string): string =>
  error instanceof Error && error.name === "TimeoutError"
    ? `timeout_${timeoutMs}ms`
    : fallback;

export function analystAvailable(): boolean {
  return Boolean(env("ANTHROPIC_API_KEY") || env("XAI_API_KEY"));
}

interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}

// A classifier failure reason is TRANSIENT when a retry could plausibly
// succeed (network drop, timeout, upstream 5xx, rate-limit 429, a truncated
// JSON body). It is DETERMINISTIC when the same request would fail identically
// (max-token truncation, an over-complex schema, a 4xx, an ambiguous or missing
// tool call): retrying those wastes budget and money. Callers that retry (the
// analyst) pass onFailure to observe the reason and decide.
export function isTransientAnalystFailure(reason: string): boolean {
  return /^transport_error$/.test(reason)
    || /^timeout_\d+ms$/.test(reason)
    || /^response_json_error$/.test(reason)
    || /^http_(?:5\d\d|429)$/.test(reason);
}

export async function structured<T>(
  system: string,
  user: string,
  tool: ToolSchema,
  maxTokens = 2048,
  timeoutMs = 60_000,
  onFailure?: (reason: string) => void,
): Promise<T | null> {
  const deadlineAt = Date.now() + Math.max(0, timeoutMs);
  const claude = env("ANTHROPIC_API_KEY")
    ? await structuredClaude<T>(system, user, tool, maxTokens, timeoutMs, onFailure)
    : null;
  if (claude !== null || !env("XAI_API_KEY")) return claude;
  // A Claude FAILURE only retries on Grok when failover is explicitly enabled:
  // by default a dead provider fails visibly instead of silently moving the
  // spend to a different metered provider. With no Anthropic key at all, Grok
  // is the configured primary, not a fallback.
  if (env("ANTHROPIC_API_KEY") && !providerFallbacksEnabled()) return null;
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs < 1) return null;
  return structuredGrok<T>(system, user, tool, maxTokens, remainingMs, onFailure);
}

// Calls the Anthropic Messages API and forces a single tool call, returning the
// tool input as the structured result. Returns null on any failure so the
// governing wrapper can fail over to another configured analyst provider.
async function structuredClaude<T>(
  system: string,
  user: string,
  tool: ToolSchema,
  maxTokens: number,
  timeoutMs: number,
  onFailure?: (reason: string) => void,
): Promise<T | null> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  const startedAt = Date.now();
  // Prompt caching: the scoring rubric (system) and the evidence packet
  // (user) repeat verbatim across repair attempts and the validator pass
  // within one run's 5-minute cache window; cache reads bill at 10% of input.
  // Blocks below the model's minimum cacheable length are ignored harmlessly.
  const requestBody = JSON.stringify({
    model: ANALYST_MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: user, cache_control: { type: "ephemeral" } }] }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true },
  });
  const requestMetrics = {
    tool: tool.name,
    requestBytes: Buffer.byteLength(requestBody),
    schemaBytes: Buffer.byteLength(JSON.stringify(tool.input_schema)),
    userBytes: Buffer.byteLength(user),
    timeoutMs,
  };
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const failure = failureMeta(e, timeoutMs, "transport_error");
    addClaudeUsage(undefined, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      elapsedMs: Date.now() - startedAt,
    }));
    console.error(`[agent] ${tool.name} request failed (${failure})`, e);
    onFailure?.(failure);
    return null;
  }
  const requestId = res.headers.get("request-id") || res.headers.get("x-request-id");
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* response detail is diagnostic only */ }
    const failure = res.status === 400 && SCHEMA_COMPILATION_ERROR.test(detail)
      ? "schema_too_complex"
      : `http_${res.status}`;
    addClaudeUsage(undefined, tool.name, "failed", failure);
    onFailure?.(failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      httpStatus: res.status,
      requestId,
      elapsedMs: Date.now() - startedAt,
    }));
    console.error("[agent] anthropic error", res.status, detail);
    return null;
  }

  let data: {
    content?: { type: string; name?: string; input?: unknown }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch (e) {
    const failure = failureMeta(e, timeoutMs, "response_json_error");
    addClaudeUsage(undefined, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      httpStatus: res.status,
      requestId,
      elapsedMs: Date.now() - startedAt,
    }));
    console.error(`[agent] ${tool.name} response parse failed (${failure})`, e);
    onFailure?.(failure);
    return null;
  }
  const toolBlocks = Array.isArray(data.content)
    ? data.content.filter((candidate) => candidate.type === "tool_use")
    : [];
  const matchingBlocks = toolBlocks.filter((candidate) =>
    candidate.name === tool.name && candidate.input != null);
  const block = data.stop_reason === "tool_use"
    && toolBlocks.length === 1
    && matchingBlocks.length === 1
    ? matchingBlocks[0]
    : undefined;
  const partialReason = data.stop_reason !== "tool_use"
    ? `stop_reason_${data.stop_reason || "missing"}`
    : matchingBlocks.length === 0
      ? "missing_tool_use"
      : "ambiguous_tool_use";
  addClaudeUsage(
    data.usage,
    tool.name,
    block ? "succeeded" : "partial",
    block ? undefined : partialReason,
  );
  console.info("[agent-call]", JSON.stringify({
    ...requestMetrics,
    state: block ? "succeeded" : "partial",
    httpStatus: res.status,
    requestId,
    stopReason: data.stop_reason ?? null,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    toolUseCount: toolBlocks.length,
    elapsedMs: Date.now() - startedAt,
    ...(block ? {} : { failure: partialReason }),
  }));
  if (!block) onFailure?.(partialReason);
  return (block?.input as T) ?? null;
}

/** xAI structured-output fallback for scoring, contradiction, and intake tools.
 * It receives the same schema and evidence packet, then passes through every
 * existing deterministic validator before any result can affect a report. */
async function structuredGrok<T>(
  system: string,
  user: string,
  tool: ToolSchema,
  maxTokens: number,
  timeoutMs: number,
  onFailure?: (reason: string) => void,
): Promise<T | null> {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  const startedAt = Date.now();
  const requestBody = JSON.stringify({
    model: env("ARGUS_GROK_ANALYST_MODEL") || env("ARGUS_GROK_MODEL") || "grok-4-fast",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: `${system}\n\nReturn exactly one ${tool.name} object. ${tool.description}` },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: tool.name,
        strict: true,
        schema: tool.input_schema,
      },
    },
  });
  const requestMetrics = {
    provider: "grok",
    tool: tool.name,
    requestBytes: Buffer.byteLength(requestBody),
    schemaBytes: Buffer.byteLength(JSON.stringify(tool.input_schema)),
    userBytes: Buffer.byteLength(user),
    timeoutMs,
  };
  let response: Response;
  try {
    response = await fetch(XAI_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const failure = failureMeta(error, timeoutMs, "transport_error");
    addGrokUsage(undefined, 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      elapsedMs: Date.now() - startedAt,
    }));
    onFailure?.(failure);
    return null;
  }
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id");
  if (!response.ok) {
    addGrokUsage(undefined, 0, tool.name, "failed", `http_${response.status}`);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure: `http_${response.status}`,
      httpStatus: response.status,
      requestId,
      elapsedMs: Date.now() - startedAt,
    }));
    onFailure?.(`http_${response.status}`);
    return null;
  }

  let data: {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      num_sources_used?: number;
    };
  };
  try {
    data = await response.json() as typeof data;
  } catch (error) {
    const failure = failureMeta(error, timeoutMs, "response_json_error");
    addGrokUsage(undefined, 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      httpStatus: response.status,
      requestId,
      elapsedMs: Date.now() - startedAt,
    }));
    onFailure?.(failure);
    return null;
  }
  const content = data.choices?.[0]?.message?.content;
  const parsed: unknown = (() => {
    try {
      return typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return null;
    }
  })();
  const usage = {
    input_tokens: data.usage?.prompt_tokens,
    output_tokens: data.usage?.completion_tokens,
    num_sources_used: data.usage?.num_sources_used,
  };
  const valid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  addGrokUsage(usage, 0, tool.name, valid ? "succeeded" : "partial", valid ? undefined : "invalid_structured_output");
  console.info("[agent-call]", JSON.stringify({
    ...requestMetrics,
    state: valid ? "succeeded" : "partial",
    httpStatus: response.status,
    requestId,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    elapsedMs: Date.now() - startedAt,
    ...(valid ? {} : { failure: "invalid_structured_output" }),
  }));
  if (!valid) onFailure?.("invalid_structured_output");
  return valid ? parsed as T : null;
}

// Claim extraction: for an UNKNOWN handle, read the subject's own surfaces (bio
// + recent posts) and capture what they CLAIM about themselves, so the
// verification adapters have something to check. This is the step that lets a
// cold handle be audited. It captures claims, never truth.
export interface ExtractedClaims {
  roles: string[];
  ventures: { project_name: string; role?: string; period?: string; claimed_outcome?: string }[];
  testimonials: { claimed_endorser_handle: string; claimed_relationship?: string }[];
  advised: { project_name: string; project_handle?: string; claimed_role?: string }[];
  promotions: { ticker: string; contract_address?: string; chain?: string }[];
}

export async function extractClaims(handle: string, bio: string, posts: string[]): Promise<ExtractedClaims | null> {
  const system =
    "You are ARGUS intake. From a subject's own bio and recent posts, extract the " +
    "claims they make about themselves so they can be verified later. Capture CLAIMS " +
    "ONLY, never judge truth. Roles drawn from: FOUNDER, PROJECT, KOL, INVESTOR, " +
    "ADVISOR, AGENCY, MEMBER. Classify the ACCOUNT TYPE precisely: " +
    "PROJECT = the account IS an organization: a token, protocol, product, company, " +
    "or DAO's own brand/official handle (usually named after the project, speaks as " +
    "'we/our', ships and promotes its OWN single token/product). " +
    "FOUNDER = an individual PERSON who founded or leads a project (a personal account, " +
    "speaks as 'I'). " +
    "KOL = an influencer/caller whose activity is promoting OTHER people's tokens across " +
    "MANY different projects (calls, alpha, gems, paid shills for others), NOT their own. " +
    "INVESTOR = PROFESSIONAL capital allocation ONLY: an actual fund/VC/syndicate (or its " +
    "official brand account), a GP/partner/principal at one, or an angel with NAMED, " +
    "verifiable investments (led or joined specific rounds). Buying/trading tokens, " +
    "'investing in gems', or calling oneself an investor with no documented deals is NOT " +
    "INVESTOR. A caller who trades is a KOL, nothing more. " +
    "Decisive rules: a brand account promoting its own token is PROJECT (never KOL); an " +
    "investment firm's brand account is INVESTOR, NOT PROJECT (PROJECT is for accounts " +
    "shipping a product/token, not allocating capital); an individual builder is FOUNDER; " +
    "only tag KOL when they shill multiple external tokens they did not build. A subject " +
    "can hold several roles, but do not tag KOL merely for hype words or for promoting the " +
    "project's own token, and do not tag INVESTOR merely for trading talk. " +
    "Ventures = companies/projects they say they founded or led. " +
    "Testimonials = named people/accounts they cite as backers or endorsers. Advised " +
    "= projects they claim to advise. Promotions = tokens/tickers they shill; for a prolific caller " +
    "capture EVERY distinct token they promoted (each cashtag / chart-link post is a call), not just a few, " +
    "listing each ticker once with its contract address and chain when a chart link or CA is present. Use the " +
    "@handle form for accounts. Omit anything not actually claimed. Never use em dashes.";
  const user = `Subject: ${handle}\nBio: ${bio || "(none)"}\n\nPosts (a claim-targeted corpus: recent originals + keyword-searched history, each stamped [Month Year · views]; dates let you fill venture periods, engagement shows which claims the subject pushed):\n${posts.slice(0, 70).map((p, i) => `${i + 1}. ${p}`).join("\n") || "(none)"}`;
  const tool: ToolSchema = {
    name: "record_claims",
    description: "Record the subject's self-claimed roles, ventures, endorsers, advisory seats, and promotions.",
    input_schema: {
      type: "object",
      properties: {
        roles: { type: "array", items: { type: "string" } },
        ventures: {
          type: "array",
          items: {
            type: "object",
            properties: { project_name: { type: "string" }, role: { type: "string" }, period: { type: "string" }, claimed_outcome: { type: "string" } },
            required: ["project_name"],
          },
        },
        testimonials: {
          type: "array",
          items: {
            type: "object",
            properties: { claimed_endorser_handle: { type: "string" }, claimed_relationship: { type: "string" } },
            required: ["claimed_endorser_handle"],
          },
        },
        advised: {
          type: "array",
          items: {
            type: "object",
            properties: { project_name: { type: "string" }, project_handle: { type: "string" }, claimed_role: { type: "string" } },
            required: ["project_name"],
          },
        },
        promotions: {
          type: "array",
          items: {
            type: "object",
            properties: { ticker: { type: "string" }, contract_address: { type: "string" }, chain: { type: "string" } },
            required: ["ticker"],
          },
        },
      },
      required: ["roles", "ventures", "testimonials", "advised", "promotions"],
    },
  };
  return structured<ExtractedClaims>(system, user, tool, 4096);
}

// Phase 4: internal contradiction scan. Given everything collected, find places
// where the subject's own claims conflict with each other or with the evidence.
// This is the "do the stories match the facts" pass. Strict: a missing data
// point is a GAP, never a contradiction.
const lvl = (s?: string): "low" | "medium" | "high" => {
  const v = (s ?? "").toLowerCase();
  return v === "high" ? "high" : v === "low" ? "low" : "medium";
};

export async function scanContradictions(
  handle: string,
  evidenceJson: string,
  options: { deadlineAt?: number } = {},
): Promise<Contradiction[] | null> {
  const system =
    "You are ARGUS contradiction analysis. From everything collected about a subject, find INTERNAL CONTRADICTIONS: where the subject's own stated claims conflict with each other or with the collected evidence. " +
    "Examples: claims a team of N but only one builder is found; claims an audit but no auditor or verification exists; claims a named backer who never acknowledges them; a stated launch/founding date that conflicts with the account age, domain age, or on-chain history; claims 'doxxed' but no real identity resolves; claims locked liquidity that on-chain shows unlocked; a partnership the partner never confirmed; a venture in the bio that discovery found no evidence for. " +
    "Be STRICT and grounded: report ONLY genuine contradictions, each with the EXACT claim and the EXACT conflicting fact from the evidence. A missing or unverifiable data point is a GAP, not a contradiction; never report gaps, and never invent. If there are none, return an empty list. Never use em dashes. " +
    "SCOPE RULES: these are NOT contradictions: (1) ARGUS's OWN analysis metadata (fields like identity_confidence, identity_note, verdicts, evidence notes such as 'single-source lead, unverified') disagreeing with other ARGUS fields. Only the SUBJECT's outward claims vs external facts count; a low-confidence evidence note is a gap, not a conflict. (2) Normal vertical integration: a project's token running on its own chain, its dApp on its own platform, or its products naming each other is how ecosystems work, not circularity. (3) Marketing self-description ('#1', 'leading') vs modest traction is puffery to note in scoring, not a contradiction, unless it conflicts with a specific verifiable fact. " +
    "INVESTIGATIVE LEAD EXCLUSION: investigative leads are excluded from this evidence packet. Do not infer anything about the subject from their absence. " +
    "FINDING ATTRIBUTION RULE: when comparing or interpreting finding collections, attribute only direct-subject findings to the audited subject. A claim targeting an associate or venture cannot contradict the subject's claims unless separate direct-subject evidence explicitly connects the conduct to the subject. Never rewrite an associate's allegation as the subject's allegation. This attribution rule is specific to finding collections; profile, team, wallet, check-outcome, and other non-finding evidence in the packet remain legitimate evidence for testing the subject's claims.";
  const user = `Subject: ${handle}\n\nCollected evidence (JSON):\n${evidenceJson}`;
  const tool: ToolSchema = {
    name: "record_contradictions",
    description: "Record internal contradictions between the subject's claims and the collected evidence.",
    input_schema: {
      type: "object",
      properties: {
        contradictions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string", description: "what the subject asserts" },
              conflict: { type: "string", description: "the specific evidence that contradicts it" },
              severity: { type: "string", enum: ["low", "medium", "high"] },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["claim", "conflict", "severity", "confidence"],
          },
        },
      },
      required: ["contradictions"],
    },
  };
  const timeoutMs = typeof options.deadlineAt === "number"
    ? Math.min(60_000, Math.max(0, options.deadlineAt - Date.now()))
    : 60_000;
  if (timeoutMs < 1_000) {
    console.warn("[agent-runtime]", JSON.stringify({
      tool: "record_contradictions",
      state: "contradictions_skipped_budget",
      remainingMs: timeoutMs,
    }));
    return null;
  }
  const r = await structured<{ contradictions?: unknown }>(
    system,
    user,
    tool,
    2048,
    timeoutMs,
  );
  if (!r) return null;
  const contradictions = (() => {
    if (Array.isArray(r.contradictions)) return r.contradictions;
    if (typeof r.contradictions !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(r.contradictions);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })();
  if (!contradictions) {
    // Tool schemas are a contract, but providers can still return malformed
    // tool input. Contradiction analysis is advisory and must never abort the
    // governing scorer or discard an otherwise complete project audit.
    console.warn("[agent-runtime]", JSON.stringify({
      tool: "record_contradictions",
      state: "invalid_result_shape",
      received: r.contradictions === null ? "null" : typeof r.contradictions,
    }));
    return null;
  }
  return contradictions
    .filter((candidate): candidate is {
      claim: string;
      conflict: string;
      severity?: string;
      confidence?: string;
    } => {
      if (!candidate || typeof candidate !== "object") return false;
      const contradiction = candidate as Record<string, unknown>;
      return typeof contradiction.claim === "string"
        && contradiction.claim.trim().length > 0
        && typeof contradiction.conflict === "string"
        && contradiction.conflict.trim().length > 0;
    })
    .map((c) => ({ claim: c.claim.trim(), conflict: c.conflict.trim(), severity: lvl(c.severity), confidence: lvl(c.confidence) }))
    .slice(0, 10);
}

// The flagship analyst call: given everything collected, score each axis of each
// held role with a one-line rationale, classify identity, and write the headline.
// The engine still owns caps/banding/composite — the agent only fills the axes.
export interface AnalystVerdict {
  axes: {
    axis: string;
    score: number;
    rationale: string;
    evidenceRefs: string[];
    counterEvidenceRefs: string[];
    gaps: string[];
  }[];
  headline: string;
  identity_note: string;
}

export interface AnalystAxis {
  axis: string;
  weight: number;
  role: string;
}

/**
 * Project scores describe the quality and risk established by substantive
 * evidence. Collection completeness is reported separately by decision
 * readiness, so a provider miss cannot quietly become a second score penalty.
 * Keep this policy explicit and model-facing because axis maxima alone do not
 * define a calibrated scale.
 */
export const PROJECT_SCORING_POLICY = [
  "PROJECT CALIBRATION POLICY:",
  "Keep score and confidence separate. Score what substantive evidence establishes about project quality and risk. Record missing, unavailable, stale, or uncollected information in coverageRefs and gaps; those items reduce decision readiness outside this scorer and are not counter-evidence.",
  "Never subtract points merely because a provider did not run, a database returned no record, a licensed identity lookup missed, or a fact was not collected. Never charge the same gap against several axes. A material gap may keep an otherwise strong axis out of the exceptional band, but a gap alone must not push solid verified fundamentals into the mixed or adverse bands.",
  "Use the same evidence-strength bands on every project axis: 85 to 100 percent means exceptional, broad, current verification; 70 to 84 percent means solid verified fundamentals; 40 to 69 percent means an emerging, source-backed project with real but still limited demonstrated maturity or scale; 0 to 39 percent requires a severe verified weakness, contradiction, misconduct, or failure. Missing coverage is separate and never creates or lowers a strength tier.",
  "Anchor WITHIN each band by evidence density and independence: verification from several independent sources at demonstrated scale belongs at the top of its band, single-source or partial verification belongs low in it. A subject with top-tier verified scale, institutional corroboration, and a multi-year verified operating record should score at the top of whatever band its evidence justifies; do not park overwhelming verification at the band midpoint.",
  "If an axis has neither affirmative evidence nor verified adverse evidence, do not score it at zero. Mark it unscored and publish the investigation as INCOMPLETE. A zero is a severe assessment, not a synonym for missing data.",
  "P1 team and identity: named founders or leaders, a verified official account or domain, and a verified operating or legal entity are strong evidence. Missing LinkedIn profiles, full legal names, or a complete staff directory are confidence gaps, not evidence that a publicly named team is weak or anonymous.",
  "P2 product substance: a live product, first-party documentation, public source repositories, current releases, and independent evidence of operation justify a strong score. A missing whitepaper or audit can limit the exceptional band, but must not erase a verified working product.",
  "P3 token conduct: verified canonical token identity, healthy observable market activity, and no verified adverse conduct justify a solid score. Reserve the exceptional band for verified token economics plus an independent security review. An unknown unlock schedule is a gap, not evidence of dumping or manipulation. A completed token-identity assessment (the project-token-identity check) that binds no canonical token scores P3 at the low end for lack of demonstrated conduct history; it is a null result on this axis only, never adverse conduct evidence or counter-evidence against any other axis.",
  "P4 backing and partners: score source-backed integrations, counterparties, ecosystem partners, backers, and investors. Independent reporting can establish a solid relationship; reserve the exceptional band for direct counterparty, first-party, or multi-source corroboration. Venture funding is not required. A bootstrapped project is not weaker merely because no VC round was found, and a checked-empty funding search is not counter-evidence when meaningful partnerships are verified. A completed backing assessment (the project-backing-partners check) that finds no verified backer or partner in the collected record scores P4 at the low end as a null result on this axis only, never counter-evidence against any other axis.",
  "P5 traction and liveness: current product activity plus concrete usage, volume, users, fees, TVL, transactions, or other market metrics justify a strong score. Social posting alone is only mild support, but verified live usage must not be reduced to moderate merely because another metric was not collected.",
  "A severe canonical-token market drawdown is material counter-evidence for P5 and must be cited, but price performance alone only caps otherwise exceptional traction and liveness at the solid band. It cannot erase verified current protocol usage or imply token misconduct.",
  "P6 transparency and integrity: a named legal operator, terms, public docs or repositories, governance materials, and consistent current disclosures justify a solid score. Published independent audits, treasury reporting, and fuller financial disclosures may justify the exceptional band. An unavailable disclosure path is a confidence gap unless a direct verified search establishes a material nondisclosure.",
  "Only cite substantive counterEvidenceRefs for distinct verified facts that pull a score below its evidence-strength band. A verified adverse fact may be primary support for an adverse band, but positive support and score-limiting counter-evidence must otherwise remain separate citations. An emerging score reflects limited demonstrated maturity or scale and does not require adverse evidence. Never use absence wording or operational coverage telemetry as a reason to lower a band.",
].join("\n");

/**
 * Founder scores describe verified operating history and conduct, not how many
 * optional providers happened to return a row. Keep social reach and evidence
 * coverage in their own lanes so a famous, well-documented builder cannot be
 * reduced to a claimed identity when one database or exact-name query misses.
 */
export const FOUNDER_SCORING_POLICY = [
  "FOUNDER CALIBRATION POLICY:",
  "Keep score and confidence separate. Score source-backed identity, operating history, products, outcomes, conduct, and network quality. Record unavailable, stale, checked-empty, or uncollected information in coverageRefs and gaps. Missing coverage is not counter-evidence and never erases a verified fact.",
  "F1 identity verifiability: a fetched first-party organization page, regulator or institutional counterparty record, or two independent fetched sources can establish identity and current authority. A People Data Labs miss, an empty exact-name news query, or a missing personal GitHub profile is only a coverage gap.",
  "F2 track record: use verified founder and executive relationships, prior roles, products, launches, exits, and concrete operating outcomes. Follower count, posting cadence, profile biography, fame, and X follow relationships never establish a founder role or track record. Weigh the OBSERVED SCALE of what the subject verifiably founded: a verified venture token carries market capitalization, rank, and chain, and a founder whose venture independently reached top-tier scale has demonstrated an outcome far beyond merely shipping something. Reserve the exceptional band for exactly that.",
  "F3 repeat backing: require actual source-backed financing, investor, or repeat-counterparty records across distinct events. Social follows, mutual follows, and generic affiliations are network context, not repeat backing. A completed repeat-backing assessment (the founder-repeat-backing check) that establishes no source-backed repeat financing across the known ventures scores F3 at the low end for lack of a demonstrated positive signal; it is a null result on this axis only, never counter-evidence against identity, track record, build substance, or any other axis.",
  "F4 build substance: verified live products, protocols, documentation, audits, usage, releases, or organization repositories establish build substance. A personal GitHub account is optional and its absence cannot negate a verified live product. A verified venture token is direct evidence the venture shipped and is live at the observed market scale; a large, independently ranked network is the strongest build evidence available and belongs in the exceptional band.",
  "F5 reputation and integrity: use direct-subject, source-verified conduct, legal, regulatory, sanctions, governance, or conflict evidence. A completed clear screen is coverage context, not affirmative character evidence, and an unavailable screen is not adverse evidence.",
  "F6 network quality: use observed professional relationships and notable network evidence only for network quality. Never transfer that evidence into identity, track record, repeat backing, or build substance.",
  "Preserve the entity named by each source. A person may be CEO of an operating company and founder of a related protocol; do not transfer the company title onto the protocol or DAO.",
].join("\n");

export function scoringPolicyForAxes(axisCatalog: readonly AnalystAxis[]): string {
  return [
    ...(axisCatalog.some(({ role }) => role === "PROJECT") ? [PROJECT_SCORING_POLICY] : []),
    ...(axisCatalog.some(({ role }) => role === "FOUNDER") ? [FOUNDER_SCORING_POLICY] : []),
  ].join("\n\n");
}

// Anthropic compiles every strict tool schema into a grammar. Keep this schema
// shallow and invariant across investigations so the compiled grammar remains
// bounded and can be reused from the provider cache. Axis-specific semantics
// (the exact set, weights, citation eligibility, and array bounds) are enforced
// by validateAnalystVerdict below and then again at the API/database boundary.
export const RECORD_VERDICT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    axes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          axis: { type: "string", description: "Exact axis ID from the requested axis list." },
          score: { type: "integer", description: "Integer score within the maximum listed for this axis." },
          rationale: { type: "string", description: "Tight evidence-grounded rationale for this axis." },
          primaryEvidenceRef: { type: "string", description: "One substantive citation alias eligible for this axis." },
          additionalEvidenceRefs: {
            type: "array",
            items: { type: "string" },
            description: "Zero to seven additional unique substantive citation aliases eligible for this axis.",
          },
          counterEvidenceRefs: {
            type: "array",
            items: { type: "string" },
            description: "Zero to eight unique substantive citation aliases that credibly pull against this axis score.",
          },
          coverageRefs: {
            type: "array",
            items: { type: "string" },
            description: "Zero to four checked-empty or unavailable aliases for this axis; return an empty array when none apply.",
          },
          gaps: {
            type: "array",
            items: { type: "string" },
            description: "Zero to six unique descriptions of material unresolved evidence for this axis.",
          },
        },
        required: [
          "axis",
          "score",
          "rationale",
          "primaryEvidenceRef",
          "additionalEvidenceRefs",
          "counterEvidenceRefs",
          "coverageRefs",
          "gaps",
        ],
        additionalProperties: false,
      },
    },
    headline: { type: "string", description: "One non-empty sentence explaining what governs the composite verdict." },
    identity_note: { type: "string", description: "Non-empty identity resolution grounded in the collected evidence." },
  },
  required: ["axes", "headline", "identity_note"],
  additionalProperties: false,
} as const;

const ARTIFACT_ID = /^art_v1_[a-f0-9]{64}$/;
const COVERAGE_ONLY_VERIFICATIONS = new Set<AxisEvidenceRecord["verification"]>(["checked_empty", "unavailable"]);
const isSubstantiveArtifact = (artifact: AxisEvidenceRecord | undefined): artifact is AxisEvidenceRecord =>
  !!artifact && !COVERAGE_ONLY_VERIFICATIONS.has(artifact.verification);

// Coverage-only artifacts are frozen investigator context, not positive proof.
// Link one to an axis only when the analyst wrote an explicit, semantically
// related gap. This keeps a clear sanctions screen, a provider miss, or another
// absence record from silently becoming affirmative support while preserving
// the artifact itself in the immutable evidence catalog.
const GAP_MATCH_STOP_WORDS = new Set([
  "about", "after", "again", "against", "available", "because", "before",
  "being", "check", "checked", "collection", "could", "coverage", "evidence",
  "failed", "failure", "found", "from", "incomplete", "material", "missing",
  "provider", "record", "result", "returned", "screen", "search", "source",
  "still", "through", "unavailable", "unknown", "unresolved", "without",
]);

const gapMatchTerms = (value: string): Set<string> => new Set(
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 5 && !GAP_MATCH_STOP_WORDS.has(term)),
);

function coverageArtifactMatchesGap(
  artifact: AxisEvidenceRecord | undefined,
  gaps: readonly string[],
): boolean {
  if (!artifact || gaps.length === 0) return false;
  const artifactTerms = gapMatchTerms([
    artifact.provider,
    artifact.operation,
    artifact.section,
    artifact.title,
    artifact.excerpt ?? "",
  ].join(" "));
  if (artifactTerms.size === 0) return false;
  return gaps.some((gap) => {
    const terms = gapMatchTerms(gap);
    return [...terms].some((term) => artifactTerms.has(term));
  });
}

const isVerifiedCounterArtifact = (
  artifact: AxisEvidenceRecord | undefined,
  axis: string,
): artifact is AxisEvidenceRecord =>
  artifact?.verification === "verified" && artifact.counterEligibleAxes?.includes(axis) === true;
const isOneTierCounterArtifact = (artifact: AxisEvidenceRecord | undefined): boolean =>
  artifact?.operation === "findings:ProjectTokenDrawdown";
const TEAM_IDENTITY_NOUN = "(?:identity|founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)";
// The unresolved-identity gate polices claims about the audited team itself,
// so the negation must bind to that noun. A team noun serving as the object of
// a preposition ("profiles for two executives", "litigation involving the
// founders") or qualified as another asset's staff ("treasury multisig
// operators", "partner's team") is not a claim that the team is unresolved.
const SUBJECT_TEAM_NOUN =
  "(?<!\\b(?:for|of|about|regarding|involving|against|concerning|with|by|on|around|toward|towards)\\s(?:[\\w-]+\\s){0,3})" +
  "(?<!\\b(?:multi-?sig(?:nature)?s?|wallet|treasury|custody|partner(?:'s|s'?)?|counterpart(?:y|ies)(?:'s)?|vendor(?:'s|s)?)\\s)" +
  TEAM_IDENTITY_NOUN;
// Exonerating double negation ("no anonymous founders", "not an anonymous
// team") AFFIRMS the named team and must not read as an absence claim.
const EXONERATING_TEAM_ADJECTIVES = "anonymous|unnamed|undisclosed|unidentified|unknown|unverified|pseudonymous|hidden";
const UNRESOLVED_TEAM_IDENTITY_CLAIM = new RegExp(
  `(?:\\b${SUBJECT_TEAM_NOUN}\\b(?:\\s+[\\w-]+){0,7}\\s+\\b(?:remains?|is|are|was|were|appears?)\\s+(?:still\\s+)?(?:unresolved|unnamed|anonymous|unknown|incomplete|absent|missing)\\b)` +
  `|(?:\\b${SUBJECT_TEAM_NOUN}\\b(?:\\s+[\\w-]+){0,7}\\s+\\b(?:could\\s+not\\s+be|has\\s+not\\s+been|have\\s+not\\s+been)\\s+(?:identified|named|resolved|verified|confirmed|corroborated|surfaced|disclosed|enumerated)\\b)` +
  `|(?:(?<!\\b(?:not|no|never|without|longer)\\s)(?<!\\b(?:not|no|never)\\s(?:an?|the)\\s)\\b(?:unresolved|unnamed|anonymous|unknown|incomplete|absent|missing)\\b(?:\\s+[\\w-]+){0,7}\\s+\\b${TEAM_IDENTITY_NOUN}\\b)` +
  `|(?:\\b(?:no|absent|absence\\s+of|without|missing|lacks?)\\s+(?:(?!(?:${EXONERATING_TEAM_ADJECTIVES}|about|regarding|involving|against|concerning|surrounding|toward|towards|over|on|with|by|from|to)\\b)[\\w-]+\\s+){0,6}(?:named\\s+)?${TEAM_IDENTITY_NOUN}\\b)` +
  `|(?:\\babsence\\s+of\\s+named\\s+${TEAM_IDENTITY_NOUN}\\b)` +
  `|(?:\\b(?:named\\s+)?${SUBJECT_TEAM_NOUN}\\b(?:\\s+[\\w-]+){0,7}\\s+\\b(?:(?:is|are|was|were)\\s+)?not\\s+(?:surfaced|disclosed|present|identified|named|resolved|verified|confirmed|corroborated|enumerated)\\b)`,
  "i",
);
const describesGroundedTeamAsUnresolved = (value: string): boolean => {
  if (UNRESOLVED_TEAM_IDENTITY_CLAIM.test(value)) return true;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return /\bnamed\s+(?:founders?|co\s+founders?|leaders?|leadership|team|executives?|ceo)(?:\s+\w+){0,12}\s+not\s+(?:surfaced|disclosed|present|identified|named|resolved|verified|confirmed|corroborated|enumerated)\b/.test(normalized);
};
const UNVERIFIED_FOUNDER_ROLE_CLAIMS = [
  /\b(?:founder(?:ship)?|co[- ]?founder|chief executive|ceo|current\s+(?:operating\s+)?role|operating\s+role|founder\s+relationship)\b[^.!?]{0,140}\b(?:alleged|claimed|inferred|purported|self[- ]?(?:described|reported)|unconfirmed|uncorroborated|unresolved|unverified|not\s+(?:independently\s+)?(?:confirmed|corroborated|verified))\b/i,
  /\b(?:alleged|claimed|purported|self[- ]?(?:described|reported)|unconfirmed|uncorroborated|unverified)\b[^.!?]{0,100}\b(?:founder|co[- ]?founder|chief executive|ceo|current\s+(?:operating\s+)?role)\b/i,
  /\b(?:presents?|positions?)\s+(?:himself|herself|themself|themselves|the\s+subject)?\s*as\b[^.!?]{0,100}\b(?:founder|co[- ]?founder|chief executive|ceo)\b/i,
  /\b(?:identity|current\s+role|operating\s+role|founder\s+status)\b[^.!?]{0,100}\b(?:formally\s+)?(?:remains?\s+)?(?:unresolved|unverified|unconfirmed|uncorroborated)\b/i,
] as const;
const SOCIAL_ONLY_TRACK_RECORD_CLAIM = /(?:\btrack\s+record\b[^.!?]{0,220}\b(?:inferred|rests?\s+on|based\s+(?:only|primarily)\s+on|not\s+independently\s+(?:verified|corroborated))\b[^.!?]{0,220}\b(?:claimed\s+role|follower(?:s|\s+base|\s+count)?|social\s+(?:graph|reach)|profile\s+bio)|\b(?:claimed\s+role|follower(?:s|\s+base|\s+count)?|social\s+(?:graph|reach))\b[^.!?]{0,220}\b(?:rather\s+than|without)\b[^.!?]{0,120}\b(?:independent|verified|source-backed)\s+(?:artifacts?|evidence|sources?)\b)/i;
const describesGroundedFounderRoleAsUnverified = (value: string): boolean =>
  UNVERIFIED_FOUNDER_ROLE_CLAIMS.some((claim) => claim.test(value));
const describesGroundedTrackRecordAsSocialOnly = (value: string): boolean =>
  SOCIAL_ONLY_TRACK_RECORD_CLAIM.test(value);
const FOUNDER_SOCIAL_EVIDENCE = /\b(?:followers?|follower\s+(?:base|count)|follow\s+graph|mutual\s+follows?|notable\s+followers?|posting\s+cadence|profile\s+bio(?:graphy)?|social\s+(?:graph|reach))\b/i;
const FOUNDER_OPERATING_FUNDAMENTAL = /\b(?:track\s+record|operating\s+history|operating\s+track\s+record|repeat\s+backing|venture\s+outcomes?|founder\s+history)\b/i;
const SOCIAL_SUPPORT_VERB = /\b(?:establish(?:es|ed)?|support(?:s|ed)?|prove(?:s|d)?|demonstrat(?:e[sd]?|ed)|confirm(?:s|ed)?|validate(?:s|d)?|evidence(?:s|d)?|show(?:s|ed)?)\b/i;
const SOCIAL_SUPPORT_NEGATION = /\b(?:do|does|did|can|could|would|should)\s+not\s+(?:itself\s+)?(?:directly\s+)?(?:establish|support|prove|demonstrate|confirm|validate|evidence|show)\b|\b(?:cannot|can't|never|insufficient\s+to|not\s+enough\s+to)\s+(?:itself\s+)?(?:directly\s+)?(?:establish|support|prove|demonstrate|confirm|validate|evidence|show)\b|\b(?:is|are|was|were)\s+not\s+(?:established|supported|proven|demonstrated|confirmed|validated|evidenced|shown)\s+(?:by|from)\b/i;
const founderFundamentalsAffirmativelyRelyOnSocial = (value: string): boolean =>
  value.split(/[.!?]+/).some((sentence) => {
    if (
      !FOUNDER_SOCIAL_EVIDENCE.test(sentence)
      || !FOUNDER_OPERATING_FUNDAMENTAL.test(sentence)
      || SOCIAL_SUPPORT_NEGATION.test(sentence)
    ) return false;
    const social = FOUNDER_SOCIAL_EVIDENCE.exec(sentence);
    const fundamental = FOUNDER_OPERATING_FUNDAMENTAL.exec(sentence);
    if (!social || social.index === undefined || !fundamental || fundamental.index === undefined) return false;
    const support = SOCIAL_SUPPORT_VERB.exec(sentence);
    if (support?.index !== undefined) {
      return social.index < support.index && support.index < fundamental.index;
    }
    return fundamental.index < social.index
      && /\b(?:based|grounded|rest(?:s|ed)?|founded)\s+(?:on|in)\b/i.test(
        sentence.slice(fundamental.index, social.index),
      );
  });
// The absence gate polices claims that the followers themselves are absent.
// Partial-coverage wording about follower metadata ("notable follower depth is
// not documented") is endorsed gap phrasing, and a partitive subject ("none of
// the observed notable followers are flagged") presupposes the followers exist.
const ABSENT_NOTABLE_FOLLOWERS_CLAIM = new RegExp(
  "(?:\\b(?:no|zero)\\s+(?:named\\s+|verified\\s+|documented\\s+|structured\\s+|observed\\s+)?notable\\s+followers?\\b" +
  "|\\b(?:absence|lack|missing)\\s+of\\s+(?:named\\s+|verified\\s+|documented\\s+|observed\\s+)?notable\\s+followers?\\b" +
  "|\\bnotable\\s+followers?\\b(?:\\s+(?!(?:depth|coverage|count|counts|breadth|sampling|pagination|history|beyond)\\b)[\\w-]+){0,10}\\s+(?:are|were|remain)?\\s*not\\s+(?:listed|documented|present|included|provided|available|observed|surfaced)\\b" +
  "|\\b(?:notable\\s+followers?|observed\\s+network)(?:\\s+(?:evidence|data|array|list|collection|section))?\\s+(?:is|was|remains?)\\s+(?:empty|absent|missing|unavailable|not\\s+present)\\b" +
  "|\\bnone\\b(?:\\s+[\\w-]+){0,6}\\s+(?:are|were|is|was|qualify|qualifies|qualified|count|counts|counted|rank|ranks|ranked)\\s+(?:as\\s+)?(?:[\\w-]+\\s+){0,2}notable\\s+followers?\\b" +
  "|\\bno\\s+direct\\s+observed\\s+network\\s+evidence\\b)",
  "i",
);
const describesGroundedNotableFollowersAsAbsent = (value: string): boolean =>
  ABSENT_NOTABLE_FOLLOWERS_CLAIM.test(value);

// Claude can occasionally place the same substantive citation on both sides
// of an axis despite the strict prompt. Preserve the conservative meaning of
// that response by letting counter-evidence win and removing the duplicate
// from support. We only normalize when another substantive support reference
// remains; otherwise the strict validator rejects the row and the repair pass
// must choose a real replacement rather than manufacturing one.
export function normalizeAnalystSupportCounterOverlap(
  value: unknown,
  evidenceCatalog: AxisEvidenceRecord[],
  projectScoreBands: Readonly<Record<string, ProjectScoreBand>> = {},
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const aliasToArtifactId = new Map(
    evidenceCatalog.map((artifact, index) => [
      `e${String(index + 1).padStart(3, "0")}`,
      artifact.artifactId,
    ]),
  );
  const refKey = (ref: unknown): string | null => {
    if (typeof ref !== "string") return null;
    const alias = /^e\d+$/i.test(ref) ? ref.toLowerCase() : ref;
    return aliasToArtifactId.get(alias) ?? alias;
  };
  const normalizeRow = (candidate: unknown, axisHint?: string): unknown => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.primaryEvidenceRef !== "string"
      || !Array.isArray(row.additionalEvidenceRefs)
      || !Array.isArray(row.counterEvidenceRefs)
    ) return candidate;
    const axis = typeof row.axis === "string" ? row.axis : axisHint;
    const counterKeys = new Set(row.counterEvidenceRefs.map(refKey).filter((ref): ref is string => !!ref));
    const support = [row.primaryEvidenceRef, ...row.additionalEvidenceRefs];
    if (axis && projectScoreBands[axis]?.tier === "adverse") {
      const supportKeys = new Set(support.map(refKey).filter((ref): ref is string => !!ref));
      const disjointCounter = row.counterEvidenceRefs.filter((ref) => {
        const key = refKey(ref);
        return !key || !supportKeys.has(key);
      });
      return disjointCounter.length === row.counterEvidenceRefs.length
        ? candidate
        : { ...row, counterEvidenceRefs: disjointCounter };
    }
    const disjointSupport = support.filter((ref) => {
      const key = refKey(ref);
      return !key || !counterKeys.has(key);
    });
    if (disjointSupport.length === support.length) return candidate;
    if (disjointSupport.length === 0) return candidate;
    return {
      ...row,
      primaryEvidenceRef: disjointSupport[0],
      additionalEvidenceRefs: disjointSupport.slice(1),
    };
  };

  if (Array.isArray(root.axes)) {
    const rawAxes = root.axes;
    const axes = rawAxes.map((row) => normalizeRow(row));
    return axes.some((axis, index) => axis !== rawAxes[index]) ? { ...root, axes } : value;
  }
  if (root.axes && typeof root.axes === "object" && !Array.isArray(root.axes)) {
    const entries = Object.entries(root.axes as Record<string, unknown>);
    let changed = false;
    const axes = Object.fromEntries(entries.map(([axis, row]) => {
      const normalized = normalizeRow(row, axis);
      changed ||= normalized !== row;
      return [axis, normalized];
    }));
    return changed ? { ...root, axes } : value;
  }
  return value;
}

// Claude can also append a real citation from the wrong axis. Removing that
// cross-axis reference is safe when the same row already contains at least one
// substantive citation that is eligible for the requested axis. We never add a
// citation the model did not choose; when no eligible support remains, strict
// validation still rejects the row and the repair pass must try again.
export function normalizeAnalystCitationEligibility(
  value: unknown,
  evidenceCatalog: AxisEvidenceRecord[],
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const aliasToArtifact = new Map<string, AxisEvidenceRecord>();
  evidenceCatalog.forEach((artifact, index) => {
    aliasToArtifact.set(artifact.artifactId, artifact);
    aliasToArtifact.set(`e${String(index + 1).padStart(3, "0")}`, artifact);
  });
  const artifactFor = (ref: unknown): AxisEvidenceRecord | undefined => {
    if (typeof ref !== "string") return undefined;
    const key = /^e\d+$/i.test(ref) ? ref.toLowerCase() : ref;
    return aliasToArtifact.get(key);
  };
  const eligibleValues = (
    values: unknown[],
    axis: string,
    substantive: boolean,
  ): string[] => {
    return values.flatMap((value) => {
      if (typeof value !== "string") return [];
      const artifact = artifactFor(value);
      if (
        !artifact
        || !artifact.eligibleAxes.includes(axis)
        || isSubstantiveArtifact(artifact) !== substantive
      ) return [];
      return [value];
    });
  };
  const normalizeRow = (candidate: unknown, axisHint?: string): unknown => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const row = candidate as Record<string, unknown>;
    const axis = typeof row.axis === "string" ? row.axis : axisHint;
    if (
      !axis
      || typeof row.primaryEvidenceRef !== "string"
      || !Array.isArray(row.additionalEvidenceRefs)
      || !Array.isArray(row.counterEvidenceRefs)
      || !Array.isArray(row.coverageRefs)
    ) return candidate;
    const support = eligibleValues([row.primaryEvidenceRef, ...row.additionalEvidenceRefs], axis, true);
    if (!support.length) return candidate;
    // Overlap policy belongs to normalizeAnalystSupportCounterOverlap, which
    // runs first. Deduplicating counter against support here would resolve the
    // sole-support overlap case in favor of support, silently erasing the
    // counter-evidence marker the strict validator must reject for repair.
    const counter = eligibleValues(row.counterEvidenceRefs, axis, true);
    const coverage = eligibleValues(row.coverageRefs, axis, false);
    const changed = support[0] !== row.primaryEvidenceRef
      || support.length - 1 !== row.additionalEvidenceRefs.length
      || counter.length !== row.counterEvidenceRefs.length
      || coverage.length !== row.coverageRefs.length;
    return changed ? {
      ...row,
      primaryEvidenceRef: support[0],
      additionalEvidenceRefs: support.slice(1),
      counterEvidenceRefs: counter,
      coverageRefs: coverage,
    } : candidate;
  };

  if (Array.isArray(root.axes)) {
    const rawAxes = root.axes;
    const axes = rawAxes.map((row) => normalizeRow(row));
    return axes.some((axis, index) => axis !== rawAxes[index]) ? { ...root, axes } : value;
  }
  if (root.axes && typeof root.axes === "object" && !Array.isArray(root.axes)) {
    const entries = Object.entries(root.axes as Record<string, unknown>);
    let changed = false;
    const axes = Object.fromEntries(entries.map(([axis, row]) => {
      const normalized = normalizeRow(row, axis);
      changed ||= normalized !== row;
      return [axis, normalized];
    }));
    return changed ? { ...root, axes } : value;
  }
  return value;
}

// The uiCopyPolicy CI gate bans em and en dashes but can only see authored
// string literals; model-generated verdict copy (headline, identity note,
// rationales, gaps) is the one user-facing channel it cannot reach, so the
// banned dashes are normalized deterministically before the copy is frozen.
// A digit range keeps a plain hyphen; a prose dash becomes a comma pause.
const stripBannedDashes = (value: string): string => value
  .replace(/(\d)\s*[\u2013\u2014]\s*(?=\d)/g, "$1-")
  .replace(/\s*[\u2013\u2014]+\s*/g, ", ")
  .replace(/^,\s*/, "")
  .replace(/,\s*$/, "")
  .trim();

// Tool schemas constrain the shape Claude is asked to return, but provider
// responses are still untrusted input. An analyst result is usable only when it
// contains one (and only one) finite, in-range score for every requested axis.
// Returning null is deliberate: callers must publish INCOMPLETE rather than
// silently treating a missing axis as zero or retaining stale seeded scores.
export function validateAnalystVerdict(
  value: unknown,
  axisCatalog: AnalystAxis[],
  evidenceCatalog: AxisEvidenceRecord[] = [],
  onReject?: (reason: string) => void,
  options: { projectScoreBands?: Readonly<Record<string, ProjectScoreBand>> } = {},
): AnalystVerdict | null {
  const reject = (reason: string): null => {
    onReject?.(reason);
    return null;
  };
  if (!value || typeof value !== "object" || Array.isArray(value) || !axisCatalog.length || !evidenceCatalog.length) {
    return reject("invalid-root-or-catalog");
  }
  const raw = value as { axes?: unknown; headline?: unknown; identity_note?: unknown };
  if (Object.keys(value as Record<string, unknown>).some((key) =>
    !["axes", "headline", "identity_note"].includes(key))) {
    return reject("root-extra-field");
  }
  const headline = typeof raw.headline === "string" ? stripBannedDashes(raw.headline) : "";
  const identityNote = typeof raw.identity_note === "string" ? stripBannedDashes(raw.identity_note) : "";
  if (!headline || !identityNote) return reject("blank-headline-or-identity-note");

  const expected = new Map<string, AnalystAxis>();
  for (const spec of axisCatalog) {
    if (!spec.axis || expected.has(spec.axis) || !Number.isInteger(spec.weight) || spec.weight < 0) {
      return reject("invalid-axis-catalog");
    }
    expected.set(spec.axis, spec);
  }

  const artifacts = new Map<string, AxisEvidenceRecord>();
  for (const artifact of evidenceCatalog) {
    if (
      !ARTIFACT_ID.test(artifact.artifactId)
      || artifacts.has(artifact.artifactId)
      || artifact.contentHash !== artifact.artifactId.slice("art_v1_".length)
      || !Array.isArray(artifact.eligibleAxes)
    ) return reject("invalid-evidence-catalog");
    artifacts.set(artifact.artifactId, artifact);
  }

  // This is a semantic invariant, not a writing preference. A scorer packet can
  // contain a content-addressed, governing team artifact while the model still
  // repeats a stale "identity unresolved" narrative from an unavailable person
  // lookup. Do not publish that internal contradiction. The repair pass receives
  // the rejection reason and must describe the named public team accurately.
  const hasGroundedProjectTeam = expected.has("P1_team_and_identity")
    && evidenceCatalog.some((artifact) =>
      artifact.eligibleAxes.includes("P1_team_and_identity")
      && isSubstantiveArtifact(artifact)
      && artifact.section === "team");
  const rawAxisRow = (axis: string): unknown => {
    if (Array.isArray(raw.axes)) {
      return raw.axes.find((candidate) =>
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).axis === axis);
    }
    return raw.axes && typeof raw.axes === "object" && !Array.isArray(raw.axes)
      ? (raw.axes as Record<string, unknown>)[axis]
      : undefined;
  };
  const axisNarrative = JSON.stringify(raw.axes ?? "");
  // The team and follower gates scan only the row that owns the claim plus the
  // headline and identity note. A true statement on another axis ("the
  // treasury multisig operators are not disclosed" on P6, "one partner's team
  // is unknown" on P4) is not an internal contradiction about the subject.
  const teamAxisNarrative = JSON.stringify(rawAxisRow("P1_team_and_identity") ?? "");
  if (
    hasGroundedProjectTeam
    && (describesGroundedTeamAsUnresolved(headline)
      || describesGroundedTeamAsUnresolved(identityNote)
      || describesGroundedTeamAsUnresolved(teamAxisNarrative))
  ) {
    return reject("grounded-team-described-as-unresolved");
  }
  const hasFounderAxis = [...expected.values()].some((axis) => axis.role === "FOUNDER");
  const networkMisusedForFounderFundamentals = ["F2_track_record", "F3_repeat_backing"]
    .filter((axis) => expected.get(axis)?.role === "FOUNDER")
    .some((axis) => founderFundamentalsAffirmativelyRelyOnSocial(
      JSON.stringify(rawAxisRow(axis) ?? ""),
    ));
  if (networkMisusedForFounderFundamentals) {
    return reject("founder-fundamentals-cite-network-only-evidence");
  }
  const hasGroundedFounderRole = hasFounderAxis && evidenceCatalog.some((artifact) =>
    artifact.verification === "verified"
    && (
      artifact.operation === "basicFacts:founder"
      || artifact.operation === "checkOutcomes:founder-company-relationships"
    ));
  if (
    hasGroundedFounderRole
    && (describesGroundedFounderRoleAsUnverified(headline)
      || describesGroundedFounderRoleAsUnverified(identityNote)
      || describesGroundedFounderRoleAsUnverified(axisNarrative))
  ) {
    return reject("grounded-founder-role-described-as-unverified");
  }
  const hasGroundedFounderTrackRecord = hasFounderAxis && evidenceCatalog.some((artifact) =>
    artifact.verification === "verified"
    && (
      (artifact.section === "basicFacts" && [
        "basicFacts:founder",
        "basicFacts:founded",
        "basicFacts:prior_role",
        "basicFacts:product",
        "basicFacts:launched",
        "basicFacts:exit",
        "basicFacts:track_record",
        "basicFacts:traction",
      ].includes(artifact.operation))
      || (artifact.section === "checkOutcomes"
        && artifact.operation === "checkOutcomes:founder-track-record")
    ));
  if (
    hasFounderAxis
    && (describesGroundedTrackRecordAsSocialOnly(headline)
      || describesGroundedTrackRecordAsSocialOnly(identityNote)
      || describesGroundedTrackRecordAsSocialOnly(axisNarrative))
  ) {
    return reject(hasGroundedFounderTrackRecord
      ? "grounded-founder-track-record-described-as-social-only"
      : "founder-track-record-described-as-social-only");
  }
  const hasGroundedNotableFollowers = expected.has("F6_network_quality")
    && evidenceCatalog.some((artifact) =>
      artifact.section === "notableFollowers"
      && artifact.eligibleAxes.includes("F6_network_quality")
      && isSubstantiveArtifact(artifact));
  const followerAxisNarrative = JSON.stringify(rawAxisRow("F6_network_quality") ?? "");
  if (
    hasGroundedNotableFollowers
    && (describesGroundedNotableFollowersAsAbsent(headline)
      || describesGroundedNotableFollowersAsAbsent(identityNote)
      || describesGroundedNotableFollowersAsAbsent(followerAxisNarrative))
  ) {
    return reject("grounded-notable-followers-described-as-absent");
  }

  const artifactIdByAlias = new Map(
    evidenceCatalog.map((artifact, index) => [
      `e${String(index + 1).padStart(3, "0")}`,
      artifact.artifactId,
    ]),
  );
  const resolveRef = (value: string): string => {
    const alias = /^e\d+$/i.test(value) ? value.toLowerCase() : value;
    return artifactIdByAlias.get(alias) ?? value;
  };

  let keyedAxes = false;
  const keyedRowKeys = new Map<string, string[]>();
  let candidates: unknown[];
  if (Array.isArray(raw.axes)) {
    if (raw.axes.length !== axisCatalog.length) return reject("axis-count");
    candidates = raw.axes;
  } else if (raw.axes && typeof raw.axes === "object") {
    keyedAxes = true;
    const rows = raw.axes as Record<string, unknown>;
    const keys = Object.keys(rows);
    if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
      return reject("axis-key-set");
    }
    candidates = axisCatalog.map((spec) => {
      const candidate = rows[spec.axis];
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      keyedRowKeys.set(spec.axis, Object.keys(candidate as Record<string, unknown>));
      return { ...(candidate as Record<string, unknown>), axis: spec.axis };
    });
  } else {
    return reject("axis-shape");
  }

  const validRefs = (value: unknown, min: number, max: number): string[] | null => {
    if (!Array.isArray(value) || value.length < min || value.length > max) return null;
    if (!value.every((item) => typeof item === "string")) return null;
    const refs = (value as string[]).map(resolveRef);
    if (!refs.every((item) => ARTIFACT_ID.test(item))) return null;
    return new Set(refs).size === refs.length ? [...refs] : null;
  };
  const validGaps = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || value.length > 6) return null;
    const gaps = value.map((item) => typeof item === "string" ? stripBannedDashes(item) : "");
    if (gaps.some((gap) => !gap || gap.length > 400) || new Set(gaps).size !== gaps.length) return null;
    return gaps;
  };

  const seen = new Map<string, AnalystVerdict["axes"][number]>();
  const outOfBandProjectScores: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return reject("axis-row-shape");
    }
    const row = candidate as {
      axis?: unknown;
      score?: unknown;
      rationale?: unknown;
      primaryEvidenceRef?: unknown;
      additionalEvidenceRefs?: unknown;
      coverageRefs?: unknown;
      evidenceRefs?: unknown;
      counterEvidenceRefs?: unknown;
      gaps?: unknown;
    };
    if (
      typeof row.axis !== "string"
      || typeof row.score !== "number"
      || typeof row.rationale !== "string"
      || !row.rationale.trim()
    ) return reject("axis-row-required-fields");
    const spec = expected.get(row.axis);
    if (!spec) return reject(`unknown-axis:${row.axis}`);
    if (seen.has(row.axis)) return reject(`duplicate-axis:${row.axis}`);
    if (!Number.isInteger(row.score) || row.score < 0 || row.score > spec.weight) {
      return reject(`score-out-of-range:${row.axis}`);
    }
    const primary = typeof row.primaryEvidenceRef === "string"
      ? resolveRef(row.primaryEvidenceRef)
      : "";
    const additional = validRefs(row.additionalEvidenceRefs, 0, 7);
    const hasCoverageCandidates = [...artifacts.values()].some((artifact) =>
      COVERAGE_ONLY_VERIFICATIONS.has(artifact.verification)
      && artifact.eligibleAxes.includes(row.axis as string));
    const allowedFields = new Set([
      ...(keyedAxes ? [] : ["axis"]),
      "score",
      "rationale",
      "primaryEvidenceRef",
      "additionalEvidenceRefs",
      "counterEvidenceRefs",
      "gaps",
      ...(!keyedAxes || hasCoverageCandidates ? ["coverageRefs"] : []),
    ]);
    const rowKeys = keyedAxes
      ? keyedRowKeys.get(row.axis) ?? []
      : Object.keys(candidate as Record<string, unknown>);
    if (rowKeys.some((key) => !allowedFields.has(key))) {
      return reject(`axis-row-extra-field:${row.axis}`);
    }
    if (
      (keyedAxes && hasCoverageCandidates && row.coverageRefs === undefined)
      || (keyedAxes && !hasCoverageCandidates && row.coverageRefs !== undefined)
      || (!keyedAxes && row.coverageRefs === undefined)
    ) {
      return reject(`coverage-field-shape:${row.axis}`);
    }
    const rawCoverage = row.coverageRefs === undefined ? [] : row.coverageRefs;
    if (Array.isArray(rawCoverage) && rawCoverage.length > 4) {
      return reject(`coverage-reference-limit-observed-${rawCoverage.length}-max-4:${row.axis}`);
    }
    const coverage = validRefs(rawCoverage, 0, 4);
    if (!ARTIFACT_ID.test(primary)) return reject(`primary-reference-shape:${row.axis}`);
    if (!additional) return reject(`additional-reference-shape:${row.axis}`);
    if (!coverage) return reject(`coverage-reference-shape:${row.axis}`);
    const supportRefs = [primary, ...additional];
    const coverageRefs = coverage;
    const allSelectedEvidenceRefs = [...supportRefs, ...coverageRefs];
    if (new Set(allSelectedEvidenceRefs).size !== allSelectedEvidenceRefs.length) {
      return reject(`duplicate-evidence-reference:${row.axis}`);
    }
    const counterEvidenceRefs = validRefs(row.counterEvidenceRefs, 0, 8);
    const gaps = validGaps(row.gaps);
    if (allSelectedEvidenceRefs.length > 12 || !counterEvidenceRefs || !gaps) {
      return reject(`axis-arrays-invalid:${row.axis}`);
    }
    // A gap may claim a collection path was never run only while the frozen
    // catalog actually lacks that evidence. Relationship press frozen in the
    // catalog and eligible for the backing axis falsifies "partnership ...
    // not collected" wording, so the row is rejected and the repair pass must
    // rewrite the gap against the collected evidence. Asymmetry, stated
    // openly: every other reject here keys on verified artifacts; this one
    // keys on unfetched press headlines and is defensible only because the
    // policed claim ("not collected") is a collection-status statement the
    // headlines' existence directly falsifies. Verification-failure phrasing
    // ("could not be verified/found") is deliberately untouched.
    if (spec.role === "PROJECT" && row.axis === "P4_backing_and_partners") {
      const frozenRelationshipPress = [...artifacts.values()].some((artifact) => {
        if (!artifact.eligibleAxes.includes("P4_backing_and_partners")) return false;
        if (artifact.verification === "unavailable") return false;
        const text = `${artifact.title} ${artifact.excerpt ?? ""}`;
        return MATERIAL_RELATIONSHIP_PRESS.test(text) && !MATERIAL_RELATIONSHIP_DENIAL.test(text);
      });
      const collectionStatusGap = gaps.some((gap) =>
        /\b(?:partner|integrat|counterpart)/i.test(gap) && /\bnot\s+collected\b/i.test(gap));
      if (frozenRelationshipPress && collectionStatusGap) {
        return reject(`relationship-press-described-as-uncollected:${row.axis}`);
      }
    }
    if (counterEvidenceRefs.some((ref) => allSelectedEvidenceRefs.includes(ref))) {
      return reject(`support-counter-overlap:${row.axis}`);
    }
    const everyRefEligible = [...allSelectedEvidenceRefs, ...counterEvidenceRefs].every((ref) => {
      const artifact = artifacts.get(ref);
      return artifact?.eligibleAxes.includes(row.axis as string);
    });
    if (!everyRefEligible) return reject(`axis-ineligible-reference:${row.axis}`);
    // Coverage records preserve exact gap lineage but cannot satisfy support by
    // themselves. Every scored axis must also cite substantive evidence.
    if (!supportRefs.some((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`missing-substantive-support:${row.axis}`);
    }
    if (!supportRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-support:${row.axis}`);
    }
    if (!coverageRefs.every((ref) => !isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`substantive-coverage-reference:${row.axis}`);
    }
    const hasUnavailableCoverage = coverageRefs.some((ref) =>
      artifacts.get(ref)?.verification === "unavailable");
    if (hasUnavailableCoverage && gaps.length === 0) {
      return reject(`coverage-without-gap:${row.axis}`);
    }
    const linkedCoverageRefs = coverageRefs.filter((ref) =>
      coverageArtifactMatchesGap(artifacts.get(ref), gaps));
    // Unlinked coverage remains in axisEvidenceCatalog for the investigator,
    // but never enters positive evidenceRefs. Strict persistence therefore sees
    // absence evidence only when the analyst also supplied a matching gap.
    const evidenceRefs = [...supportRefs, ...linkedCoverageRefs];
    if (!counterEvidenceRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-counter-reference:${row.axis}`);
    }
    if (
      spec.role === "PROJECT"
      && !counterEvidenceRefs.every((ref) => isVerifiedCounterArtifact(artifacts.get(ref), row.axis as string))
    ) {
      return reject(`project-counter-reference-not-score-limiting:${row.axis}`);
    }
    const projectBand = options.projectScoreBands?.[row.axis];
    const requiredBoundedCounters = [...artifacts.values()].filter((artifact) =>
      isOneTierCounterArtifact(artifact)
      && isVerifiedCounterArtifact(artifact, row.axis as string));
    if (
      spec.role === "PROJECT"
      && projectBand?.tier !== "adverse"
      && requiredBoundedCounters.some((artifact) => !counterEvidenceRefs.includes(artifact.artifactId))
    ) {
      return reject(`project-required-counter-reference-missing:${row.axis}`);
    }
    const verifiedCounterArtifacts = counterEvidenceRefs
      .map((ref) => artifacts.get(ref))
      .filter((artifact): artifact is AxisEvidenceRecord =>
        isVerifiedCounterArtifact(artifact, row.axis as string));
    const hasVerifiedCounterEvidence = verifiedCounterArtifacts.length > 0
      || (
        projectBand?.tier === "adverse"
        && supportRefs.some((ref) => isVerifiedCounterArtifact(artifacts.get(ref), row.axis as string))
      );
    const hasSevereCounterEvidence = verifiedCounterArtifacts.some((artifact) =>
      !isOneTierCounterArtifact(artifact));
    if (
      spec.role === "PROJECT"
      && options.projectScoreBands
      && (
        !projectBand
        || projectBand.tier === "none"
        || row.score > projectBand.maxScore
        || (
          projectBand.tier !== "adverse"
          && row.score < projectBand.minScore
          && (!hasVerifiedCounterEvidence || !hasSevereCounterEvidence)
        )
      )
    ) outOfBandProjectScores.push(row.axis);
    seen.set(row.axis, {
      axis: row.axis,
      score: row.score,
      rationale: stripBannedDashes(row.rationale),
      evidenceRefs,
      counterEvidenceRefs,
      gaps,
    });
  }
  if (seen.size !== expected.size) return reject("incomplete-axis-set");
  if (outOfBandProjectScores.length > 0) {
    return reject(`project-scores-outside-evidence-strength-band:${outOfBandProjectScores.join(",")}`);
  }

  return {
    // Canonical order makes downstream completeness checks and snapshots stable.
    axes: axisCatalog.map((spec) => seen.get(spec.axis)!),
    headline,
    identity_note: identityNote,
  };
}

export const ANALYST_EVIDENCE_MAX_CHARS = 24_000;
const SCORING_PACKET_STATE_FIELD = "scoring_packet_state";
const SCORING_PACKET_OVERSIZE = "oversize";

const scoringPacketOversizeJson = (requestedAxisCount: number, reason: string): string => JSON.stringify({
  schema_version: 5,
  [SCORING_PACKET_STATE_FIELD]: SCORING_PACKET_OVERSIZE,
  reason,
  limit_chars: ANALYST_EVIDENCE_MAX_CHARS,
  requested_axis_count: requestedAxisCount,
  evidenceCatalog: [],
});

interface AnalystEvidencePacketOptions {
  /**
   * Discovery-only rows are useful in the investigator UI, but they must never
   * enter the context used to score or contradict the audited subject.
   */
  includeInvestigativeLeads: boolean;
  axisCatalog?: AnalystAxis[];
}

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  return value.length <= max ? value : value.slice(0, max) + "…";
};

const compactObject = (value: unknown, depth = 0): unknown => {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return clip(value, 320);
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => compactObject(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 24)
      .map(([key, item]) => [key, compactObject(item, depth + 1)])
      .filter(([, item]) => item !== undefined),
  );
};

const SCORING_PROFILE_FIELDS = [
  "handle", "display_name", "resolved_name", "bio", "website",
  "profile_collection_state", "profile_provider", "profile_captured_at",
  "x_account_status", "x_account_status_source_url", "x_account_status_captured_at",
  "last_post_at", "days_since_post",
] as const;

const compactScoringProfile = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const prioritized = Object.fromEntries(SCORING_PROFILE_FIELDS.flatMap((key) => {
    const compacted = compactObject(row[key], 1);
    return compacted === undefined ? [] : [[key, compacted]];
  }));
  const remainder = compactObject(value);
  return remainder && typeof remainder === "object" && !Array.isArray(remainder)
    ? { ...(remainder as Record<string, unknown>), ...prioritized }
    : prioritized;
};

const compactProjectToken = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const history = row.history && typeof row.history === "object" && !Array.isArray(row.history)
    ? row.history as Record<string, unknown>
    : undefined;
  // The frozen OHLCV points belong in the investigator UI, not in the language
  // model packet. Preserve the market and trend summary while keeping the
  // scoring prompt small and deterministic.
  return {
    ...Object.fromEntries(Object.entries(row).flatMap(([key, item]) => {
      if (key === "history") return [];
      const compacted = compactObject(item, 1);
      return compacted === undefined ? [] : [[key, compacted]];
    })),
    ...(history ? {
      history: Object.fromEntries([
        "first", "last", "peak", "changePct", "drawdownPct", "timeframe", "poolAddress",
      ].flatMap((key) => {
        const compacted = compactObject(history[key], 2);
        return compacted === undefined ? [] : [[key, compacted]];
      })),
    } : {}),
  };
};

const SOURCE_ARTIFACT_FIELDS = [
  "kind", "provider", "title", "sourceUrl", "capturedAt", "contentHash", "sourceContentHash",
  "publishedAt", "excerpt", "match", "coverageState", "relationship", "subjectName", "subjectHandle",
  "projectName", "projectHandle", "projectDomain", "sourceClass", "investorEntityName",
  "investorEntityHandle", "investorEntityDomain", "attribution", "attributionSourceUrl",
  "attributionSourceContentHash", "attributionCapturedAt", "attributionSourceKind", "investorDomainSourceUrl",
  "investorDomainSourceContentHash", "investorDomainCapturedAt", "investorDomainSourceKind",
  "investorDomainProfileName", "investorDomainProfileWebsite", "fundName", "fundSizeUsd",
  "fundVehicle", "fundScaleMetric", "fundAmountQualifier", "fundScaleBasis", "fundScaleAsOf",
  "fundScaleTemporalState", "fundScaleSourceCount", "fundScaleClaimId",
] as const;

const compactSourceArtifact = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(SOURCE_ARTIFACT_FIELDS.flatMap((key) => {
    const compacted = compactObject(row[key], 1);
    return compacted === undefined ? [] : [[key, compacted]];
  }));
};

// Transitive counterparty verbs only: "Aave adopts Chainlink CCIP" names a
// relationship between two parties; "RugX goes live on Base" or "built on
// Solana" is self-referential platform usage and must never count as
// partnership evidence (deploy/launch phrasing already feeds the product
// axis via PROJECT_PRODUCT_PRESS). "expands/extends to|into|its|the" is
// excluded for the same reason: expansion INTO a chain is not a counterparty.
const MATERIAL_RELATIONSHIP_PRESS = /\b(?:partner(?:s|ed|ing|ship)?|integrat(?:e[ds]?|ion)|collaborat(?:e[ds]?|ion)|alliance|joint(?:ly)?|teams? up|backed by|invest(?:s|ed|ing|ment)|funding|launch(?:e[ds])?\s+(?:with|alongside)|adopt(?:s|ed|ion)?|taps|selects|(?:expand|extend)(?:s|ed|ing)?\s+(?!to\b|into\b|its\b|the\b)\S)\b/i;
const MULTI_PARTY_LAUNCH_PRESS = /^(?:[^,\n]{1,100},){2}[^,\n]{1,140}\blaunch(?:e[ds])?\b/i;
const MATERIAL_RELATIONSHIP_DENIAL = /\b(?:den(?:y|ies|ied)|rumou?r(?:ed|s)?|alleg(?:e[ds]?|ation)|reportedly|false|fake|no partnership|not (?:a |an )?(?:partner|investor|backer)|end(?:s|ed)? (?:its |the )?(?:partnership|integration|collaboration)|terminat(?:e[ds]?|ion))\b/i;
const PROJECT_PRODUCT_PRESS = /\b(?:product|protocol|platform|exchange|app(?:lication)?|mainnet|testnet|launch(?:e[ds])?|releas(?:e[ds])?|ship(?:s|ped)?|deploy(?:s|ed|ment)|upgrade|integration|developer|repository|open[ -]?source)\b/i;
const PROJECT_TRACTION_PRESS = /\b(?:active users?|daily users?|monthly users?|transactions?|trading volume|volume|fees?|revenue|tvl|total value locked|market share|adoption|usage|liquidity|deposits?|borrow(?:ing|ers?)?)\b/i;
const PROJECT_TRANSPARENCY_PRESS = /\b(?:governance|proposal|vote|audit|security review|security audit|treasury report|financial disclosure|disclosure|legal entity|terms of service|multisig|multi-sig|incident report)\b/i;
const isFreshPublishedArtifact = (artifact: Record<string, unknown>, maxAgeDays = 90): boolean => {
  const publishedAt = Date.parse(String(artifact.publishedAt ?? ""));
  const capturedAt = Date.parse(String(artifact.capturedAt ?? ""));
  if (!Number.isFinite(publishedAt) || !Number.isFinite(capturedAt)) return false;
  const ageMs = capturedAt - publishedAt;
  return ageMs >= -86_400_000 && ageMs <= maxAgeDays * 86_400_000;
};

const datedMetricTimestamps = (fact: Record<string, unknown>): number[] => {
  const sources = Array.isArray(fact.sources)
    ? fact.sources.filter((value): value is Record<string, unknown> =>
      !!value && typeof value === "object" && !Array.isArray(value))
    : [];
  const text = [
    String(fact.qualifier ?? ""),
    String(fact.value ?? ""),
    ...sources.map((source) => String(source.excerpt ?? "")),
  ].join(" ");
  const matches = [
    ...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g),
    ...text.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:\d{1,2},?\s+)?20\d{2}\b/gi),
  ];
  const quarters = [...text.matchAll(/\bQ([1-4])\s+(20\d{2})\b/gi)]
    .map((match) => {
      const quarter = Number(match[1]);
      const year = Number(match[2]);
      return Date.UTC(year, quarter * 3, 0);
    });
  return [
    ...matches
    .map((match) => Date.parse(match[0]))
    .filter((timestamp) => Number.isFinite(timestamp)),
    ...quarters.filter((timestamp) => Number.isFinite(timestamp)),
  ];
};

const hasFreshDatedMetric = (
  fact: Record<string, unknown>,
  referenceCapturedAt: number,
  maxAgeDays = 90,
): boolean => datedMetricTimestamps(fact).some((timestamp) => {
  const ageMs = referenceCapturedAt - timestamp;
  return ageMs >= -86_400_000 && ageMs <= maxAgeDays * 86_400_000;
});

const relationshipStoryKey = (artifact: Record<string, unknown>): string => {
  const headline = String(artifact.title ?? "")
    .split(/\s+[|]\s+|\s+-\s+(?=[^-]+$)/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return headline || String(artifact.contentHash ?? artifact.sourceUrl ?? "").toLowerCase();
};

const sourceArtifactPriority = (value: unknown): number => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 9;
  const row = value as Record<string, unknown>;
  if (row.kind === "fund_scale" && row.match === "fund_scale_confirmed") return 0;
  if (row.kind === "portfolio_relationship" && row.match === "relationship_confirmed") return 1;
  if (row.match === "risk_signal") return 2;
  if (row.kind === "fund_scale") return 3;
  if (row.kind === "portfolio_relationship") return 4;
  // Independently reported integrations and counterparties are the governing
  // evidence for project backing. Keep them ahead of generic press so adding
  // more news cannot evict the exact partnership record and reverse the score.
  if (
    row.kind === "press"
    && !MATERIAL_RELATIONSHIP_DENIAL.test(`${String(row.title ?? "")} ${String(row.excerpt ?? "")}`)
    && (
      MATERIAL_RELATIONSHIP_PRESS.test(`${String(row.title ?? "")} ${String(row.excerpt ?? "")}`)
      || MULTI_PARTY_LAUNCH_PRESS.test(String(row.title ?? ""))
    )
  ) return 5;
  if (row.kind === "legal_case" || row.kind === "sanctions_screen" || row.kind === "trust_graph") return 5;
  return 6;
};

const retainSourceArtifacts = (source: readonly unknown[], limit: number): unknown[] => source
  .map((value, index) => ({ value, index, priority: sourceArtifactPriority(value) }))
  .sort((left, right) => left.priority - right.priority || left.index - right.index)
  .slice(0, limit)
  .map(({ value }) => value);

export type ProjectScoreBand = ProjectStrengthBandRecord;

const PROJECT_EARLY_STAGE = /\b(?:alpha|beta|testnet|prototype|demo|pilot|coming soon|pre-?launch|waitlist)\b/i;
const PROJECT_MATURE_STAGE = /\b(?:live|mainnet|production|in production|operational|operating)\b/i;
const TOKEN_MARKET_ONLY_TRACTION = /\b(?:token|trading volume|volume|market cap|liquidity|price|fdv)\b/i;
const PROJECT_PROTOCOL_TRACTION = /\b(?:protocol|platform|exchange|aggregator|product|active users?|daily users?|monthly users?|transactions?|swaps?|orders?|fees?|revenue|tvl|total value locked|adoption|usage)\b/i;
const PROJECT_LEADER_TEAM_ROLE = /\b(?:co-?founder|founder|chief(?:\s+\w+){0,3}\s+officer|ceo|cto|cfo|coo|president|executive director|managing director|general manager|head of (?:engineering|product|operations|protocol|research))\b/i;
const PROJECT_PRODUCT_ACTIVITY = /\b(?:product|protocol|platform|exchange|app(?:lication)?|mainnet|testnet|launch(?:e[ds])?|releas(?:e[ds])?|ship(?:s|ped)?|deploy(?:s|ed|ment)|upgrade|integration|developer|repository|open[ -]?source)\b/i;

const trustedProjectProfileDaysSincePost = (profile: Record<string, unknown> | undefined): number | null => {
  if (
    !profile
    || profile.profile_collection_state !== "resolved"
    || profile.profile_provider !== "twitterapi"
    || typeof profile.profile_captured_at !== "string"
    || !Number.isFinite(Date.parse(profile.profile_captured_at))
    || typeof profile.days_since_post !== "number"
    || !Number.isFinite(profile.days_since_post)
    || profile.days_since_post < 0
  ) return null;
  return profile.days_since_post;
};

const projectBandRange = (weight: number, tier: ProjectStrengthTier): Pick<ProjectScoreBand, "minScore" | "maxScore"> => {
  if (tier === "none") return { minScore: 0, maxScore: 0 };
  if (tier === "assessed_null") return { minScore: 0, maxScore: Math.floor(weight * 0.39) };
  if (tier === "adverse") return { minScore: 0, maxScore: Math.floor(weight * 0.39) };
  if (tier === "emerging") return { minScore: Math.ceil(weight * 0.4), maxScore: Math.floor(weight * 0.69) };
  if (tier === "solid") return { minScore: Math.ceil(weight * 0.7), maxScore: Math.floor(weight * 0.84) };
  return { minScore: Math.ceil(weight * 0.85), maxScore: weight };
};

/** Derive axis-specific maturity bands from the exact frozen scoring packet. */
export function deriveProjectStrengthBands(
  evidenceJson: string,
  axisCatalog: readonly AnalystAxis[],
): Record<string, ProjectScoreBand> {
  const projectAxes = axisCatalog.filter(({ role }) => role === "PROJECT");
  if (projectAxes.length === 0) return {};
  let packet: Record<string, unknown>;
  try {
    const parsed = JSON.parse(evidenceJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    packet = parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object" && !Array.isArray(row)))
    : [];
  const artifactIds = (values: readonly Record<string, unknown>[]): string[] => [...new Set(values
    .map((row) => typeof row.artifactId === "string" ? row.artifactId : "")
    .filter(Boolean))];
  const basicFacts = records(packet.basicFacts);
  // Score FLOORS derive only from strict single-passage facts. A web-corroborated
  // recall fact (floorEligible === false) counts for coverage/readiness but is
  // excluded here, so multi-source corroboration can never mint a minimum score
  // (H2). `floorEligible !== false` keeps every strict fact (flag absent) flooring
  // exactly as before; every floor tier derives from verifiedFacts(), so this is
  // the single scoring gate that isolates recall facts from floors.
  const verifiedFacts = (...predicates: string[]): Record<string, unknown>[] => basicFacts.filter((fact) =>
    predicates.includes(String(fact.predicate ?? "").toLowerCase())
    && fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated")
    && fact.floorEligible !== false);
  const factText = (facts: readonly Record<string, unknown>[]): string => facts
    .map((fact) => `${String(fact.value ?? "")} ${String(fact.claim ?? "")}`)
    .join(" ");
  const team = records(packet.team).filter((member) =>
    member.artifact_verified === true && member.evidence_origin !== "model_lead");
  const leaders = team.filter((member) => PROJECT_LEADER_TEAM_ROLE.test(String(member.role ?? "")));
  const leaderNames = new Set(leaders.map((member) => String(member.name ?? "").trim().toLowerCase()).filter(Boolean));
  const profile = packet.profile && typeof packet.profile === "object" && !Array.isArray(packet.profile)
    ? packet.profile as Record<string, unknown>
    : undefined;
  const sourceArtifacts = records(packet.sourceArtifacts);
  const productPress = sourceArtifacts.filter((artifact) => {
    const text = `${String(artifact.title ?? "")} ${String(artifact.excerpt ?? "")}`;
    return artifact.kind === "press"
      && !MATERIAL_RELATIONSHIP_DENIAL.test(text)
      && PROJECT_PRODUCT_PRESS.test(text);
  });
  const freshProductPress = productPress.filter((artifact) => isFreshPublishedArtifact(artifact));
  const relationshipPress = sourceArtifacts.filter((artifact) => {
    const text = `${String(artifact.title ?? "")} ${String(artifact.excerpt ?? "")}`;
    return artifact.kind === "press"
      && !MATERIAL_RELATIONSHIP_DENIAL.test(text)
      && (MATERIAL_RELATIONSHIP_PRESS.test(text)
        || MULTI_PARTY_LAUNCH_PRESS.test(String(artifact.title ?? "")));
  });
  // Syndicated copies of one announcement are one relationship story, even
  // when aggregators expose them through different URLs.
  const distinctRelationshipKeys = new Set(relationshipPress.map(relationshipStoryKey).filter(Boolean));
  const recentActivity = records(packet.recentActivity);
  const productActivity = recentActivity.filter((row) =>
    PROJECT_PRODUCT_ACTIVITY.test(String(row.text ?? row.value ?? row.claim ?? row.title ?? "")));
  const token = packet.projectToken && typeof packet.projectToken === "object" && !Array.isArray(packet.projectToken)
    ? packet.projectToken as Record<string, unknown>
    : undefined;
  const verifiedToken = token?.verified === true
    && (token.verification === "official_x" || token.verification === "official_domain");
  const rank = typeof token?.rank === "number" ? token.rank : Number.POSITIVE_INFINITY;
  const marketCap = typeof token?.marketCapUsd === "number" ? token.marketCapUsd : 0;
  const volume = typeof token?.volume24hUsd === "number" ? token.volume24hUsd : 0;
  const liquidity = typeof token?.liquidityUsd === "number" ? token.liquidityUsd : 0;
  const moderateMarket = verifiedToken && (rank <= 500 || marketCap >= 10_000_000 || volume >= 250_000 || liquidity >= 1_000_000);
  const scaleSignals = [rank <= 200, marketCap >= 100_000_000, volume >= 5_000_000, liquidity >= 5_000_000]
    .filter(Boolean).length;
  const tokenProviders = Array.isArray(token?.providers)
    ? new Set(token.providers.filter((provider) => typeof provider === "string")).size
    : 0;
  const daysSincePost = trustedProjectProfileDaysSincePost(profile);
  const currentSocialActivity = daysSincePost !== null && daysSincePost < 21;
  const repositoryFacts = verifiedFacts("repository", "repositories");
  const leaderFacts = verifiedFacts("founder", "founders", "executive");
  const productFacts = verifiedFacts("product", "launched", "launch_date");
  const auditFacts = verifiedFacts("audit", "audits");
  // Audit CEILING signal (never a floor). The security-audit collector only ever
  // records selfAttested names that match its curated AUDITOR_REGISTRY (Trail of
  // Bits, ConsenSys, OpenZeppelin, CertiK, ...) found on the subject's OWN fetched
  // security page, so >=2 of them is "multiple reputable firms attest an
  // engagement" -- it cannot be spoofed with arbitrary text. Established protocols
  // (Uniswap) list several real auditors whose OWN sites the corroboration hop
  // often can't scrape, so auditFacts stays empty and P3/P6 wrongly cap at solid.
  // This lets the analyst REACH the exceptional ceiling on those axes; the
  // enforced FLOOR still requires a strictly corroborated auditFact (H2: soft
  // evidence never mints a minimum), and the fraud/rug hard caps are independent
  // of band tiers, so a scam that self-lists auditors still caps at 10.
  const securityAudits = packet.securityAudits && typeof packet.securityAudits === "object" && !Array.isArray(packet.securityAudits)
    ? packet.securityAudits as Record<string, unknown>
    : undefined;
  const selfAttestedAuditorCount = Array.isArray(securityAudits?.selfAttested)
    ? securityAudits.selfAttested.filter((name) => typeof name === "string" && name.trim()).length
    : 0;
  const auditExceptionalCeiling = auditFacts.length > 0 || selfAttestedAuditorCount >= 2;
  const governanceFacts = verifiedFacts("governance");
  const tokenDisclosureFacts = verifiedFacts("tokenomics", "vesting", "treasury");
  const legalFacts = verifiedFacts("legal_entity");
  const officialFacts = verifiedFacts("official_identity");
  const fundingFacts = verifiedFacts("funding");
  const investorFacts = verifiedFacts("investor");
  const partnershipFacts = verifiedFacts("partnership");
  const tractionFacts = verifiedFacts("traction");
  const protocolTractionFacts = tractionFacts.filter((fact) => {
    const text = factText([fact]);
    return PROJECT_PROTOCOL_TRACTION.test(text) || !TOKEN_MARKET_ONLY_TRACTION.test(text);
  });
  const referenceCapturedAt = Date.parse(String(profile?.profile_captured_at ?? token?.capturedAt ?? ""));
  const currentProtocolTractionFacts = Number.isFinite(referenceCapturedAt)
    ? protocolTractionFacts.filter((fact) => hasFreshDatedMetric(fact, referenceCapturedAt))
    : [];
  // Posting cadence is only one liveness signal. Recent dated product coverage
  // can establish current operation without X, while an undated historical
  // usage claim remains traction evidence and cannot manufacture liveness.
  const currentActivity = currentSocialActivity || freshProductPress.length > 0;
  const advisorTeam = team.filter((member) => {
    const role = String(member.role ?? "");
    return PROJECT_BACKING_TEAM_ROLE.test(role) && !PROJECT_NON_BACKING_TEAM_ROLE.test(role);
  });
  const productStageText = [
    factText(productFacts),
    ...productActivity.map((row) => String(row.text ?? row.value ?? "")),
    ...productPress.map((row) => `${String(row.title ?? "")} ${String(row.excerpt ?? "")}`),
  ].join(" ");
  const earlyStage = PROJECT_EARLY_STAGE.test(productStageText)
    && !PROJECT_MATURE_STAGE.test(productStageText);
  const catalog = extractScoringEvidenceCatalog(evidenceJson, axisCatalog);
  const severeUnrecoveredProtocolIncident = catalog.some((artifact) => {
    if (artifact.operation !== "findings:ProtocolSecurityIncident") return false;
    const text = `${artifact.title} ${artifact.excerpt ?? ""}`;
    const amount = text.match(/\$([\d.]+)\s*([BM])\b/i);
    if (!amount || !/\bdoes not record returned funds\b/i.test(text)) return false;
    const amountUsd = Number(amount[1]) * (amount[2].toUpperCase() === "B" ? 1_000_000_000 : 1_000_000);
    return Number.isFinite(amountUsd) && amountUsd >= 10_000_000;
  });
  const limitingByAxis = new Map(projectAxes.map(({ axis }) => [axis, catalog
    .filter((artifact) => isVerifiedCounterArtifact(artifact, axis))
    .map((artifact) => artifact.artifactId)]));
  // A completed deterministic assessment (an assessed-null checkOutcome) keeps
  // a zero-positive-evidence axis scoreable in the low band instead of
  // abstaining the whole subject: the assessment artifact itself anchors the
  // band. Only substituted when the axis would otherwise band "none" with no
  // verified limiting evidence (limiting evidence still converts to adverse).
  const assessmentArtifactFor = (axis: string, checkId: string) => catalog.find((artifact) =>
    artifact.operation === `checkOutcomes:${checkId}`
    && isSubstantiveArtifact(artifact)
    && artifact.eligibleAxes.includes(axis)) ?? null;
  const bands: Record<string, ProjectScoreBand> = {};
  const setBand = (
    axis: string,
    tier: ProjectStrengthTier,
    reasons: string[],
    anchors: string[],
    // Unverified evidence (press headlines that were never passage-verified)
    // may WIDEN the allowed range upward, but the enforced minimum must come
    // only from verified records: floorTier is the strongest tier the axis
    // reaches WITHOUT unverified sources. Omitted = the tier is fully verified.
    floorTier?: ProjectStrengthTier,
  ) => {
    const spec = projectAxes.find((candidate) => candidate.axis === axis);
    if (!spec) return;
    const limiting = limitingByAxis.get(axis) ?? [];
    const effectiveTier = tier === "none" && limiting.length > 0 ? "adverse" : tier;
    const range = projectBandRange(spec.weight, effectiveTier);
    const widenedByUnverified = floorTier !== undefined && floorTier !== effectiveTier && effectiveTier !== "adverse";
    // Persistence enforces the band contract strictly: at least one reason for
    // every non-none tier, no duplicates, items capped at 240 chars. A band
    // composition slip here must degrade to a generic reason, never to a
    // rejected immutable save (the P4 investor-only path shipped empty once).
    const composedReasons = [...new Set([
      ...(effectiveTier !== tier ? ["verified score-limiting evidence"] : []),
      ...(widenedByUnverified ? ["unverified press widens the ceiling only, never the floor"] : []),
      ...reasons,
    ].map((reason) => reason.slice(0, 240)).filter(Boolean))].slice(0, 12);
    bands[axis] = {
      tier: effectiveTier,
      ...(widenedByUnverified
        ? { minScore: projectBandRange(spec.weight, floorTier).minScore, maxScore: range.maxScore, floorTier }
        : range),
      reasons: composedReasons.length || effectiveTier === "none"
        ? composedReasons
        : ["verified records reached this evidence tier"],
      anchorArtifactIds: [...new Set([...anchors, ...limiting])],
    };
  };

  const namedLeaderCount = Math.max(leaderNames.size, new Set(leaderFacts
    .map((fact) => String(fact.value ?? "").trim().toLowerCase())
    .filter(Boolean)).size);
  const p1Badges = [namedLeaderCount > 0, Boolean(profile?.website) || officialFacts.length > 0, legalFacts.length > 0 || namedLeaderCount >= 2];
  setBand("P1_team_and_identity", p1Badges.filter(Boolean).length >= 3 ? "exceptional" : p1Badges.filter(Boolean).length >= 2 ? "solid" : p1Badges.some(Boolean) ? "emerging" : "none", [
    ...(namedLeaderCount ? [`${namedLeaderCount} source-backed leader${namedLeaderCount === 1 ? "" : "s"}`] : []),
    ...((Boolean(profile?.website) || officialFacts.length) ? ["official identity linkage"] : []),
    ...((legalFacts.length || namedLeaderCount >= 2) ? ["operator corroboration"] : []),
  ], artifactIds([...leaders, ...leaderFacts, ...officialFacts, ...legalFacts, ...(profile ? [profile] : [])]));

  const p2Anchors = [...repositoryFacts, ...productFacts, ...auditFacts, ...productPress, ...productActivity];
  const productProof = productFacts.length > 0 || productPress.length > 0 || productActivity.length > 0;
  // Verified-only ladder (press excluded): the enforced score floor may only
  // come from records ARGUS actually verified, never from search headlines.
  const verifiedProductProof = productFacts.length > 0 || productActivity.length > 0;
  let p2FloorTier: ProjectStrengthTier = repositoryFacts.length || verifiedProductProof ? "emerging" : "none";
  if (!earlyStage && repositoryFacts.length > 0 && verifiedProductProof) p2FloorTier = "solid";
  if (!earlyStage && repositoryFacts.length > 0 && verifiedProductProof && auditFacts.length > 0) p2FloorTier = "exceptional";
  let p2Tier: ProjectStrengthTier = repositoryFacts.length || productProof ? "emerging" : "none";
  if (!earlyStage && repositoryFacts.length > 0 && productProof) p2Tier = "solid";
  if (!earlyStage && repositoryFacts.length > 0 && productProof && (auditFacts.length > 0 || productPress.length >= 2)) p2Tier = "exceptional";
  if (severeUnrecoveredProtocolIncident && (p2Tier === "solid" || p2Tier === "exceptional")) p2Tier = "emerging";
  if (severeUnrecoveredProtocolIncident && (p2FloorTier === "solid" || p2FloorTier === "exceptional")) p2FloorTier = "emerging";
  setBand("P2_product_substance", p2Tier, [
    ...(repositoryFacts.length ? ["verified public repository"] : []),
    ...(productProof ? ["source-backed product operation"] : []),
    ...(earlyStage ? ["explicit early-stage product marker"] : []),
    ...(severeUnrecoveredProtocolIncident ? ["material protocol security incident without a recorded full recovery caps product substance at emerging"] : []),
  ], artifactIds(p2Anchors), p2FloorTier);

  const tokenDisclosures = [...tokenDisclosureFacts];
  // A project with no canonical token record has no token conduct to measure,
  // and the preflight treats a "none" band as missing evidence for the WHOLE
  // axis set. Verified conduct disclosures therefore keep the axis scoreable
  // for tokenless brand and company subjects; market-tier strength still
  // requires the verified token, and a discovered token that failed official
  // verification still fails closed to "none".
  const tokenlessConductCategories = [governanceFacts.length > 0, tokenDisclosures.length > 0, auditFacts.length > 0]
    .filter(Boolean).length;
  // Ceiling uses the audit CEILING signal (reputable self-attestation counts);
  // floor uses the strict corroborated auditFact only, so a self-attested audit
  // widens the allowed range without minting an enforced minimum (H2).
  const p3CeilingTier: ProjectStrengthTier = verifiedToken
    ? (scaleSignals >= 2
      && tokenDisclosures.length > 0
      && auditExceptionalCeiling ? "exceptional"
      : moderateMarket ? "solid" : "emerging")
    : !token && tokenlessConductCategories > 0
      ? (tokenlessConductCategories >= 2 ? "solid" : "emerging")
      : "none";
  const p3FloorTier: ProjectStrengthTier = verifiedToken
    ? (scaleSignals >= 2
      && tokenDisclosures.length > 0
      && auditFacts.length > 0 ? "exceptional"
      : moderateMarket ? "solid" : "emerging")
    : !token && tokenlessConductCategories > 0
      ? (tokenlessConductCategories >= 2 ? "solid" : "emerging")
      : "none";
  const p3Assessment = p3CeilingTier === "none" && (limitingByAxis.get("P3_token_conduct") ?? []).length === 0
    ? assessmentArtifactFor("P3_token_conduct", "project-token-identity")
    : null;
  let p3FinalTier: ProjectStrengthTier = p3Assessment ? "assessed_null" : p3CeilingTier;
  let p3FinalFloorTier: ProjectStrengthTier = p3Assessment ? "assessed_null" : p3FloorTier;
  if (severeUnrecoveredProtocolIncident && (p3FinalTier === "solid" || p3FinalTier === "exceptional")) p3FinalTier = "emerging";
  if (severeUnrecoveredProtocolIncident && (p3FinalFloorTier === "solid" || p3FinalFloorTier === "exceptional")) p3FinalFloorTier = "emerging";
  setBand("P3_token_conduct", p3FinalTier, [
    ...(verifiedToken ? ["canonical token verified"] : []),
    ...(!token && p3FinalTier !== "none" && !p3Assessment ? ["no canonical token; conduct scored from verified disclosures"] : []),
    ...(p3Assessment ? ["completed token-identity assessment bound no canonical token"] : []),
    ...(moderateMarket ? ["measured market activity"] : []),
    ...(governanceFacts.length ? ["verified token governance"] : []),
    ...(tokenDisclosures.length ? ["verified token economic disclosure"] : []),
    ...(auditFacts.length
      ? ["verified security review"]
      : selfAttestedAuditorCount >= 2 ? [`${selfAttestedAuditorCount} reputable auditors attested on the official security page`] : []),
    ...(severeUnrecoveredProtocolIncident ? ["material protocol security incident without a recorded full recovery caps token and control evidence at emerging"] : []),
  ], [
    ...artifactIds([...(token ? [token] : []), ...governanceFacts, ...tokenDisclosures, ...auditFacts]),
    ...(p3Assessment ? [p3Assessment.artifactId] : []),
  ], p3FinalFloorTier);

  const disclosedTreasury = fundingFacts.some((fact) => /\b(?:disclosed treasury|treasury-funded)\b/i.test(factText([fact])));
  // Verified-only ladder (press excluded) for the enforced floor: headlines can
  // suggest a partnership story to the analyst but cannot force a minimum score.
  let p4FloorTier: ProjectStrengthTier = fundingFacts.length || investorFacts.length || partnershipFacts.length || advisorTeam.length ? "emerging" : "none";
  if (investorFacts.length > 0 || partnershipFacts.length > 0 || advisorTeam.length >= 2 || disclosedTreasury) p4FloorTier = "solid";
  let p4Tier: ProjectStrengthTier = fundingFacts.length || investorFacts.length || partnershipFacts.length || advisorTeam.length || relationshipPress.length ? "emerging" : "none";
  if (relationshipPress.length > 0 || investorFacts.length > 0 || partnershipFacts.length > 0 || advisorTeam.length >= 2 || disclosedTreasury) p4Tier = "solid";
  if (distinctRelationshipKeys.size >= 2) p4Tier = "exceptional";
  const p4Assessment = p4Tier === "none" && (limitingByAxis.get("P4_backing_and_partners") ?? []).length === 0
    ? assessmentArtifactFor("P4_backing_and_partners", "project-backing-partners")
    : null;
  const p4FinalTier: ProjectStrengthTier = p4Assessment ? "assessed_null" : p4Tier;
  setBand("P4_backing_and_partners", p4FinalTier, [
    ...(relationshipPress.length ? [`${distinctRelationshipKeys.size} material relationship source${distinctRelationshipKeys.size === 1 ? "" : "s"}`] : []),
    ...(fundingFacts.length ? ["source-backed financing state"] : []),
    ...(investorFacts.length ? [`${investorFacts.length} verified investor record${investorFacts.length === 1 ? "" : "s"}`] : []),
    ...(partnershipFacts.length ? [`${partnershipFacts.length} verified operating relationship${partnershipFacts.length === 1 ? "" : "s"}`] : []),
    ...(advisorTeam.length ? [`${advisorTeam.length} named advisor or backer record${advisorTeam.length === 1 ? "" : "s"}`] : []),
    ...(p4Assessment ? ["completed backing assessment found no verified backer or partner"] : []),
  ], [
    ...artifactIds([...relationshipPress, ...fundingFacts, ...investorFacts, ...partnershipFacts, ...advisorTeam]),
    ...(p4Assessment ? [p4Assessment.artifactId] : []),
    // An assessed-null band is a plain band, never a press-widened one.
  ], p4Assessment ? undefined : p4FloorTier);

  // Fresh press can establish an upper-bound liveness hypothesis, but it is
  // still an unfetched headline. Compute the enforceable floor from verified
  // activity only so coverage cannot manufacture traction points.
  const verifiedCurrentActivity = currentSocialActivity;
  let p5FloorTier: ProjectStrengthTier = verifiedCurrentActivity || protocolTractionFacts.length > 0 || verifiedToken ? "emerging" : "none";
  if (verifiedCurrentActivity && (protocolTractionFacts.length > 0 || moderateMarket)) p5FloorTier = "solid";
  if (verifiedCurrentActivity && currentProtocolTractionFacts.length > 0 && scaleSignals >= 2 && tokenProviders >= 2) p5FloorTier = "exceptional";
  let p5Tier: ProjectStrengthTier = currentActivity || protocolTractionFacts.length > 0 || verifiedToken ? "emerging" : "none";
  if (currentActivity && (protocolTractionFacts.length > 0 || moderateMarket)) p5Tier = "solid";
  if (currentActivity && currentProtocolTractionFacts.length > 0 && scaleSignals >= 2 && tokenProviders >= 2) p5Tier = "exceptional";
  // Multi-year third-party TVL history at billion-dollar scale is a traction
  // signal a fresh deployment cannot fabricate. "History since" bounds rather
  // than proves age (the series can be backfilled at listing time), so it
  // lifts traction only alongside verified current activity and $1B+ scale,
  // and it is applied BEFORE the drawdown demotion so a severe verified
  // drawdown still caps it.
  const tvlLongevity = protocolTractionFacts.some((fact) => {
    const text = factText([fact]);
    const sinceYear = text.match(/TVL history since (\d{4})/)?.[1];
    if (!sinceYear) return false;
    const scaleMatch = text.match(/\$(\d+(?:\.\d+)?)B[^.]*total value locked/i);
    return Number(sinceYear) <= new Date().getFullYear() - 3
      && scaleMatch !== null && Number(scaleMatch[1]) >= 1;
  });
  if (tvlLongevity && currentActivity && p5Tier === "solid") p5Tier = "exceptional";
  if (tvlLongevity && verifiedCurrentActivity && p5FloorTier === "solid") p5FloorTier = "exceptional";
  const severeProjectTokenDrawdown = catalog.some((artifact) =>
    artifact.operation === "findings:ProjectTokenDrawdown"
    && artifact.counterEligibleAxes?.includes("P5_traction_and_liveness"));
  if (severeProjectTokenDrawdown && p5Tier === "exceptional") p5Tier = "solid";
  if (severeProjectTokenDrawdown && p5FloorTier === "exceptional") p5FloorTier = "solid";
  setBand("P5_traction_and_liveness", p5Tier, [
    ...(currentActivity ? ["current operating activity"] : []),
    ...(protocolTractionFacts.length ? ["verified protocol usage metric"] : []),
    ...(currentProtocolTractionFacts.length ? ["dated current protocol metric"] : []),
    ...(tvlLongevity ? ["multi-year billion-scale TVL history"] : []),
    ...(moderateMarket ? ["measured token-market corroboration"] : []),
    ...(severeProjectTokenDrawdown ? ["severe canonical-token drawdown caps exceptional traction"] : []),
  ], artifactIds([
    ...(currentSocialActivity && daysSincePost !== null && profile ? [profile] : []),
    ...freshProductPress,
    ...protocolTractionFacts,
    ...(token ? [token] : []),
  ]), p5FloorTier);

  const disclosureBase = [...legalFacts, ...officialFacts, ...repositoryFacts];
  // Floor: strict corroborated auditFact. Ceiling: reputable multi-firm
  // self-attestation also unlocks the exceptional ceiling (H2-safe: floor never
  // rises on soft evidence).
  let p6FloorTier: ProjectStrengthTier = disclosureBase.length || governanceFacts.length || auditFacts.length ? "emerging" : "none";
  if (
    ((governanceFacts.length > 0 || auditFacts.length > 0) && disclosureBase.length > 0)
    || (legalFacts.length > 0 && officialFacts.length > 0 && repositoryFacts.length > 0)
  ) p6FloorTier = "solid";
  if (governanceFacts.length && auditFacts.length && (legalFacts.length || repositoryFacts.length)) p6FloorTier = "exceptional";
  let p6Tier: ProjectStrengthTier = disclosureBase.length || governanceFacts.length || auditExceptionalCeiling ? "emerging" : "none";
  if (
    ((governanceFacts.length > 0 || auditExceptionalCeiling) && disclosureBase.length > 0)
    || (legalFacts.length > 0 && officialFacts.length > 0 && repositoryFacts.length > 0)
  ) p6Tier = "solid";
  if (governanceFacts.length && auditExceptionalCeiling && (legalFacts.length || repositoryFacts.length)) p6Tier = "exceptional";
  setBand("P6_transparency_integrity", p6Tier, [
    ...(legalFacts.length ? ["verified legal operator"] : []),
    ...(repositoryFacts.length ? ["public repository disclosure"] : []),
    ...(governanceFacts.length ? ["verified governance disclosure"] : []),
    ...(auditFacts.length
      ? ["verified audit disclosure"]
      : selfAttestedAuditorCount >= 2 ? [`${selfAttestedAuditorCount} reputable auditors named on the official security page`] : []),
  ], artifactIds([...disclosureBase, ...governanceFacts, ...auditFacts]), p6FloorTier);
  return bands;
}

export function projectScoreFloorsForPacket(
  evidenceJson: string,
  axisCatalog: readonly AnalystAxis[],
): Record<string, number> {
  return Object.fromEntries(Object.entries(deriveProjectStrengthBands(evidenceJson, axisCatalog))
    .map(([axis, band]) => [axis, band.minScore]));
}

const compactProfileAuthenticity = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  // imageData is intentionally excluded. The immutable report retains the
  // exact inspected bytes for replay, while Claude receives only the bounded
  // classification metadata and byte hash.
  return {
    provider: clip(row.provider, 80),
    capturedAt: clip(row.capturedAt, 40),
    imageUrl: clip(row.imageUrl, 420),
    imageContentHash: clip(row.imageContentHash, 64),
    mediaType: clip(row.mediaType, 40),
    classification: clip(row.classification, 80),
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : undefined,
    isRealPerson: typeof row.isRealPerson === "boolean" ? row.isRealPerson : undefined,
    flag: typeof row.flag === "boolean" ? row.flag : undefined,
    tells: Array.isArray(row.tells) ? row.tells.slice(0, 8).map((tell) => clip(tell, 180)).filter(Boolean) : [],
    note: clip(row.note, 420),
  };
};

const compactTrustGraphPredicate = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const edgeTypes = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.slice(0, 12).map((item) => clip(item, 80)).filter(Boolean)
    : [];
  return {
    tie_key: clip(row.tie_key, 240),
    tie_type: clip(row.tie_type, 80),
    tie_strength: clip(row.tie_strength, 20),
    subject_edge_types: edgeTypes(row.subject_edge_types),
    other_edge_types: edgeTypes(row.other_edge_types),
    other_report_version_id: clip(row.other_report_version_id, 64),
    other_attestation: clip(row.other_attestation, 40),
    other_completeness: clip(row.other_completeness, 20),
    other_verdict: clip(row.other_verdict, 40),
  };
};

const compactFindingScope = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return {
    scope: clip(row.scope, 32),
    target_entity_key: clip(row.target_entity_key, 180),
    target_entity_type: clip(row.target_entity_type, 32),
    relationship_to_subject: clip(row.relationship_to_subject, 32),
    relationship_label: clip(row.relationship_label, 180),
  };
};

const compactTrustGraphScreen = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const connections = Array.isArray(row.connections) ? row.connections.slice(0, 8).map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
    const connection = candidate as Record<string, unknown>;
    const ties = Array.isArray(connection.ties) ? connection.ties.slice(0, 4).map((candidateTie) => {
      if (!candidateTie || typeof candidateTie !== "object" || Array.isArray(candidateTie)) return undefined;
      const tie = candidateTie as Record<string, unknown>;
      const edges = (candidateEdges: unknown) => Array.isArray(candidateEdges)
        ? candidateEdges.slice(0, 8).map((item) => clip(item, 60)).filter(Boolean)
        : [];
      return {
        key: clip(tie.key, 180),
        label: clip(tie.label, 180),
        type: clip(tie.type, 80),
        strength: clip(tie.strength, 20),
        subjectEdgeTypes: edges(tie.subjectEdgeTypes),
        otherEdgeTypes: edges(tie.otherEdgeTypes),
      };
    }).filter(Boolean) : [];
    return {
      other: clip(connection.other, 180),
      otherReportVersionId: clip(connection.otherReportVersionId, 64),
      otherAttestation: clip(connection.otherAttestation, 40),
      otherCompleteness: clip(connection.otherCompleteness, 20),
      otherVerdict: clip(connection.otherVerdict, 40),
      qualified: typeof connection.qualified === "boolean" ? connection.qualified : undefined,
      direct: typeof connection.direct === "boolean" ? connection.direct : undefined,
      ties,
    };
  }).filter(Boolean) : [];
  return {
    provider: clip(row.provider, 80),
    capturedAt: clip(row.capturedAt, 40),
    status: clip(row.status, 20),
    contributionCount: typeof row.contributionCount === "number" && Number.isFinite(row.contributionCount) ? row.contributionCount : undefined,
    qualifiedContributionCount: typeof row.qualifiedContributionCount === "number" && Number.isFinite(row.qualifiedContributionCount) ? row.qualifiedContributionCount : undefined,
    sourceContentHash: clip(row.sourceContentHash, 64),
    severity: clip(row.severity, 20),
    line: clip(row.line, 500),
    connections,
  };
};

const compactFinding = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  return {
    finding_type: clip(f.finding_type, 80),
    claim: clip(f.claim, 420),
    source_url: clip(f.source_url, 420),
    source_date: clip(f.source_date, 40),
    source_author: clip(f.source_author, 100),
    verification_status: clip(f.verification_status, 32),
    independent_source_count: typeof f.independent_source_count === "number" && Number.isFinite(f.independent_source_count)
      ? f.independent_source_count : undefined,
    polarity: typeof f.polarity === "number" && Number.isFinite(f.polarity) ? f.polarity : undefined,
    evidence_origin: clip(f.evidence_origin, 32),
    artifact_verified: typeof f.artifact_verified === "boolean" ? f.artifact_verified : undefined,
    content_hash: clip(f.content_hash, 64),
    trust_graph: compactTrustGraphPredicate(f.trust_graph),
    finding_scope: compactFindingScope(f.finding_scope),
  };
};

// Scoring eligibility is deliberately methodology-owned rather than inferred
// by the model. Sections may support only the axes listed here; the validator
// rejects a citation to a real artifact when that artifact is ineligible for
// the particular axis being scored.
const SECTION_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  profile: [
    "F1_identity_verifiability", "F5_reputation_integrity",
    "P1_team_and_identity",
    "K1_identity_roster", "K3_disclosure_deletion",
    "I1_identity_legitimacy", "AG1_identity_legitimacy",
    "AD1_identity_verifiability", "ME1_identity", "ME2_role_authenticity", "ME3_conduct_reputation",
  ],
  // Visual profile-photo triage is a review lead, never identity proof and
  // therefore never eligible to move a score.
  profileAuthenticity: [],
  trustGraphScreen: [
    "F5_reputation_integrity", "F6_network_quality", "P1_team_and_identity", "P4_backing_and_partners", "P6_transparency_integrity",
    "K1_identity_roster", "K4_onchain_conduct", "K5_cabal_fud", "I1_identity_legitimacy", "I4_testimonial_corroboration", "I5_reputation_fud",
    "AG1_identity_legitimacy", "AG3_service_integrity", "AG4_reputation_fud", "AD1_identity_verifiability", "AD3_relationship_corroboration",
    "AD4_advisory_conduct", "AD5_reputation_fud", "ME1_identity", "ME3_conduct_reputation",
  ],
  projectToken: [
    "P3_token_conduct", "P5_traction_and_liveness",
  ],
  // Findings are routed by exact finding_type below. A section-wide allowlist
  // made unrelated facts (for example, token collapse) eligible for identity.
  findings: [],
  ventures: [
    "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality",
    "P2_product_substance", "P4_backing_and_partners", "P5_traction_and_liveness",
    "AG2_client_outcomes", "AD2_advised_outcomes",
  ],
  testimonials: ["F3_repeat_backing", "F6_network_quality", "P4_backing_and_partners", "I4_testimonial_corroboration", "AD3_relationship_corroboration"],
  advised: ["F2_track_record", "F5_reputation_integrity", "AD2_advised_outcomes", "AD3_relationship_corroboration", "AD4_advisory_conduct", "AD5_reputation_fud"],
  promotions: ["F5_reputation_integrity", "P3_token_conduct", "P6_transparency_integrity", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "K5_cabal_fud", "AG3_service_integrity", "AD4_advisory_conduct"],
  wallets: ["F5_reputation_integrity", "P3_token_conduct", "P6_transparency_integrity", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "AD4_advisory_conduct"],
  team: [
    "F1_identity_verifiability", "F2_track_record", "F4_build_substance", "F6_network_quality",
    "P1_team_and_identity", "P2_product_substance", "P4_backing_and_partners", "I1_identity_legitimacy",
    "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity", "ME2_role_authenticity",
  ],
  notableFollowers: ["F6_network_quality", "P5_traction_and_liveness", "K5_cabal_fud", "I4_testimonial_corroboration", "I5_reputation_fud", "AG4_reputation_fud", "AD3_relationship_corroboration", "AD5_reputation_fud", "ME2_role_authenticity", "ME3_conduct_reputation"],
  recentActivity: [
    "F4_build_substance", "F5_reputation_integrity", "P2_product_substance", "P3_token_conduct", "P5_traction_and_liveness", "P6_transparency_integrity",
    "K2_call_performance", "K3_disclosure_deletion", "K5_cabal_fud", "I4_testimonial_corroboration", "I5_reputation_fud",
    "AG2_client_outcomes", "AG3_service_integrity", "AG4_reputation_fud", "AD2_advised_outcomes", "AD3_relationship_corroboration", "AD4_advisory_conduct", "AD5_reputation_fud",
    "ME2_role_authenticity", "ME3_conduct_reputation",
  ],
  // Source artifacts are routed by kind/provider below. An unknown artifact is
  // intentionally ineligible; a gap is safer than a citation with no semantic
  // relationship to the axis.
  sourceArtifacts: [],
  clientEngagements: ["F5_reputation_integrity", "AG2_client_outcomes", "AG3_service_integrity", "AG4_reputation_fud"],
  associates: ["F6_network_quality", "P4_backing_and_partners", "K5_cabal_fud", "I5_reputation_fud", "AG4_reputation_fud", "AD5_reputation_fud", "ME3_conduct_reputation"],
  ventureTeams: ["F1_identity_verifiability", "F2_track_record", "F4_build_substance", "F6_network_quality", "P1_team_and_identity", "P2_product_substance", "P4_backing_and_partners", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability"],
};

const REPUTATION_FINDING_AXES = [
  "F5_reputation_integrity", "P6_transparency_integrity", "K5_cabal_fud",
  "I5_reputation_fud", "AG4_reputation_fud", "AD5_reputation_fud", "ME3_conduct_reputation",
] as const;

/** Methodology-owned semantic routing for direct-subject finding artifacts. */
const FINDING_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  CommunityFUD: REPUTATION_FINDING_AXES,
  // Exact-name screens are triage leads, not proof that the result belongs to
  // the audited subject. Keep them in the investigator packet but outside the
  // frozen scorer packet until a direct-subject event is independently proven.
  LegalCaseNameLead: [],
  SanctionsNameLead: [],
  // A failed official product surface is one product-substance finding. Do not
  // triple-charge the same fetch against liveness and transparency as well.
  SiteNotLive: ["F4_build_substance", "P2_product_substance"],
  TokenCollapse: ["F5_reputation_integrity", "P3_token_conduct", "K2_call_performance", "K4_onchain_conduct"],
  // Price performance limits traction/liveness, not token conduct. Keep this
  // distinct from a promoted-token collapse so the report never implies that
  // market drawdown by itself proves misconduct.
  ProjectTokenDrawdown: ["P5_traction_and_liveness"],
  // Being exploited is evidence of a security/control failure, not proof that
  // the project committed fraud. Keep it off reputation and hard-cap axes.
  ProtocolSecurityIncident: ["P2_product_substance", "P3_token_conduct"],
  OfficialXAccountSuspended: ["P5_traction_and_liveness", "P6_transparency_integrity"],
  CadenceDecay: ["F4_build_substance", "P5_traction_and_liveness", "ME3_conduct_reputation"],
  TrustGraphConnection: SECTION_AXIS_ELIGIBILITY.trustGraphScreen,
  AdvisoryRug: ["F5_reputation_integrity", "AD2_advised_outcomes", "AD4_advisory_conduct", "AD5_reputation_fud"],
  DeceptionFinding: [
    "F5_reputation_integrity", "P6_transparency_integrity", "K3_disclosure_deletion", "K5_cabal_fud",
    "I4_testimonial_corroboration", "I5_reputation_fud", "AG3_service_integrity", "AG4_reputation_fud",
    "AD3_relationship_corroboration", "AD4_advisory_conduct", "AD5_reputation_fud", "ME3_conduct_reputation",
  ],
  Exit: ["F2_track_record", "F3_repeat_backing", "F4_build_substance", "I2_portfolio_quality"],
  IPO: ["F2_track_record", "F3_repeat_backing", "F4_build_substance", "I2_portfolio_quality"],
  MeridianExit: ["F2_track_record", "F3_repeat_backing", "F4_build_substance", "I2_portfolio_quality"],
  InvestigatorCallout: [
    ...REPUTATION_FINDING_AXES,
    "K3_disclosure_deletion", "K4_onchain_conduct", "AG3_service_integrity", "AD4_advisory_conduct",
  ],
};

const INVESTIGATOR_TOKEN_CONDUCT = /\b(?:token|vesting|treasury|unlock|supply|liquidity|wash trad(?:e|ing)|market manipulation|on-?chain|wallet|dump(?:ed|ing)?|insider sell(?:ing)?|mint)\b/i;

const CHECK_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  "identity-resolution": ["F1_identity_verifiability", "P1_team_and_identity", "K1_identity_roster", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "profile-photo-authenticity": [],
  "code-footprint-github": ["F4_build_substance", "P2_product_substance", "P5_traction_and_liveness", "ME2_role_authenticity"],
  "identity-continuity": ["F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "K1_identity_roster", "K3_disclosure_deletion", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "affiliations-associates": ["F6_network_quality", "P4_backing_and_partners", "K5_cabal_fud", "I4_testimonial_corroboration", "AD3_relationship_corroboration", "ME2_role_authenticity"],
  "promoted-token-performance": ["P3_token_conduct", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "K5_cabal_fud"],
  "project-token-identity": ["P3_token_conduct"],
  "project-product-substance": ["P2_product_substance", "P5_traction_and_liveness"],
  "project-team-identity": ["P1_team_and_identity"],
  "project-backing-partners": ["P4_backing_and_partners"],
  "project-traction-liveness": ["P5_traction_and_liveness"],
  "project-transparency": ["P3_token_conduct", "P6_transparency_integrity"],
  "founder-identity-authority": ["F1_identity_verifiability"],
  "founder-company-relationships": ["F2_track_record", "F6_network_quality"],
  "founder-track-record": ["F2_track_record", "F4_build_substance"],
  "founder-control-conflicts": ["F5_reputation_integrity"],
  "founder-legal-regulatory": ["F5_reputation_integrity"],
  "founder-asset-distinction": ["F4_build_substance", "F5_reputation_integrity"],
  "founder-repeat-backing": ["F3_repeat_backing"],
  "vc-portfolio-track-record": ["I2_portfolio_quality"],
  "investor-fund-scale": ["I3_fund_scale_tier"],
  "news-press": ["F5_reputation_integrity", "P2_product_substance", "P5_traction_and_liveness", "I5_reputation_fud", "AG2_client_outcomes", "AG4_reputation_fud", "AD2_advised_outcomes", "AD5_reputation_fud", "ME3_conduct_reputation"],
  "us-legal-history": ["F5_reputation_integrity", "P6_transparency_integrity", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud", "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud", "ME3_conduct_reputation"],
  "ofac-sanctions-name": ["F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity", "K1_identity_roster", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud", "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud", "ME1_identity", "ME3_conduct_reputation"],
  "trust-graph-connections": SECTION_AXIS_ELIGIBILITY.trustGraphScreen,
};

const SOURCE_ARTIFACT_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  profile_photo: SECTION_AXIS_ELIGIBILITY.profileAuthenticity,
  trust_graph: SECTION_AXIS_ELIGIBILITY.trustGraphScreen,
  legal_case: [
    "F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity",
    "K1_identity_roster", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud",
    "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud",
    "ME1_identity", "ME3_conduct_reputation",
  ],
  sanctions_screen: [
    "F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity",
    "K1_identity_roster", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud",
    "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud",
    "ME1_identity", "ME3_conduct_reputation",
  ],
  portfolio_relationship: ["I2_portfolio_quality"],
  fund_scale: ["I3_fund_scale_tier"],
  press: [
    "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality",
    "P2_product_substance", "P4_backing_and_partners", "P5_traction_and_liveness", "P6_transparency_integrity",
    "K5_cabal_fud", "I5_reputation_fud",
    "AG2_client_outcomes", "AG4_reputation_fud", "AD2_advised_outcomes", "AD5_reputation_fud", "ME3_conduct_reputation",
  ],
};

// Basic Facts are independently fetched, content-hashed facts. Discovery-only
// answers never reach this section. Keep predicate ownership role-aware so a
// person fact can support the corresponding person methodology without making
// that same predicate evidence for an unrelated project or fund axis.
const PROJECT_BASIC_FACT_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  official_identity: ["P1_team_and_identity", "P6_transparency_integrity"],
  founder: ["P1_team_and_identity"],
  founders: ["P1_team_and_identity"],
  executive: ["P1_team_and_identity"],
  team: ["P1_team_and_identity"],
  founded: ["P1_team_and_identity", "P2_product_substance"],
  launched: ["P2_product_substance", "P5_traction_and_liveness"],
  launch_date: ["P2_product_substance", "P5_traction_and_liveness"],
  product: ["P2_product_substance", "P5_traction_and_liveness"],
  official_token: ["P3_token_conduct"],
  token: ["P3_token_conduct"],
  network: ["P2_product_substance", "P3_token_conduct"],
  legal_entity: ["P1_team_and_identity", "P6_transparency_integrity"],
  funding: ["P4_backing_and_partners"],
  investor: ["P4_backing_and_partners"],
  partnership: ["P4_backing_and_partners"],
  governance: ["P3_token_conduct", "P6_transparency_integrity"],
  control: ["P3_token_conduct", "P6_transparency_integrity"],
  conflict_of_interest: ["P6_transparency_integrity"],
  tokenomics: ["P3_token_conduct", "P6_transparency_integrity"],
  vesting: ["P3_token_conduct", "P6_transparency_integrity"],
  treasury: ["P3_token_conduct", "P6_transparency_integrity"],
  audit: ["P2_product_substance", "P3_token_conduct", "P6_transparency_integrity"],
  audits: ["P2_product_substance", "P3_token_conduct", "P6_transparency_integrity"],
  repository: ["P2_product_substance", "P5_traction_and_liveness", "P6_transparency_integrity"],
  repositories: ["P2_product_substance", "P5_traction_and_liveness", "P6_transparency_integrity"],
  traction: ["P5_traction_and_liveness"],
  legal_regulatory_event: ["P6_transparency_integrity"],
  security_incident: ["P2_product_substance", "P3_token_conduct"],
};

const FOUNDER_BASIC_FACT_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  official_identity: ["F1_identity_verifiability"],
  current_role: ["F1_identity_verifiability"],
  executive: ["F1_identity_verifiability"],
  education: ["F1_identity_verifiability"],
  founder: ["F2_track_record"],
  founders: ["F2_track_record"],
  prior_role: ["F2_track_record"],
  founded: ["F2_track_record"],
  launched: ["F2_track_record", "F4_build_substance"],
  launch_date: ["F2_track_record", "F4_build_substance"],
  product: ["F2_track_record", "F4_build_substance"],
  exit: ["F2_track_record"],
  track_record: ["F2_track_record"],
  repository: ["F4_build_substance"],
  repositories: ["F4_build_substance"],
  audit: ["F4_build_substance"],
  audits: ["F4_build_substance"],
  traction: ["F2_track_record"],
  // One round or named backer is network evidence, not proof of repeat
  // backing. F3 remains reserved for deterministic multi-round/venture
  // aggregation elsewhere in the frozen evidence catalog.
  investor: ["F6_network_quality"],
  backer: ["F6_network_quality"],
  network: ["F6_network_quality"],
  governance: ["F5_reputation_integrity"],
  control: ["F5_reputation_integrity"],
  conflict_of_interest: ["F5_reputation_integrity"],
  legal_regulatory_event: ["F5_reputation_integrity"],
};

const INVESTOR_BASIC_FACT_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  official_identity: ["I1_identity_legitimacy"],
  current_role: ["I1_identity_legitimacy"],
  executive: ["I1_identity_legitimacy"],
  education: ["I1_identity_legitimacy"],
  legal_entity: ["I1_identity_legitimacy"],
  governance: ["I1_identity_legitimacy"],
  control: ["I1_identity_legitimacy"],
  prior_role: ["I2_portfolio_quality"],
  founder: ["I2_portfolio_quality"],
  founders: ["I2_portfolio_quality"],
  founded: ["I2_portfolio_quality"],
  product: ["I2_portfolio_quality"],
  exit: ["I2_portfolio_quality"],
  track_record: ["I2_portfolio_quality"],
  funding: ["I2_portfolio_quality"],
  investor: ["I2_portfolio_quality"],
  traction: ["I2_portfolio_quality"],
  conflict_of_interest: ["I5_reputation_fud"],
  legal_regulatory_event: ["I5_reputation_fud"],
};

const OTHER_ROLE_BASIC_FACT_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  legal_regulatory_event: [
    "K5_cabal_fud",
    "AG4_reputation_fud",
    "AD5_reputation_fud",
    "ME3_conduct_reputation",
  ],
};

const mergeAxisEligibility = (
  ...maps: readonly Record<string, readonly string[]>[]
): Record<string, readonly string[]> => {
  const merged: Record<string, string[]> = {};
  for (const map of maps) {
    for (const [predicate, axes] of Object.entries(map)) {
      merged[predicate] = [...new Set([...(merged[predicate] ?? []), ...axes])];
    }
  }
  return merged;
};

const BASIC_FACT_AXIS_ELIGIBILITY = mergeAxisEligibility(
  PROJECT_BASIC_FACT_AXIS_ELIGIBILITY,
  FOUNDER_BASIC_FACT_AXIS_ELIGIBILITY,
  INVESTOR_BASIC_FACT_AXIS_ELIGIBILITY,
  OTHER_ROLE_BASIC_FACT_AXIS_ELIGIBILITY,
);

const PROJECT_BACKING_TEAM_ROLE = /\b(?:advisor|adviser|backer|investor)\b/i;
const PROJECT_NON_BACKING_TEAM_ROLE = /\binvestor relations?\b/i;
const PROJECT_TOKEN_ACTIVITY = /\b(?:tokenomics|vesting|token unlock|unlock schedule|emission(?:s| schedule)?|token supply|circulating supply|total supply|max(?:imum)? supply|treasury|token burn|burn mechanism|liquidity|contract address|token contract|airdrop|staking)\b/i;
const PROJECT_TRANSPARENCY_ACTIVITY = /\b(?:governance|proposal|vote|treasury|audit|security audit|security review|vulnerability|incident|disclosure|transparency|multisig|multi-sig)\b/i;

// A requested axis must be owned by at least one deterministic routing rule.
// Synthesizing an unavailable gap for a misspelled or newly added-but-unwired
// methodology axis would misdiagnose a configuration error as missing evidence.
const SCORING_SUPPORTED_AXES = new Set<string>([
  ...Object.values(SECTION_AXIS_ELIGIBILITY).flat(),
  ...Object.values(FINDING_AXIS_ELIGIBILITY).flat(),
  ...Object.values(CHECK_AXIS_ELIGIBILITY).flat(),
  ...Object.values(SOURCE_ARTIFACT_AXIS_ELIGIBILITY).flat(),
  ...Object.values(BASIC_FACT_AXIS_ELIGIBILITY).flat(),
]);

const sourceArtifactKind = (value: Record<string, unknown>): string => {
  const kind = typeof value.kind === "string" ? value.kind : "";
  if (SOURCE_ARTIFACT_AXIS_ELIGIBILITY[kind]) return kind;
  const provider = typeof value.provider === "string" ? value.provider : "";
  if (provider === "claude-vision" || provider === "twitterapi") return "profile_photo";
  if (provider === "argus-graph") return "trust_graph";
  if (provider === "courtlistener") return "legal_case";
  if (provider === "opensanctions") return "sanctions_screen";
  if (provider === "google-news") return "press";
  return "";
};

const sourceArtifactEligibleAxes = (
  value: Record<string, unknown>,
  sourceArtifactPeers: readonly Record<string, unknown>[] = [],
  subjectHandle?: string,
  profile?: Record<string, unknown>,
): readonly string[] => {
  const kind = sourceArtifactKind(value);
  const match = recordText(value, ["match"], 40)?.toLowerCase();
  // A CourtListener caption or sanctions-name match remains investigator-facing
  // context only. Exact names do not establish identity, so these artifacts
  // cannot support or limit a score without a separately verified event.
  if (kind === "legal_case" && match === "candidate") return [];
  if (kind === "sanctions_screen" && (match === "candidate" || match === "exact_name")) return [];
  // A fetched page that mentions a relationship can remain visible as a
  // reported lead, but only a deterministic confirmation threshold may move
  // portfolio quality. This keeps the scoring boundary aligned with the UI
  // and prevents a single press report from becoming investment proof.
  if (kind === "portfolio_relationship" && value.match !== "relationship_confirmed") return [];
  if (kind === "fund_scale" && !isStrictFundScaleArtifact(value, sourceArtifactPeers, { subjectHandle, profile })) return [];
  const eligible = SOURCE_ARTIFACT_AXIS_ELIGIBILITY[kind] ?? [];
  if (kind === "press") {
    const relationshipText = `${String(value.title ?? "")} ${String(value.excerpt ?? "")}`;
    const speculativeOrDenied = MATERIAL_RELATIONSHIP_DENIAL.test(relationshipText);
    const affirmativeRelationship = !speculativeOrDenied
      && (MATERIAL_RELATIONSHIP_PRESS.test(relationshipText)
        || MULTI_PARTY_LAUNCH_PRESS.test(String(value.title ?? "")));
    return eligible.filter((axis) => {
      if (!axis.startsWith("P")) return true;
      if (speculativeOrDenied) return false;
      if (axis === "P2_product_substance") return PROJECT_PRODUCT_PRESS.test(relationshipText);
      if (axis === "P4_backing_and_partners") return affirmativeRelationship;
      if (axis === "P5_traction_and_liveness") {
        return PROJECT_TRACTION_PRESS.test(relationshipText)
          || (PROJECT_PRODUCT_PRESS.test(relationshipText) && isFreshPublishedArtifact(value));
      }
      if (axis === "P6_transparency_integrity") return PROJECT_TRANSPARENCY_PRESS.test(relationshipText);
      return false;
    });
  }
  return eligible;
};

const stableJson = (value: unknown): string => {
  const normalize = (candidate: unknown): unknown => {
    if (candidate == null || typeof candidate === "string" || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : null;
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (typeof candidate !== "object") return null;
    return Object.fromEntries(
      Object.keys(candidate as Record<string, unknown>)
        .sort()
        .filter((key) => (candidate as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, normalize((candidate as Record<string, unknown>)[key])]),
    );
  };
  return JSON.stringify(normalize(value));
};

const evidencePayload = (value: unknown): Record<string, unknown> => {
  const base: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : { value };
  delete base.artifactId;
  return base;
};

const eligibleAxesFor = (
  section: string,
  value: Record<string, unknown>,
  axisCatalog: AnalystAxis[],
  sourceArtifactPeers: readonly Record<string, unknown>[] = [],
  subjectHandle?: string,
  profile?: Record<string, unknown>,
): string[] => {
  const checkId = typeof value.checkId === "string" ? value.checkId : typeof value.check_id === "string" ? value.check_id : "";
  const findingType = typeof value.finding_type === "string" ? value.finding_type : "";
  const findingText = section === "findings"
    ? recordText(value, ["claim", "title", "excerpt", "detail"], 2_000) ?? ""
    : "";
  const checkStatus = section === "checkOutcomes"
    ? recordText(value, ["status"], 40)?.toLowerCase()
    : undefined;
  const candidateOnlyNameScreen = section === "checkOutcomes"
    && checkStatus === "finding"
    && (checkId === "us-legal-history" || checkId === "ofac-sanctions-name");
  const basicFactPredicate = section === "basicFacts"
    ? recordText(value, ["predicate"], 80)?.toLowerCase() ?? ""
    : "";
  const basicFactAxes = basicFactPredicate === "legal_regulatory_event"
    && value.attributionScope !== "direct_subject"
    ? []
    : BASIC_FACT_AXIS_ELIGIBILITY[basicFactPredicate] ?? [];
  const findingAxes = section === "findings"
    ? [
        ...(FINDING_AXIS_ELIGIBILITY[findingType] ?? []),
        ...(findingType === "InvestigatorCallout" && INVESTIGATOR_TOKEN_CONDUCT.test(findingText)
          ? ["P3_token_conduct"]
          : []),
      ]
    : [];
  const profileAxes = section === "profile" && value.profile_collection_state === "resolved"
    ? [
        ...SECTION_AXIS_ELIGIBILITY.profile,
        ...(trustedProjectProfileDaysSincePost(value) !== null
          ? ["P5_traction_and_liveness"]
          : []),
      ]
    : [];
  // What the founder actually built, at its observed scale. A verified venture
  // token is bound by the venture's own official X account or domain, so it
  // says "this person founded a network of this size" - track record and build
  // substance. It is deliberately NOT eligible for identity, reputation, or
  // repeat backing: market scale is not conduct evidence about the person.
  const ventureTokenAxes = section === "ventureToken"
    ? (value.verified === true
      && (value.verification === "official_x" || value.verification === "official_domain")
        ? ["F2_track_record", "F4_build_substance"]
        : [])
    : [];
  const projectTokenAxes = section === "projectToken"
    ? [
        "P3_token_conduct",
        ...([value.marketCapUsd, value.volume24hUsd, value.liquidityUsd].some((metric) =>
          typeof metric === "number" && Number.isFinite(metric) && metric > 0)
          ? ["P5_traction_and_liveness"]
          : []),
      ]
    : [];
  const teamAxes = section === "team"
    ? SECTION_AXIS_ELIGIBILITY.team.filter((axis) =>
        axis !== "P2_product_substance"
        && (axis !== "P4_backing_and_partners" || (
          PROJECT_BACKING_TEAM_ROLE.test(recordText(value, ["role"], 180) ?? "")
          && !PROJECT_NON_BACKING_TEAM_ROLE.test(recordText(value, ["role"], 180) ?? "")
        )))
    : [];
  const recentActivityText = section === "recentActivity"
    ? recordText(value, ["text", "value", "claim", "title"], 1_000) ?? ""
    : "";
  const recentActivityAxes = section === "recentActivity"
    ? SECTION_AXIS_ELIGIBILITY.recentActivity.filter((axis) =>
        (axis !== "P3_token_conduct" || PROJECT_TOKEN_ACTIVITY.test(recentActivityText))
        && (axis !== "P6_transparency_integrity" || PROJECT_TRANSPARENCY_ACTIVITY.test(recentActivityText)))
    : [];
  const eligible = section === "profile"
    ? profileAxes
    : section === "ventureToken"
      ? ventureTokenAxes
    : section === "projectToken"
      ? projectTokenAxes
    : section === "team"
      ? teamAxes
    : section === "recentActivity"
      ? recentActivityAxes
    : section === "findings"
      ? findingAxes
    : section === "checkOutcomes" && checkId
    ? candidateOnlyNameScreen ? [] : CHECK_AXIS_ELIGIBILITY[checkId] ?? []
    : section === "basicFacts"
      ? basicFactAxes
    : section === "sourceArtifacts"
      ? sourceArtifactEligibleAxes(value, sourceArtifactPeers, subjectHandle, profile)
      : SECTION_AXIS_ELIGIBILITY[section] ?? [];
  const allowed = new Set(eligible);
  return [...new Set(axisCatalog.filter((axis) => allowed.has(axis.axis)).map((axis) => axis.axis))];
};

const recordText = (record: Record<string, unknown>, keys: string[], max: number): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return clip(value.trim(), max);
  }
  return undefined;
};

const ARTIFACT_SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

const safeArtifactSourceUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) {
      return undefined;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (ARTIFACT_SENSITIVE_URL_PARAM.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const ARTIFACT_URL_FIELDS = new Set([
  "sourceUrl", "source_url", "evidence_url", "url", "linkedin", "link", "href",
  "citation", "link_evidence_url", "attributionSourceUrl", "investorDomainSourceUrl",
  "investorDomainProfileWebsite",
]);

const sanitizeArtifactUrls = (value: unknown, depth = 0): unknown => {
  if (value == null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeArtifactUrls(item, depth + 1));
  const sourceRecord = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(sourceRecord)) {
    if (ARTIFACT_URL_FIELDS.has(key) && typeof item === "string") {
      if (
        key === "attributionSourceUrl"
        || key === "investorDomainSourceUrl"
        || key === "investorDomainProfileWebsite"
        || (sourceRecord.kind === "fund_scale" && (key === "sourceUrl" || key === "source_url"))
      ) {
        try {
          if ([...new URL(item).searchParams.keys()].some((param) => ARTIFACT_SENSITIVE_URL_PARAM.test(param))) continue;
        } catch {
          continue;
        }
      }
      const safe = safeArtifactSourceUrl(item);
      if (safe) sanitized[key] = safe;
      continue;
    }
    sanitized[key] = sanitizeArtifactUrls(item, depth + 1);
  }
  return sanitized;
};

const verificationFor = (
  section: string,
  record: Record<string, unknown>,
  sourceArtifactPeers: readonly Record<string, unknown>[] = [],
  subjectHandle?: string,
  profile?: Record<string, unknown>,
): AxisEvidenceRecord["verification"] => {
  if (section === "axisGaps") return "unavailable";
  if (section === "checkOutcomes") {
    const status = recordText(record, ["status"], 40)?.toLowerCase();
    if (status === "confirmed" || status === "finding") return "verified";
    if (status === "checked-empty") return "checked_empty";
    if (status === "unavailable" || status === "unknown" || status === "stale" || status === "not-applicable") return "unavailable";
  }
  if (section === "findings") {
    const status = recordText(record, ["verification_status"], 40)?.toLowerCase();
    if (status === "verified" && record.artifact_verified === true) return "verified";
    if (status === "reported") return "reported";
  }
  if (section === "sourceArtifacts") {
    const match = recordText(record, ["match"], 40);
    const kind = recordText(record, ["kind"], 80);
    if (kind === "portfolio_relationship") {
      if (match === "relationship_confirmed") return "verified";
      if (match === "candidate") return "reported";
      return "unavailable";
    }
    if (kind === "fund_scale") {
      return isStrictFundScaleArtifact(record, sourceArtifactPeers, { subjectHandle, profile }) ? "verified" : "unavailable";
    }
    if (kind === "trust_graph") {
      if (record.coverageState === "unavailable" || match === "observed") return "unavailable";
      if (match === "screened_clear" || match === "no_match") return "checked_empty";
      const contentHash = recordText(record, ["contentHash"], 64);
      const sourceContentHash = recordText(record, ["sourceContentHash"], 64);
      if (match === "risk_signal" && /^[a-f0-9]{64}$/i.test(contentHash ?? "") && /^[a-f0-9]{64}$/i.test(sourceContentHash ?? "")) {
        return "verified";
      }
      return "unavailable";
    }
    if (match === "no_match" || match === "screened_clear") return "checked_empty";
    if (match === "candidate") return "reported";
  }
  if (section === "trustGraphScreen") {
    if (record.status === "incomplete") return "unavailable";
    const connections = Array.isArray(record.connections) ? record.connections : [];
    const qualifiedConnections = connections.filter((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      const connection = candidate as Record<string, unknown>;
      return connection.qualified === true && Array.isArray(connection.ties) && connection.ties.length > 0;
    });
    if (record.status === "clear" && qualifiedConnections.length === 0) return "checked_empty";
    if (qualifiedConnections.length > 0) return "verified";
    return "unavailable";
  }
  if (section === "projectToken" || section === "ventureToken") {
    return record.verified === true
      && (record.verification === "official_x" || record.verification === "official_domain")
      ? "verified"
      : "unavailable";
  }
  if (section === "basicFacts") {
    const status = recordText(record, ["status"], 40)?.toLowerCase();
    return record.artifact_verified === true && (status === "verified" || status === "corroborated")
      ? "verified"
      : status === "lead"
        ? "reported"
        : "unavailable";
  }
  return "observed";
};

const counterEligibleAxesFor = (
  section: string,
  record: Record<string, unknown>,
  verification: AxisEvidenceRecord["verification"],
  eligibleAxes: readonly string[],
): string[] => {
  if (verification !== "verified") return [];
  if (
    section === "findings"
    && typeof record.polarity === "number"
    && record.polarity < 0
  ) return [...eligibleAxes];
  if (
    section === "basicFacts"
    && recordText(record, ["predicate"], 80)?.toLowerCase() === "security_incident"
  ) return [...eligibleAxes];
  if (
    section === "sourceArtifacts"
    && record.match === "risk_signal"
  ) return [...eligibleAxes];
  if (
    section === "trustGraphScreen"
    && (record.severity === "caution" || record.severity === "avoid")
  ) return [...eligibleAxes];
  return [];
};

const DIRECT_SECTIONS = new Set(["profile", "profileAuthenticity", "projectToken", "findings", "wallets", "promotions", "recentActivity"]);

const providerFor = (section: string, payload: Record<string, unknown>): string => {
  if (section === "basicFacts" && Array.isArray(payload.sources)) {
    const source = payload.sources.find((value) => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown> | undefined;
    const sourceProvider = source ? recordText(source, ["provider"], 100) : undefined;
    if (sourceProvider) return sourceProvider;
  }
  const declared = recordText(payload, ["provider"], 100);
  if (declared) return declared;
  if (section === "profile") {
    const profileProvider = recordText(payload, ["profile_provider"], 100);
    if (profileProvider) return profileProvider;
  }
  if (section === "ventureToken") return "coingecko";
  if (section === "projectToken") {
    const observed = Array.isArray(payload.providers)
      ? payload.providers.filter((value): value is string =>
          value === "coingecko" || value === "dexscreener" || value === "geckoterminal")
      : [];
    return observed.length ? [...new Set(observed)].join("/") : "coingecko";
  }
  const attributed = recordText(payload, ["source_author", "source"], 100);
  if (attributed) return attributed;
  const sourceUrl = safeArtifactSourceUrl(
    recordText(payload, ["sourceUrl", "source_url", "evidence_url", "link_evidence_url", "url"], 420),
  );
  if (sourceUrl) {
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./i, "");
    } catch {
      // safeArtifactSourceUrl already parsed it; retain the honest fallback below.
    }
  }
  return section === "axisGaps" ? "argus" : "source-unspecified";
};

const makeAxisArtifact = (
  section: string,
  value: unknown,
  axisCatalog: AnalystAxis[],
  eligibleOverride?: string[],
  sourceArtifactPeers: readonly Record<string, unknown>[] = [],
  subjectHandle?: string,
  profile?: Record<string, unknown>,
): { decorated: Record<string, unknown>; catalog: AxisEvidenceRecord } => {
  const payload = sanitizeArtifactUrls(evidencePayload(value)) as Record<string, unknown>;
  const contentHash = createHash("sha256").update(stableJson({ section, payload })).digest("hex");
  const artifactId = `art_v1_${contentHash}`;
  const eligibleAxes = eligibleOverride ?? eligibleAxesFor(section, payload, axisCatalog, sourceArtifactPeers, subjectHandle, profile);
  const provider = providerFor(section, payload);
  const basicFactSource = section === "basicFacts" && Array.isArray(payload.sources)
    ? payload.sources.find((value) => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown> | undefined
    : undefined;
  const operationKey = section === "basicFacts"
    ? recordText(payload, ["predicate"], 100)
    : recordText(payload, ["checkId", "check_id", "finding_type", "kind", "type"], 100);
  const title = recordText(payload, ["title", "label", "claim", "name", "project_name", "handle", "axis", "value", "predicate"], 180)
    ?? `${section} evidence`;
  // A Basic Fact's value is the normalized answer, while its nested source
  // excerpt is the actual fetched proof. Prefer that proof in the frozen
  // catalog so the scorer and report citation retain the source's exact words.
  const excerpt = (basicFactSource ? recordText(basicFactSource, ["excerpt"], 320) : undefined)
    ?? recordText(payload, ["excerpt", "note", "rationale", "evidence", "bio", "detail", "text", "value"], 320);
  const sourceUrl = safeArtifactSourceUrl(
    recordText(payload, ["sourceUrl", "source_url", "evidence_url", "url", "linkedin"], 420),
  ) ?? safeArtifactSourceUrl(basicFactSource ? recordText(basicFactSource, ["url", "sourceUrl"], 420) : undefined);
  const capturedAt = recordText(payload, ["capturedAt", "captured_at", "profile_captured_at", "completedAt", "source_date"], 40)
    ?? (basicFactSource ? recordText(basicFactSource, ["capturedAt", "captured_at"], 40) : undefined);
  const verification = verificationFor(section, payload, sourceArtifactPeers, subjectHandle, profile);
  const counterEligibleAxes = counterEligibleAxesFor(section, payload, verification, eligibleAxes);
  return {
    decorated: { ...payload, artifactId },
    catalog: {
      artifactId,
      kind: "axis_evidence",
      provider,
      operation: section === "axisGaps" ? `coverage_gap:${eligibleAxes[0] ?? "unknown"}` : `${section}:${operationKey ?? "collect"}`,
      section,
      title,
      ...(excerpt ? { excerpt } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(capturedAt ? { capturedAt } : {}),
      contentHash,
      eligibleAxes,
      verification,
      ...(counterEligibleAxes.length
        ? { counterEligibleAxes }
        : {}),
      scope: DIRECT_SECTIONS.has(section) ? "direct_subject" : "subject_context",
    },
  };
};

const SCORING_SINGLE_SECTIONS = ["profile", "profileAuthenticity", "trustGraphScreen", "projectToken", "ventureToken"] as const;
const SCORING_ARRAY_SECTIONS = [
  "findings", "ventures", "testimonials", "advised", "promotions", "wallets", "team",
  "basicFacts",
  "notableFollowers", "recentActivity", "sourceArtifacts", "checkOutcomes",
  "clientEngagements", "associates", "ventureTeams",
] as const;

function renderScoringPacket(packet: Record<string, unknown>, axisCatalog: AnalystAxis[]): Record<string, unknown> {
  const rendered: Record<string, unknown> = { ...packet, schema_version: 5 };
  const packetProfile = packet.profile && typeof packet.profile === "object" && !Array.isArray(packet.profile)
    ? packet.profile as Record<string, unknown>
    : undefined;
  const subjectHandle = recordText(packetProfile ?? {}, ["handle"], 80);
  const packetCoverage = packet.coverage && typeof packet.coverage === "object" && !Array.isArray(packet.coverage)
    ? packet.coverage as Record<string, { available: number; included: number }>
    : {};
  const renderedCoverage = Object.fromEntries(
    Object.entries(packetCoverage).map(([section, value]) => [section, { ...value }]),
  );
  // Decision calls may cite only content-addressed artifacts. Raw collection
  // telemetry (including provider-run counts and omitted-row counts) stays in the
  // investigator packet and cannot influence scoring as uncitable context.
  delete rendered.coverage;
  delete rendered.providerRuns;
  const artifacts: AxisEvidenceRecord[] = [];
  for (const section of SCORING_SINGLE_SECTIONS) {
    if (packet[section] == null) continue;
    const artifact = makeAxisArtifact(section, packet[section], axisCatalog);
    if (artifact.catalog.eligibleAxes.length === 0) {
      delete rendered[section];
      continue;
    }
    rendered[section] = artifact.decorated;
    artifacts.push(artifact.catalog);
  }
  for (const section of SCORING_ARRAY_SECTIONS) {
    const values = Array.isArray(packet[section]) ? packet[section] as unknown[] : [];
    const sourceArtifactPeers = section === "sourceArtifacts"
      ? values.map((value) => sanitizeArtifactUrls(evidencePayload(value)))
        .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)))
      : [];
    const eligibleValues = values.flatMap((value) => {
      const artifact = makeAxisArtifact(section, value, axisCatalog, undefined, sourceArtifactPeers, subjectHandle, packetProfile);
      if (artifact.catalog.eligibleAxes.length === 0) return [];
      artifacts.push(artifact.catalog);
      return [artifact.decorated];
    });
    rendered[section] = eligibleValues;
    if (renderedCoverage[section]) renderedCoverage[section].included = eligibleValues.length;
  }

  const axisGaps = axisCatalog.flatMap((axis) => {
    // An existing unavailable check is already the explicit gap artifact for
    // that axis. Synthesize a new one only when no retained record is eligible.
    const hasEligibleEvidence = artifacts.some((artifact) => artifact.eligibleAxes.includes(axis.axis));
    if (hasEligibleEvidence) return [];
    const artifact = makeAxisArtifact("axisGaps", {
      axis: axis.axis,
      status: "unavailable",
      note: `No retained scoring artifact is eligible for ${axis.axis}.`,
    }, axisCatalog, [axis.axis]);
    artifacts.push(artifact.catalog);
    return [artifact.decorated];
  });
  rendered.axisGaps = axisGaps;
  rendered.evidenceCatalog = [...new Map(artifacts.map((artifact) => [artifact.artifactId, artifact])).values()];
  return rendered;
}

const isAxisEvidenceRecord = (value: unknown): value is AxisEvidenceRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<AxisEvidenceRecord>;
  return typeof row.artifactId === "string"
    && ARTIFACT_ID.test(row.artifactId)
    && row.kind === "axis_evidence"
    && typeof row.provider === "string" && !!row.provider
    && typeof row.operation === "string" && !!row.operation
    && typeof row.section === "string" && !!row.section
    && typeof row.title === "string" && !!row.title
    && (row.excerpt === undefined || typeof row.excerpt === "string")
    && (row.sourceUrl === undefined || typeof row.sourceUrl === "string")
    && (row.capturedAt === undefined || typeof row.capturedAt === "string")
    && typeof row.contentHash === "string"
    && row.contentHash === row.artifactId.slice("art_v1_".length)
    && Array.isArray(row.eligibleAxes)
    && row.eligibleAxes.length > 0
    && row.eligibleAxes.every((axis) => typeof axis === "string" && !!axis)
    && new Set(row.eligibleAxes).size === row.eligibleAxes.length
    && ["verified", "reported", "observed", "checked_empty", "unavailable"].includes(String(row.verification))
    && (row.counterEligibleAxes === undefined || (
      Array.isArray(row.counterEligibleAxes)
      && row.counterEligibleAxes.length > 0
      && row.counterEligibleAxes.every((axis) => typeof axis === "string" && row.eligibleAxes?.includes(axis))
      && new Set(row.counterEligibleAxes).size === row.counterEligibleAxes.length
    ))
    && (row.scope === "direct_subject" || row.scope === "subject_context");
};

/** Parse and integrity-check the concise catalog frozen into a scorer packet. */
export function extractScoringEvidenceCatalog(
  json: string,
  axisCatalog?: readonly AnalystAxis[],
): AxisEvidenceRecord[] {
  let packet: Record<string, unknown>;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    packet = value as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!Array.isArray(packet.evidenceCatalog) || !packet.evidenceCatalog.every(isAxisEvidenceRecord)) return [];
  if (axisCatalog && axisCatalog.length > 0 && packet.schema_version !== 5) return [];
  const catalog = packet.evidenceCatalog as AxisEvidenceRecord[];
  const byId = new Map(catalog.map((record) => [record.artifactId, record]));
  if (byId.size !== catalog.length) return [];
  const strictCatalog = packet.schema_version === 5;
  const requestedAxes = axisCatalog && axisCatalog.length > 0
    && new Set(axisCatalog.map(({ axis }) => axis)).size === axisCatalog.length
    ? [...axisCatalog]
    : undefined;

  const packetProfile = packet.profile && typeof packet.profile === "object" && !Array.isArray(packet.profile)
    ? evidencePayload(packet.profile)
    : undefined;
  const subjectHandle = recordText(packetProfile ?? {}, ["handle"], 80);
  const sourceArtifactPeers = Array.isArray(packet.sourceArtifacts)
    ? packet.sourceArtifacts
      .filter((value) => value && typeof value === "object" && !Array.isArray(value))
      .map((value) => sanitizeArtifactUrls(evidencePayload(value)))
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)))
    : [];

  const represented = new Set<string>();
  const inspect = (section: string, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const decorated = value as Record<string, unknown>;
    if (typeof decorated.artifactId !== "string") return;
    const artifactId = decorated.artifactId;
    const payload = evidencePayload(decorated);
    const contentHash = createHash("sha256").update(stableJson({ section, payload })).digest("hex");
    const catalogRecord = byId.get(artifactId);
    if (artifactId !== `art_v1_${contentHash}` || catalogRecord?.section !== section || catalogRecord.contentHash !== contentHash) return;
    const verification = verificationFor(section, payload, sourceArtifactPeers, subjectHandle, packetProfile);
    if (strictCatalog && catalogRecord.verification !== verification) return;
    const expectedEligibleAxes = requestedAxes
      ? section === "axisGaps"
        ? requestedAxes.some(({ axis }) => axis === payload.axis) && typeof payload.axis === "string"
          ? [payload.axis]
          : []
        : eligibleAxesFor(section, payload, [...requestedAxes], sourceArtifactPeers, subjectHandle, packetProfile)
      : catalogRecord.eligibleAxes;
    if (
      strictCatalog
      && requestedAxes
      && (
        expectedEligibleAxes.length !== catalogRecord.eligibleAxes.length
        || expectedEligibleAxes.some((axis, index) => axis !== catalogRecord.eligibleAxes[index])
      )
    ) return;
    const expectedCounterAxes = counterEligibleAxesFor(
      section,
      payload,
      verification,
      expectedEligibleAxes,
    );
    const actualCounterAxes = catalogRecord.counterEligibleAxes ?? [];
    if (
      (strictCatalog || catalogRecord.counterEligibleAxes !== undefined)
      && (
        expectedCounterAxes.length !== actualCounterAxes.length
        || expectedCounterAxes.some((axis, index) => axis !== actualCounterAxes[index])
      )
    ) {
      return;
    }
    represented.add(artifactId);
  };
  for (const section of SCORING_SINGLE_SECTIONS) inspect(section, packet[section]);
  for (const section of [...SCORING_ARRAY_SECTIONS, "axisGaps"] as const) {
    if (Array.isArray(packet[section])) (packet[section] as unknown[]).forEach((value) => inspect(section, value));
  }
  return represented.size === catalog.length
    ? catalog.map((record) => ({
      ...record,
      eligibleAxes: [...record.eligibleAxes],
      ...(record.counterEligibleAxes ? { counterEligibleAxes: [...record.counterEligibleAxes] } : {}),
    }))
    : [];
}

const pruneTrustGraphPacket = (packet: Record<string, unknown>): boolean => {
  const screen = packet.trustGraphScreen;
  if (!screen || typeof screen !== "object" || Array.isArray(screen)) return false;
  const graph = screen as Record<string, unknown>;
  const connections = Array.isArray(graph.connections) ? graph.connections as unknown[] : [];
  for (let index = connections.length - 1; index >= 0; index--) {
    const connection = connections[index];
    if (!connection || typeof connection !== "object" || Array.isArray(connection)) continue;
    const ties = (connection as Record<string, unknown>).ties;
    if (Array.isArray(ties) && ties.length > 1) {
      ties.pop();
      return true;
    }
  }
  if (connections.length > 1) {
    connections.pop();
    return true;
  }
  if (connections.length === 1) {
    connections.pop();
    return true;
  }
  delete packet.trustGraphScreen;
  return true;
};

/**
 * Serialize evidence without ever truncating JSON text. Each section is capped
 * structurally and the packet records coverage, with findings receiving first
 * priority. If the packet is still large, low-priority items are removed whole;
 * the returned string therefore always parses and never cuts a finding in half.
 */
function serializeAnalystEvidencePacket(
  input: Record<string, unknown>,
  options: AnalystEvidencePacketOptions,
): string {
  // A check outcome's position in the frozen checklist says nothing about how
  // much it informs a score. Truncating positionally lets a block of
  // not-applicable rows (14 of them on an investor subject) crowd out the sole
  // substantive assessment for an axis, which silently abstains that axis. Rank
  // by informativeness before the cap, then restore checklist order. Same
  // invariant retainSourceArtifacts already enforces for source artifacts.
  const checkOutcomeRank = (row: unknown): number => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return 2;
    const status = String((row as Record<string, unknown>).status ?? "").toLowerCase();
    if (status === "confirmed" || status === "finding") return 0;
    if (status === "checked-empty") return 1;
    if (status === "not-applicable") return 3;
    return 2;
  };
  const retainCheckOutcomes = (rows: readonly unknown[], limit: number): unknown[] => {
    if (rows.length <= limit) return [...rows];
    return rows
      .map((row, index) => ({ row, index, rank: checkOutcomeRank(row) }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .slice(0, limit)
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.row);
  };
  const sectionLimits: Record<string, number> = {
    ventures: 12,
    testimonials: 12,
    advised: 12,
    promotions: 16,
    wallets: 12,
    team: 16,
    basicFacts: 24,
    notableFollowers: 16,
    recentActivity: 12,
    sourceArtifacts: 24,
    checkOutcomes: 20,
    providerRuns: 24,
    clientEngagements: 16,
    associates: 16,
    ventureTeams: 12,
  };
  const findingsRaw = Array.isArray(input.findings) ? input.findings : [];
  const profile = input.profile && typeof input.profile === "object" && !Array.isArray(input.profile)
    ? input.profile as Record<string, unknown>
    : undefined;
  const normalizeEntityKey = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const handle = value.trim().replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "");
    return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? `@${handle.toLowerCase()}` : undefined;
  };
  const subjectEntityKey = normalizeEntityKey(profile?.handle);
  const isInvestigativeLead = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const scope = row.finding_scope && typeof row.finding_scope === "object" && !Array.isArray(row.finding_scope)
      ? row.finding_scope as Record<string, unknown>
      : undefined;
    if (row.evidence_origin === "model_lead" || row.artifact_verified === false) return true;
    if (!scope) return false; // backwards-compatible curated direct finding
    if (scope.scope !== "direct_subject" || scope.relationship_to_subject !== "self") return true;
    const targetEntityKey = normalizeEntityKey(scope.target_entity_key);
    return !!subjectEntityKey && targetEntityKey !== subjectEntityKey;
  };
  const hasTrustedFindingProvenance = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return (row.evidence_origin === "deterministic" || row.evidence_origin === "human_verified")
      && row.artifact_verified === true;
  };
  const findingPriority = (value: unknown): number => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 4;
    const row = value as Record<string, unknown>;
    if (row.finding_type === "TrustGraphConnection" && row.trust_graph) return 0;
    if (row.verification_status === "Verified" && row.artifact_verified === true) return 1;
    if (typeof row.polarity === "number" && row.polarity < 0) return 2;
    return 3;
  };
  const scoringFindingsRaw = findingsRaw.filter((value) =>
    !isInvestigativeLead(value)
    && (!options.axisCatalog || hasTrustedFindingProvenance(value)));
  const investigativeLeadsRaw = findingsRaw.filter(isInvestigativeLead);
  const findings = scoringFindingsRaw
    .map((value, index) => ({ value, index }))
    .sort((a, b) => findingPriority(a.value) - findingPriority(b.value) || a.index - b.index)
    .slice(0, 24)
    .map(({ value }) => compactFinding(value))
    .filter((f): f is Record<string, unknown> => !!f);
  const coverage: Record<string, { available: number; included: number }> = {
    findings: { available: scoringFindingsRaw.length, included: findings.length },
  };
  const packet: Record<string, unknown> = {
    schema_version: 3,
    coverage,
    finding_scope_policy: {
      findings: "Direct subject evidence eligible for scoring, subject to provenance and verification.",
    },
    profile: compactScoringProfile(input.profile),
    profileAuthenticity: compactProfileAuthenticity(input.profileAuthenticity),
    trustGraphScreen: compactTrustGraphScreen(input.trustGraphScreen),
    projectToken: input.projectToken && typeof input.projectToken === "object" && !Array.isArray(input.projectToken)
      ? compactProjectToken(input.projectToken)
      : undefined,
    // Findings stay ahead of descriptive context in the budget. This prevents a
    // long social corpus from hiding the material facts that govern a verdict.
    findings,
  };

  if (options.includeInvestigativeLeads) {
    const investigativeLeads = investigativeLeadsRaw
      .slice(0, 16)
      .map((value) => compactFinding(value))
      .filter((f): f is Record<string, unknown> => !!f);
    coverage.investigative_leads = {
      available: investigativeLeadsRaw.length,
      included: investigativeLeads.length,
    };
    (packet.finding_scope_policy as Record<string, unknown>).investigative_leads =
      "Discovery/context only. Never attribute these claims to the audited subject or use them to lower subject scores, set the headline, establish a cap, or claim decision readiness.";
    // The general analyst packet can retain leads for investigator-facing tasks.
    // Decision calls use buildScoringEvidencePacket, which omits them entirely.
    packet.investigative_leads = investigativeLeads;
  }

  for (const [section, limit] of Object.entries(sectionLimits)) {
    const rawSource = Array.isArray(input[section]) ? input[section] as unknown[] : [];
    if (options.axisCatalog && section === "providerRuns") {
      // Operational telemetry is useful for the investigator trace but is not
      // evidence about the subject. Remove it structurally from decision calls
      // so an uncitable provider state cannot influence a score.
      coverage.providerRuns = { available: rawSource.length, included: 0 };
      continue;
    }
    const source = options.includeInvestigativeLeads
      ? rawSource
      : rawSource.filter((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return true;
          const record = item as Record<string, unknown>;
          // The decision packet accepts provider-collected records and legacy
          // deterministic rows, never discovery-only/model-lead objects. This
          // closes the same attribution boundary for ventures, testimonials,
          // wallets, promotions, and advisory rows as for findings.
          return record.evidence_origin !== "model_lead" && record.artifact_verified !== false;
        });
    // Scoring packets first inspect the complete bounded collector output for
    // source artifacts, then reduce it with the same substantive-axis invariant
    // used by the 24k structural pruner. Applying the 24-row cap here would let
    // many high-priority I3 rows crowd out the sole I2 relationship before the
    // coverage baseline even exists.
    const selected = section === "sourceArtifacts"
      ? retainSourceArtifacts(source, options.axisCatalog ? source.length : limit)
      : section === "checkOutcomes"
        ? retainCheckOutcomes(source, limit)
        : source.slice(0, limit);
    const included = selected
      .map((item) => section === "sourceArtifacts" ? compactSourceArtifact(item) : compactObject(item))
      .filter((item) => item !== undefined);
    packet[section] = included;
    coverage[section] = { available: source.length, included: included.length };
  }

  const pruneOrder = [
    "recentActivity",
    "notableFollowers",
    ...(options.includeInvestigativeLeads ? ["investigative_leads"] : []),
    "wallets",
    "promotions",
    "advised",
    "testimonials",
    "ventures",
    "providerRuns",
    "associates",
    "clientEngagements",
    "ventureTeams",
    "checkOutcomes",
    "sourceArtifacts",
    "basicFacts",
    "team",
  ];
  const render = () => options.axisCatalog
    ? renderScoringPacket(packet, options.axisCatalog)
    : packet;
  const substantiveAxesIn = (rendered: Record<string, unknown>): Set<string> => {
    if (!Array.isArray(rendered.evidenceCatalog)) return new Set();
    return new Set((rendered.evidenceCatalog as unknown[]).flatMap((value) =>
      isAxisEvidenceRecord(value) && isSubstantiveArtifact(value)
        ? value.eligibleAxes
        : []));
  };
  // Capture the axes the unpruned packet can honestly support. Structural
  // budget reduction may remove redundant evidence, but it must never turn a
  // supported axis into a coverage-only gap merely because that evidence lived
  // in a lower-priority section (for example, the sole testimonial supporting
  // I4 in a large multi-role packet).
  const initialRenderedPacket = render();
  const requiredSubstantiveAxes = options.axisCatalog
    ? substantiveAxesIn(initialRenderedPacket)
    : new Set<string>();
  const requiredProjectBandRanges = options.axisCatalog
    ? Object.fromEntries(Object.entries(deriveProjectStrengthBands(
        JSON.stringify(initialRenderedPacket),
        options.axisCatalog,
      )).map(([axis, band]) => [axis, `${band.tier}:${band.minScore}-${band.maxScore}`]))
    : {};
  const preservesSubstantiveCoverage = (): boolean => {
    if (!options.axisCatalog || requiredSubstantiveAxes.size === 0) return true;
    const retained = substantiveAxesIn(render());
    return [...requiredSubstantiveAxes].every((axis) => retained.has(axis));
  };
  const preservesProjectBandRanges = (): boolean => {
    if (!options.axisCatalog || Object.keys(requiredProjectBandRanges).length === 0) return true;
    const retainedBands = deriveProjectStrengthBands(JSON.stringify(render()), options.axisCatalog);
    return Object.entries(requiredProjectBandRanges).every(([axis, required]) => {
      const band = retainedBands[axis];
      return band && `${band.tier}:${band.minScore}-${band.maxScore}` === required;
    });
  };
  const preservesDecisionSemantics = (): boolean =>
    preservesSubstantiveCoverage() && preservesProjectBandRanges();
  const removeOneArrayItem = (section: string, minimumLength = 0): boolean => {
    const values = Array.isArray(packet[section]) ? packet[section] as unknown[] : [];
    if (values.length <= minimumLength) return false;
    for (let index = values.length - 1; index >= minimumLength; index -= 1) {
      const [removed] = values.splice(index, 1);
      if (preservesDecisionSemantics()) {
        if (coverage[section]) coverage[section].included = values.length;
        return true;
      }
      values.splice(index, 0, removed);
    }
    return false;
  };
  const removeOneFrom = (sections: readonly string[], allowed: (section: string) => boolean): boolean => {
    for (const section of sections) {
      if (allowed(section) && removeOneArrayItem(section)) return true;
    }
    return false;
  };
  const pruneTrustGraphPreservingCoverage = (): boolean => {
    const previous = packet.trustGraphScreen == null
      ? undefined
      : structuredClone(packet.trustGraphScreen);
    if (!pruneTrustGraphPacket(packet)) return false;
    if (preservesDecisionSemantics()) return true;
    if (previous === undefined) delete packet.trustGraphScreen;
    else packet.trustGraphScreen = previous;
    return false;
  };
  const deleteProfilePreservingCoverage = (): boolean => {
    if (packet.profile == null) return false;
    const previous = packet.profile;
    delete packet.profile;
    if (preservesDecisionSemantics()) return true;
    packet.profile = previous;
    return false;
  };
  if (options.axisCatalog) {
    const sourceArtifactLimit = sectionLimits.sourceArtifacts;
    const sourceArtifacts = Array.isArray(packet.sourceArtifacts)
      ? packet.sourceArtifacts as unknown[]
      : [];
    while (sourceArtifacts.length > sourceArtifactLimit) {
      if (!removeOneArrayItem("sourceArtifacts")) break;
    }
    if (sourceArtifacts.length > sourceArtifactLimit) {
      return scoringPacketOversizeJson(options.axisCatalog.length, "source_artifact_cap_irreducible");
    }
  }
  let json = JSON.stringify(render());
  // Named team rows are the human-readable identity proof behind the generic
  // project-team check outcome. Keep them through the first pruning pass so a
  // bounded packet cannot retain "2 team records confirmed" while dropping
  // the actual founder names those records established.
  const protectedEvidenceSections = new Set(["checkOutcomes", "sourceArtifacts", "basicFacts", "team"]);
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    if (!removeOneFrom(pruneOrder, (section) => !protectedEvidenceSections.has(section))) break;
    json = JSON.stringify(render());
  }
  // Pathological inputs can fill the entire budget with findings alone. Remove
  // complete lowest-priority rows, never bytes, and disclose the omitted count.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 1) {
    if (!removeOneArrayItem("findings", 1)) break;
    json = JSON.stringify(render());
  }
  // A graph is a high-priority predicate, but its nested connection/tie arrays
  // must still obey the same hard request budget as every other section.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && pruneTrustGraphPreservingCoverage()) {
    json = JSON.stringify(render());
  }
  // Only after low-priority context and oversized graph detail are bounded do we
  // trim primary source/check artifacts.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    if (!removeOneFrom(pruneOrder, (section) => protectedEvidenceSections.has(section))) break;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 0) {
    if (!removeOneArrayItem("findings")) break;
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS && deleteProfilePreservingCoverage()) {
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    if (options.axisCatalog) {
      return scoringPacketOversizeJson(options.axisCatalog.length, "substantive_coverage_irreducible");
    }
    throw new Error(`analyst evidence packet exceeds ${ANALYST_EVIDENCE_MAX_CHARS} characters after structural pruning`);
  }
  return json;
}

/**
 * General-purpose compact packet used by non-decision analyst workflows. It
 * keeps investigative leads structurally separate from direct findings.
 */
export function buildAnalystEvidencePacket(input: Record<string, unknown>): string {
  return serializeAnalystEvidencePacket(input, { includeInvestigativeLeads: true });
}

/**
 * Evidence context for subject scoring and contradiction analysis. Discovery
 * leads are removed as data, not merely accompanied by a prompt instruction,
 * so related-entity allegations cannot influence either decision call.
 */
export function buildScoringEvidencePacket(input: Record<string, unknown>, axisCatalog: AnalystAxis[]): string {
  return serializeAnalystEvidencePacket(input, { includeInvestigativeLeads: false, axisCatalog });
}

export type AnalystScoringPreflightState =
  | "ready"
  | "no_axes"
  | "unsupported_axes"
  | "packet_oversize"
  | "invalid_catalog"
  | "insufficient_evidence";

export interface AnalystScoringPreflight {
  state: AnalystScoringPreflightState;
  requestedAxisCount: number;
  evidenceArtifactCount: number;
  missingSubstantiveAxes: string[];
  unsupportedAxes: string[];
}

/**
 * Inspect the immutable scorer packet before spending a model call. A genuine
 * evidence gap is an abstention, not an invalid model response and never an
 * instruction to synthesize a zero score.
 */
export function inspectAnalystScoringPreflight(
  axisCatalog: AnalystAxis[],
  evidenceJson: string,
): AnalystScoringPreflight {
  if (axisCatalog.length === 0) {
    return {
      state: "no_axes",
      requestedAxisCount: 0,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: [],
    };
  }
  const axisNames = axisCatalog.map(({ axis }) => axis);
  if (
    new Set(axisNames).size !== axisNames.length
    || axisCatalog.some((axis) => !axis.axis || !Number.isInteger(axis.weight) || axis.weight < 0)
  ) {
    return {
      state: "invalid_catalog",
      requestedAxisCount: axisCatalog.length,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: [],
    };
  }
  const unsupportedAxes = axisNames.filter((axis) => !SCORING_SUPPORTED_AXES.has(axis));
  if (unsupportedAxes.length > 0) {
    return {
      state: "unsupported_axes",
      requestedAxisCount: axisCatalog.length,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes,
    };
  }
  try {
    const packet = JSON.parse(evidenceJson) as unknown;
    if (
      packet
      && typeof packet === "object"
      && !Array.isArray(packet)
      && (packet as Record<string, unknown>)[SCORING_PACKET_STATE_FIELD] === SCORING_PACKET_OVERSIZE
    ) {
      return {
        state: "packet_oversize",
        requestedAxisCount: axisCatalog.length,
        evidenceArtifactCount: 0,
        missingSubstantiveAxes: [],
        unsupportedAxes: [],
      };
    }
  } catch {
    // The catalog integrity check below owns malformed JSON classification.
  }
  const evidenceCatalog = extractScoringEvidenceCatalog(evidenceJson, axisCatalog);
  if (!evidenceCatalog.length) {
    return {
      state: "invalid_catalog",
      requestedAxisCount: axisCatalog.length,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: [],
    };
  }
  const projectBands = deriveProjectStrengthBands(evidenceJson, axisCatalog);
  const missingSubstantiveAxes = axisCatalog
    .filter((axis) =>
      !evidenceCatalog.some((artifact) =>
        isSubstantiveArtifact(artifact) && artifact.eligibleAxes.includes(axis.axis))
      || (axis.role === "PROJECT" && projectBands[axis.axis]?.tier === "none"))
    .map(({ axis }) => axis);
  return {
    state: missingSubstantiveAxes.length > 0 ? "insufficient_evidence" : "ready",
    requestedAxisCount: axisCatalog.length,
    evidenceArtifactCount: evidenceCatalog.length,
    missingSubstantiveAxes,
    unsupportedAxes: [],
  };
}

export async function analyzeSubject(
  handle: string,
  roles: string[],
  axisCatalog: AnalystAxis[],
  evidenceJson: string,
  options: { analystDeadlineAt?: number } = {},
): Promise<AnalystVerdict | null> {
  const axisNames = axisCatalog.map(({ axis }) => axis);
  if (
    !axisCatalog.length
    || new Set(axisNames).size !== axisNames.length
    || axisCatalog.some((axis) => !axis.axis || !Number.isInteger(axis.weight) || axis.weight < 0)
  ) return null;
  const preflight = inspectAnalystScoringPreflight(axisCatalog, evidenceJson);
  console.info("[agent-preflight]", JSON.stringify({
    tool: "record_verdict",
    ...preflight,
  }));
  if (preflight.state !== "ready") return null;
  const evidenceCatalog = extractScoringEvidenceCatalog(evidenceJson, axisCatalog);
  const citationAliases = evidenceCatalog.map((artifact, index) => ({
    alias: `e${String(index + 1).padStart(3, "0")}`,
    artifact,
  }));
  const substantiveAliasesForAxis = (axis: string): string[] => citationAliases
    .filter(({ artifact }) => artifact.eligibleAxes.includes(axis)
      && isSubstantiveArtifact(artifact))
    .map(({ alias }) => alias);
  const verifiedScoreLimitingAliasesForAxis = (axis: string): string[] => citationAliases
    .filter(({ artifact }) => isVerifiedCounterArtifact(artifact, axis))
    .map(({ alias }) => alias);
  const preferredCoverageAliasesForAxis = (axis: string): string[] => citationAliases
    .filter(({ artifact }) => artifact.eligibleAxes.includes(axis) && !isSubstantiveArtifact(artifact))
    // Unavailable checks disclose a stronger coverage limitation than a
    // successful checked-empty result. Array.prototype.sort is stable, so the
    // frozen catalog order remains the tie-breaker.
    .sort((a, b) =>
      Number(b.artifact.verification === "unavailable")
      - Number(a.artifact.verification === "unavailable"))
    .slice(0, 4)
    .map(({ alias }) => alias);
  const formatAliases = (aliases: string[]): string => aliases.length > 0
    ? aliases.join(", ")
    : "(none)";
  const citationAliasTable = citationAliases
    .map(({ alias, artifact }) => `${alias} = ${artifact.artifactId}`)
    .join("\n");
  const citationEligibilityTable = axisCatalog
    .map(({ axis }) => `${axis} | substantive aliases (choose 1 primary; do not ` +
      `exhaustively copy): ${formatAliases(substantiveAliasesForAxis(axis))}` +
      ` | verified score-limiting aliases (the only counterEvidenceRefs that can justify ` +
      `a PROJECT score below its evidence-strength band): ${formatAliases(verifiedScoreLimitingAliasesForAxis(axis))}` +
      ` | coverageRefs preferred return set (optional; return 0-4 total, never ` +
      `the whole coverage catalog): ${formatAliases(preferredCoverageAliasesForAxis(axis))}`)
    .join("\n");
  const system =
    "You are ARGUS, a forensic crypto due-diligence analyst. You score a subject " +
    "on a fixed set of axes from collected evidence only. Be skeptical: a strong " +
    "story never papers over a disqualifying fact. Score conservatively when " +
    "evidence is thin, and score at the TOP of the justified band when verification " +
    "is overwhelming: several independent verified sources, institutional " +
    "corroboration, top-tier verified scale, or a multi-year verified operating " +
    "record. Skepticism gates what counts as verified evidence; it never discounts " +
    "evidence that has been verified. Understating fully verified strength is as " +
    "much a scoring error as overstating thin evidence. Each axis score must be " +
    "between 0 and its weight. Write one tight rationale per axis citing the " +
    "evidence. Never use em dashes.";
  const roleSpecificScoringPolicy = scoringPolicyForAxes(axisCatalog);
  const projectScoreBands = deriveProjectStrengthBands(evidenceJson, axisCatalog);
  const projectBandPolicy = axisCatalog
    .filter(({ role }) => role === "PROJECT")
    .map(({ axis }) => {
      const band = projectScoreBands[axis];
      return band
        ? `${axis}: ${band.tier} evidence, allowed ${band.minScore}-${band.maxScore}` +
          (band.tier === "adverse"
            ? "; cite a verified harmful alias as primary support for the adverse assessment and leave that alias out of counterEvidenceRefs"
            : "")
        : `${axis}: no affirmative strength band`;
    })
    .join("; ");
  const user =
    `Subject: ${handle}\nHeld roles: ${roles.join(", ")}\n\n` +
    `Axes to score (axis | weight | role):\n` +
    axisCatalog.map((a) => `- ${a.axis} | max ${a.weight} | ${a.role}`).join("\n") +
    (roleSpecificScoringPolicy ? `\n\n${roleSpecificScoringPolicy}` : "") +
    (projectBandPolicy
      ? `\n\nPROJECT EVIDENCE-STRENGTH BANDS FOR THIS FROZEN PACKET: ${projectBandPolicy}. Stay inside each range. Going below a positive axis's minimum requires a distinct severe verified score-limiting alias in counterEvidenceRefs; positive support alone never authorizes a lower score. A listed canonical-token drawdown alias must be cited in P5 counterEvidenceRefs, and its solid-band cap is already reflected in the frozen range, so it does not authorize scoring below that range. No evidence may justify exceeding the maximum. Never duplicate one alias on both sides. For an adverse band, the harmful fact supports the adverse assessment: cite it as primary evidence rather than duplicating it in counter-evidence.`
      : "") +
    `\n\nCollected evidence (JSON):\n${evidenceJson}\n\n` +
    `Citation aliases (return these short aliases in the tool call; ARGUS maps ` +
    `them back to the exact immutable artifact IDs):\n${citationAliasTable}\n\n` +
    `Axis citation guidance (the substantive aliases are authoritative, while each ` +
    `coverageRefs preferred return set is intentionally bounded. These are candidate ` +
    `sets, not checklists: never copy every available artifact. Other eligible ` +
    `coverage artifacts remain frozen in the evidence packet and need not be cited. ` +
    `primaryEvidenceRef and additionalEvidenceRefs may use only the substantive ` +
    `aliases. For this call, coverageRefs may use only the preferred return set. ` +
    `counterEvidenceRefs for PROJECT axes may use only the listed verified ` +
    `score-limiting aliases; other roles may use unused substantive aliases):\n` +
    `${citationEligibilityTable}\n\n` +
    `Score every listed axis, write the composite headline (one sentence on what ` +
    `governs the verdict), and an identity note.\n\n` +
    `ACTIVITY RULE: weigh posting cadence. profile.days_since_post is how long the ` +
    `account has been silent. For a PROJECT/token, going quiet for weeks (roughly ` +
    `21+ days) is a real liveness flag (abandoned, winding down, or quiet after a ` +
    `raise) and should temper traction/execution axes; for an individual it is a ` +
    `milder signal. Recent, steady posting is mildly positive, not a free pass.\n\n` +
    `OBSERVED NETWORK RULE: a non-empty notableFollowers array is direct observed ` +
    `network evidence. You may state that follower coverage is partial, but never ` +
    `claim that no notable followers were found, listed, documented, or present ` +
    `when those rows exist. Name representative observed accounts in the rationale.\n\n` +
    `IDENTITY RULE: if the evidence has a "team" array of named people tied to the ` +
    `project (especially any with a LinkedIn, or a named founder/CEO/CTO), the ` +
    `project's real-world identity is RESOLVED. A pseudonymous brand/company handle ` +
    `run on behalf of a publicly named team is NORMAL and is NOT an anonymity red ` +
    `flag: do not score identity/backing axes as if the operators were anonymous, ` +
    `and do NOT write a headline that calls the founder identity "unresolved", ` +
    `"unnamed", or "anonymous" when named leaders are present. The same applies ` +
    `to identity notes, axis rationales, and gap lines: a licensed identity-provider ` +
    `miss does not erase first-party founder evidence. Only treat identity ` +
    `as unresolved when the evidence genuinely names no one behind the project.\n\n` +
    `FOUNDER IDENTITY AND TRACK RECORD RULE: for a FOUNDER report, a verified ` +
    `Basic Fact or founder decision check governs the person's role. Describe ` +
    `that role as verified, not claimed, inferred, self-reported, or unresolved. ` +
    `Follower count, profile biography, posting cadence, notable followers, and ` +
    `X follow relationships may inform F6 network quality only. They never prove ` +
    `identity, founder status, track record, repeat backing, or build substance. ` +
    `A missing personal GitHub profile, People Data Labs miss, or checked-empty ` +
    `exact-name news query is a coverage limitation and cannot erase verified ` +
    `founder, company, product, or outcome evidence. Preserve source-specific ` +
    `entities: being CEO of an operating company does not make the person CEO of ` +
    `a related protocol or DAO.\n\n` +
    `PUBLIC DILIGENCE GAP RULE: identity gaps must be resolvable through public ` +
    `or consensually supplied professional records. Never request or recommend ` +
    `collecting a government-issued ID, passport, SSN or tax ID, home address, ` +
    `private account credentials, private financial records, or any other ` +
    `non-public personal proof. When public evidence is insufficient, say the ` +
    `public identity or role evidence remains unresolved and name the public ` +
    `source that should be checked next.\n\n` +
    `PROFILE PHOTO RULE: profileAuthenticity is a visual-integrity triage screen, ` +
    `not identity proof. A real-looking photo never establishes who operates the ` +
    `account, and an AI, stock, celebrity, logo, cartoon, unclear, or missing photo ` +
    `never establishes impersonation by itself. Use it only as a review lead.\n\n` +
    `FUND SCALE RULE: score I3 from verified fund_scale artifacts. Keep ` +
    `firm-wide AUM separate from an individual vehicle close, never sum several ` +
    `vehicles into AUM, and treat first_close or at_least values as lower bounds. ` +
    `An affiliated fund's scale is context for that fund and is never the audited ` +
    `person's personal capital. Historical vehicle closes remain fixed facts, while ` +
    `historical or undated AUM must not be presented as current. When no verified ` +
    `fund_scale artifact exists but the completed fund-scale assessment (the ` +
    `investor-fund-scale check) recorded a null result, score I3 at the low end ` +
    `for lack of a demonstrated source-backed scale; it is a null result on this ` +
    `axis only, never adverse evidence or counter-evidence against any other axis.\n\n` +
    `INVESTIGATIVE LEAD EXCLUSION: investigative leads are excluded from this ` +
    `scoring packet. Do not infer anything about the subject from their absence. ` +
    `Use all remaining collected evidence according to its provenance and ` +
    `verification state.\n\n` +
    `FINDING ATTRIBUTION RULE: when comparing or interpreting finding collections, ` +
    `only direct-subject findings may be attributed to the audited ` +
    `subject. A relationship alone is not evidence of participation or ` +
    `responsibility. This restriction applies to finding collections, not to ` +
    `legitimate non-finding evidence: profile, team, wallet, check-outcome, source, ` +
    `and provider evidence may affect scoring when relevant and reliable.\n\n` +
    `CITATION RULE: return exactly one array row for every requested axis. The axis ` +
    `field must exactly match an ID in the requested axis list and score must be an ` +
    `integer from zero through that axis's listed maximum. primaryEvidenceRef must ` +
    `be one substantive alias eligible for that axis. additionalEvidenceRefs ` +
    `contains zero to seven other substantive aliases, without duplicates. Always ` +
    `return coverageRefs, using an empty array when none apply; it may contain zero ` +
    `to four checked-empty or unavailable aliases eligible for that axis. Gaps must ` +
    `include a material missing-coverage description for every unavailable coverage ` +
    `reference. A checked-empty reference records a completed clear or negative screen; ` +
    `it is not an evidence gap and must not create a gap line by itself. counterEvidenceRefs contains zero ` +
    `to eight substantive aliases that credibly pull against the score. Never ` +
    `repeat an alias or place it on both sides. gaps contains zero to six short ` +
    `descriptions of material unresolved evidence. Write each gap as a plain question ` +
    `an investor would ask, one sentence, without internal vocabulary: never write ` +
    `packet, provider, coverage, collected, artifact, telemetry, or frozen. providerRuns operational ` +
    `telemetry is excluded from the scoring packet and must never be inferred or cited.\n\n` +
    `TRUST GRAPH RULE: only qualified connections and structured TrustGraphConnection ` +
    `findings bound to an exact complete server-collected report may influence scoring. ` +
    `Weak or unqualified ties are context only. ARGUS applies any graph cap ` +
    `deterministically after your axis scoring; do not invent or strengthen one.`;
  const tool: ToolSchema = {
    name: "record_verdict",
    description: "Record one complete forensic score row for every requested axis, plus a composite headline and identity note. Coverage-only citations belong only in coverageRefs. Unavailable coverage requires a material gap; checked-empty coverage records a completed screen and does not. Coverage never counts as substantive support or counter-evidence. Every declared field must be returned, even when an array is empty. ARGUS deterministically validates the exact axis set, score bounds, and citation eligibility before accepting the result.",
    strict: true,
    input_schema: RECORD_VERDICT_INPUT_SCHEMA,
  };
  const firstAttemptTimeoutMs = typeof options.analystDeadlineAt === "number"
    ? Math.min(ANALYST_SCORING_TIMEOUT_MS, Math.max(0, options.analystDeadlineAt - Date.now()))
    : ANALYST_SCORING_TIMEOUT_MS;
  if (firstAttemptTimeoutMs < 1_000) {
    console.warn("[agent-runtime]", JSON.stringify({
      tool: "record_verdict",
      state: "scoring_skipped_budget",
      remainingMs: firstAttemptTimeoutMs,
    }));
    return null;
  }
  // The analyst call is the linchpin of a multi-minute collection, and
  // structured() only fails over Claude to Grok once each: if BOTH providers
  // blip in the same instant (a rate-limit burst, a transient network drop),
  // it returns null and the whole run would abandon to INCOMPLETE with no
  // retry (the repair loop below is gated on a non-null response). Retry the
  // initial call a bounded number of times with a short backoff so a momentary
  // provider failure does not throw away the entire investigation. This is
  // distinct from the content-repair loop, which handles a returned-but-invalid
  // response. Retry ONLY genuinely transient failures: a max-token truncation
  // or an over-complex schema would fail identically on retry and only waste
  // budget. Every attempt stays inside the analyst deadline budget.
  const MAX_ANALYST_TRANSIENT_RETRIES = 2;
  const remainingBudgetMs = () => typeof options.analystDeadlineAt === "number"
    ? Math.min(ANALYST_SCORING_TIMEOUT_MS, Math.max(0, options.analystDeadlineAt - Date.now()))
    : ANALYST_SCORING_TIMEOUT_MS;
  const runScoringCall = async (timeoutMs: number): Promise<{ value: unknown; transient: boolean }> => {
    let sawDeterministic = false;
    let sawTransient = false;
    const value = await structured<unknown>(system, user, tool, 6000, timeoutMs, (reason) => {
      if (isTransientAnalystFailure(reason)) sawTransient = true;
      else sawDeterministic = true;
    });
    // Retry only when the failure was purely transient: any deterministic
    // reason (max_tokens, schema, 4xx, invalid tool call) recurs on retry.
    return { value, transient: value === null && sawTransient && !sawDeterministic };
  };
  let attempt = await runScoringCall(firstAttemptTimeoutMs);
  let raw = attempt.value;
  for (let transientRetry = 1; raw === null && attempt.transient && transientRetry <= MAX_ANALYST_TRANSIENT_RETRIES; transientRetry++) {
    const backoffMs = 750 * transientRetry;
    const budgetAfterBackoff = remainingBudgetMs() - backoffMs;
    if (budgetAfterBackoff < 1_000) {
      console.warn("[agent-runtime]", JSON.stringify({ tool: "record_verdict", state: "transient_retry_skipped_budget", remainingMs: budgetAfterBackoff }));
      break;
    }
    console.warn("[agent-runtime]", JSON.stringify({ tool: "record_verdict", state: "transient_retry", attempt: transientRetry, backoffMs }));
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    attempt = await runScoringCall(remainingBudgetMs());
    raw = attempt.value;
  }
  let rejectionReason = "unknown";
  let normalizedRaw = normalizeAnalystSupportCounterOverlap(raw, evidenceCatalog, projectScoreBands);
  normalizedRaw = normalizeAnalystCitationEligibility(normalizedRaw, evidenceCatalog);
  if (normalizedRaw !== raw) {
    console.info("[agent] normalized analyst citation placement before strict validation");
  }
  let validated = validateAnalystVerdict(
    normalizedRaw,
    axisCatalog,
    evidenceCatalog,
    (reason) => { rejectionReason = reason; },
    { projectScoreBands },
  );
  if (raw && !validated) {
    console.warn(`[agent] rejected incomplete or invalid analyst axis set (${rejectionReason})`);
  }
  // A weak packet often needs more than one round: the first repair can fix
  // the rejected language while introducing a different citation slip. Each
  // round rebuilds the reason-specific hint for the CURRENT rejection.
  const MAX_ANALYST_REPAIRS = 3;
  for (let repairAttempt = 1; raw && !validated && repairAttempt <= MAX_ANALYST_REPAIRS; repairAttempt++) {
    if (
      typeof options.analystDeadlineAt === "number"
      && Date.now() + ANALYST_REPAIR_TIMEOUT_MS > options.analystDeadlineAt
    ) {
      console.warn("[agent-runtime]", JSON.stringify({
        tool: "record_verdict",
        state: "repair_skipped_budget",
        remainingMs: Math.max(0, options.analystDeadlineAt - Date.now()),
        requiredMs: ANALYST_REPAIR_TIMEOUT_MS,
      }));
      return null;
    }
    const rejectedAxis = axisNames.find((axis) => rejectionReason.endsWith(`:${axis}`));
    const coverageLimitMatch = rejectionReason.match(/^coverage-reference-limit-observed-(\d+)-max-4:/);
    const supportCounterOverlap = rejectionReason.startsWith("support-counter-overlap:");
    const outOfBandProjectAxes = rejectionReason
      .match(/^project-scores-outside-evidence-strength-band:(.+)$/)?.[1]
      ?.split(",")
      .filter((axis) => axisNames.includes(axis)) ?? [];
    const verifiedScoreLimitingRepairAliases = outOfBandProjectAxes
      .map((axis) => `${axis}: ${formatAliases(verifiedScoreLimitingAliasesForAxis(axis))}`)
      .join("; ");
    const calibratedRepairBands = outOfBandProjectAxes
      .map((axis) => {
        const band = projectScoreBands[axis];
        return `${axis}: ${band?.minScore}-${band?.maxScore} (${band?.tier ?? "none"})`;
      })
      .join("; ");
    const projectBandRepair = outOfBandProjectAxes.length > 0
      ? ` The prior ${outOfBandProjectAxes.join(", ")} score${outOfBandProjectAxes.length === 1 ? " was" : "s were"} outside the evidence-strength band. Recheck every PROJECT axis against the calibration policy. Required bands by axis: ${calibratedRepairBands}. Stay inside the listed range unless a verified score-limiting alias justifies going below the minimum; never exceed the maximum. Verified score-limiting aliases by axis: ${verifiedScoreLimitingRepairAliases}. Missing coverage, unavailable providers, unanswered questions, and positive context belong in coverageRefs, gaps, or support and cannot justify a lower score.`
      : "";
    let rejectedAxisHint = "";
    if (rejectionReason === "grounded-team-described-as-unresolved") {
      rejectedAxisHint = " The frozen packet contains substantive named-team artifacts. Rewrite the headline, identity note, every axis rationale, and every evidence-gap line to acknowledge the public team. Do not claim there is no, absent, unnamed, unresolved, anonymous, unknown, or undisclosed project founder, operator, executive, leader, or team. Keep a failed licensed-identity-provider lookup separate from the first-party founder evidence; it does not erase the named team.";
    } else if (rejectionReason === "founder-fundamentals-cite-network-only-evidence") {
      rejectedAxisHint = " F2 track record and F3 repeat backing may not cite follower count, profile biography, posting cadence, notable followers, or X follow relationships. Remove that network-only context from those rows. Use it only in F6 network quality, and score F2 or F3 only from source-backed roles, ventures, products, outcomes, financing, investors, or repeat counterparties.";
    } else if (rejectionReason === "grounded-founder-role-described-as-unverified") {
      rejectedAxisHint = " The frozen packet contains verified founder or current-role evidence. Rewrite the headline, identity note, every axis rationale, and every gap line to state the verified relationship directly. Do not call that role claimed, inferred, self-reported, unconfirmed, uncorroborated, unresolved, or unverified. Missing People Data Labs, GitHub, or exact-name news coverage may remain a separate coverage gap but cannot erase the verified role.";
    } else if (rejectionReason === "grounded-founder-track-record-described-as-social-only") {
      rejectedAxisHint = " The frozen packet contains verified founder, product, role, or outcome evidence for F2. Rewrite F2 and the report summary from those source-backed artifacts. Followers, profile biography, posting cadence, and follow relationships may inform F6 only. You may say that additional measurable outcomes remain incomplete, but do not say the track record is inferred from social reach or a claimed role.";
    } else if (rejectionReason === "founder-track-record-described-as-social-only") {
      rejectedAxisHint = " Followers, profile biography, posting cadence, and follow relationships may inform F6 network quality only. They cannot establish F2 track record. If the frozen packet has no source-backed founder, role, product, or outcome artifacts, state that the track record remains unscored and publish the investigation as incomplete rather than inferring it from social reach.";
    } else if (rejectionReason.startsWith("relationship-press-described-as-uncollected")) {
      rejectedAxisHint = " The frozen packet contains press artifacts naming a counterparty relationship that are eligible for P4. Do not write a gap claiming partnership or integration evidence was not collected. You may state that the named integrations are press-reported and not yet first-party confirmed, which is the accurate remaining gap.";
    } else if (rejectionReason === "grounded-notable-followers-described-as-absent") {
      rejectedAxisHint = " The frozen packet contains observed notable-follower artifacts. Rewrite the headline, identity note, every axis rationale, and every evidence-gap line to acknowledge those accounts. You may describe provider coverage as partial, but do not claim that no notable followers were found, listed, documented, present, included, or observed. Name representative observed accounts in the F6 network-quality rationale.";
    } else if (projectBandRepair) {
      rejectedAxisHint = projectBandRepair;
    } else if (rejectedAxis && coverageLimitMatch) {
      rejectedAxisHint = ` The prior ${rejectedAxis} coverageRefs contained ${coverageLimitMatch[1]} aliases; ` +
        `the maximum is 4. Return no more than these four preferred aliases: ` +
        `${formatAliases(preferredCoverageAliasesForAxis(rejectedAxis))}. Do not append ` +
        `or move omitted coverage aliases into support or counter fields.`;
    } else if (rejectedAxis && supportCounterOverlap) {
      rejectedAxisHint = projectScoreBands[rejectedAxis]?.tier === "adverse"
        ? ` For adverse ${rejectedAxis}, the verified harmful alias is primary support for the adverse assessment. Keep one of ${formatAliases(verifiedScoreLimitingAliasesForAxis(rejectedAxis))} as primaryEvidenceRef and remove it from counterEvidenceRefs. Leave counterEvidenceRefs empty unless a distinct verified score-limiting alias remains; no alias may appear on both sides.`
        : ` For ${rejectedAxis}, the same alias appeared in support and counter-evidence. Counter-evidence wins only when it is a verified score-limiting alias: keep that alias only in counterEvidenceRefs, then choose a different unused substantive alias as primaryEvidenceRef from ${formatAliases(substantiveAliasesForAxis(rejectedAxis))}. No alias may appear in both primary/additional support and counter-evidence.`;
    } else if (rejectedAxis) {
      rejectedAxisHint = ` For ${rejectedAxis}, choose exactly one primary from the substantive aliases ` +
        `${formatAliases(substantiveAliasesForAxis(rejectedAxis))}. Assign each other ` +
        `substantive alias to at most one array. Return coverageRefs as zero to four ` +
        `distinct values chosen only from ` +
        `${formatAliases(preferredCoverageAliasesForAxis(rejectedAxis))}; [] is valid ` +
        `and you must not exhaustively copy coverage artifacts.`;
    }
    const repairUser = `${user}\n\nREPAIR REQUIRED: the prior record_verdict tool payload was rejected by ` +
      `deterministic validation with reason "${rejectionReason}". Make one fresh ` +
      `record_verdict call. Recheck the exact axis set, per-axis score bounds, ` +
      `citation eligibility, duplicate aliases, support/counter overlap, and the ` +
      `array limits (seven additional support, eight counter, four coverage, and six ` +
      `gaps), plus the requirement that any returned coverageRefs have a material gap description. ` +
      `Do not invent evidence or fill a missing fact.${rejectedAxisHint}`;
    raw = await structured<unknown>(
      system,
      repairUser,
      tool,
      6000,
      ANALYST_REPAIR_TIMEOUT_MS,
    );
    rejectionReason = "unknown";
    normalizedRaw = normalizeAnalystSupportCounterOverlap(raw, evidenceCatalog, projectScoreBands);
    normalizedRaw = normalizeAnalystCitationEligibility(normalizedRaw, evidenceCatalog);
    if (normalizedRaw !== raw) {
      console.info("[agent] normalized repaired citation placement before strict validation");
    }
    validated = validateAnalystVerdict(
      normalizedRaw,
      axisCatalog,
      evidenceCatalog,
      (reason) => { rejectionReason = reason; },
      { projectScoreBands },
    );
    if (raw && !validated) {
      console.warn(`[agent] rejected analyst repair axis set (${rejectionReason}) attempt=${repairAttempt}/${MAX_ANALYST_REPAIRS}`);
    }
  }
  return validated;
}
