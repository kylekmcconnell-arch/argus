// Profile-photo forensics. GET /api/pfp-check?handle=<x_handle>  |  ?url=<image>
//
// A founder's face is the thing they can't easily fake, so it fails in telling
// ways: an AI-generated face, a stock headshot, a celebrity, or a logo standing in
// for a "real person" are all strong scam tells. Claude vision classifies the
// profile photo so a supposedly-real founder fronted by a GAN face gets flagged.
// Gated on ANTHROPIC_API_KEY (reuses the OCR pattern). Read-only.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 45 };

const HANDLE = /^[A-Za-z0-9_]{1,30}$/;

async function fetchImage(url: string): Promise<{ media: string; data: string } | null> {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(7000), headers: { "user-agent": "argus-osint/1.0" } });
    if (!r.ok) return null;
    const media = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!/^image\//.test(media)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 256 || buf.length > 4_500_000) return null; // skip empty/placeholder or oversized
    return { media, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

// twitterapi.io gives the real X avatar URL when unavatar can't resolve one.
// Field name varies, so check the common ones (+ nested legacy).
async function twitterAvatar(handle: string): Promise<string | null> {
  const key = process.env.TWITTERAPI_KEY;
  if (!key || !HANDLE.test(handle)) return null;
  try {
    const r = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(handle)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const p = d?.data ?? d ?? {};
    const u = p.profilePicture || p.profile_image_url_https || p.profile_image_url || p.profileImage || p.image || p.avatar || p?.legacy?.profile_image_url_https;
    // twitter's "_normal" suffix is a 48px thumbnail; request the original.
    return typeof u === "string" && /^https?:\/\//.test(u) ? u.replace(/_normal(\.\w+)(\?.*)?$/, "$1") : null;
  } catch {
    return null;
  }
}

// Resolve a usable avatar image, trying every source with one retry each — the
// providers (unavatar especially) are intermittently flaky.
async function resolveAvatar(handle: string, urlParam: string): Promise<{ img: { media: string; data: string }; url: string } | null> {
  const urls: string[] = [];
  if (urlParam) urls.push(urlParam);
  const tw = await twitterAvatar(handle);
  if (tw) urls.push(tw);
  if (handle && HANDLE.test(handle)) urls.push(`https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false`, `https://unavatar.io/twitter/${encodeURIComponent(handle)}?fallback=false`);
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const img = await fetchImage(url);
      if (img) return { img, url };
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.ANTHROPIC_API_KEY;
  const handle = typeof req.query.handle === "string" ? req.query.handle.replace(/^@/, "").trim() : "";
  const urlParam = typeof req.query.url === "string" ? req.query.url : "";
  const imageUrl = urlParam || (HANDLE.test(handle) ? `https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false` : "");
  if (!imageUrl) { res.status(400).json({ error: "handle or url required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Photo check unavailable (no analyst key)." }); return; }

  const resolved = await resolveAvatar(handle, imageUrl);
  const img = resolved?.img ?? null;
  const usedUrl = resolved?.url ?? imageUrl;
  if (!img) { res.status(200).json({ available: true, imageUrl: usedUrl, classification: "no_photo", flag: false, note: "No profile photo found (default avatar or unreachable). An anonymous project with no face is a soft flag on its own." }); return; }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 500,
        system:
          "You are a due-diligence analyst examining a crypto/tech founder's PROFILE PICTURE. Classify what it most likely is and flag anything that undercuts a claim of being a real, individual founder. " +
          "classification is one of: real_candid (a genuine personal photo of a real individual), studio_or_stock (a polished headshot that looks like stock or a generic professional photo), ai_generated (a synthetic/GAN face — look for tells: mismatched or single earrings, warped glasses, melted backgrounds, irregular teeth/ears, unnatural hair strands, asymmetric eyes), celebrity_or_public_figure (a recognizable famous person used as an avatar), logo_or_cartoon (a logo, mascot, illustration, or non-human image), or unclear. " +
          "flag = true if the photo undercuts a real-founder claim (ai_generated, studio_or_stock, celebrity_or_public_figure), else false. " +
          "Reply with ONLY compact JSON: {\"classification\":\"...\",\"confidence\":0.0,\"is_real_person\":true,\"flag\":true,\"tells\":[\"...\"],\"note\":\"one sentence\"}. Never invent a specific identity; describe what you see.",
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: img.media, data: img.data } }, { type: "text", text: "Classify this profile photo and flag anything suspicious for a supposedly real founder." }] }],
      }),
      signal: AbortSignal.timeout(22000),
    });
    if (!r.ok) { res.status(200).json({ available: true, imageUrl: usedUrl, note: `vision ${r.status}` }); return; }
    const d = (await r.json()) as any;
    const text = (d.content ?? []).map((b: any) => b.text ?? "").join(" ");
    const m = text.match(/\{[\s\S]*\}/);
    let parsed: any = {};
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }
    res.status(200).json({
      available: true,
      imageUrl: usedUrl,
      // We already hold the image bytes (they were sent to vision) — ship them as
      // a data URI so the client never re-fetches unavatar, which is flaky and
      // was leaving the thumbnail blank.
      imageData: `data:${img.media};base64,${img.data}`,
      classification: typeof parsed.classification === "string" ? parsed.classification : "unclear",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      isRealPerson: parsed.is_real_person !== false,
      flag: parsed.flag === true,
      tells: Array.isArray(parsed.tells) ? parsed.tells.filter((t: any) => typeof t === "string").slice(0, 6) : [],
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    });
  } catch (e) {
    res.status(200).json({ available: true, imageUrl, error: String(e), note: "Photo check failed." });
  }
}
