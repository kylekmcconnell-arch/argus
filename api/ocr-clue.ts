// Screenshot -> clues. POST /api/ocr-clue  body: { image: "<base64 or data URL>" }
// Grok vision reads a screenshot for crypto identity clues — full or partial
// wallet addresses, ENS/basename/.sol names, and @handles — so the find-wallet
// flow can resolve them. Gated on XAI_API_KEY; Claude is fallback-only.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { claudeVision, grokVision, parseJsonObject, providerFallbacksEnabled } from "./_llm";

export const config = { maxDuration: 30 };

const SYSTEM =
  "You extract crypto identity clues from a screenshot. Find every: full or PARTIAL wallet address (EVM 0x… or Solana base58, including truncated forms shown with an ellipsis like 0x71C0…A04e), ENS/basename/.sol name, and X/Twitter @handle that is VISIBLE in the image. " +
  "Copy partial addresses verbatim, exactly as shown (keep the ellipsis). Reply with ONLY compact JSON: {\"clues\":[\"...\"]}. If none are visible, {\"clues\":[]}. Do not invent.";
const USER = "Extract every wallet address, ENS/.sol name, and @handle visible.";

function cluesFromText(text: string): string[] {
  const parsed = parseJsonObject(text);
  const raw = parsed?.clues;
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string" && c.trim()).slice(0, 12) : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST an { image } body" }); return; }
  const xai = process.env.XAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!xai && !(providerFallbacksEnabled() && anthropic)) {
    res.status(200).json({ clues: [], note: "vision unavailable (no analyst key)" });
    return;
  }

  const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const image: string = typeof raw?.image === "string" ? raw.image : "";
  let media = "image/png";
  let data = image;
  const m = image.match(/^data:(image\/[a-zA-Z]+);base64,([\s\S]*)$/);
  if (m) { media = m[1]; data = m[2]; }
  if (!data || data.length < 32) { res.status(400).json({ error: "image (base64 or data URL) required" }); return; }

  try {
    if (xai) {
      const grok = await grokVision({
        key: xai, system: SYSTEM, text: USER, mediaType: media, imageBase64: data,
        maxTokens: 600, timeoutMs: 25000,
      });
      if (grok.ok) {
        res.status(200).json({ clues: cluesFromText(grok.text) });
        return;
      }
      if (!providerFallbacksEnabled() || !anthropic) {
        res.status(200).json({ clues: [], note: `vision ${grok.status || "failed"}` });
        return;
      }
    }
    const claude = await claudeVision({
      key: anthropic!, system: SYSTEM, text: USER, mediaType: media, imageBase64: data,
      maxTokens: 600, timeoutMs: 25000,
    });
    if (!claude.ok) { res.status(200).json({ clues: [], note: `vision ${claude.status || "failed"}` }); return; }
    res.status(200).json({ clues: cluesFromText(claude.text) });
  } catch (e) {
    res.status(200).json({ clues: [], error: String(e) });
  }
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
