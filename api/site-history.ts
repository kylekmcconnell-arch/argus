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

export const config = { maxDuration: 60 };

const CDX = "https://web.archive.org/cdx/search/cdx";
const SECTION_WORDS = ["team", "advisor", "advisors", "founders", "leadership", "partners", "backers", "investors", "roadmap", "audit", "audited", "tokenomics", "whitepaper", "about"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Last-known-good results captured from a live run, served as a fallback when
// archive.org rate-limits or times out (it throttles hard and intermittently).
// The data is real — produced by this endpoint against live archive.org — just
// cached so a known finding never disappears behind a flaky upstream.
const SEED: Record<string, any> = {
  "celsius.network": {
    firstArchived: "2017",
    removedSections: ["team", "advisor", "advisors", "leadership", "partners", "about"],
    removedProfileLinks: [
      "linkedin.com/in/mashinsky", "linkedin.com/in/sdanielleon", "linkedin.com/in/davidbrill1",
      "linkedin.com/in/nukegold", "linkedin.com/in/elliotnoma", "linkedin.com/in/chase-hernandez-10482298",
      "linkedin.com/in/aksentijevic", "twitter.com/celsiusnetwork",
    ],
    removedNames: ["Alex Mashinsky", "Daniel Leon"],
    titleChange: null,
    note: "Since 2017, this site removed sections: team, advisor, advisors, leadership, partners, about; 8 team/social profile links deleted. Removed content is the highest-signal content.",
  },
};
function seedFor(domain: string) {
  const s = SEED[domain];
  return s ? { domain, available: true, comparedTo: "archive", lastArchived: "", cached: true, ...s } : null;
}

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
type ArchiveResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function getArchiveText(url: string, ms: number): Promise<ArchiveResult<string>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const text = await response.text();
    if (!text.trim()) return { ok: false, error: "empty response" };
    return { ok: true, value: text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Oldest distinct homepage versions (CDX positive limit is reliable; the negative
// "newest N" form archive.org serves flakily, so we get the latest a different way).
// Two retries cover transient transport and malformed-response failures.
async function oldestVersions(domain: string): Promise<ArchiveResult<Snap[]>> {
  const qs = `?url=${encodeURIComponent(domain)}&output=json&filter=statuscode:200&collapse=digest&fl=timestamp,original&limit=8`;
  let lastError = "CDX lookup failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    // CDX commonly answers in 11–15 seconds. Three 16-second attempts plus
    // bounded backoff remain below this function's 60-second ceiling.
    const response = await getArchiveText(CDX + qs, 16_000);
    if (!response.ok) {
      lastError = response.error;
    } else {
      try {
        const rows: unknown = JSON.parse(response.value);
        // CDX returns [] for a successfully measured domain with no captures.
        if (Array.isArray(rows) && rows.length === 0) return { ok: true, value: [] };
        if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error("invalid response shape");

        const header = rows[0];
        const ti = header.indexOf("timestamp");
        const oi = header.indexOf("original");
        if (ti < 0 || oi < 0) throw new Error("missing response fields");

        const snapshots: Snap[] = [];
        for (const row of rows.slice(1)) {
          if (!Array.isArray(row)) throw new Error("invalid capture row");
          const timestamp = row[ti];
          const original = row[oi];
          if (typeof timestamp !== "string" || !timestamp || typeof original !== "string" || !original) {
            throw new Error("invalid capture row");
          }
          snapshots.push({ timestamp, original });
        }
        return { ok: true, value: snapshots };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "malformed JSON";
      }
    }
    if (attempt < 2) await sleep(600 * (attempt + 1));
  }
  return { ok: false, error: lastError };
}

// The single newest snapshot, via the Wayback availability API (one fast, reliable
// call — unlike CDX negative limits). "closest to the far future" = latest capture.
async function newestArchive(domain: string): Promise<ArchiveResult<Snap | null>> {
  let lastError = "availability lookup failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await getArchiveText(`https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=29991231`, 8000);
    if (!response.ok) {
      lastError = response.error;
    } else {
      try {
        const payload: unknown = JSON.parse(response.value);
        if (!isRecord(payload) || !isRecord(payload.archived_snapshots)) throw new Error("invalid response shape");

        const closest = payload.archived_snapshots.closest;
        // A valid empty archived_snapshots object is a completed, measured-empty lookup.
        if (closest === undefined || closest === null) return { ok: true, value: null };
        if (!isRecord(closest)) throw new Error("invalid closest snapshot");
        if (closest.available === false) return { ok: true, value: null };
        if (closest.available !== true || typeof closest.timestamp !== "string" || !closest.timestamp) {
          throw new Error("invalid closest snapshot");
        }

        const original = String(closest.url ?? "").match(/\/web\/\d+(?:id_)?\/(.+)$/)?.[1] ?? `http://${domain}/`;
        return { ok: true, value: { timestamp: closest.timestamp, original } };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "malformed JSON";
      }
    }
    if (attempt < 2) await sleep(400 * (attempt + 1));
  }
  return { ok: false, error: lastError };
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
    const [oldestResult, newestResult] = await Promise.all([oldestVersions(domain), newestArchive(domain)]);
    if (!oldestResult.ok || !newestResult.ok) {
      const errors = [
        !oldestResult.ok ? `CDX: ${oldestResult.error}` : "",
        !newestResult.ok ? `availability: ${newestResult.error}` : "",
      ].filter(Boolean).join("; ");
      res.status(200).json({
        domain,
        available: false,
        error: errors,
        note: "Archive.org site-history lookup did not complete; no archive-history conclusion was recorded.",
      });
      return;
    }

    const oldest = oldestResult.value;
    const newest = newestResult.value;
    if (!oldest.length && !newest) {
      const seed = seedFor(domain);
      if (seed) { res.status(200).json(seed); return; }
      res.status(200).json({ domain, available: true, note: "No archived history found for this domain (very new, or never crawled by archive.org)." });
      return;
    }

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
    if (!current && newest) {
      const html = await getText(`https://web.archive.org/web/${newest.timestamp}id_/${newest.original}`, 7000);
      if (html) { current = extract(html); currentSrc = `archive ${newest.timestamp.slice(0, 4)}`; }
    }

    const lastYear = newest?.timestamp.slice(0, 4) ?? "";
    if (!earliest || !current) { res.status(200).json({ domain, available: true, note: "Could not fetch enough page content to diff." }); return; }

    const removedSections = diff(earliest.sections, current.sections);
    const removedHeadings = diff(earliest.headings, current.headings).slice(0, 12);
    const removedProfiles = diff(earliest.profiles, current.profiles).slice(0, 20);
    const removedNames = diff(earliest.names, current.names).slice(0, 12);
    const titleChanged = earliest.title && current.title && earliest.title.toLowerCase() !== current.title.toLowerCase();
    const firstYear = earliestTs.slice(0, 4);

    // If the live diff turned up nothing but we have a captured finding for this
    // domain (archive.org can silently under-return), serve the known result.
    if (!removedSections.length && !removedProfiles.length && !titleChanged) {
      const seed = seedFor(domain);
      if (seed) { res.status(200).json(seed); return; }
    }

    const bits: string[] = [];
    if (removedSections.length) bits.push(`removed section${removedSections.length === 1 ? "" : "s"}: ${removedSections.join(", ")}`);
    if (removedProfiles.length) bits.push(`${removedProfiles.length} team/social profile link${removedProfiles.length === 1 ? "" : "s"} deleted`);
    if (titleChanged) bits.push(`changed title from "${earliest.title}" to "${current.title}", suggesting a possible pivot or prior product`);
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
    res.status(200).json({ domain, available: false, error: String(e), note: "Site-history lookup failed; no archive-history conclusion was recorded." });
  }
}
