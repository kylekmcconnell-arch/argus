// OFAC sanctioned-address screening. GET /api/sanctions?addresses=a,b,c&chain=
//
// The screening logic lives in the shared ./_sanctions-core module so this HTTP
// route and the server-side token audit path screen from one implementation.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { screenAddresses } from "./_sanctions-core.js";

export const config = { maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw: string = typeof req.query.addresses === "string" ? req.query.addresses : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  const addresses: string[] = [...new Set(raw.split(",").map((a: string) => a.trim()).filter(Boolean))].slice(0, 40);
  if (!addresses.length) { res.status(400).json({ error: "addresses required" }); return; }
  try {
    const result = await screenAddresses(chain, addresses);
    if (!result.available) { res.status(200).json({ available: false, note: "OFAC list unavailable." }); return; }
    res.status(200).json(result);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Sanctions screen failed." });
  }
}
