// Wayback Machine corroboration. An off-LinkedIn role often left a fingerprint
// that was later scrubbed: a name on a /team page, an /about blurb, a launch post.
// archive.org keeps those snapshots forever. Given a candidate venture's domain
// and the subject's name, we look for the name in archived team/about/home pages.
// This is pure corroboration of an ALREADY-discovered lead, never a fishing trip:
// it only ever confirms a tie the discovery layer already proposed.

import { recordCall } from "../cost";
import { htmlToText } from "./teampage";

const CDX = "https://web.archive.org/cdx/search/cdx";

interface Snapshot { timestamp: string; original: string }

async function newestSnapshot(urlPath: string): Promise<Snapshot | null> {
  let response: Response;
  try {
    const qs = `?url=${encodeURIComponent(urlPath)}&output=json&filter=statuscode:200&collapse=digest&limit=-1`;
    response = await fetch(CDX + qs, { signal: AbortSignal.timeout(4000) });
  } catch {
    recordCall("wayback", "cdx-search", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("wayback", "cdx-search", 0, `http_${response.status}`, "failed");
    return null;
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    recordCall("wayback", "cdx-search", 0, "response_json_error", "failed");
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) {
    recordCall("wayback", "cdx-search", 0, "invalid_result_shape", "partial");
    return null;
  }
  const rows = parsed as unknown[][];
  if (rows.length < 2) {
    recordCall("wayback", "cdx-search", 0, "no_snapshot", "succeeded");
    return null;
  }
  // rows[0] is the header: [urlkey, timestamp, original, mimetype, statuscode, digest, length]
  const header = rows[0];
  const last = rows[rows.length - 1];
  const ti = header.indexOf("timestamp");
  const oi = header.indexOf("original");
  if (ti < 0 || oi < 0 || typeof last[ti] !== "string" || typeof last[oi] !== "string") {
    recordCall("wayback", "cdx-search", 0, "invalid_result_shape", "partial");
    return null;
  }
  recordCall("wayback", "cdx-search", 0, undefined, "succeeded");
  return { timestamp: last[ti], original: last[oi] };
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
): Promise<{ url: string; year: string; where: string } | null> {
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
  const paths = [`${clean}/team`, `${clean}/about`];
  for (const p of paths) {
    const snap = await newestSnapshot(p);
    if (!snap) continue;
    let response: Response;
    try {
      const archiveUrl = `https://web.archive.org/web/${snap.timestamp}id_/${snap.original}`;
      response = await fetch(archiveUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        recordCall("wayback", "snapshot-fetch", 0, `http_${response.status}`, "failed");
        continue;
      }
      let text: string;
      try {
        // Strip markup and collapse whitespace before matching: a roster row like
        // "<span>John</span> <span>Smith</span>" must match, and a name-shaped
        // substring inside a script, comment, or longer word must not.
        text = htmlToText(await response.text());
      } catch {
        recordCall("wayback", "snapshot-fetch", 0, "response_text_error", "failed");
        continue;
      }
      if (!text.trim()) {
        recordCall("wayback", "snapshot-fetch", 0, "empty_snapshot", "partial");
        continue;
      }
      const matched = subjectNeedles.some((n) => n.test(text)) && ventureNeedles.some((n) => n.test(text));
      recordCall("wayback", "snapshot-fetch", 0, matched ? "subject_and_venture_match" : "no_match", "succeeded");
      if (matched) {
        return {
          url: `https://web.archive.org/web/${snap.timestamp}/${snap.original}`,
          year: snap.timestamp.slice(0, 4),
          where: p.replace(clean, "").replace(/^\//, "") || "team",
        };
      }
    } catch {
      recordCall("wayback", "snapshot-fetch", 0, "transport_error", "failed");
    }
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
