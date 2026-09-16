// Stage cohort for the shipping read. GET /api/shipping-cohort?chain=&mcap=&ageDays=&commits=&authors=&ref=
//
// Measuring a two-month launchpad token against Uniswap says nothing. This
// builds the like-for-like set from the workspace's own saved token reports:
// same chain, a market-cap band around the subject (a quarter to four times),
// and an age band (half to double, with a 30-day floor), each carrying the
// frozen shipping summary the scan-time lane wrote. The subject's percentile
// within that set is what the panel prints. Org-scoped by construction: the
// cohort is "tokens this workspace has scanned", and the label says so.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import type { ShippingCohort } from "../src/threat/shipping.js";

export const config = { maxDuration: 15 };

const MIN_COHORT = 5;

type Row = {
  ref: string;
  chain?: string | null;
  mcap?: number | null;
  ageDays?: number | null;
  shipping?: { version?: number; grade?: string; totalCommits?: number; distinctHuman?: number } | null;
};

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

function percentile(values: number[], subject: number): number {
  if (!values.length) return 50;
  const below = values.filter((v) => v < subject).length;
  const equal = values.filter((v) => v === subject).length;
  return Math.round(((below + equal / 2) / values.length) * 100);
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Pure: pick the band and compute the cohort from candidate rows. Exported for tests. */
export function buildCohort(rows: Row[], subject: { ref: string; chain: string; mcap?: number; ageDays?: number; commits: number; authors: number }): ShippingCohort | null {
  const lo = subject.mcap != null ? subject.mcap / 4 : undefined;
  const hi = subject.mcap != null ? subject.mcap * 4 : undefined;
  const ageLo = subject.ageDays != null ? Math.max(0, Math.min(subject.ageDays / 2, subject.ageDays - 30)) : undefined;
  const ageHi = subject.ageDays != null ? Math.max(subject.ageDays * 2, subject.ageDays + 30) : undefined;
  const peers = rows.filter((r) => {
    if (!r.shipping || r.shipping.version !== 1 || typeof r.shipping.totalCommits !== "number" || typeof r.shipping.distinctHuman !== "number") return false;
    if (r.ref.toLowerCase() === subject.ref.toLowerCase()) return false;
    if ((r.chain ?? "").toLowerCase() !== subject.chain.toLowerCase()) return false;
    const m = num(r.mcap);
    if (lo != null && hi != null && m != null && (m < lo || m > hi)) return false;
    const a = num(r.ageDays);
    if (ageLo != null && ageHi != null && a != null && (a < ageLo || a > ageHi)) return false;
    return true;
  });
  if (peers.length < MIN_COHORT) return null;
  const commits = peers.map((p) => p.shipping!.totalCommits as number);
  const authors = peers.map((p) => p.shipping!.distinctHuman as number);
  const shipping = peers.filter((p) => p.shipping!.grade === "shipping-team" || p.shipping!.grade === "shipping-solo").length;
  const capBand = subject.mcap != null ? ` between $${compact(lo!)} and $${compact(hi!)}` : "";
  const ageBand = subject.ageDays != null ? ` aged ${Math.round(ageLo!)} to ${Math.round(ageHi!)} days` : "";
  return {
    label: `${subject.chain} tokens this workspace has scanned${capBand}${ageBand}`,
    size: peers.length,
    medianCommits: median(commits),
    medianAuthors: median(authors),
    percentileCommits: percentile(commits, subject.commits),
    percentileAuthors: percentile(authors, subject.authors),
    shippingSharePct: Math.round((shipping / peers.length) * 100),
  };
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").trim().toLowerCase();
  const ref = (typeof req.query.ref === "string" ? req.query.ref : "").trim();
  const commits = num(req.query.commits);
  const authors = num(req.query.authors);
  if (!chain || !/^[a-z0-9-]{2,30}$/.test(chain) || commits == null || authors == null) { res.status(400).json({ error: "chain, commits and authors required" }); return; }
  const credentials = serviceCredentials();
  if (!credentials) { res.status(200).json({ available: false, note: "Report storage is not configured." }); return; }
  try {
    const url = `${credentials.url}/rest/v1/reports`
      + `?select=ref,chain:payload->>chain,mcap:payload->mcap,ageDays:payload->ageDays,shipping:payload->shipping`
      + `&organization_id=eq.${encodeURIComponent(auth.organizationId)}`
      + `&kind=eq.token`
      + `&payload->>chain=eq.${encodeURIComponent(chain)}`
      + `&payload->shipping=not.is.null`
      + `&order=ts.desc&limit=1000`;
    const r = await fetch(url, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) { res.status(200).json({ available: false, note: `Report storage answered ${r.status}.` }); return; }
    const rows = (await r.json()) as Row[];
    const cohort = buildCohort(Array.isArray(rows) ? rows : [], { ref, chain, mcap: num(req.query.mcap), ageDays: num(req.query.ageDays), commits, authors });
    if (!cohort) { res.status(200).json({ available: false, candidates: Array.isArray(rows) ? rows.length : 0, note: `Fewer than ${MIN_COHORT} comparable ${chain} tokens with a development read are saved in this workspace yet; the cohort fills as reports are saved.` }); return; }
    res.status(200).json({ available: true, cohort });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "The stage cohort could not be built." });
  }
}
