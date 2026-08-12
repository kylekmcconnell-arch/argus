// Legal history screen for a resolved real name. GET /api/legal-screen?name=<full name>
//
// A crypto founder named in a fraud suit, an SEC/CFTC enforcement action, or a
// bankruptcy is diligence gold that lives entirely off-chain. CourtListener (Free
// Law Project) indexes US federal + state dockets (the RECAP archive) and is free
// to query. We search the resolved REAL name (never a pseudonymous handle — that's
// noise) and return the matching cases with links, flagging which name the subject
// actually appears in as a party. Framed as leads to verify, not proven identity.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { collectLegalCases, isPlausibleFullName, normalizeResolvedName, type LegalPayload } from "../src/lib/offchainEvidence.js";
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = normalizeResolvedName(typeof req.query.name === "string" ? req.query.name : "");
  // Require a plausible real full name (2+ words) — searching a one-word handle is noise.
  if (!isPlausibleFullName(name)) { res.status(200).json({ available: false, note: "Legal screen needs a resolved real name." }); return; }

  const ck = `legal:${name.toLowerCase()}`;
  const cached = await cacheGetJson<LegalPayload>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const result = await collectLegalCases(name);
  if (result.status !== "succeeded") {
    res.status(200).json({ available: false, note: "CourtListener search was unavailable. No clean legal-history result was inferred." });
    return;
  }
  if (result.value.available) await cacheSetJson(ck, result.value);
  res.status(200).json(result.value);
}
