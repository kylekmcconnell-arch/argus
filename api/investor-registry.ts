// Cross-scan VC ranking. GET /api/investor-registry
//
// Rates and ranks the funds seen in rounds THIS WORKSPACE has scanned (#454
// follow-up): rounds participated, lead share, distinct subjects backed,
// cadence (first to last round), disclosed capital, and the valuation
// direction across the rounds it appears in. The denominator is the
// workspace's own scan history, and the surface says so; nothing here is a
// verified fact about a fund or an input to any subject's verdict. Rows come
// from investor_records, written best-effort at every non-private saved scan
// from the report's frozen funding snapshots (aggregator attributions, kept
// with their providers named).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";

export const config = { maxDuration: 15 };

// Below this many observations the ranking is noise, not a read.
const MIN_OBSERVATIONS = 3;

export type InvestorRegistryRow = {
  investor_key: string;
  display_name: string;
  backer_type?: string | null;
  subject_ref: string;
  round_key: string;
  is_lead?: boolean | null;
  round_date?: string | null;
  amount_usd?: number | null;
  valuation_usd?: number | null;
  providers?: string[] | null;
  updated_at?: string | null;
};

export interface InvestorRanking {
  investorKey: string;
  displayName: string;
  backerType: string;
  rounds: number;
  leadRounds: number;
  subjects: number;
  firstRoundDate: string | null;
  lastRoundDate: string | null;
  disclosedUsd: number;
  /** Direction across this investor's dated, valued rounds, oldest first. */
  valuationDirection: "rising" | "falling" | "mixed" | "insufficient";
  providers: string[];
}

/** Pure: fold observation rows into one ranked investor list. Exported for tests. */
export function buildInvestorRanking(rows: InvestorRegistryRow[]): InvestorRanking[] {
  const byInvestor = new Map<string, InvestorRegistryRow[]>();
  for (const row of rows) {
    if (!row.investor_key || !row.display_name) continue;
    const list = byInvestor.get(row.investor_key) ?? [];
    list.push(row);
    byInvestor.set(row.investor_key, list);
  }
  const rankings: InvestorRanking[] = [];
  for (const [investorKey, observations] of byInvestor) {
    const dated = observations
      .filter((row) => row.round_date)
      .sort((left, right) => String(left.round_date).localeCompare(String(right.round_date)));
    const valued = dated.filter((row) => typeof row.valuation_usd === "number" && row.valuation_usd > 0);
    let rising = 0;
    let falling = 0;
    for (let i = 1; i < valued.length; i += 1) {
      if (valued[i].valuation_usd! > valued[i - 1].valuation_usd!) rising += 1;
      else if (valued[i].valuation_usd! < valued[i - 1].valuation_usd!) falling += 1;
    }
    // The freshest row's spelling wins; the key already merged the identity.
    const freshest = [...observations].sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")))[0];
    rankings.push({
      investorKey,
      displayName: freshest.display_name,
      backerType: freshest.backer_type ?? "backer",
      rounds: observations.length,
      leadRounds: observations.filter((row) => row.is_lead === true).length,
      subjects: new Set(observations.map((row) => row.subject_ref)).size,
      firstRoundDate: dated[0]?.round_date ?? null,
      lastRoundDate: dated.length ? dated[dated.length - 1].round_date ?? null : null,
      disclosedUsd: observations.reduce((sum, row) => sum + (typeof row.amount_usd === "number" ? row.amount_usd : 0), 0),
      valuationDirection: valued.length < 2 ? "insufficient" : falling === 0 ? "rising" : rising === 0 ? "falling" : "mixed",
      providers: [...new Set(observations.flatMap((row) => row.providers ?? []))],
    });
  }
  // Ranked by weight of evidence: distinct subjects, then lead rounds, then
  // rounds, then disclosed capital. A quality judgement stays with the reader;
  // the order only says who this workspace has seen the most of.
  return rankings.sort((left, right) =>
    right.subjects - left.subjects
    || right.leadRounds - left.leadRounds
    || right.rounds - left.rounds
    || right.disclosedUsd - left.disclosedUsd);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(200).json({ available: false, note: "Report storage is not configured." });
    return;
  }
  try {
    const url = `${credentials.url}/rest/v1/investor_records`
      + `?select=investor_key,display_name,backer_type,subject_ref,round_key,is_lead,round_date,amount_usd,valuation_usd,providers,updated_at`
      + `&organization_id=eq.${encodeURIComponent(auth.organizationId)}`
      + `&order=updated_at.desc&limit=2000`;
    const response = await fetch(url, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      res.status(200).json({ available: false, note: `Report storage answered ${response.status}.` });
      return;
    }
    const rows = (await response.json()) as InvestorRegistryRow[];
    const observationCount = Array.isArray(rows) ? rows.length : 0;
    if (observationCount < MIN_OBSERVATIONS) {
      res.status(200).json({
        available: false,
        observations: observationCount,
        note: "Fewer than three backer observations are saved in this workspace yet; the registry fills as scans with funding records are saved.",
      });
      return;
    }
    res.status(200).json({
      available: true,
      observations: observationCount,
      label: "funds seen in rounds this workspace has scanned",
      investors: buildInvestorRanking(rows),
    });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "The investor registry could not be built." });
  }
}
