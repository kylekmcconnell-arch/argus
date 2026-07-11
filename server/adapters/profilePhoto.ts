import { createHash } from "node:crypto";
import { ANALYST_MODEL, env } from "../config";
import { addClaudeUsage, recordCall } from "../cost";
import type {
  ProfileAuthenticityResult,
  ProfilePhotoClassification,
  SourceArtifact,
} from "../../src/data/evidence";
import type { CollectContext } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_IMAGE_BYTES = 750_000;
const MIN_IMAGE_BYTES = 256;
const MIN_ACTIONABLE_CONFIDENCE = 0.7;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const CLASSIFICATIONS = new Set<ProfilePhotoClassification>([
  "real_candid",
  "studio_or_stock",
  "ai_generated",
  "celebrity_or_public_figure",
  "logo_or_cartoon",
  "no_photo",
  "unclear",
]);
const REVIEW_LEADS = new Set<ProfilePhotoClassification>([
  "studio_or_stock",
  "ai_generated",
  "celebrity_or_public_figure",
]);

export interface ProfilePhotoAttempt {
  status: "succeeded" | "partial" | "failed";
  detail: string;
}

export interface TrustedImage {
  bytes: Buffer;
  mediaType: string;
  url: string;
  contentHash: string;
}

interface VisionInput {
  classification?: unknown;
  confidence?: unknown;
  is_real_person?: unknown;
  flag?: unknown;
  tells?: unknown;
  note?: unknown;
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function safeOfficialAvatarUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "pbs.twimg.com" || host === "abs.twimg.com" || host.endsWith(".twimg.com");
    if (
      url.protocol !== "https:"
      || !allowedHost
      || url.username
      || url.password
      || (url.port && url.port !== "443")
    ) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function readBoundedImage(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  if (total < MIN_IMAGE_BYTES) return null;
  return Buffer.concat(chunks, total);
}

function matchesImageSignature(bytes: Buffer, mediaType: string): boolean {
  if (mediaType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mediaType === "image/gif") return bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mediaType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function fetchTrustedProfileImage(rawUrl: string): Promise<TrustedImage | null> {
  let url = safeOfficialAvatarUrl(rawUrl);
  if (!url) {
    recordCall("x-avatar", "image-fetch", 0, "unsafe_or_untrusted_url", "failed");
    return null;
  }
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(7_000),
        headers: { "user-agent": "argus-osint/1.0" },
      });
    } catch {
      recordCall("x-avatar", "image-fetch", 0, "transport_error", "failed");
      return null;
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      let next: URL | null;
      try {
        next = location ? safeOfficialAvatarUrl(new URL(location, url).toString()) : null;
      } catch {
        next = null;
      }
      if (!next || redirect === 3) {
        recordCall("x-avatar", "image-fetch", 0, "unsafe_or_excessive_redirect", "failed");
        return null;
      }
      url = next;
      continue;
    }
    if (!response.ok) {
      recordCall("x-avatar", "image-fetch", 0, `http_${response.status}`, "failed");
      return null;
    }
    const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mediaType)) {
      recordCall("x-avatar", "image-fetch", 0, "unsupported_content_type", "failed");
      return null;
    }
    const bytes = await readBoundedImage(response);
    if (!bytes || !matchesImageSignature(bytes, mediaType)) {
      recordCall("x-avatar", "image-fetch", 0, "empty_oversized_or_invalid_image", "failed");
      return null;
    }
    recordCall("x-avatar", "image-fetch", 0, `${bytes.length} bytes`, "succeeded");
    return { bytes, mediaType, url: url.toString(), contentHash: sha256(bytes) };
  }
  return null;
}

function validateVisionInput(value: unknown): Omit<ProfileAuthenticityResult, "provider" | "capturedAt" | "imageUrl" | "imageContentHash"> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as VisionInput;
  if (typeof raw.classification !== "string" || !CLASSIFICATIONS.has(raw.classification as ProfilePhotoClassification)) return null;
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return null;
  if (typeof raw.is_real_person !== "boolean" || typeof raw.flag !== "boolean") return null;
  if (typeof raw.note !== "string" || !raw.note.trim()) return null;
  if (!Array.isArray(raw.tells) || raw.tells.some((tell) => typeof tell !== "string")) return null;
  const classification = raw.classification as ProfilePhotoClassification;
  return {
    classification,
    confidence: raw.confidence,
    isRealPerson: raw.is_real_person,
    // Classification drives the product signal; a contradictory model boolean
    // cannot silently clear or manufacture a finding.
    flag: REVIEW_LEADS.has(classification),
    tells: raw.tells.map((tell) => String(tell).trim().slice(0, 120)).filter(Boolean).slice(0, 6),
    note: raw.note.trim().slice(0, 500),
  };
}

async function classifyImage(image: TrustedImage): Promise<ReturnType<typeof validateVisionInput>> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYST_MODEL,
        max_tokens: 500,
        system:
          "You are screening a crypto/tech account's profile image for due diligence. This is visual triage, not identity proof and not reverse-image search. Classify only what is visible. A professional headshot or public figure may be legitimate, so those are review leads rather than fraud findings. Never identify a person by name.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.bytes.toString("base64") } },
            { type: "text", text: "Classify the profile image and list concrete visible tells. Use the record_profile_photo tool." },
          ],
        }],
        tools: [{
          name: "record_profile_photo",
          description: "Record a bounded visual profile-image integrity assessment.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              classification: { type: "string", enum: [...CLASSIFICATIONS].filter((value) => value !== "no_photo") },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              is_real_person: { type: "boolean" },
              flag: { type: "boolean" },
              tells: { type: "array", maxItems: 6, items: { type: "string" } },
              note: { type: "string" },
            },
            required: ["classification", "confidence", "is_real_person", "flag", "tells", "note"],
          },
        }],
        tool_choice: { type: "tool", name: "record_profile_photo" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    addClaudeUsage(undefined, "profile-photo-integrity", "failed", "transport_error");
    return null;
  }
  if (!response.ok) {
    addClaudeUsage(undefined, "profile-photo-integrity", "failed", `http_${response.status}`);
    return null;
  }
  let body: {
    content?: Array<{ type?: unknown; name?: unknown; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    body = await response.json() as typeof body;
  } catch {
    addClaudeUsage(undefined, "profile-photo-integrity", "failed", "response_json_error");
    return null;
  }
  const tool = body.content?.find((item) => item.type === "tool_use" && item.name === "record_profile_photo");
  const parsed = validateVisionInput(tool?.input);
  addClaudeUsage(
    body.usage,
    "profile-photo-integrity",
    parsed ? "succeeded" : "partial",
    parsed ? undefined : "invalid_tool_result",
  );
  return parsed;
}

function addArtifact(ctx: CollectContext, artifact: SourceArtifact): void {
  const exists = ctx.evidence.sourceArtifacts.some((candidate) =>
    candidate.kind === artifact.kind && candidate.contentHash === artifact.contentHash,
  );
  if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
}

export async function collectProfilePhoto(ctx: CollectContext): Promise<ProfilePhotoAttempt> {
  const capturedAt = new Date().toISOString();
  const profileUrl = `https://x.com/${encodeURIComponent(ctx.handle.replace(/^@/, ""))}`;

  if (ctx.evidence.profile.avatar_source_state === "none") {
    const result: ProfileAuthenticityResult = {
      provider: "twitterapi",
      capturedAt,
      classification: "no_photo",
      flag: false,
      tells: [],
      note: "The official X profile response contained no custom profile image. This is not proof of deception or identity.",
    };
    ctx.evidence.profileAuthenticity = result;
    addArtifact(ctx, {
      kind: "profile_photo",
      provider: "twitterapi",
      title: "Official X profile-photo presence screen",
      sourceUrl: profileUrl,
      capturedAt,
      contentHash: sha256(JSON.stringify(result)),
      excerpt: result.note,
      match: "screened_clear",
    });
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "checked-empty",
      note: "official X profile response contained no custom photo; visual ownership/reuse was not testable",
      provider: "twitterapi.io",
    });
    return { status: "succeeded", detail: "official profile returned no custom photo" };
  }

  if (!env("ANTHROPIC_API_KEY")) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "profile-photo integrity screen is unavailable because the vision analyst is not configured",
      provider: "claude-vision",
    });
    return { status: "failed", detail: "vision analyst is not configured" };
  }

  const avatarUrl = ctx.evidence.profile.avatar_url;
  if (!avatarUrl) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "official X avatar source was not resolved; no photo conclusion was recorded",
      provider: "twitterapi.io",
    });
    return { status: "failed", detail: "official avatar source unavailable" };
  }

  const image = await fetchTrustedProfileImage(avatarUrl);
  if (!image) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "official X avatar bytes could not be fetched safely; no photo conclusion was recorded",
      provider: "x-avatar",
    });
    return { status: "failed", detail: "trusted avatar fetch failed" };
  }

  const classified = await classifyImage(image);
  if (!classified) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "vision provider failed or returned an invalid profile-photo result",
      provider: "claude-vision",
    });
    return { status: "failed", detail: "vision result unavailable or invalid" };
  }

  const conclusive = classified.classification !== "unclear"
    && (classified.confidence ?? 0) >= MIN_ACTIONABLE_CONFIDENCE;
  const result: ProfileAuthenticityResult = {
    provider: "claude-vision",
    capturedAt,
    imageUrl: image.url,
    imageData: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
    mediaType: image.mediaType as ProfileAuthenticityResult["mediaType"],
    imageContentHash: image.contentHash,
    ...classified,
    flag: conclusive && classified.flag,
    note: [
      classified.note,
      classified.classification === "real_candid"
        ? "A visually plausible personal photo does not prove ownership or identity."
        : classified.classification === "studio_or_stock"
          ? "A professional headshot can be legitimate; treat this only as a review lead."
          : classified.classification === "celebrity_or_public_figure"
            ? "A public figure may legitimately use their own image; verify identity before drawing a conclusion."
            : classified.classification === "ai_generated"
              ? "This is a vision-model lead and requires human or reverse-image verification."
              : "Visual classification does not establish who owns or originally published the image.",
    ].join(" ").slice(0, 700),
  };
  ctx.evidence.profileAuthenticity = result;

  const artifactRecord = {
    imageContentHash: image.contentHash,
    model: ANALYST_MODEL,
    classification: result.classification,
    confidence: result.confidence,
    flag: result.flag,
    tells: result.tells,
    note: result.note,
  };
  const artifactHash = sha256(JSON.stringify(artifactRecord));
  addArtifact(ctx, {
    kind: "profile_photo",
    provider: "claude-vision",
    title: "Profile-photo integrity screen",
    sourceUrl: image.url,
    capturedAt,
    contentHash: artifactHash,
    sourceContentHash: image.contentHash,
    excerpt: `${result.classification.replace(/_/g, " ")} · ${result.note}`,
    match: conclusive && result.flag ? "risk_signal" : conclusive ? "observed" : "candidate",
  });

  if (!conclusive) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: `vision result was ${result.classification} at ${Math.round((result.confidence ?? 0) * 100)}% confidence; no clean conclusion recorded`,
      provider: "claude-vision",
      sourceCount: 1,
    });
    return { status: "partial", detail: "vision result was inconclusive" };
  }

  ctx.recordCheck?.({
    id: "profile-photo-authenticity",
    status: result.flag ? "finding" : "checked-empty",
    note: result.flag
      ? `${result.classification.replace(/_/g, " ")} review lead at ${Math.round((result.confidence ?? 0) * 100)}% model confidence; not identity proof`
      : `${result.classification.replace(/_/g, " ")} observed; visual-only screen cannot prove image ownership or identity`,
    provider: "claude-vision",
    sourceCount: 1,
  });
  return { status: "succeeded", detail: `${result.classification} at ${Math.round((result.confidence ?? 0) * 100)}%` };
}
