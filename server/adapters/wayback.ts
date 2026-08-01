// Wayback Machine corroboration. An off-LinkedIn role often left a fingerprint
// that was later scrubbed: a name on a /team page, an /about blurb, a launch post.
// archive.org keeps those snapshots forever. Given a candidate venture's domain
// and the subject's name, we look for the name in archived team/about/home pages.
// This is pure corroboration of an ALREADY-discovered lead, never a fishing trip:
// it only ever confirms a tie the discovery layer already proposed.
//
// It reads the newest capture first and, only when that one is silent, a bounded
// sample of the older ones: a scrubbed name is by definition missing from the
// newest capture, so a single-capture check was checking the one page that could
// not hold the evidence.

import { recordCall } from "../cost";
import { htmlToText } from "./teampage";

const CDX = "https://web.archive.org/cdx/search/cdx";
// The detail this module hunts is the one that was LATER SCRUBBED, so the newest
// capture is the single capture guaranteed not to hold it. We sample the range
// instead, bounded hard: a domain archived for a decade must still cost a fixed
// handful of fetches (archive.org throttles bursts), and what the sample shows is
// a floor on the archive, never a total.
const MAX_CAPTURES_PER_PATH = 4;

interface Snapshot { timestamp: string; original: string }
/** One sampled capture and its stripped text, or null when we could not read it. */
interface CaptureRead { snap: Snapshot; text: string | null }

export interface ArchivedAffiliation {
  url: string;
  year: string;
  where: string;
  /**
   * Set only when a sampled capture names both parties and the newest capture we
   * actually READ does not. Two dates and a count, nothing more: archived pages
   * get restructured and re-pathed, so this is what the captures show and never
   * the inference that the affiliation ended.
   */
  disappearance?: {
    lastSeen: string;
    newestChecked: string;
    capturesChecked: number;
    note: string;
  };
}

/**
 * The corroboration line orchestrate records for an archived tie.
 *
 * It lives here, next to the evidence, so the phrasing cannot drift from what
 * the sampler actually did. The archive corroborates the tie; the second clause
 * only ever reports which capture was read and found silent. It never says the
 * affiliation ended, because a page that was restructured or re-pathed reads
 * exactly the same way from the outside.
 */
export function archiveCorroborationLabels(arch: ArchivedAffiliation): string[] {
  const labels = [`archived ${arch.where} page (${arch.year})`];
  if (arch.disappearance) {
    labels.push(`both names absent from the ${arch.disappearance.newestChecked} capture of that page, the most recent one read`);
  }
  return labels;
}

async function sampledSnapshots(urlPath: string): Promise<Snapshot[]> {
  let response: Response;
  try {
    // collapse=timestamp:4 asks the index for one capture per year, so the range
    // arrives in a handful of rows however long the site has been archived.
    // Exactly ONE collapse field: the CDX server honours the first and silently
    // ignores the rest, so pairing it with collapse=digest returned the full
    // unbounded index instead (verified against the live endpoint).
    const qs = `?url=${encodeURIComponent(urlPath)}&output=json&filter=statuscode:200&collapse=timestamp:4`;
    response = await fetch(CDX + qs, { signal: AbortSignal.timeout(4000) });
  } catch {
    recordCall("wayback", "cdx-search", 0, "transport_error", "failed");
    return [];
  }
  if (!response.ok) {
    recordCall("wayback", "cdx-search", 0, `http_${response.status}`, "failed");
    return [];
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    recordCall("wayback", "cdx-search", 0, "response_json_error", "failed");
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) {
    recordCall("wayback", "cdx-search", 0, "invalid_result_shape", "partial");
    return [];
  }
  const rows = parsed as unknown[][];
  if (rows.length < 2) {
    recordCall("wayback", "cdx-search", 0, "no_snapshot", "succeeded");
    return [];
  }
  // rows[0] is the header: [urlkey, timestamp, original, mimetype, statuscode, digest, length]
  const header = rows[0];
  const ti = header.indexOf("timestamp");
  const oi = header.indexOf("original");
  const all: Snapshot[] = [];
  if (ti >= 0 && oi >= 0) {
    for (const row of rows.slice(1)) {
      if (typeof row[ti] === "string" && typeof row[oi] === "string") {
        all.push({ timestamp: row[ti], original: row[oi] });
      }
    }
  }
  if (!all.length) {
    recordCall("wayback", "cdx-search", 0, "invalid_result_shape", "partial");
    return [];
  }
  // The index is served oldest-first, but "newest" carries an evidentiary claim
  // here, so sort rather than trust the order we were handed.
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  recordCall("wayback", "cdx-search", 0, undefined, "succeeded");
  return spreadSample(all, MAX_CAPTURES_PER_PATH);
}

// Oldest and newest always (they are the two the comparison rests on), plus an
// even spread between them.
function spreadSample(all: Snapshot[], max: number): Snapshot[] {
  if (all.length <= max) return all;
  const picks = new Set<number>([0, all.length - 1]);
  for (let i = 1; i < max - 1; i += 1) picks.add(Math.round((i * (all.length - 1)) / (max - 1)));
  return [...picks].sort((a, b) => a - b).map((i) => all[i]);
}

async function readCapture(snap: Snapshot): Promise<CaptureRead> {
  try {
    const archiveUrl = `https://web.archive.org/web/${snap.timestamp}id_/${snap.original}`;
    const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      recordCall("wayback", "snapshot-fetch", 0, `http_${response.status}`, "failed");
      return { snap, text: null };
    }
    let text: string;
    try {
      // Strip markup and collapse whitespace before matching: a roster row like
      // "<span>John</span> <span>Smith</span>" must match, and a name-shaped
      // substring inside a script, comment, or longer word must not.
      text = htmlToText(await response.text());
    } catch {
      recordCall("wayback", "snapshot-fetch", 0, "response_text_error", "failed");
      return { snap, text: null };
    }
    if (!text.trim()) {
      recordCall("wayback", "snapshot-fetch", 0, "empty_snapshot", "partial");
      return { snap, text: null };
    }
    return { snap, text };
  } catch {
    recordCall("wayback", "snapshot-fetch", 0, "transport_error", "failed");
    return { snap, text: null };
  }
}

function captureDate(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

// Does an archived team/about page of `domain` name BOTH the subject AND the
// venture itself? Requiring the venture's own identity (its brand name or its
// domain root) on the page confirms the page belongs to the venture, so a
// subject-name hit is a genuine first-party team tie rather than a coincidental
// mention (a footer, a testimonial, a different same-named person) on an
// unrelated or model-misguessed domain. Returns the archived URL + year, else null.
export async function archivedAffiliation(
  domain: string,
  subjectName: string,
  ventureName: string,
): Promise<ArchivedAffiliation | null> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean || !subjectName) return null;
  const subjectNeedles = nameNeedles(subjectName);
  if (!subjectNeedles.length) return null;
  // The venture is confirmed present when its brand name or its domain's root
  // label appears (both are on a venture's own site). Guard against 1-2 char roots.
  const domainRoot = clean.split(".")[0] ?? "";
  const ventureNeedles = [ventureName.trim().toLowerCase(), domainRoot]
    .filter((t) => t.length >= 3)
    .map(needleRegex);
  if (!ventureNeedles.length) return null;

  // Only a first-party team/about page carries the weight to tie a person to a
  // venture; a bare homepage naming someone is too weak to promote to scoreable.
  // One recorded outcome per capture we managed to read, so the ledger still
  // counts fetches and not intentions.
  const namesBoth = (read: CaptureRead): boolean => {
    const text = read.text;
    if (text === null) return false;
    const hit = subjectNeedles.some((n) => n.test(text)) && ventureNeedles.some((n) => n.test(text));
    recordCall("wayback", "snapshot-fetch", 0, hit ? "subject_and_venture_match" : "no_match", "succeeded");
    return hit;
  };
  const cite = (read: CaptureRead, where: string): ArchivedAffiliation => ({
    url: `https://web.archive.org/web/${read.snap.timestamp}/${read.snap.original}`,
    year: read.snap.timestamp.slice(0, 4),
    where,
  });

  const paths = [`${clean}/team`, `${clean}/about`];
  for (const p of paths) {
    const snaps = await sampledSnapshots(p);
    if (!snaps.length) continue;
    const where = p.replace(clean, "").replace(/^\//, "") || "team";

    // Newest first, and stop there when it still shows the tie: a page that
    // never scrubbed anything then costs exactly one fetch, as before. We only
    // pay to walk the history for the case this module exists for.
    const newest = await readCapture(snaps[snaps.length - 1]);
    if (namesBoth(newest)) return cite(newest, where);

    // The newest capture is the first thing a scrub reaches, so its silence is
    // the start of the search, not the end of it.
    const older = await Promise.all(snaps.slice(0, -1).map(readCapture));
    const matches = older.filter(namesBoth);
    if (!matches.length) continue;

    // Cite the most recent capture that actually shows the tie: that date is the
    // latest moment we can say the page carried both names.
    const best = matches[matches.length - 1];
    const out = cite(best, where);
    // A capture we failed to fetch is not measured, so it can never carry the
    // second half of "present then, absent now". Only a newest capture we read
    // and found without both names supports reporting the gap at all.
    if (newest.text !== null) {
      const lastSeen = captureDate(best.snap.timestamp);
      const newestChecked = captureDate(newest.snap.timestamp);
      const capturesChecked = older.length + 1;
      out.disappearance = {
        lastSeen,
        newestChecked,
        capturesChecked,
        note: `Both names appear on the archived ${where} page in the ${lastSeen} capture and do not appear in the ${newestChecked} capture, the most recent one read. ${capturesChecked} captures were sampled across the archived range, so that is a floor on what the archive holds, not a total. Archived pages get restructured and re-pathed, so the later absence is not by itself evidence that the affiliation ended.`,
      };
    }
    return out;
  }
  return null;
}

// A needle only matches as whole words separated by real whitespace, so
// "ed chen" never matches inside "watched chennai".
function needleRegex(needle: string): RegExp {
  const parts = needle.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${parts.join("\\s+")}(?:[^\\p{L}\\p{N}]|$)`, "iu");
}

// Build conservative match needles from a display name: the full name, and the
// "first last" pair if there are >= 2 tokens. We require a multi-token name so a
// single common first name can't false-positive across an unrelated team page.
function nameNeedles(name: string): RegExp[] {
  const n = name.trim().toLowerCase();
  const toks = n.split(/\s+/).filter((t) => t.length > 1);
  if (toks.length < 2) return []; // too generic to corroborate safely
  const out = new Set<string>([n, `${toks[0]} ${toks[toks.length - 1]}`]);
  return [...out].map(needleRegex);
}
