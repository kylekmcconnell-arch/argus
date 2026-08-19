// First-pass subject orientation. Grok reads ONLY the bound X handle + the
// official site that belongs to that profile, then answers: what is this, who
// is it for, and is it a product brand, a person, a capital allocator, or
// unknown. Display name is never a bind key. A hallucinated domain is dropped
// to UNKNOWN. This is the last-resort classifier for keyword-free bios.

import {
  grokChat,
  claudeMessages,
  grokUsageFromChat,
} from "../api/_llm";
import { env, providerFallbacksEnabled } from "./config";
import { addClaudeUsage, addGrokUsage } from "./cost";
import type { CollectedEvidence, SubjectOrientation } from "../src/data/evidence";
import { canonicalOfficialWebsite, canonicalPublicProfileWebsite } from "../src/lib/fundScaleEvidence";

const RECENT_ACTIVITY_CAP = 12;
const RECENT_ACTIVITY_ITEM_CHARS = 280;
const WHAT_MAX_CHARS = 240;
const ORIENTATION_TIMEOUT_MS = 20_000;
const ORIENTATION_MAX_TOKENS = 400;

export interface OrientationPacket {
  handle: string;
  profileResolved: boolean;
  profileProvider: string | null;
  bio: string;
  selfPostSample: string;
  recentActivity: string[];
  websiteUrl: string | null;
  websiteHost: string | null;
  websiteTitle: string | null;
  siteExcerpt: string | null;
  sourceUrls: string[];
}

export type OrientationChat = typeof grokChat;

const ORIENTATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["PROJECT", "FOUNDER", "INVESTOR", "UNKNOWN"] },
    what: { type: "string" },
    audience: { type: "string" },
    boundHandle: { type: "string" },
    boundDomain: { type: ["string", "null"] },
    sourceUrls: { type: "array", items: { type: "string" } },
  },
  required: ["kind", "what", "audience", "boundHandle", "boundDomain", "sourceUrls"],
};

const ORIENTATION_SYSTEM = [
  "You may only use the packet. Do not use world knowledge.",
  "Answer: What is this? Who is it for? Is it a product/protocol/company brand (PROJECT), a person who founds or builds (FOUNDER), a capital allocator (INVESTOR), or unknown (UNKNOWN)?",
  "One-sentence what, only from bound artifacts. audience is who it is for, or \"\".",
  "Do not invent a token, contract address, or legal name.",
  "Do not treat display name as identity. The bind keys are the twitterapi handle and the official website host in the packet.",
  "Return boundHandle as the exact packet handle. Return boundDomain only when it is the packet website host; otherwise null.",
  "sourceUrls must be packet URLs you actually used.",
].join(" ");

export function normalizeHandle(value: string): string {
  return value.replace(/^@/, "").trim().toLowerCase();
}

export function looksLikeHandle(value: string): boolean {
  return /^@?[A-Za-z0-9_]{2,30}$/.test(value.trim());
}

export function handlesMatch(left: string, right: string): boolean {
  if (!looksLikeHandle(left) || !looksLikeHandle(right)) return false;
  const a = normalizeHandle(left);
  const b = normalizeHandle(right);
  return a.length > 0 && a === b;
}

export function normalizeDomain(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    const host = raw.replace(/^www\./i, "").toLowerCase().replace(/[/:].*$/, "");
    return host || null;
  }
}

function titleFromExcerpt(excerpt?: string): string | null {
  if (!excerpt) return null;
  const quoted = excerpt.match(/"([^"]{3,160})"/);
  return quoted?.[1]?.trim() || null;
}

function xProfileUrl(handle: string): string {
  return `https://x.com/${normalizeHandle(handle)}`;
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed: unknown = JSON.parse(match[0]);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function oneSentence(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, WHAT_MAX_CHARS);
}

function boundSourceUrls(claimed: unknown, packet: OrientationPacket): string[] {
  const allowed = new Set(packet.sourceUrls.map((url) => url.replace(/\/$/, "").toLowerCase()));
  const claimedUrls = Array.isArray(claimed)
    ? claimed.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  const kept = claimedUrls.filter((url) => allowed.has(url.replace(/\/$/, "").toLowerCase()));
  return kept.length ? [...new Set(kept)] : [...packet.sourceUrls];
}

function unknownOrientation(
  packet: OrientationPacket,
  what: string,
  audience: string,
  sourceUrls: string[],
): SubjectOrientation {
  return {
    kind: "UNKNOWN",
    what,
    audience,
    boundHandle: packet.handle,
    boundDomain: null,
    sourceUrls,
  };
}

export function twitterapiHandleResolved(evidence: CollectedEvidence): boolean {
  return evidence.profile.profile_collection_state === "resolved"
    && evidence.profile.profile_provider === "twitterapi";
}

export function orientationHandleBound(evidence: CollectedEvidence): boolean {
  const orientation = evidence.subjectOrientation;
  if (!orientation?.boundHandle) return false;
  return twitterapiHandleResolved(evidence)
    && handlesMatch(orientation.boundHandle, evidence.profile.handle);
}

export function buildOrientationPacket(
  evidence: CollectedEvidence,
  siteExcerpt?: string,
): OrientationPacket {
  const handle = evidence.profile.handle;
  const official = canonicalOfficialWebsite(evidence.profile.website);
  const publicUrl = canonicalPublicProfileWebsite(evidence.profile.website);
  const websiteUrl = official?.canonicalUrl ?? publicUrl;
  const websiteHost = official?.domain ?? null;
  const excerpt = (siteExcerpt ?? "").trim() || null;
  const sourceUrls: string[] = [];
  if (twitterapiHandleResolved(evidence) && normalizeHandle(handle)) {
    sourceUrls.push(xProfileUrl(handle));
  }
  if (websiteUrl) sourceUrls.push(websiteUrl);
  return {
    handle,
    profileResolved: evidence.profile.profile_collection_state === "resolved",
    profileProvider: evidence.profile.profile_provider ?? null,
    bio: evidence.profile.bio ?? "",
    selfPostSample: (evidence.profile.self_post_sample ?? "").slice(0, 2000),
    recentActivity: (evidence.recentActivity ?? [])
      .slice(0, RECENT_ACTIVITY_CAP)
      .map((text) => text.slice(0, RECENT_ACTIVITY_ITEM_CHARS)),
    websiteUrl,
    websiteHost,
    websiteTitle: titleFromExcerpt(excerpt ?? undefined),
    siteExcerpt: excerpt,
    sourceUrls,
  };
}

export function parseOrientation(raw: unknown, packet: OrientationPacket): SubjectOrientation | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const kindRaw = typeof obj.kind === "string" ? obj.kind.trim().toUpperCase() : "";
  if (kindRaw !== "PROJECT" && kindRaw !== "FOUNDER" && kindRaw !== "INVESTOR" && kindRaw !== "UNKNOWN") {
    return null;
  }
  const what = oneSentence(obj.what);
  const audience = typeof obj.audience === "string" ? obj.audience.replace(/\s+/g, " ").trim() : "";
  const sourceUrls = boundSourceUrls(obj.sourceUrls, packet);
  const claimedHandle = typeof obj.boundHandle === "string" ? obj.boundHandle.trim() : "";
  const namedDomain = normalizeDomain(typeof obj.boundDomain === "string" ? obj.boundDomain : null);

  // A domain Grok named that is not the packet website is a hallucination.
  if (namedDomain && namedDomain !== packet.websiteHost) {
    return unknownOrientation(packet, what, audience, sourceUrls);
  }

  const handleBound = packet.profileResolved
    && packet.profileProvider === "twitterapi"
    && handlesMatch(claimedHandle, packet.handle);
  const domainBound = Boolean(namedDomain && packet.websiteHost && namedDomain === packet.websiteHost);

  if (kindRaw === "UNKNOWN") {
    return unknownOrientation(packet, what, audience, sourceUrls);
  }
  if (!handleBound) {
    return unknownOrientation(packet, what, audience, sourceUrls);
  }
  if (kindRaw === "PROJECT" && !domainBound) {
    return unknownOrientation(packet, what, audience, sourceUrls);
  }
  return {
    kind: kindRaw,
    what,
    audience,
    boundHandle: packet.handle,
    boundDomain: domainBound ? packet.websiteHost : null,
    sourceUrls,
  };
}

async function orientWithClaude(packet: OrientationPacket): Promise<SubjectOrientation | null> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  const result = await claudeMessages({
    key,
    system: ORIENTATION_SYSTEM,
    user: JSON.stringify(packet),
    maxTokens: ORIENTATION_MAX_TOKENS,
    timeoutMs: ORIENTATION_TIMEOUT_MS,
  });
  if (!result.ok) {
    addClaudeUsage(undefined, "subject-orientation", "failed", `http_${result.status}`);
    return null;
  }
  const usage = (result.data as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  addClaudeUsage(usage, "subject-orientation", "succeeded");
  return parseOrientation(result.text, packet);
}

export async function orientSubjectWithGrok(
  evidence: CollectedEvidence,
  options?: { siteExcerpt?: string; chat?: OrientationChat },
): Promise<SubjectOrientation | null> {
  const packet = buildOrientationPacket(evidence, options?.siteExcerpt);
  const chat = options?.chat;
  const key = env("XAI_API_KEY");
  if (!chat && !key) {
    if (!providerFallbacksEnabled()) return null;
    return orientWithClaude(packet);
  }
  const result = await (chat ?? grokChat)({
    key: key || "test",
    system: ORIENTATION_SYSTEM,
    user: JSON.stringify(packet),
    maxTokens: ORIENTATION_MAX_TOKENS,
    timeoutMs: ORIENTATION_TIMEOUT_MS,
    jsonSchema: { name: "subject_orientation", schema: ORIENTATION_SCHEMA },
  });
  if (!chat) {
    if (!result.ok) {
      addGrokUsage(undefined, 0, "subject-orientation", "failed", `http_${result.status}`);
      if (providerFallbacksEnabled()) return orientWithClaude(packet);
      return null;
    }
    addGrokUsage(grokUsageFromChat(result.data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }), 0, "subject-orientation", "succeeded");
  } else if (!result.ok) {
    return null;
  }
  return parseOrientation(result.text, packet);
}
