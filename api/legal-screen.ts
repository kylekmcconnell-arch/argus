// Legal history screen for a resolved real name. GET /api/legal-screen?name=<full name>
//
// A crypto founder named in a fraud suit, an SEC/CFTC enforcement action, or a
// bankruptcy is diligence gold that lives entirely off-chain. CourtListener (Free
// Law Project) indexes US federal + state dockets (the RECAP archive) and is free
// to query. We search the resolved REAL name (never a pseudonymous handle — that's
// noise) and return the matching cases with links, flagging which name the subject
// actually appears in as a party. Framed as leads to verify, not proven identity.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 15 };

const CL = "https://www.courtlistener.com/api/rest/v4/search/";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = (typeof req.query.name === "string" ? req.query.name : "").trim().replace(/^@/, "").slice(0, 80);
  // Require a plausible real full name (2+ words) — searching a one-word handle is noise.
  if (name.split(/\s+/).filter(Boolean).length < 2) { res.status(200).json({ available: false, note: "Legal screen needs a resolved real name." }); return; }

  const ck = `legal:${name.toLowerCase()}`;
  const cached = await cacheGetJson<any>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  try {
    const url = `${CL}?q=${encodeURIComponent(`"${name}"`)}&type=r&order_by=${encodeURIComponent("dateFiled desc")}`;
    const r = await fetch(url, { headers: { "user-agent": "ARGUS due-diligence (contact via argus)" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) { res.status(200).json({ available: false, note: `CourtListener ${r.status}` }); return; }
    const d = (await r.json()) as any;
    const rows: any[] = Array.isArray(d?.results) ? d.results : [];
    const last = name.split(/\s+/).filter(Boolean).pop()!.toLowerCase();
    const cases = rows.slice(0, 8).map((x) => {
      const caseName = String(x.caseName ?? x.case_name_full ?? "").slice(0, 90);
      return {
        caseName,
        court: String(x.court ?? x.court_citation_string ?? "").slice(0, 60),
        date: x.dateFiled ?? x.dateTerminated ?? null,
        docket: x.docketNumber ?? null,
        url: x.docket_absolute_url ? `https://www.courtlistener.com${x.docket_absolute_url}` : null,
        // Party match: the subject's surname appears in the case caption — a much
        // stronger signal than a passing mention buried in a filing.
        nameInCase: caseName.toLowerCase().includes(last),
      };
    });
    const out = { available: true, name, total: d?.count ?? cases.length, cases, asParty: cases.filter((c) => c.nameInCase).length };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Legal screen failed." });
  }
}
