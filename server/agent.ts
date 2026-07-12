// Claude analyst agent. The engine needs axis scores with rationales, venture
// outcome classifications, and a one-line headline. Raw provider data is messy;
// this is the step where judgement lives. We force structured output via a tool
// so the model returns validated JSON, never prose.
//
// Gated on ANTHROPIC_API_KEY. With no key, callers fall back to heuristics.

import { createHash } from "node:crypto";
import { ANALYST_MODEL, env } from "./config";
import { addClaudeUsage } from "./cost";
import type { AxisEvidenceRecord, Contradiction } from "../src/data/evidence";
import { ANALYST_REPAIR_TIMEOUT_MS, ANALYST_SCORING_TIMEOUT_MS } from "../src/lib/investigationRuntime";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const failureMeta = (error: unknown, timeoutMs: number, fallback: string): string =>
  error instanceof Error && error.name === "TimeoutError"
    ? `timeout_${timeoutMs}ms`
    : fallback;

export function analystAvailable(): boolean {
  return !!env("ANTHROPIC_API_KEY");
}

interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}

// Calls the Anthropic Messages API and forces a single tool call, returning the
// tool input as the structured result. Returns null on any failure.
export async function structured<T>(
  system: string,
  user: string,
  tool: ToolSchema,
  maxTokens = 2048,
  timeoutMs = 60_000,
): Promise<T | null> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  const startedAt = Date.now();
  const requestBody = JSON.stringify({
    model: ANALYST_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
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
    return null;
  }
  const requestId = res.headers.get("request-id") || res.headers.get("x-request-id");
  if (!res.ok) {
    addClaudeUsage(undefined, tool.name, "failed", `http_${res.status}`);
    let detail = "";
    try { detail = await res.text(); } catch { /* response detail is diagnostic only */ }
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
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
  return (block?.input as T) ?? null;
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
    "PROJECT = the account IS an organization — a token, protocol, product, company, " +
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
    "INVESTOR — a caller who trades is a KOL, nothing more. " +
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
    "SCOPE RULES — these are NOT contradictions: (1) ARGUS's OWN analysis metadata (fields like identity_confidence, identity_note, verdicts, evidence notes such as 'single-source lead, unverified') disagreeing with other ARGUS fields — only the SUBJECT's outward claims vs external facts count; a low-confidence evidence note is a gap, not a conflict. (2) Normal vertical integration: a project's token running on its own chain, its dApp on its own platform, or its products naming each other is how ecosystems work, not circularity. (3) Marketing self-description ('#1', 'leading') vs modest traction is puffery to note in scoring, not a contradiction, unless it conflicts with a specific verifiable fact. " +
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
  const r = await structured<{ contradictions: { claim: string; conflict: string; severity: string; confidence: string }[] }>(
    system,
    user,
    tool,
    2048,
    timeoutMs,
  );
  if (!r) return null;
  return (r.contradictions ?? [])
    .filter((c) => c && c.claim?.trim() && c.conflict?.trim())
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

const ARTIFACT_ID = /^art_v1_[a-f0-9]{64}$/;
const COVERAGE_ONLY_VERIFICATIONS = new Set<AxisEvidenceRecord["verification"]>(["checked_empty", "unavailable"]);
const isSubstantiveArtifact = (artifact: AxisEvidenceRecord | undefined): artifact is AxisEvidenceRecord =>
  !!artifact && !COVERAGE_ONLY_VERIFICATIONS.has(artifact.verification);

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
  const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
  const identityNote = typeof raw.identity_note === "string" ? raw.identity_note.trim() : "";
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
    const gaps = value.map((item) => typeof item === "string" ? item.trim() : "");
    if (gaps.some((gap) => !gap || gap.length > 400) || new Set(gaps).size !== gaps.length) return null;
    return gaps;
  };

  const seen = new Map<string, AnalystVerdict["axes"][number]>();
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
    let evidenceRefs: string[] | null;
    let coverageRefs: string[] = [];
    if (keyedAxes) {
      const primary = typeof row.primaryEvidenceRef === "string"
        ? resolveRef(row.primaryEvidenceRef)
        : "";
      const additional = validRefs(row.additionalEvidenceRefs, 0, 7);
      const hasCoverageCandidates = [...artifacts.values()].some((artifact) =>
        COVERAGE_ONLY_VERIFICATIONS.has(artifact.verification)
        && artifact.eligibleAxes.includes(row.axis as string));
      const allowedFields = new Set([
        "score",
        "rationale",
        "primaryEvidenceRef",
        "additionalEvidenceRefs",
        "counterEvidenceRefs",
        "gaps",
        ...(hasCoverageCandidates ? ["coverageRefs"] : []),
      ]);
      if ((keyedRowKeys.get(row.axis) ?? []).some((key) => !allowedFields.has(key))) {
        return reject(`axis-row-extra-field:${row.axis}`);
      }
      if (
        (hasCoverageCandidates && row.coverageRefs === undefined)
        || (!hasCoverageCandidates && row.coverageRefs !== undefined)
      ) {
        return reject(`coverage-field-shape:${row.axis}`);
      }
      const rawCoverage = row.coverageRefs === undefined ? [] : row.coverageRefs;
      const coverage = validRefs(rawCoverage, 0, 4);
      if (!ARTIFACT_ID.test(primary) || !additional || !coverage) {
        return reject(`axis-reference-shape:${row.axis}`);
      }
      evidenceRefs = [primary, ...additional, ...coverage];
      coverageRefs = coverage;
      if (new Set(evidenceRefs).size !== evidenceRefs.length) {
        return reject(`duplicate-evidence-reference:${row.axis}`);
      }
    } else {
      evidenceRefs = validRefs(row.evidenceRefs, 1, 12);
    }
    const counterEvidenceRefs = validRefs(row.counterEvidenceRefs, 0, keyedAxes ? 8 : 12);
    const gaps = validGaps(row.gaps);
    if (!evidenceRefs || evidenceRefs.length > 12 || !counterEvidenceRefs || !gaps) {
      return reject(`axis-arrays-invalid:${row.axis}`);
    }
    if (counterEvidenceRefs.some((ref) => evidenceRefs.includes(ref))) {
      return reject(`support-counter-overlap:${row.axis}`);
    }
    const everyRefEligible = [...evidenceRefs, ...counterEvidenceRefs].every((ref) => {
      const artifact = artifacts.get(ref);
      return artifact?.eligibleAxes.includes(row.axis as string);
    });
    if (!everyRefEligible) return reject(`axis-ineligible-reference:${row.axis}`);
    // Coverage records preserve exact gap lineage but cannot satisfy support by
    // themselves. Every scored axis must also cite substantive evidence.
    if (!evidenceRefs.some((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`missing-substantive-support:${row.axis}`);
    }
    if (keyedAxes) {
      const supportRefs = evidenceRefs.filter((ref) => !coverageRefs.includes(ref));
      if (!supportRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
        return reject(`non-substantive-support:${row.axis}`);
      }
      if (!coverageRefs.every((ref) => !isSubstantiveArtifact(artifacts.get(ref)))) {
        return reject(`substantive-coverage-reference:${row.axis}`);
      }
    }
    if (evidenceRefs.some((ref) => !isSubstantiveArtifact(artifacts.get(ref))) && gaps.length === 0) {
      return reject(`coverage-without-gap:${row.axis}`);
    }
    if (!counterEvidenceRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-counter-reference:${row.axis}`);
    }
    seen.set(row.axis, {
      axis: row.axis,
      score: row.score,
      rationale: row.rationale.trim(),
      evidenceRefs,
      counterEvidenceRefs,
      gaps,
    });
  }
  if (seen.size !== expected.size) return reject("incomplete-axis-set");

  return {
    // Canonical order makes downstream completeness checks and snapshots stable.
    axes: axisCatalog.map((spec) => seen.get(spec.axis)!),
    headline,
    identity_note: identityNote,
  };
}

export const ANALYST_EVIDENCE_MAX_CHARS = 24_000;

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
    "P1_team_and_identity", "P5_traction_and_liveness", "P6_transparency_integrity",
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
  // Findings are routed by exact finding_type below. A section-wide allowlist
  // made unrelated facts (for example, token collapse) eligible for identity.
  findings: [],
  ventures: [
    "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality",
    "P2_product_substance", "P4_backing_and_partners", "P5_traction_and_liveness", "I2_portfolio_quality", "I3_fund_scale_tier",
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
  notableFollowers: ["F6_network_quality", "P4_backing_and_partners", "P5_traction_and_liveness", "K5_cabal_fud", "I2_portfolio_quality", "I4_testimonial_corroboration", "I5_reputation_fud", "AG4_reputation_fud", "AD3_relationship_corroboration", "AD5_reputation_fud", "ME2_role_authenticity", "ME3_conduct_reputation"],
  recentActivity: [
    "F2_track_record", "F4_build_substance", "F5_reputation_integrity", "P2_product_substance", "P3_token_conduct", "P5_traction_and_liveness", "P6_transparency_integrity",
    "K2_call_performance", "K3_disclosure_deletion", "K5_cabal_fud", "I2_portfolio_quality", "I4_testimonial_corroboration", "I5_reputation_fud",
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

const IDENTITY_LEAD_FINDING_AXES = [
  "F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity",
  "K1_identity_roster", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud",
  "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud",
  "ME1_identity", "ME3_conduct_reputation",
] as const;

/** Methodology-owned semantic routing for direct-subject finding artifacts. */
const FINDING_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  CommunityFUD: REPUTATION_FINDING_AXES,
  LegalCaseNameLead: IDENTITY_LEAD_FINDING_AXES,
  SanctionsNameLead: IDENTITY_LEAD_FINDING_AXES,
  SiteNotLive: ["F4_build_substance", "P2_product_substance", "P5_traction_and_liveness", "P6_transparency_integrity"],
  TokenCollapse: ["F5_reputation_integrity", "P3_token_conduct", "K2_call_performance", "K4_onchain_conduct"],
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
    "P3_token_conduct", "K3_disclosure_deletion", "K4_onchain_conduct", "AG3_service_integrity", "AD4_advisory_conduct",
  ],
};

const CHECK_AXIS_ELIGIBILITY: Record<string, readonly string[]> = {
  "identity-resolution": ["F1_identity_verifiability", "P1_team_and_identity", "K1_identity_roster", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "profile-photo-authenticity": [],
  "code-footprint-github": ["F2_track_record", "F4_build_substance", "P2_product_substance", "P5_traction_and_liveness", "ME2_role_authenticity"],
  "identity-continuity": ["F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity", "K1_identity_roster", "K3_disclosure_deletion", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "affiliations-associates": ["F2_track_record", "F3_repeat_backing", "F6_network_quality", "P4_backing_and_partners", "K5_cabal_fud", "I2_portfolio_quality", "I4_testimonial_corroboration", "AD3_relationship_corroboration", "ME2_role_authenticity"],
  "promoted-token-performance": ["P3_token_conduct", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "K5_cabal_fud"],
  "vc-portfolio-track-record": ["F2_track_record", "F3_repeat_backing", "I2_portfolio_quality", "I3_fund_scale_tier"],
  "news-press": ["F2_track_record", "F3_repeat_backing", "F5_reputation_integrity", "P2_product_substance", "P4_backing_and_partners", "P5_traction_and_liveness", "I2_portfolio_quality", "I3_fund_scale_tier", "I5_reputation_fud", "AG2_client_outcomes", "AG4_reputation_fud", "AD2_advised_outcomes", "AD5_reputation_fud", "ME3_conduct_reputation"],
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
  press: [
    "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality",
    "P2_product_substance", "P4_backing_and_partners", "P5_traction_and_liveness", "P6_transparency_integrity",
    "K5_cabal_fud", "I2_portfolio_quality", "I3_fund_scale_tier", "I5_reputation_fud",
    "AG2_client_outcomes", "AG4_reputation_fud", "AD2_advised_outcomes", "AD5_reputation_fud", "ME3_conduct_reputation",
  ],
};

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

const eligibleAxesFor = (section: string, value: Record<string, unknown>, axisCatalog: AnalystAxis[]): string[] => {
  const checkId = typeof value.checkId === "string" ? value.checkId : typeof value.check_id === "string" ? value.check_id : "";
  const findingType = typeof value.finding_type === "string" ? value.finding_type : "";
  const eligible = section === "profile" && value.profile_collection_state !== "resolved"
    ? []
    : section === "findings"
      ? FINDING_AXIS_ELIGIBILITY[findingType] ?? []
      : section === "checkOutcomes" && checkId
    ? CHECK_AXIS_ELIGIBILITY[checkId] ?? []
    : section === "sourceArtifacts"
      ? SOURCE_ARTIFACT_AXIS_ELIGIBILITY[sourceArtifactKind(value)] ?? []
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

const safeArtifactSourceUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) {
      return undefined;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:access[_-]?token|api[_-]?key|key|token|signature|sig|auth)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const ARTIFACT_URL_FIELDS = new Set([
  "sourceUrl", "source_url", "evidence_url", "url", "linkedin", "link", "href",
  "citation", "link_evidence_url",
]);

const sanitizeArtifactUrls = (value: unknown, depth = 0): unknown => {
  if (value == null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeArtifactUrls(item, depth + 1));
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (ARTIFACT_URL_FIELDS.has(key) && typeof item === "string") {
      const safe = safeArtifactSourceUrl(item);
      if (safe) sanitized[key] = safe;
      continue;
    }
    sanitized[key] = sanitizeArtifactUrls(item, depth + 1);
  }
  return sanitized;
};

const verificationFor = (section: string, record: Record<string, unknown>): AxisEvidenceRecord["verification"] => {
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
  return "observed";
};

const DIRECT_SECTIONS = new Set(["profile", "profileAuthenticity", "findings", "wallets", "promotions", "recentActivity"]);

const providerFor = (section: string, payload: Record<string, unknown>): string => {
  const declared = recordText(payload, ["provider"], 100);
  if (declared) return declared;
  if (section === "profile") {
    const profileProvider = recordText(payload, ["profile_provider"], 100);
    if (profileProvider) return profileProvider;
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
): { decorated: Record<string, unknown>; catalog: AxisEvidenceRecord } => {
  const payload = sanitizeArtifactUrls(evidencePayload(value)) as Record<string, unknown>;
  const contentHash = createHash("sha256").update(stableJson({ section, payload })).digest("hex");
  const artifactId = `art_v1_${contentHash}`;
  const eligibleAxes = eligibleOverride ?? eligibleAxesFor(section, payload, axisCatalog);
  const provider = providerFor(section, payload);
  const operationKey = recordText(payload, ["checkId", "check_id", "finding_type", "kind", "type"], 100);
  const title = recordText(payload, ["title", "label", "claim", "name", "project_name", "handle", "axis"], 180)
    ?? `${section} evidence`;
  const excerpt = recordText(payload, ["excerpt", "note", "rationale", "evidence", "bio", "detail", "text", "value"], 320);
  const sourceUrl = safeArtifactSourceUrl(
    recordText(payload, ["sourceUrl", "source_url", "evidence_url", "url", "linkedin"], 420),
  );
  const capturedAt = recordText(payload, ["capturedAt", "captured_at", "profile_captured_at", "completedAt", "source_date"], 40);
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
      verification: verificationFor(section, payload),
      scope: DIRECT_SECTIONS.has(section) ? "direct_subject" : "subject_context",
    },
  };
};

const SCORING_SINGLE_SECTIONS = ["profile", "profileAuthenticity", "trustGraphScreen"] as const;
const SCORING_ARRAY_SECTIONS = [
  "findings", "ventures", "testimonials", "advised", "promotions", "wallets", "team",
  "notableFollowers", "recentActivity", "sourceArtifacts", "checkOutcomes",
  "clientEngagements", "associates", "ventureTeams",
] as const;

function renderScoringPacket(packet: Record<string, unknown>, axisCatalog: AnalystAxis[]): Record<string, unknown> {
  const rendered: Record<string, unknown> = { ...packet, schema_version: 4 };
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
    const eligibleValues = values.flatMap((value) => {
      const artifact = makeAxisArtifact(section, value, axisCatalog);
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
    && (row.scope === "direct_subject" || row.scope === "subject_context");
};

/** Parse and integrity-check the concise catalog frozen into a scorer packet. */
export function extractScoringEvidenceCatalog(json: string): AxisEvidenceRecord[] {
  let packet: Record<string, unknown>;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    packet = value as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!Array.isArray(packet.evidenceCatalog) || !packet.evidenceCatalog.every(isAxisEvidenceRecord)) return [];
  const catalog = packet.evidenceCatalog as AxisEvidenceRecord[];
  const byId = new Map(catalog.map((record) => [record.artifactId, record]));
  if (byId.size !== catalog.length) return [];

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
    represented.add(artifactId);
  };
  for (const section of SCORING_SINGLE_SECTIONS) inspect(section, packet[section]);
  for (const section of [...SCORING_ARRAY_SECTIONS, "axisGaps"] as const) {
    if (Array.isArray(packet[section])) (packet[section] as unknown[]).forEach((value) => inspect(section, value));
  }
  return represented.size === catalog.length ? catalog.map((record) => ({ ...record, eligibleAxes: [...record.eligibleAxes] })) : [];
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
  const sectionLimits: Record<string, number> = {
    ventures: 12,
    testimonials: 12,
    advised: 12,
    promotions: 16,
    wallets: 12,
    team: 16,
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
    profile: compactObject(input.profile),
    profileAuthenticity: compactProfileAuthenticity(input.profileAuthenticity),
    trustGraphScreen: compactTrustGraphScreen(input.trustGraphScreen),
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
    const included = source.slice(0, limit).map((item) => compactObject(item)).filter((item) => item !== undefined);
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
    "team",
    "providerRuns",
    "associates",
    "clientEngagements",
    "ventureTeams",
    "checkOutcomes",
    "sourceArtifacts",
  ];
  const render = () => options.axisCatalog
    ? renderScoringPacket(packet, options.axisCatalog)
    : packet;
  let json = JSON.stringify(render());
  const protectedEvidenceSections = new Set(["checkOutcomes", "sourceArtifacts"]);
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    const section = pruneOrder.find((key) =>
      !protectedEvidenceSections.has(key)
      && Array.isArray(packet[key])
      && (packet[key] as unknown[]).length > 0);
    if (!section) break;
    (packet[section] as unknown[]).pop();
    coverage[section].included = (packet[section] as unknown[]).length;
    json = JSON.stringify(render());
  }
  // Pathological inputs can fill the entire budget with findings alone. Remove
  // complete lowest-priority rows, never bytes, and disclose the omitted count.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 1) {
    findings.pop();
    coverage.findings.included = findings.length;
    json = JSON.stringify(render());
  }
  // A graph is a high-priority predicate, but its nested connection/tie arrays
  // must still obey the same hard request budget as every other section.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && pruneTrustGraphPacket(packet)) {
    json = JSON.stringify(render());
  }
  // Only after low-priority context and oversized graph detail are bounded do we
  // trim primary source/check artifacts.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    const section = pruneOrder.find((key) =>
      protectedEvidenceSections.has(key)
      && Array.isArray(packet[key])
      && (packet[key] as unknown[]).length > 0);
    if (!section) break;
    (packet[section] as unknown[]).pop();
    coverage[section].included = (packet[section] as unknown[]).length;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 0) {
    findings.pop();
    coverage.findings.included = findings.length;
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS && packet.profile != null) {
    delete packet.profile;
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
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
  const evidenceCatalog = extractScoringEvidenceCatalog(evidenceJson);
  if (
    !evidenceCatalog.length
    || axisCatalog.some((axis) => !evidenceCatalog.some((artifact) =>
      isSubstantiveArtifact(artifact) && artifact.eligibleAxes.includes(axis.axis)))
  ) return null;
  const citationAliases = evidenceCatalog.map((artifact, index) => ({
    alias: `e${String(index + 1).padStart(3, "0")}`,
    artifact,
  }));
  const aliasesForAxis = (axis: string, coverageOnly: boolean): string[] => citationAliases
    .filter(({ artifact }) => artifact.eligibleAxes.includes(axis)
      && (coverageOnly ? !isSubstantiveArtifact(artifact) : isSubstantiveArtifact(artifact)))
    .map(({ alias }) => alias);
  const citationAliasTable = citationAliases
    .map(({ alias, artifact }) => `${alias} = ${artifact.artifactId}`)
    .join("\n");
  const axisSchemas = Object.fromEntries(axisCatalog.map((spec) => {
    const substantiveAliases = aliasesForAxis(spec.axis, false);
    const coverageAliases = aliasesForAxis(spec.axis, true);
    const properties: Record<string, unknown> = {
      score: {
        type: "number",
        enum: Array.from({ length: spec.weight + 1 }, (_, score) => score),
        description: `Integer score from 0 through ${spec.weight} for ${spec.axis}.`,
      },
      rationale: {
        type: "string",
        description: `Tight evidence-grounded rationale for ${spec.axis}.`,
      },
      primaryEvidenceRef: {
        type: "string",
        enum: substantiveAliases,
        description: `One substantive citation alias eligible for ${spec.axis}.`,
      },
      additionalEvidenceRefs: {
        type: "array",
        items: { type: "string", enum: substantiveAliases },
        description: `Zero to seven additional, unique substantive citation aliases for ${spec.axis}; never repeat primaryEvidenceRef.`,
      },
      counterEvidenceRefs: {
        type: "array",
        items: { type: "string", enum: substantiveAliases },
        description: `Zero to eight unique substantive aliases that credibly pull against the ${spec.axis} score; never overlap support.`,
      },
      gaps: {
        type: "array",
        items: { type: "string" },
        description: `Zero to six unique, non-empty descriptions of material unresolved evidence for ${spec.axis}.`,
      },
    };
    const required = [
      "score",
      "rationale",
      "primaryEvidenceRef",
      "additionalEvidenceRefs",
      "counterEvidenceRefs",
      "gaps",
    ];
    if (coverageAliases.length > 0) {
      properties.coverageRefs = {
        type: "array",
        items: { type: "string", enum: coverageAliases },
        description: `Zero to four unique checked-empty or unavailable citation aliases for ${spec.axis}. If any alias is returned, gaps must include a material missing-coverage description.`,
      };
      required.push("coverageRefs");
    }
    return [spec.axis, {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    }];
  }));
  const system =
    "You are ARGUS, a forensic crypto due-diligence analyst. You score a subject " +
    "on a fixed set of axes from collected evidence only. Be skeptical: a strong " +
    "story never papers over a disqualifying fact. Score conservatively when " +
    "evidence is thin. Each axis score must be between 0 and its weight. Write one " +
    "tight rationale per axis citing the evidence. Never use em dashes.";
  const user =
    `Subject: ${handle}\nHeld roles: ${roles.join(", ")}\n\n` +
    `Axes to score (axis | weight | role):\n` +
    axisCatalog.map((a) => `- ${a.axis} | max ${a.weight} | ${a.role}`).join("\n") +
    `\n\nCollected evidence (JSON):\n${evidenceJson}\n\n` +
    `Citation aliases (return these short aliases in the tool call; ARGUS maps ` +
    `them back to the exact immutable artifact IDs):\n${citationAliasTable}\n\n` +
    `Score every listed axis, write the composite headline (one sentence on what ` +
    `governs the verdict), and an identity note.\n\n` +
    `ACTIVITY RULE: weigh posting cadence. profile.days_since_post is how long the ` +
    `account has been silent. For a PROJECT/token, going quiet for weeks (roughly ` +
    `21+ days) is a real liveness flag (abandoned, winding down, or quiet after a ` +
    `raise) and should temper traction/execution axes; for an individual it is a ` +
    `milder signal. Recent, steady posting is mildly positive, not a free pass.\n\n` +
    `IDENTITY RULE: if the evidence has a "team" array of named people tied to the ` +
    `project (especially any with a LinkedIn, or a named founder/CEO/CTO), the ` +
    `project's real-world identity is RESOLVED. A pseudonymous brand/company handle ` +
    `run on behalf of a publicly named team is NORMAL and is NOT an anonymity red ` +
    `flag: do not score identity/backing axes as if the operators were anonymous, ` +
    `and do NOT write a headline that calls the founder identity "unresolved", ` +
    `"unnamed", or "anonymous" when named leaders are present. Only treat identity ` +
    `as unresolved when the evidence genuinely names no one behind the project.\n\n` +
    `PROFILE PHOTO RULE: profileAuthenticity is a visual-integrity triage screen, ` +
    `not identity proof. A real-looking photo never establishes who operates the ` +
    `account, and an AI, stock, celebrity, logo, cartoon, unclear, or missing photo ` +
    `never establishes impersonation by itself. Use it only as a review lead.\n\n` +
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
    `CITATION RULE: the tool exposes one required object for every exact axis. ` +
    `primaryEvidenceRef must be one substantive alias from that axis's allowed ` +
    `enum. additionalEvidenceRefs contains zero to seven other substantive ` +
    `aliases, without duplicates. coverageRefs, when the field exists, contains ` +
    `only checked-empty or unavailable aliases; if any are returned, gaps must ` +
    `include a material missing-coverage description. counterEvidenceRefs contains zero ` +
    `to eight substantive aliases that credibly pull against the score. Never ` +
    `repeat an alias or place it on both sides. gaps contains zero to six short ` +
    `descriptions of material unresolved evidence. providerRuns operational ` +
    `telemetry is excluded from the scoring packet and must never be inferred or cited.\n\n` +
    `TRUST GRAPH RULE: only qualified connections and structured TrustGraphConnection ` +
    `findings bound to an exact complete server-collected report may influence scoring. ` +
    `Weak or unqualified ties are context only. ARGUS applies any graph cap ` +
    `deterministically after your axis scoring; do not invent or strengthen one.`;
  const tool: ToolSchema = {
    name: "record_verdict",
    description: "Record one complete forensic score object for every exact requested axis, plus a composite headline and identity note. Axis keys, integer score choices, and citation aliases are constrained independently so evidence from one axis cannot be silently reused on another. Coverage-only citations belong only in coverageRefs and require a material missing-coverage gap when any are returned; they never count as substantive support or counter-evidence. Every declared field must be returned, even when an array is empty.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        axes: {
          type: "object",
          properties: axisSchemas,
          required: axisCatalog.map((axis) => axis.axis),
          additionalProperties: false,
        },
        headline: { type: "string", description: "One non-empty sentence explaining what governs the composite verdict." },
        identity_note: { type: "string", description: "Non-empty identity resolution. Distinguish the ACCOUNT OPERATOR from the project's TEAM: if named team members are present in the evidence (especially with a LinkedIn), acknowledge them by name and do NOT claim 'no linked real-world identity' or 'zero credentials' — instead say the account/operator is pseudonymous while N named people are publicly tied to the project (list a few). Only say no one is identified if the evidence truly has no named people." },
      },
      required: ["axes", "headline", "identity_note"],
      additionalProperties: false,
    },
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
  let raw = await structured<unknown>(
    system,
    user,
    tool,
    6000,
    firstAttemptTimeoutMs,
  );
  let rejectionReason = "unknown";
  let validated = validateAnalystVerdict(
    raw,
    axisCatalog,
    evidenceCatalog,
    (reason) => { rejectionReason = reason; },
  );
  if (raw && !validated) {
    console.warn(`[agent] rejected incomplete or invalid analyst axis set (${rejectionReason})`);
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
    const repairUser = `${user}\n\nREPAIR REQUIRED: the prior record_verdict tool payload was rejected by ` +
      `deterministic validation with reason "${rejectionReason}". Make one fresh ` +
      `record_verdict call. Recheck the exact axis keys, per-axis score enum, ` +
      `citation eligibility, duplicate aliases, support/counter overlap, and the ` +
      `requirement that any returned coverageRefs have a material gap description. ` +
      `Do not invent evidence or fill a missing fact.`;
    raw = await structured<unknown>(
      system,
      repairUser,
      tool,
      6000,
      ANALYST_REPAIR_TIMEOUT_MS,
    );
    rejectionReason = "unknown";
    validated = validateAnalystVerdict(
      raw,
      axisCatalog,
      evidenceCatalog,
      (reason) => { rejectionReason = reason; },
    );
    if (raw && !validated) {
      console.warn(`[agent] rejected analyst repair axis set (${rejectionReason})`);
    }
  }
  return validated;
}
