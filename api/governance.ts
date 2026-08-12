// Scan-time Snapshot governance reading.
// GET /api/governance?name=<project>&address=<token>&handle=<@x>&website=<url>
//
// Answers a question no holder chart can: of the addresses that actually voted
// on this project's last governance proposals, how few carried the result. On
// Uniswap's last temp check that was two addresses casting 80% of the voting
// power out of 118 that voted.
//
// The space is never bound by name. Candidate ids come from naming conventions
// and a candidate is accepted only when Snapshot marks it verified AND one
// independent fact ties it to this subject (the official X handle or official
// domain). A strategy address is chosen by the space creator and is not
// identity evidence. See the
// header of server/adapters/snapshot.ts for the live evidence that anything
// looser binds a squatter: a zero-follower space named "uniswap" votes on the
// genuine UNI contract.
//
// Snapshot's hub is free and keyless, so this route is scan-time and ungated on
// the pattern api/gmgn-bundle.ts set, with middleware's budget as the abuse
// guard. Governance figures are soft evidence and set no score floors.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describeGovernance, fetchGovernance } from "../server/adapters/snapshot.js";

export const config = { maxDuration: 30 };

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const name = str(req.query.name);
  if (!name) return res.status(400).json({ error: "name is required" });
  // Bound before spending a call; these are identity hints, not free text.
  if (name.length > 120) return res.status(400).json({ error: "identity hint is too long" });

  const reading = await fetchGovernance({
    name,
    // Caller-supplied space ids are discovery input, not project provenance.
    // The public route intentionally ignores ?space= and binds candidates only
    // through Snapshot verification plus the subject's official X or domain.
    spaceId: null,
    tokenAddress: str(req.query.address) || null,
    handle: str(req.query.handle) || null,
    website: str(req.query.website) || null,
  });

  const payload = { ...reading, claims: describeGovernance(reading) };
  // Governance moves slowly and a closed proposal never changes, so a short
  // shared cache is safe here in a way the live-balance routes cannot be.
  res.setHeader("cache-control", "private, max-age=900");
  return res.status(200).json(payload);
}
