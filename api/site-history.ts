// Deleted-content archaeology. GET /api/site-history?url=<domain>
//
// What a project REMOVED from its site is the highest-signal content there is: a
// scrubbed team page, a deleted "advisors" or "audited by" section, a pivot from
// a previous failed product on the same domain. archive.org keeps every version;
// this diffs the earliest substantive snapshot against the live site and reports
// what disappeared — sections, team/social profile links, named people, and title
// pivots. An investigator does this by eye across dozens of snapshots; automated.
//
// Keyless (Wayback CDX + archived HTML + a live fetch). Read-only.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const CDX = "https://web.archive.org/cdx/search/cdx";
const SECTION_WORDS = ["team", "advisor", "advisors", "founders", "leadership", "partners", "backers", "investors", "roadmap", "audit", "audited", "tokenomics", "whitepaper", "about"];

async function getText(url: string, ms: number, ua?: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: ua ? { "user-agent": ua } : undefined });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

interface Snap { timestamp: string; original: string }

// A CDX page of distinct homepage versions. Positive limit = oldest N, negative =
// newest N (a small limit keeps it fast even for sites with huge crawl history).
async function cdx(domain: string, limit: number): Promise<Snap[]> {
  const qs = `?url=${encodeURIComponent(domain)}&output=json&filter=statuscode:200&collapse=digest&fl=timestamp,original&limit=${limit}`;
  const raw = await getText(CDX + qs, 9000);
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as string[][];
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const ti = rows[0].indexOf("timestamp");
    const oi = rows[0].indexOf("original");
    return rows.slice(1).map((r) => ({ timestamp: r[ti], original: r[oi] })).filter((s) => s.timestamp && s.original);
  } catch {
    return [];
  }
}
// Oldest few + newest few (two targeted queries, not one big pull).
async function versions(domain: string): Promise<{ oldest: Snap[]; newest: Snap[] }> {
  const [oldest, newest] = await Promise.all([cdx(domain, 8), cdx(domain, -8)]);
  return { oldest, newest };
}

const strip = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();

interface Features { title: string; headings: Set<string>; sections: Set<string>; profiles: Set<string>; names: Set<string>; len: number }

function extract(html: string): Features {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const headings = new Set<string>();
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const h = strip(m[1]).toLowerCase();
    if (h.length >= 2 && h.length <= 70) headings.add(h);
  }
  const text = strip(html);
  const lower = text.toLowerCase();
  const sections = new Set<string>(SECTION_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)));
  const profiles = new Set<string>();
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    const u = m[1];
    const pm = u.match(/(?:linkedin\.com\/in\/[A-Za-z0-9\-_%]+|(?:x|twitter)\.com\/[A-Za-z0-9_]{2,30}|github\.com\/[A-Za-z0-9\-_.]{1,39}|t\.me\/[A-Za-z0-9_]{3,32})/i);
    if (pm && !/(?:x|twitter)\.com\/(?:intent|share|home|search|hashtag)/i.test(pm[0])) profiles.add(pm[0].toLowerCase().replace(/\/$/, ""));
  }
  const names = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z][a-z]{1,15}\s[A-Z][a-z]{1,15}\b/g)) names.add(m[0]);
  return { title, headings, sections, profiles, names, len: text.length };
}

const diff = <T,>(before: Set<T>, after: Set<T>): T[] => [...before].filter((x) => !after.has(x));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const domain = (typeof req.query.url === "string" ? req.query.url : "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) { res.status(400).json({ error: "a domain (url=) is required" }); return; }

  try {
    const { oldest, newest } = await versions(domain);
    if (!oldest.length && !newest.length) { res.status(200).json({ domain, available: true, note: "No archived history found for this domain (very new, or never crawled by archive.org)." }); return; }

    // Earliest substantive snapshot: skip thin/parking pages up front.
    let earliest: Features | null = null;
    let earliestTs = "";
    for (const s of oldest.slice(0, 4)) {
      const html = await getText(`https://web.archive.org/web/${s.timestamp}id_/${s.original}`, 7000);
      if (!html) continue;
      const f = extract(html);
      if (f.len >= 400) { earliest = f; earliestTs = s.timestamp; break; }
      if (!earliest) { earliest = f; earliestTs = s.timestamp; }
    }

    // Current = the LIVE site if reachable, else the NEWEST archived snapshot.
    let current: Features | null = null;
    let currentSrc = "live";
    const live = await getText(`https://${domain}`, 7000, "Mozilla/5.0 (compatible; ARGUS/1.0)");
    if (live && strip(live).length >= 200) current = extract(live);
    if (!current) {
      const last = newest[newest.length - 1] ?? oldest[oldest.length - 1];
      if (last) {
        const html = await getText(`https://web.archive.org/web/${last.timestamp}id_/${last.original}`, 7000);
        if (html) { current = extract(html); currentSrc = `archive ${last.timestamp.slice(0, 4)}`; }
      }
    }

    const lastYear = (newest[newest.length - 1] ?? oldest[oldest.length - 1])?.timestamp.slice(0, 4) ?? "";
    if (!earliest || !current) { res.status(200).json({ domain, available: true, note: "Could not fetch enough page content to diff." }); return; }

    const removedSections = diff(earliest.sections, current.sections);
    const removedHeadings = diff(earliest.headings, current.headings).slice(0, 12);
    const removedProfiles = diff(earliest.profiles, current.profiles).slice(0, 20);
    const removedNames = diff(earliest.names, current.names).slice(0, 12);
    const titleChanged = earliest.title && current.title && earliest.title.toLowerCase() !== current.title.toLowerCase();
    const firstYear = earliestTs.slice(0, 4);

    const bits: string[] = [];
    if (removedSections.length) bits.push(`removed section${removedSections.length === 1 ? "" : "s"}: ${removedSections.join(", ")}`);
    if (removedProfiles.length) bits.push(`${removedProfiles.length} team/social profile link${removedProfiles.length === 1 ? "" : "s"} deleted`);
    if (titleChanged) bits.push(`title changed ("${earliest.title}" → "${current.title}") — possible pivot / prior product`);
    const note = bits.length
      ? `Since ${firstYear}, this site ${bits.join("; ")}. Removed content is the highest-signal content.`
      : `No significant content removals detected between the ${firstYear} snapshot and ${lastYear || "now"}.`;

    res.status(200).json({
      domain,
      available: true,
      firstArchived: firstYear,
      lastArchived: lastYear,
      comparedTo: currentSrc,
      titleChange: titleChanged ? { from: earliest.title, to: current.title } : null,
      removedSections,
      removedHeadings,
      removedProfileLinks: removedProfiles,
      removedNames,
      note,
    });
  } catch (e) {
    res.status(200).json({ domain, available: true, error: String(e), note: "Site-history lookup failed." });
  }
}
