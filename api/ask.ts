// Ask-the-report. POST /api/ask  { subject, question, context }
//
// A scoped chat over a finished report: the analyst asks "why didn't you connect
// this to @foo?" or "what's the strongest red flag here?" and ARGUS answers from
// the report's own evidence. Grounded — it never invents facts not in the context,
// and when the analyst asks why two things aren't linked it explains what evidence
// would be needed and, if it plausibly should be, points them at the hard-link tool.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 25 };

const s = (v: unknown) => (typeof v === "string" ? v : "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST required" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) ?? {};
  const subject = s(body.subject).slice(0, 120);
  const question = s(body.question).trim().slice(0, 500);
  const context = s(body.context).slice(0, 8000);
  if (!question) { res.status(400).json({ error: "question required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Claude not configured." }); return; }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 600,
        system:
          "You are ARGUS, a crypto due-diligence engine, answering an analyst's question ABOUT a report you produced. " +
          "Answer ONLY from the report context provided plus general, well-established public knowledge you are highly confident in — NEVER invent specific facts (wallets, dates, deals, holdings) that are not in the context. " +
          "If asked why two things weren't connected, explain what evidence would be needed to link them and whether the context supports it; if it plausibly SHOULD be connected, say so and tell the analyst to use the 'Link to another entity' tool to add the connection. " +
          "Be concise, direct, and specific. If the context doesn't contain enough to answer, say exactly what is missing rather than guessing.",
        messages: [{ role: "user", content: `Subject: ${subject || "(this report)"}\n\nReport context:\n${context || "(no structured context was provided)"}\n\nAnalyst question: ${question}` }],
      }),
      signal: AbortSignal.timeout(24000),
    });
    if (!r.ok) { res.status(200).json({ available: true, note: `claude ${r.status}` }); return; }
    const d = (await r.json()) as { content?: { text?: string }[] };
    const answer = (d.content ?? []).map((b) => b.text ?? "").join(" ").trim().slice(0, 4000);
    res.status(200).json({ available: true, answer });
  } catch (e) {
    res.status(200).json({ available: true, error: String(e), note: "Ask failed." });
  }
}
