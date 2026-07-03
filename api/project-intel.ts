// Project intelligence — the OSINT layer an investigator runs that a single
// page-scrape misses. GET /api/project-intel?domain=<host>&name=<project>
// Two keyless, deterministic, high-signal angles:
//   1. DOMAIN AGE (RDAP): registration date + registrar. A "multi-year
//      ecosystem" on a 3-week-old domain is a hard contradiction; a domain far
//      younger than the token/account is a fresh-start signal.
//   2. CLAIMED AUDITS: scan the site for named security auditors and whether a
//      real report/proof link sits next to the claim. "Audited by CertiK" with
//      no linkable report is the classic fake-legitimacy move.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const AUDITORS = [
  "CertiK", "Hacken", "PeckShield", "SlowMist", "Trail of Bits", "OpenZeppelin",
  "Quantstamp", "Cyberscope", "SolidProof", "ConsenSys Diligence", "Halborn",
  "Zokyo", "Beosin", "Verichains", "Sherlock", "Code4rena", "Spearbit", "Cure53",
];

async function rdap(host: string): Promise<{ registered?: string; expires?: string; registrar?: string; ageMonths?: number } | null> {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(host)}`, { redirect: "follow", headers: { accept: "application/rdap+json" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const ev: Record<string, string> = {};
    for (const e of d.events ?? []) if (e.eventAction && e.eventDate) ev[e.eventAction] = e.eventDate;
    const registrarEntity = (d.entities ?? []).find((e: any) => (e.roles ?? []).includes("registrar"));
    const vcard = registrarEntity?.vcardArray?.[1] ?? [];
    const registrar = (vcard.find((x: any) => x?.[0] === "fn")?.[3]) as string | undefined;
    const registered = ev.registration?.slice(0, 10);
    const ageMonths = registered ? Math.max(0, Math.round((Date.now() - Date.parse(registered)) / (30.44 * 864e5))) : undefined;
    if (!registered) return { registrar };
    return { registered, expires: ev.expiration?.slice(0, 10), registrar, ageMonths };
  } catch {
    return null;
  }
}

function htmlText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function fetchText(url: string): Promise<{ text: string; links: string[] } | null> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html" }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!/html/i.test(ct)) return null;
    const raw = await r.text();
    const links = [...raw.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    return { text: htmlText(raw), links };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const domainRaw = typeof req.query.domain === "string" ? req.query.domain.trim() : "";
  const host = domainRaw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  if (!host || !/\.[a-z]{2,}$/.test(host)) { res.status(400).json({ error: "domain required" }); return; }

  const [domain, home, auditPage, securityPage] = await Promise.all([
    rdap(host),
    fetchText(`https://${host}`),
    fetchText(`https://${host}/audit`),
    fetchText(`https://${host}/security`),
  ]);

  // ── claimed audits: auditor name present + a plausible proof link nearby ──
  const pages = [home, auditPage, securityPage].filter(Boolean) as { text: string; links: string[] }[];
  const corpus = pages.map((p) => p.text).join(" ");
  const allLinks = pages.flatMap((p) => p.links);
  const audits: { auditor: string; proof: string | null }[] = [];
  for (const a of AUDITORS) {
    if (!new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(corpus)) continue;
    // proof = a link to a PDF, the auditor's own domain, a /audit path, or a github report
    const slug = a.toLowerCase().replace(/[^a-z]/g, "");
    const proof = allLinks.find((l) => /\.pdf($|\?)/i.test(l) || new RegExp(slug.slice(0, 6), "i").test(l) || /\/audit|report|skynet|security-review/i.test(l)) ?? null;
    audits.push({ auditor: a, proof });
  }

  const claimedNoProof = audits.filter((a) => !a.proof).length;
  const auditNote = !pages.length
    ? "Could not read the site to check audit claims."
    : audits.length === 0
      ? "No named security auditor found on the site."
      : claimedNoProof > 0
        ? `Claims ${audits.map((a) => a.auditor).join(", ")}, but ${claimedNoProof} with no linkable report — an unverifiable audit badge is a common fake-legitimacy move.`
        : `Claims ${audits.map((a) => a.auditor).join(", ")}, each with a proof link.`;

  const domainNote = !domain?.registered
    ? "Domain registration date unavailable (RDAP has no record for this TLD)."
    : (domain.ageMonths ?? 99) < 3
      ? `Domain registered ${domain.registered} — only ${domain.ageMonths} month(s) old. A project presenting as established on a brand-new domain is a contradiction.`
      : `Domain registered ${domain.registered} (${domain.ageMonths} months old)${domain.registrar ? `, via ${domain.registrar}` : ""}.`;

  res.status(200).json({ available: true, host, domain: domain ?? null, domainNote, audits, auditNote, pagesRead: pages.length });
}
