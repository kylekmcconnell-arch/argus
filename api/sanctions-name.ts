// OFAC SDN name screen for a resolved real person. GET /api/sanctions-name?name=<full name>
//
// Address screening (api/sanctions) catches a sanctioned WALLET; this catches a
// sanctioned PERSON by name — a founder, funder, or named associate on the US
// Treasury SDN list. Source: OpenSanctions' free bulk mirror of us_ofac_sdn
// (targets.simple.csv, ~7MB, public). We fetch once, build a normalized index of
// every sanctioned individual's name + aliases, cache it, and require an EXACT
// normalized full-name (or full-alias) match — surname-only matching would light
// up on every common name, so we don't do it. A hit is an adverse lead requiring
// identity verification; a name collision alone never governs a hard cap.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { collectOfacName, normalizeResolvedName, normalizeSanctionsName } from "../src/lib/offchainEvidence.js";
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 25 };

const IDX_KEY = "ofacname:v2";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = normalizeResolvedName(typeof req.query.name === "string" ? req.query.name : "");
  const q = normalizeSanctionsName(name);
  if (q.split(" ").filter(Boolean).length < 2) { res.status(200).json({ available: false, note: "Sanctions screen needs a resolved real name." }); return; }
  const result = await collectOfacName(name, {
    cache: {
      read: async () => (await cacheGetJson<{ names: string }>(IDX_KEY))?.names ?? null,
      write: async (names) => cacheSetJson(IDX_KEY, { names }),
    },
  });
  res.status(200).json(result.value);
}
