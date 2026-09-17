import { deadlineFetch } from "../providerDeadline.js";
// First-party backer wall: projects publish their investors on their own site
// ("Backed by the best in DeFi" with a logo wall). That is the subject's own
// claim about who funded it, and it belongs on the report as self-published
// evidence (never a score floor) instead of being ignored while a funding
// aggregator stays empty (the Ammalgam case: Selini, Robot Ventures,
// Framework, NGC, Faction and more sat on ammalgam.xyz while the report showed
// no backers). Logo walls carry the names in image alt/aria/title attributes
// and anchor text, so extraction reads the raw markup, scoped to the section
// under the backers heading, and never guesses from page-wide noise.
import { recordCall } from "../cost";
import { captureTimestamp } from "../captureTime";

const USER_AGENT = "Mozilla/5.0 (compatible; ARGUS/1.0)";
const SECTION_WINDOW = 7_000;
const MAX_NAMES = 20;

const BACKERS_HEADING = /\bbacked by\b[^<]{0,80}|\bour (?:investors|backers)\b|\binvestors\b[^<]{0,40}|\bour angels\b/i;

/** Attribute and anchor-text noise that is never a backer name. */
const NAME_NOISE = /^(?:logo|icon|image|img|arrow|background|banner|avatar|photo|learn more|read more|x|twitter|discord|telegram|github|medium|linkedin|menu|close|open|backed by.*|our (?:investors|backers))$/i;

const cleanName = (value: string): string | null => {
  const name = value.replace(/\s+/g, " ").replace(/\s*(?:logo|logotype|icon)$/i, "").trim();
  if (name.length < 2 || name.length > 48) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .,'&()/-]*$/.test(name)) return null;
  if (NAME_NOISE.test(name)) return null;
  // A backer name carries at least one letter run; bare numbers never qualify.
  if (!/[A-Za-z]{2}/.test(name)) return null;
  return name;
};

export interface SiteBackersSection {
  heading: string;
  names: string[];
  excerpt: string;
}

/**
 * Extract the self-published backer names from a page's raw markup: find the
 * backers heading, then read alt/aria-label/title attributes and anchor text
 * within the section that follows it. Exported for tests.
 */
export function extractSiteBackers(html: string): SiteBackersSection | null {
  const headingMatch = html.match(BACKERS_HEADING);
  if (!headingMatch || headingMatch.index === undefined) return null;
  const heading = headingMatch[0].replace(/\s+/g, " ").trim();
  const window = html.slice(headingMatch.index, headingMatch.index + SECTION_WINDOW);

  const names: string[] = [];
  const push = (value: string) => {
    const name = cleanName(value);
    if (!name) return;
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) return;
    if (names.length < MAX_NAMES) names.push(name);
  };
  for (const match of window.matchAll(/\b(?:alt|aria-label|title)\s*=\s*["']([^"'<>]{2,60})["']/gi)) {
    push(match[1]);
  }
  for (const match of window.matchAll(/<a\b[^>]*>\s*([^<>{}]{2,48}?)\s*<\/a>/gi)) {
    push(match[1]);
  }
  if (!names.length) return null;
  return {
    heading,
    names,
    excerpt: `${heading} · ${names.join(", ")}`.slice(0, 500),
  };
}

export interface SiteBackersOutcome {
  available: boolean;
  value?: {
    heading: string;
    names: string[];
    excerpt: string;
    sourceUrl: string;
    capturedAt: string;
  };
  note?: string;
}

/**
 * Fetch the official site (root, then /about) and extract its self-published
 * backer wall. A redirect off the controlled apex is discarded: a parked
 * domain must never hand the subject someone else's investor list.
 */
export async function collectSiteBackers(
  officialWebsite: string,
  fetcher: typeof fetch = deadlineFetch,
): Promise<SiteBackersOutcome> {
  let origin: URL;
  try {
    origin = new URL(officialWebsite);
  } catch {
    return { available: false, note: "No usable official website." };
  }
  const apex = origin.hostname.toLowerCase().replace(/^www\./, "");
  for (const url of [origin.toString(), new URL("about", origin).toString()]) {
    try {
      const response = await fetcher(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (!response.ok) continue;
      const landed = response.url ? new URL(response.url).hostname.toLowerCase().replace(/^www\./, "") : "";
      if (landed && landed !== apex && !landed.endsWith(`.${apex}`)) continue;
      const html = (await response.text()).slice(0, 900_000);
      const section = extractSiteBackers(html);
      if (section) {
        recordCall("site-fetch", "backer-wall", 0, `${apex} · ${section.names.length}_names`, "succeeded");
        return {
          available: true,
          value: { ...section, sourceUrl: url, capturedAt: captureTimestamp() },
        };
      }
    } catch {
      continue;
    }
  }
  return { available: false, note: "The official site publishes no readable backer section." };
}
