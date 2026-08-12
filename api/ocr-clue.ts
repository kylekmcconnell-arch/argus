// Screenshot -> clues. POST /api/ocr-clue  body: { image: "<base64 or data URL>" }
// Claude vision reads a screenshot for crypto identity clues — full or partial
// wallet addresses, ENS/basename/.sol names, and @handles — so the find-wallet
// flow can resolve them. Gated on ANTHROPIC_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST an { image } body" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ clues: [], note: "vision unavailable (no analyst key)" }); return; }

  const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const image: string = typeof raw?.image === "string" ? raw.image : "";
  let media = "image/png";
  let data = image;
  const m = image.match(/^data:(image\/[a-zA-Z]+);base64,([\s\S]*)$/);
  if (m) { media = m[1]; data = m[2]; }
  if (!data || data.length < 32) { res.status(400).json({ error: "image (base64 or data URL) required" }); return; }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 600,
        system:
          "You extract crypto identity clues from a screenshot. Find every: full or PARTIAL wallet address (EVM 0x… or Solana base58, including truncated forms shown with an ellipsis like 0x71C0…A04e), ENS/basename/.sol name, and X/Twitter @handle that is VISIBLE in the image. " +
          "Copy partial addresses verbatim, exactly as shown (keep the ellipsis). Reply with ONLY compact JSON: {\"clues\":[\"...\"]}. If none are visible, {\"clues\":[]}. Do not invent.",
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media, data } }, { type: "text", text: "Extract every wallet address, ENS/.sol name, and @handle visible." }] }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) { res.status(200).json({ clues: [], note: `vision ${r.status}` }); return; }
    const d = (await r.json()) as any;
    const text = (d.content ?? []).map((b: any) => b.text ?? "").join(" ");
    const jm = text.match(/\{[\s\S]*\}/);
    let clues: string[] = [];
    if (jm) { try { clues = (JSON.parse(jm[0]).clues ?? []).filter((c: any) => typeof c === "string" && c.trim()).slice(0, 12); } catch { /* */ } }
    res.status(200).json({ clues });
  } catch (e) {
    res.status(200).json({ clues: [], error: String(e) });
  }
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
