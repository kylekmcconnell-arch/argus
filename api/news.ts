// Press coverage for a subject. GET /api/news?q=<name>&h=<x_handle>
//
// What you'd see clicking Google's "News" tab: recent articles about the subject,
// with source + date. A real project has press; a fresh shell has none, and a
// founder's coverage (funding, hacks, exits) is corroboration the account can't
// fake. Google News RSS — keyless, read-only.
//
// PRECISION over recall: a partial-word match drowns the report in noise (query
// "0xlumen" must never return Lumen Technologies or Stellar Lumens articles). So
// we search exact phrases and only keep headlines/descriptions that contain the
// exact phrase. A multi-word display name is distinctive; a single-word name is
// not, so then we anchor on the handle instead.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { collectNews, normalizeNewsSubject } from "../src/lib/offchainEvidence.js";

export const config = { maxDuration: 20 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawName = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const handle = typeof req.query.h === "string" ? req.query.h.trim().replace(/^@/, "") : "";
  if (!normalizeNewsSubject(rawName, handle)) { res.status(400).json({ error: "q or h required" }); return; }

  try {
    const result = await collectNews(rawName, handle);
    if (result.status !== "succeeded") {
      res.status(200).json({
        ...result.value,
        available: false,
        note: "News search was incomplete. No clean absence finding was inferred.",
      });
      return;
    }
    res.status(200).json(result.value);
  } catch (e) {
    res.status(200).json({ available: false, articles: [], error: String(e), note: "News search was unavailable." });
  }
}
