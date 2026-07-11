// Claude analyst agent. The engine needs axis scores with rationales, venture
// outcome classifications, and a one-line headline. Raw provider data is messy;
// this is the step where judgement lives. We force structured output via a tool
// so the model returns validated JSON, never prose.
//
// Gated on ANTHROPIC_API_KEY. With no key, callers fall back to heuristics.

import { ANALYST_MODEL, env } from "./config";
import { addClaudeUsage } from "./cost";
import type { Contradiction } from "../src/data/evidence";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export function analystAvailable(): boolean {
  return !!env("ANTHROPIC_API_KEY");
}

interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// Calls the Anthropic Messages API and forces a single tool call, returning the
// tool input as the structured result. Returns null on any failure.
export async function structured<T>(
  system: string,
  user: string,
  tool: ToolSchema,
  maxTokens = 2048,
): Promise<T | null> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYST_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      }),
    });
  } catch (e) {
    addClaudeUsage(undefined, tool.name, "failed", "transport_error");
    console.error("[agent] request failed", e);
    return null;
  }
  if (!res.ok) {
    addClaudeUsage(undefined, tool.name, "failed", `http_${res.status}`);
    let detail = "";
    try { detail = await res.text(); } catch { /* response detail is diagnostic only */ }
    console.error("[agent] anthropic error", res.status, detail);
    return null;
  }

  let data: {
    content?: { type: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch (e) {
    addClaudeUsage(undefined, tool.name, "failed", "response_json_error");
    console.error("[agent] response parse failed", e);
    return null;
  }
  const block = Array.isArray(data.content)
    ? data.content.find((candidate) => candidate.type === "tool_use" && candidate.name === tool.name && candidate.input != null)
    : undefined;
  addClaudeUsage(
    data.usage,
    tool.name,
    block ? "succeeded" : "partial",
    block ? undefined : "missing_tool_use",
  );
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

export async function scanContradictions(handle: string, evidenceJson: string): Promise<Contradiction[] | null> {
  const system =
    "You are ARGUS contradiction analysis. From everything collected about a subject, find INTERNAL CONTRADICTIONS: where the subject's own stated claims conflict with each other or with the collected evidence. " +
    "Examples: claims a team of N but only one builder is found; claims an audit but no auditor or verification exists; claims a named backer who never acknowledges them; a stated launch/founding date that conflicts with the account age, domain age, or on-chain history; claims 'doxxed' but no real identity resolves; claims locked liquidity that on-chain shows unlocked; a partnership the partner never confirmed; a venture in the bio that discovery found no evidence for. " +
    "Be STRICT and grounded: report ONLY genuine contradictions, each with the EXACT claim and the EXACT conflicting fact from the evidence. A missing or unverifiable data point is a GAP, not a contradiction; never report gaps, and never invent. If there are none, return an empty list. Never use em dashes. " +
    "SCOPE RULES — these are NOT contradictions: (1) ARGUS's OWN analysis metadata (fields like identity_confidence, identity_note, verdicts, evidence notes such as 'single-source lead, unverified') disagreeing with other ARGUS fields — only the SUBJECT's outward claims vs external facts count; a low-confidence evidence note is a gap, not a conflict. (2) Normal vertical integration: a project's token running on its own chain, its dApp on its own platform, or its products naming each other is how ecosystems work, not circularity. (3) Marketing self-description ('#1', 'leading') vs modest traction is puffery to note in scoring, not a contradiction, unless it conflicts with a specific verifiable fact.";
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
  const r = await structured<{ contradictions: { claim: string; conflict: string; severity: string; confidence: string }[] }>(system, user, tool, 2048);
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
  axes: { axis: string; score: number; rationale: string }[];
  headline: string;
  identity_note: string;
}

export interface AnalystAxis {
  axis: string;
  weight: number;
  role: string;
}

// Tool schemas constrain the shape Claude is asked to return, but provider
// responses are still untrusted input. An analyst result is usable only when it
// contains one (and only one) finite, in-range score for every requested axis.
// Returning null is deliberate: callers must publish INCOMPLETE rather than
// silently treating a missing axis as zero or retaining stale seeded scores.
export function validateAnalystVerdict(
  value: unknown,
  axisCatalog: AnalystAxis[],
): AnalystVerdict | null {
  if (!value || typeof value !== "object" || !axisCatalog.length) return null;
  const raw = value as Partial<AnalystVerdict>;
  if (!Array.isArray(raw.axes) || raw.axes.length !== axisCatalog.length) return null;
  if (typeof raw.headline !== "string" || typeof raw.identity_note !== "string") return null;

  const expected = new Map<string, AnalystAxis>();
  for (const spec of axisCatalog) {
    if (!spec.axis || expected.has(spec.axis) || !Number.isFinite(spec.weight) || spec.weight < 0) return null;
    expected.set(spec.axis, spec);
  }

  const seen = new Map<string, { axis: string; score: number; rationale: string }>();
  for (const candidate of raw.axes as unknown[]) {
    if (!candidate || typeof candidate !== "object") return null;
    const row = candidate as { axis?: unknown; score?: unknown; rationale?: unknown };
    if (typeof row.axis !== "string" || typeof row.score !== "number" || typeof row.rationale !== "string") return null;
    const spec = expected.get(row.axis);
    if (!spec || seen.has(row.axis) || !Number.isFinite(row.score) || row.score < 0 || row.score > spec.weight) return null;
    seen.set(row.axis, { axis: row.axis, score: row.score, rationale: row.rationale.trim() });
  }
  if (seen.size !== expected.size) return null;

  return {
    // Canonical order makes downstream completeness checks and snapshots stable.
    axes: axisCatalog.map((spec) => seen.get(spec.axis)!),
    headline: raw.headline.trim(),
    identity_note: raw.identity_note.trim(),
  };
}

export const ANALYST_EVIDENCE_MAX_CHARS = 24_000;

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
  };
};

/**
 * Serialize evidence without ever truncating JSON text. Each section is capped
 * structurally and the packet records coverage, with findings receiving first
 * priority. If the packet is still large, low-priority items are removed whole;
 * the returned string therefore always parses and never cuts a finding in half.
 */
export function buildAnalystEvidencePacket(input: Record<string, unknown>): string {
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
  };
  const findingsRaw = Array.isArray(input.findings) ? input.findings : [];
  const findings = findingsRaw.slice(0, 24).map(compactFinding).filter((f): f is Record<string, unknown> => !!f);
  const coverage: Record<string, { available: number; included: number }> = {
    findings: { available: findingsRaw.length, included: findings.length },
  };
  const packet: Record<string, unknown> = {
    schema_version: 1,
    coverage,
    profile: compactObject(input.profile),
    // Findings stay ahead of descriptive context in the budget. This prevents a
    // long social corpus from hiding the material facts that govern a verdict.
    findings,
  };

  for (const [section, limit] of Object.entries(sectionLimits)) {
    const source = Array.isArray(input[section]) ? input[section] as unknown[] : [];
    const included = source.slice(0, limit).map((item) => compactObject(item)).filter((item) => item !== undefined);
    packet[section] = included;
    coverage[section] = { available: source.length, included: included.length };
  }

  const pruneOrder = ["recentActivity", "notableFollowers", "wallets", "promotions", "advised", "testimonials", "ventures", "team", "providerRuns", "checkOutcomes", "sourceArtifacts"];
  let json = JSON.stringify(packet);
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    const section = pruneOrder.find((key) => Array.isArray(packet[key]) && (packet[key] as unknown[]).length > 0);
    if (!section) break;
    (packet[section] as unknown[]).pop();
    coverage[section].included = (packet[section] as unknown[]).length;
    json = JSON.stringify(packet);
  }
  // Pathological inputs can fill the entire budget with findings alone. Remove
  // complete lowest-priority rows, never bytes, and disclose the omitted count.
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 1) {
    findings.pop();
    coverage.findings.included = findings.length;
    json = JSON.stringify(packet);
  }
  return json;
}

export async function analyzeSubject(
  handle: string,
  roles: string[],
  axisCatalog: AnalystAxis[],
  evidenceJson: string,
): Promise<AnalystVerdict | null> {
  if (!axisCatalog.length) return null;
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
    `as unresolved when the evidence genuinely names no one behind the project.`;
  const tool: ToolSchema = {
    name: "record_verdict",
    description: "Record the per-axis scores, headline, and identity note.",
    input_schema: {
      type: "object",
      properties: {
        axes: {
          type: "array",
          minItems: axisCatalog.length,
          maxItems: axisCatalog.length,
          items: {
            type: "object",
            properties: {
              axis: { type: "string", enum: axisCatalog.map((a) => a.axis) },
              score: { type: "number", minimum: 0, maximum: Math.max(...axisCatalog.map((a) => a.weight)) },
              rationale: { type: "string" },
            },
            required: ["axis", "score", "rationale"],
          },
        },
        headline: { type: "string" },
        identity_note: { type: "string", description: "Identity resolution. Distinguish the ACCOUNT OPERATOR from the project's TEAM: if named team members are present in the evidence (especially with a LinkedIn), acknowledge them by name and do NOT claim 'no linked real-world identity' or 'zero credentials' — instead say the account/operator is pseudonymous while N named people are publicly tied to the project (list a few). Only say no one is identified if the evidence truly has no named people." },
      },
      required: ["axes", "headline", "identity_note"],
    },
  };
  const raw = await structured<unknown>(system, user, tool, 3000);
  const validated = validateAnalystVerdict(raw, axisCatalog);
  if (raw && !validated) console.warn("[agent] rejected incomplete or invalid analyst axis set");
  return validated;
}
