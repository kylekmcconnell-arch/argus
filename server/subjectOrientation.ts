// First-pass subject orientation. Grok reads the bound twitterapi packet and
// MAY x_search that exact @handle (and fetch the packet website host only).
// Display name is never a bind key. A hallucinated domain is dropped to
// UNKNOWN. This is the last-resort classifier for keyword-free bios.

import { grokChat } from "../api/_llm";
import { env } from "./config";
import type { CollectedEvidence, SubjectOrientation } from "../src/data/evidence";
import { canonicalOfficialWebsite, canonicalPublicProfileWebsite } from "../src/lib/fundScaleEvidence";
import { grokSearch } from "./adapters/x";

const RECENT_ACTIVITY_CAP = 24;
const RECENT_ACTIVITY_ITEM_CHARS = 500;
const SELF_POST_SAMPLE_CHARS = 6000;
const WHAT_MAX_CHARS = 240;
const QUOTE_MAX_CHARS = 280;
const MENTIONED_HANDLE_CAP = 8;
const ORIENTATION_TIMEOUT_MS = 45_000;
const ORIENTATION_MAX_TOKENS = 800;
const ORIENTATION_MAX_TOOL_CALLS = 3;

export interface OrientationPacket {
  handle: string;
  /** Display name as a label only. Never a bind key. */
  profileName: string | null;
  profileResolved: boolean;
  profileProvider: string | null;
  followers: string | null;
  createdAt: string | null;
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
export type OrientationSearch = typeof grokSearch;

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
    mentionedHandles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          handle: { type: "string" },
          roleHint: { type: "string" },
          quote: { type: "string" },
        },
        required: ["handle", "roleHint", "quote"],
      },
    },
  },
  required: ["kind", "what", "audience", "boundHandle", "boundDomain", "sourceUrls", "mentionedHandles"],
};

const ORIENTATION_SYSTEM = [
  "You have the bound twitterapi packet for this exact subject.",
  "You MAY x_search that exact @handle and fetch the official site host from the packet.",
  "Do not open-web fish other domains or invent handles.",
  "Answer: What is this? Who is it for? Is it a product/protocol/company brand (PROJECT), a person who founds or builds (FOUNDER), a capital allocator (INVESTOR), or unknown (UNKNOWN)?",
  "One-sentence what from the packet plus live X of THIS handle. audience is who it is for, or \"\".",
  "Quote @handles only when they appear in the packet artifacts or in live x_search of THIS subject. Never from a display name alone.",
  "Do not invent a token, contract address, or legal name.",
  "Do not treat display name as identity. The bind keys are the twitterapi handle and the official website host in the packet.",
  "If live X contradicts the packet bind, trust the packet bind keys and treat extra names as quoted mentions only.",
  "Return boundHandle as the exact packet handle. Return boundDomain only when it is the packet website host; otherwise null.",
  "sourceUrls must be packet URLs you actually used.",
  "mentionedHandles: @handles that appear in official posts or live x_search of THIS subject, each with a verbatim quote from that artifact and optional roleHint. Never display-name-only. Empty array if none.",
  "Return only the orientation JSON.",
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

function displayLabel(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed !== "N/A" ? trimmed : null;
}

function parseMentionedHandles(
  raw: unknown,
  packet: OrientationPacket,
): NonNullable<SubjectOrientation["mentionedHandles"]> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const subject = normalizeHandle(packet.handle);
  const seen = new Set<string>();
  const out: NonNullable<SubjectOrientation["mentionedHandles"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const handleRaw = typeof rec.handle === "string" ? rec.handle.trim() : "";
    if (!looksLikeHandle(handleRaw)) continue;
    const key = normalizeHandle(handleRaw);
    if (!key || key === subject || seen.has(key)) continue;
    const quote = typeof rec.quote === "string" ? rec.quote.replace(/\s+/g, " ").trim() : "";
    if (!quote) continue;
    // Unique-id is the @handle. A display-name-only mention, or an invented
    // handle paired with an unrelated quote, is dropped.
    if (!new RegExp(`@${key}\\b`, "i").test(quote)) continue;
    const roleHint = typeof rec.roleHint === "string" ? rec.roleHint.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    seen.add(key);
    out.push({
      handle: `@${key}`,
      ...(roleHint ? { roleHint } : {}),
      quote: quote.slice(0, QUOTE_MAX_CHARS),
    });
    if (out.length >= MENTIONED_HANDLE_CAP) break;
  }
  return out.length ? out : undefined;
}

function unknownOrientation(
  packet: OrientationPacket,
  what: string,
  audience: string,
  sourceUrls: string[],
  mentionedHandles?: SubjectOrientation["mentionedHandles"],
): SubjectOrientation {
  return {
    kind: "UNKNOWN",
    what,
    audience,
    boundHandle: packet.handle,
    boundDomain: null,
    sourceUrls,
    ...(mentionedHandles?.length ? { mentionedHandles } : {}),
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

/** Reverse-role-shaped leads. Unique-id confirmation still required downstream. */
export function orientationMentionLeads(orientation: SubjectOrientation | null | undefined): Array<{
  name: string;
  handle: string;
  role: string;
  kind: "team";
  evidence: string;
  source: string;
  sourceUrl: string;
}> {
  return (orientation?.mentionedHandles ?? []).map((mention) => {
    const handle = mention.handle.startsWith("@") ? mention.handle : `@${mention.handle}`;
    return {
      name: handle,
      handle,
      role: mention.roleHint || "team",
      kind: "team" as const,
      evidence: mention.quote,
      source: "orientation-live-x",
      sourceUrl: `https://x.com/${normalizeHandle(handle)}`,
    };
  });
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
  const recentActivity = (evidence.recentActivity ?? [])
    .slice(0, RECENT_ACTIVITY_CAP)
    .map((text) => text.slice(0, RECENT_ACTIVITY_ITEM_CHARS));
  const sourceUrls: string[] = [];
  if (twitterapiHandleResolved(evidence) && normalizeHandle(handle)) {
    sourceUrls.push(xProfileUrl(handle));
  }
  if (websiteUrl) sourceUrls.push(websiteUrl);
  return {
    handle,
    profileName: displayLabel(evidence.profile.display_name),
    profileResolved: evidence.profile.profile_collection_state === "resolved",
    profileProvider: evidence.profile.profile_provider ?? null,
    followers: displayLabel(evidence.profile.followers),
    createdAt: displayLabel(evidence.profile.account_created_at) ?? displayLabel(evidence.profile.joined),
    bio: evidence.profile.bio ?? "",
    selfPostSample: (evidence.profile.self_post_sample || recentActivity.join(" \n ")).slice(0, SELF_POST_SAMPLE_CHARS),
    recentActivity,
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
  const mentionedHandles = parseMentionedHandles(obj.mentionedHandles, packet);

  // A domain Grok named that is not the packet website is a hallucination.
  if (namedDomain && namedDomain !== packet.websiteHost) {
    return unknownOrientation(packet, what, audience, sourceUrls, mentionedHandles);
  }

  const handleBound = packet.profileResolved
    && packet.profileProvider === "twitterapi"
    && handlesMatch(claimedHandle, packet.handle);
  const domainBound = Boolean(namedDomain && packet.websiteHost && namedDomain === packet.websiteHost);

  if (kindRaw === "UNKNOWN") {
    return unknownOrientation(packet, what, audience, sourceUrls, mentionedHandles);
  }
  if (!handleBound) {
    return unknownOrientation(packet, what, audience, sourceUrls, mentionedHandles);
  }
  if (kindRaw === "PROJECT" && !domainBound) {
    return unknownOrientation(packet, what, audience, sourceUrls, mentionedHandles);
  }
  return {
    kind: kindRaw,
    what,
    audience,
    boundHandle: packet.handle,
    boundDomain: domainBound ? packet.websiteHost : null,
    sourceUrls,
    ...(mentionedHandles?.length ? { mentionedHandles } : {}),
  };
}

function liveSearchUser(packet: OrientationPacket): string {
  const hostRule = packet.websiteHost
    ? `You may fetch or web_search only the official host ${packet.websiteHost}. No open-web fishing.`
    : "No official site host in the packet; do not web_search other domains.";
  return [
    `Bound packet for ${packet.handle}. x_search that exact handle only.`,
    hostRule,
    "Do not invent handles, domains, tokens, contract addresses, or legal names.",
    JSON.stringify(packet),
  ].join("\n");
}

export async function orientSubjectWithGrok(
  evidence: CollectedEvidence,
  options?: { siteExcerpt?: string; chat?: OrientationChat; search?: OrientationSearch },
): Promise<SubjectOrientation | null> {
  const packet = buildOrientationPacket(evidence, options?.siteExcerpt);
  const chat = options?.chat;
  const key = env("XAI_API_KEY");

  // Packet-only test double. Production always uses Responses API + x_search.
  if (chat) {
    const result = await chat({
      key: key || "test",
      system: ORIENTATION_SYSTEM,
      user: JSON.stringify(packet),
      maxTokens: ORIENTATION_MAX_TOKENS,
      timeoutMs: ORIENTATION_TIMEOUT_MS,
      jsonSchema: { name: "subject_orientation", schema: ORIENTATION_SCHEMA },
    });
    if (!result.ok) return null;
    return parseOrientation(result.text, packet);
  }

  if (!key) return null;

  const search = options?.search ?? grokSearch;
  const text = await search(ORIENTATION_SYSTEM, liveSearchUser(packet), {
    maxToolCalls: ORIENTATION_MAX_TOOL_CALLS,
    cacheKey: `subject-orientation:${normalizeHandle(packet.handle)}`,
  });
  if (!text) return null;
  return parseOrientation(text, packet);
}
