// Cross-scan investor store (#454 follow-up): every saved scan's frozen
// funding rounds contribute one row per (investor x subject x round) to
// investor_records. The VC ranking is derived at read time from these rows
// (api/investor-registry), so a rescan is idempotent by primary key and no
// stored counter can drift. Best-effort like entityStore: a write failure
// never fails a scan, and a private run leaves no org-visible trace.
import { deadlineFetch } from "./providerDeadline.js";
import { env } from "./config";
import { canonicalEntityKey } from "../src/engine";
import { classifyBacker, mergeFundraisingRounds, type FundraisingRound } from "../src/lib/fundraising";
import type { CollectedEvidence } from "../src/data/evidence";

const TABLE = "investor_records";

function creds(): { url: string; key: string } | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const authHeaders = (key: string): Record<string, string> => ({
  apikey: key,
  ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}),
  "content-type": "application/json",
});

// The same coarse bucket fundraising.ts merges rounds with: month plus
// order-of-magnitude, so two indexes' views of "the $2.5M seed" upsert the
// same row instead of counting one round twice.
const roundKey = (date: string | null, amountUsd: number | null): string => {
  const month = date ? date.slice(0, 7) : "undated";
  const bucket = amountUsd && amountUsd > 0 ? Math.round(Math.log10(amountUsd) * 4) : 0;
  return `${month}|${bucket}`;
};

export interface InvestorObservationRow {
  organization_id: string;
  investor_key: string;
  subject_ref: string;
  subject_kind: string;
  round_key: string;
  display_name: string;
  backer_type: string;
  is_lead: boolean;
  round_label: string | null;
  round_date: string | null;
  amount_usd: number | null;
  valuation_usd: number | null;
  instrument: string;
  providers: string[];
  source_report_version_id: string | null;
}

/**
 * Derive investor observation rows from a scan's frozen funding snapshots.
 * mergeFundraisingRounds applies the residue filter (a round stating neither
 * amount, valuation, nor token terms never counts), so this store cannot
 * inherit the false "led by BlackRock" relationship-residue shape at scale.
 */
export function investorObservationsFromEvidence(
  organizationId: string,
  subjectRef: string,
  subjectKind: string,
  evidence: Pick<CollectedEvidence, "protocolFunding" | "cryptoRankFunding" | "companyEnrichment"> & { website?: string | null },
  sourceReportVersionId?: string | null,
): InvestorObservationRow[] {
  let rounds: FundraisingRound[];
  try {
    rounds = mergeFundraisingRounds({
      protocolFunding: evidence.protocolFunding,
      cryptoRankFunding: evidence.cryptoRankFunding,
      companyEnrichment: evidence.companyEnrichment,
      website: evidence.website ?? undefined,
    });
  } catch {
    return [];
  }
  const rows = new Map<string, InvestorObservationRow>();
  for (const round of rounds) {
    const key = roundKey(round.date, round.amountUsd);
    const providers = [...new Set(round.sources.map((source) => source.provider))];
    const backers: Array<{ name: string; isLead: boolean }> = [
      ...round.leadInvestors.map((name) => ({ name, isLead: true })),
      ...round.otherInvestors.map((name) => ({ name, isLead: false })),
    ];
    for (const backer of backers) {
      const name = backer.name.trim();
      const investorKey = canonicalEntityKey({ name });
      if (!name || !investorKey) continue;
      const rowKey = `${investorKey}|${key}`;
      const existing = rows.get(rowKey);
      if (existing) {
        // A lead attribution from any index outranks a plain participation.
        existing.is_lead = existing.is_lead || backer.isLead;
        existing.providers = [...new Set([...existing.providers, ...providers])];
        continue;
      }
      rows.set(rowKey, {
        organization_id: organizationId,
        investor_key: investorKey,
        subject_ref: subjectRef,
        subject_kind: subjectKind,
        round_key: key,
        display_name: name,
        backer_type: classifyBacker(name),
        is_lead: backer.isLead,
        round_label: round.label || null,
        round_date: round.date,
        amount_usd: round.amountUsd,
        valuation_usd: round.valuationUsd,
        instrument: round.instrument,
        providers,
        source_report_version_id: sourceReportVersionId ?? null,
      });
    }
  }
  return [...rows.values()];
}

/** Upsert the rows; idempotent per (org, investor, subject, round). */
export async function writeInvestorObservations(rows: InvestorObservationRow[]): Promise<boolean> {
  const c = creds();
  if (!c || !rows.length) return false;
  try {
    const res = await deadlineFetch(
      `${c.url}/rest/v1/${TABLE}?on_conflict=organization_id,investor_key,subject_ref,round_key`,
      {
        method: "POST",
        headers: { ...authHeaders(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(5_000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
