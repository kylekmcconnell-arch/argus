// TEMPORARY: confirms the current xAI Responses API + tools format works
// (model name, tool types, response shape). Returns shape + a text preview only.
// Delete after use.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.XAI_API_KEY;
  const model = process.env.ARGUS_GROK_MODEL || "grok-4-fast";
  const q = String(req.query.q ?? "What companies or projects did Anatoly Yakovenko co-found? Search the web.");
  const out: Record<string, unknown> = { hasKey: !!key, model };
  if (!key) { res.status(200).json({ ...out, error: "no key" }); return; }
  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, input: [{ role: "user", content: q }], tools: [{ type: "web_search" }, { type: "x_search" }] }),
    });
    const txt = await r.text();
    let j: any = null; try { j = JSON.parse(txt); } catch { /* non-json */ }
    out.status = r.status;
    out.topKeys = j ? Object.keys(j) : null;
    out.apiError = j?.error ?? null;
    out.outputType = Array.isArray(j?.output) ? `array[${j.output.length}]` : typeof j?.output;
    const text =
      j?.output_text ??
      (Array.isArray(j?.output) ? j.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "");
    out.textPreview = (text || "").slice(0, 400);
    if (!text) out.bodyPreview = txt.slice(0, 600);
    res.status(200).json(out);
  } catch (e) { res.status(200).json({ ...out, err: String(e) }); }
}
