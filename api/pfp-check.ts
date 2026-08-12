// Legacy/current-intelligence profile-photo integrity panel.
// Fresh reports use the frozen server collector. This route remains for older
// persisted reports, but only accepts a handle and only fetches the official X
// image host returned by twitterapi.io. It is visual triage, not identity proof
// or reverse-image search.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, claudeUsd, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 45 };

const HANDLE = /^[A-Za-z0-9_]{1,30}$/;
const MAX_IMAGE_BYTES = 750_000;
const MIN_IMAGE_BYTES = 256;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const CLASSIFICATIONS = new Set([
  "real_candid",
  "studio_or_stock",
  "ai_generated",
  "celebrity_or_public_figure",
  "logo_or_cartoon",
  "unclear",
]);
const REVIEW_LEADS = new Set(["studio_or_stock", "ai_generated", "celebrity_or_public_figure"]);

interface TwitterUsage { calls: number; succeeded: number; invalidAvatarUrl: boolean }
interface VisionResult {
  classification: string;
  confidence: number;
  isRealPerson: boolean;
  flag: boolean;
  tells: string[];
  note: string;
}

function safeOfficialAvatarUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || (host !== "pbs.twimg.com" && host !== "abs.twimg.com" && !host.endsWith(".twimg.com"))
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
  return total >= MIN_IMAGE_BYTES ? Buffer.concat(chunks, total) : null;
}

function matchesImageSignature(bytes: Buffer, mediaType: string): boolean {
  if (mediaType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mediaType === "image/gif") return bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mediaType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

async function fetchImage(rawUrl: string): Promise<{ media: string; data: string; url: string } | null> {
  let url = safeOfficialAvatarUrl(rawUrl);
  if (!url) return null;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(7_000),
        headers: { "user-agent": "argus-osint/1.0" },
      });
    } catch {
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
      if (!next || redirect === 3) return null;
      url = next;
      continue;
    }
    if (!response.ok) return null;
    const media = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(media)) return null;
    const bytes = await readBoundedImage(response);
    return bytes && matchesImageSignature(bytes, media)
      ? { media, data: bytes.toString("base64"), url: url.toString() }
      : null;
  }
  return null;
}

// Returns null both for an explicit no-photo response and a provider failure;
// callers distinguish those using the observed usage counters.
async function twitterAvatar(handle: string, usage: TwitterUsage): Promise<string | null> {
  const key = process.env.TWITTERAPI_KEY;
  if (!key || !HANDLE.test(handle)) return null;
  usage.calls += 1;
  try {
    const response = await fetch(
      `https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(handle)}`,
      { headers: { "x-api-key": key }, signal: AbortSignal.timeout(7_000) },
    );
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    usage.succeeded += 1;
    const profile = ((body.data && typeof body.data === "object") ? body.data : body) as Record<string, unknown>;
    const legacy = profile.legacy && typeof profile.legacy === "object"
      ? profile.legacy as Record<string, unknown>
      : {};
    const candidate = [
      profile.profilePicture,
      profile.profile_image_url_https,
      profile.profile_image_url,
      profile.profileImage,
      profile.image,
      profile.avatar,
      legacy.profile_image_url_https,
    ].find((value) => typeof value === "string");
    if (typeof candidate !== "string") return null;
    const upgraded = candidate.replace(/_normal(\.\w+)(\?.*)?$/, "$1$2");
    const safe = safeOfficialAvatarUrl(upgraded);
    if (!safe) usage.invalidAvatarUrl = true;
    return safe?.toString() ?? null;
  } catch {
    return null;
  }
}

function validateVisionResult(value: unknown): VisionResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.classification !== "string" || !CLASSIFICATIONS.has(raw.classification)) return null;
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return null;
  if (typeof raw.is_real_person !== "boolean" || typeof raw.flag !== "boolean") return null;
  if (typeof raw.note !== "string" || !raw.note.trim()) return null;
  if (!Array.isArray(raw.tells) || raw.tells.some((tell) => typeof tell !== "string")) return null;
  const conclusive = raw.classification !== "unclear" && raw.confidence >= 0.7;
  return {
    classification: raw.classification,
    confidence: raw.confidence,
    isRealPerson: raw.is_real_person,
    flag: conclusive && REVIEW_LEADS.has(raw.classification),
    tells: raw.tells.map((tell) => String(tell).trim().slice(0, 120)).filter(Boolean).slice(0, 6),
    note: raw.note.trim().slice(0, 500),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelToken = req.headers["x-argus-panel-token"];
  const panelTokenValue = Array.isArray(panelToken) ? panelToken[0] : panelToken;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelTokenValue);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }
  if (typeof req.query.url === "string" && req.query.url.trim()) {
    res.status(400).json({ error: "direct_image_urls_not_supported", message: "ARGUS only inspects the official X avatar resolved from the audited handle." });
    return;
  }
  const handle = typeof req.query.handle === "string" ? req.query.handle.replace(/^@/, "").trim() : "";
  if (!HANDLE.test(handle)) {
    res.status(400).json({ error: "valid_handle_required" });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(200).json({ available: false, note: "Profile-photo integrity screen unavailable (vision analyst is not configured)." });
    return;
  }

  const twitterUsage: TwitterUsage = { calls: 0, succeeded: 0, invalidAvatarUrl: false };
  const officialUrl = await twitterAvatar(handle, twitterUsage);
  if (twitterUsage.calls > 0) {
    await attachPanelCost(auth.organizationId, panelCostVersionId, {
      provider: "twitterapi",
      op: "panel:pfp-avatar",
      calls: twitterUsage.calls,
      usd: twitterUsage.calls * 0.0002,
      meta: "per-request estimate",
      initiatedBy: auth.userId,
      status: twitterUsage.succeeded === twitterUsage.calls ? "succeeded" : twitterUsage.succeeded > 0 ? "partial" : "failed",
    });
  }
  if (twitterUsage.succeeded === 0) {
    res.status(200).json({ available: false, note: "The official X avatar source could not be resolved; no photo conclusion was recorded." });
    return;
  }
  if (twitterUsage.invalidAvatarUrl) {
    res.status(200).json({ available: false, note: "The X provider returned an untrusted avatar URL; no photo conclusion was recorded." });
    return;
  }
  if (!officialUrl) {
    res.status(200).json({
      available: true,
      classification: "no_photo",
      flag: false,
      tells: [],
      note: "The official X profile response contained no custom photo. This does not establish deception or identity.",
    });
    return;
  }

  const image = await fetchImage(officialUrl);
  if (!image) {
    res.status(200).json({ available: false, imageUrl: officialUrl, note: "The official avatar bytes could not be fetched safely; no photo conclusion was recorded." });
    return;
  }

  const cost = { calls: 1, usd: 0, meta: "vision", status: "failed" as "succeeded" | "failed" | "partial" };
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 500,
        system: "Screen this crypto/tech account profile image for visual integrity. This is triage, not identity proof or reverse-image search. Classify only visible properties. A professional headshot or public figure may be legitimate, so those are review leads, never fraud findings. Never identify a person by name.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.media, data: image.data } },
            { type: "text", text: "Classify this profile image with the record_profile_photo tool." },
          ],
        }],
        tools: [{
          name: "record_profile_photo",
          description: "Record a bounded visual profile-image integrity assessment.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              classification: { type: "string", enum: [...CLASSIFICATIONS] },
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
      signal: AbortSignal.timeout(22_000),
    });
    if (!response.ok) {
      res.status(200).json({ available: false, imageUrl: image.url, note: `Vision provider unavailable (${response.status}); no photo conclusion was recorded.` });
      return;
    }
    const body = await response.json() as {
      content?: Array<{ type?: unknown; name?: unknown; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    cost.usd = claudeUsd(body.usage);
    const tool = body.content?.find((item) => item.type === "tool_use" && item.name === "record_profile_photo");
    const result = validateVisionResult(tool?.input);
    cost.status = result ? "succeeded" : "partial";
    if (!result) {
      res.status(200).json({ available: false, imageUrl: image.url, note: "Vision returned an invalid or incomplete result; no photo conclusion was recorded." });
      return;
    }
    res.status(200).json({
      available: true,
      imageUrl: image.url,
      imageData: `data:${image.media};base64,${image.data}`,
      ...result,
      note: `${result.note} Visual classification does not prove image ownership or identity.`,
    });
  } catch {
    res.status(200).json({ available: false, imageUrl: image.url, note: "Profile-photo integrity screen failed; no photo conclusion was recorded." });
  } finally {
    await attachPanelCost(auth.organizationId, panelCostVersionId, {
      provider: "claude",
      op: "panel:pfp-check",
      ...cost,
      initiatedBy: auth.userId,
    });
  }
}
