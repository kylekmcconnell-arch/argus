// Direct team-page reader. Grok's web search summarizes; it can miss the one page
// that matters — the project's own /team roster (e.g. docs.vulcanforged.com/team).
// This fetches the likely team/about pages directly, strips them to text, and has
// Claude pull the named roster. Keyless fetch + ANTHROPIC_API_KEY for extraction.
import { structured } from "../agent";
import { recordCall } from "../cost";
import type { TeamMember } from "./x";

const normalizedApex = (domain: string) =>
  domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./i, "").toLowerCase();

// Common places a crypto/tech project lists its people. Probe the most likely
// paths first and stop when one works. The previous 48-URL fan-out made an
// ordinary "no public team page" result look like a provider outage and added
// avoidable latency to every project scan.
function candidateUrlTiers(domain: string): string[][] {
  const d = normalizedApex(domain);
  if (!d) return [];
  const www = d.startsWith("www.") ? d : `www.${d}`;
  return [
    [
      `https://${d}/team`,
      `https://${d}/about`,
      `https://${d}/about-us`,
      `https://${d}/leadership`,
      `https://docs.${d}/team`,
      `https://docs.${d}/team.md`,
      `https://docs.${d}/about`,
      `https://docs.${d}/about.md`,
    ],
    [
      `https://${d}/our-team`,
      `https://${d}/team-members`,
      `https://${d}/people`,
      `https://${d}/company`,
      `https://docs.${d}/leadership`,
      `https://docs.${d}/leadership.md`,
      `https://${www}/team`,
      `https://${www}/about`,
    ],
  ];
}

const TEAM_DOCUMENT_HINT = /(?:^|[\/_-])(team|leadership|founders?|people|company|about(?:-us)?|tokenomics|governance|transparency|contributors?)(?:[\/_\-.]|$)/i;

/**
 * Parse an official docs index without trusting it to name the team itself.
 * The returned URLs still have to be fetched and re-derived below. Keeping the
 * host pinned to the verified project domain prevents a model or compromised
 * index from sending identity collection to an unrelated site.
 */
export function teamDocumentUrlsFromIndex(domain: string, raw: string): string[] {
  const apex = normalizedApex(domain);
  if (!apex || !raw) return [];
  const matches = raw.match(/https?:\/\/[^\s<>"'\])}]+/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of matches) {
    try {
      const url = new URL(value.replace(/&amp;/g, "&").replace(/[.,;:]+$/, ""));
      const host = url.hostname.toLowerCase();
      if (host !== apex && !host.endsWith(`.${apex}`)) continue;
      if (!TEAM_DOCUMENT_HINT.test(`${url.hostname}${url.pathname}`)) continue;
      url.hash = "";
      url.search = "";
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      // Malformed index rows are ignored and never become fetch targets.
    }
    if (out.length >= 24) break;
  }
  return out;
}

async function discoverTeamDocumentUrls(domain: string): Promise<string[]> {
  const d = normalizedApex(domain);
  if (!d) return [];
  const indexes = [
    `https://${d}/llms.txt`,
    `https://${d}/sitemap.xml`,
    `https://docs.${d}/llms.txt`,
    `https://docs.${d}/sitemap.xml`,
  ];
  const bodies = await Promise.all(indexes.map(async (url) => {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/plain,application/xml,text/xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        recordCall(
          "site-fetch",
          "team-doc-index",
          0,
          `http_${response.status}`,
          response.status === 404 || response.status === 410 ? "partial" : "failed",
        );
        return "";
      }
      const text = await response.text();
      recordCall("site-fetch", "team-doc-index", 0, undefined, "succeeded");
      return text.slice(0, 250_000);
    } catch {
      recordCall("site-fetch", "team-doc-index", 0, "transport_error", "failed");
      return "";
    }
  }));
  return [...new Set(bodies.flatMap((body) => teamDocumentUrlsFromIndex(d, body)))];
}

export interface ProfileAnchor {
  /** linkedin.com/in/slug (no scheme, no trailing slash) or an @handle. */
  value: string;
  kind: "linkedin" | "x";
  /** Visible text of the anchor, often the person's name. */
  anchorText: string;
  /** Character offset in the source HTML, for nearest-name binding. */
  index: number;
}

const PROFILE_ANCHOR =
  /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;

/**
 * Profile links a team page states in its markup.
 *
 * htmlToText deletes every tag, so an `href` to a person's LinkedIn is gone
 * before the extractor reads the page: Orbit's roster linked all six profiles
 * and ARGUS stored linkedin: null for every one. Anchors are read from the raw
 * HTML first and bound to people deterministically afterwards, which needs no
 * model call and cannot hallucinate a profile that was not on the page.
 */
export function profileAnchors(html: string): ProfileAnchor[] {
  const out: ProfileAnchor[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(PROFILE_ANCHOR)) {
    const href = match[1].trim();
    const anchorText = htmlToText(match[2]).slice(0, 120);
    const index = match.index ?? 0;
    const linkedin = href.match(/linkedin\.com\/in\/([A-Za-z0-9%._-]{2,100})/i);
    if (linkedin) {
      const value = `linkedin.com/in/${linkedin[1].replace(/\/$/, "").toLowerCase()}`;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ value, kind: "linkedin", anchorText, index });
      continue;
    }
    const x = href.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})(?:[/?#]|$)/i);
    if (x && !/\/(?:status|intent|share|home|i)\b/i.test(href)) {
      const value = `@${x[1]}`;
      if (seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      out.push({ value, kind: "x", anchorText, index });
    }
  }
  return out;
}

const nameTokens = (value: string): string[] =>
  value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);

/**
 * Bind a page's profile anchors to a named person: the anchor's own text, then
 * the link slug (linkedin.com/in/niklas-homan for "Niklas Homan"), then the
 * anchor physically nearest the name in the markup. Every rule requires the
 * person's own name tokens, so a page's generic company LinkedIn is never
 * attached to an individual.
 */
export function bindProfileAnchor(
  name: string,
  html: string,
  anchors: readonly ProfileAnchor[],
  kind: ProfileAnchor["kind"],
): string | undefined {
  const tokens = nameTokens(name);
  if (tokens.length < 2) return undefined;
  const candidates = anchors.filter((anchor) => anchor.kind === kind);
  if (!candidates.length) return undefined;

  const byAnchorText = candidates.find((anchor) => {
    const text = nameTokens(anchor.anchorText);
    return tokens.every((token) => text.includes(token));
  });
  if (byAnchorText) return byAnchorText.value;

  const bySlug = candidates.find((anchor) => {
    const slug = nameTokens(anchor.value.replace(/^linkedin\.com\/in\//, "").replace(/^@/, ""));
    const joined = slug.join("");
    return tokens.every((token) => joined.includes(token));
  });
  if (bySlug) return bySlug.value;

  // Nearest anchor after the name appears in the markup, bounded so an
  // unrelated link further down the page is never adopted.
  const namePosition = html.toLowerCase().indexOf(tokens.join(" "));
  if (namePosition < 0) return undefined;
  const near = candidates
    .filter((anchor) => Math.abs(anchor.index - namePosition) <= 1200)
    .sort((a, b) => Math.abs(a.index - namePosition) - Math.abs(b.index - namePosition))[0];
  return near?.value;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string, expectedApex: string): Promise<TeamPage | null> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html,text/markdown,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
  } catch {
    recordCall("site-fetch", "team-page", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall(
      "site-fetch",
      "team-page",
      0,
      `http_${response.status}`,
      response.status === 404 || response.status === 410 ? "partial" : "failed",
    );
    return null;
  }
  // The same host pin teamDocumentUrlsFromIndex enforces, applied to the URL the
  // redirect chain actually landed on. Without it, a lapsed domain 301ing to an
  // unrelated roster-bearing site would be attributed as the project's own
  // first-party team page.
  const finalUrl = response.url || url;
  try {
    const finalHost = new URL(finalUrl).hostname.toLowerCase();
    if (finalHost !== expectedApex && !finalHost.endsWith(`.${expectedApex}`)) {
      recordCall("site-fetch", "team-page", 0, "redirected_offsite", "partial");
      return null;
    }
  } catch {
    recordCall("site-fetch", "team-page", 0, "redirected_offsite", "partial");
    return null;
  }
  const ct = response.headers.get("content-type") ?? "";
  if (!/html|markdown|text\/plain/i.test(ct)) {
    recordCall("site-fetch", "team-page", 0, "unexpected_content_type", "partial");
    return null;
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    recordCall("site-fetch", "team-page", 0, "response_text_error", "failed");
    return null;
  }
  // Markdown variants are already text; only HTML needs stripping.
  const text = /markdown|text\/plain/i.test(ct) || url.endsWith(".md") ? raw.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() : htmlToText(raw);
  // A real team page mentions roles; skip thin/404-ish pages.
  if (text.length < 300 || !/founder|ceo|cto|team|advisor|lead|head of|engineer|officer/i.test(text)) {
    recordCall("site-fetch", "team-page", 0, "insufficient_team_content", "partial");
    return null;
  }
  recordCall("site-fetch", "team-page", 0, undefined, "succeeded");
  return { url: finalUrl, text, html: raw, anchors: profileAnchors(raw) };
}

const roleEvidencePattern = (role: string): RegExp => {
  if (/founder/i.test(role)) return /\b(?:co-?founders?|founders?|started|founded)\b/i;
  if (/\bcto\b|technology/i.test(role)) return /\b(?:cto|chief technology officer)\b/i;
  if (/\bceo\b|executive/i.test(role)) return /\b(?:ceo|chief executive officer)\b/i;
  if (/advisor|adviser/i.test(role)) return /\b(?:advisor|adviser)\b/i;
  if (/engineer|developer/i.test(role)) return /\b(?:engineer|developer|dev)\b/i;
  if (/lead|head|chief/i.test(role)) return /\b(?:lead|head of|chief)\b/i;
  return /\b(?:team|core team|contributor)\b/i;
};

/** Require the person's identity and stated role to occur in the same passage. */
export function teamMemberIsDirectlySupported(text: string, name: string, handle: string | undefined, role: string, projectName?: string): boolean {
  const corpus = text.replace(/\s+/g, " ");
  const identities = [name, handle?.replace(/^@/, "")]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLowerCase());
  const lower = corpus.toLowerCase();
  const rolePattern = roleEvidencePattern(role);
  for (const identity of identities) {
    let offset = lower.indexOf(identity);
    while (offset >= 0) {
      const window = corpus.slice(Math.max(0, offset - 220), Math.min(corpus.length, offset + identity.length + 220));
      if (rolePattern.test(window) && (!projectName || window.toLowerCase().includes(projectName.toLowerCase()))) return true;
      offset = lower.indexOf(identity, offset + identity.length);
    }
  }
  return false;
}

const canonicalSourceUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

type TeamPage = { url: string; text: string; html?: string; anchors?: ProfileAnchor[] };

const pageScore = (page: TeamPage) =>
  (/\/(?:team|leadership|founders?|people)(?:[/.?#-]|$)/i.test(page.url) ? 100 : 0)
  + (/\b(?:co-?founders?|founders?)\b/i.test(page.text) ? 70 : 0)
  + (/\/(?:tokenomics|governance|transparency)(?:[/.?#-]|$)/i.test(page.url) ? 35 : 0)
  + Math.min(20, page.text.length / 1000);

const TEAM_EXTRACTION_SYSTEM =
  "You extract a crypto/tech project's team roster from fetched first-party project text. " +
  "List EVERY named person with a role: founders, executives (CEO/CTO/COO/CFO/CMO), core team, engineering/product leads, and named advisors. " +
  "Use the exact role the page states. Capture any X/Twitter handle and LinkedIn URL shown next to a person. " +
  "For every person copy the exact PAGE URL that directly states that person's role. " +
  "Do NOT invent people or roles; include only names actually present in the text. Never use em dashes.";

const TEAM_EXTRACTION_TOOL = {
  name: "record_team",
  description: "Record named project people whose roles are directly stated in fetched first-party text.",
  input_schema: {
    type: "object" as const,
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            twitter: { type: "string", description: "@handle if shown" },
            linkedin: { type: "string", description: "linkedin.com/in/... if shown" },
            source_url: { type: "string", description: "Exact PAGE URL from the supplied corpus that directly states this role" },
          },
          required: ["name", "role", "source_url"],
        },
      },
    },
    required: ["people"],
  },
};

async function extractTeamFromPages(
  pages: TeamPage[],
  projectName?: string,
  requireProjectInPassage = false,
): Promise<TeamMember[]> {
  if (!pages.length) return [];
  const selectedPages = [...pages]
    .sort((a, b) => pageScore(b) - pageScore(a) || b.text.length - a.text.length)
    .slice(0, 3);
  const corpus = selectedPages.map((page) => `PAGE ${page.url}:\n${page.text.slice(0, 5000)}`).join("\n\n");
  const out = await structured<{ people: { name: string; role: string; twitter?: string; linkedin?: string; source_url: string }[] }>(
    TEAM_EXTRACTION_SYSTEM,
    `Project${projectName ? ` ${projectName}` : ""} first-party team evidence:\n\n${corpus}`,
    TEAM_EXTRACTION_TOOL,
    2048,
  );
  if (!out?.people?.length) return [];
  return out.people
    .filter((person) => person.name && person.name.trim())
    .flatMap((person) => {
      const rawName = person.name.trim();
      const displayName = /^[a-z][a-z'-]{1,30}$/.test(rawName)
        ? rawName[0].toUpperCase() + rawName.slice(1)
        : rawName;
      const role = (person.role || "team").toString();
      const kind: "team" | "advisor" = /advisor|advis|backer|mentor/i.test(role) ? "advisor" : "team";
      const handle = person.twitter && /^@?[A-Za-z0-9_]{2,30}$/.test(person.twitter.replace(/^@/, "")) ? "@" + person.twitter.replace(/^@/, "") : undefined;
      const modelLinkedin = person.linkedin && /linkedin\.com\/(in|company)\//i.test(person.linkedin) ? person.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined;
      const claimedSource = canonicalSourceUrl(person.source_url);
      const sourcePage = selectedPages.find((page) => canonicalSourceUrl(page.url) === claimedSource);
      // The page's own markup is the authority on which profile belongs to whom.
      const linkedin = modelLinkedin
        ?? (sourcePage?.html && sourcePage.anchors
          ? bindProfileAnchor(displayName, sourcePage.html, sourcePage.anchors, "linkedin")
          : undefined);
      const boundHandle = handle
        ?? (sourcePage?.html && sourcePage.anchors
          ? bindProfileAnchor(displayName, sourcePage.html, sourcePage.anchors, "x")
          : undefined);
      if (!sourcePage || !teamMemberIsDirectlySupported(
        sourcePage.text,
        displayName,
        handle,
        role,
        requireProjectInPassage ? projectName : undefined,
      )) return [];
      return [{
        name: displayName,
        handle: boundHandle,
        role,
        kind,
        linkedin,
        evidence: `direct role statement on ${sourcePage.url}`,
        source: sourcePage.url,
        sourceUrl: sourcePage.url,
      }];
    });
}

async function discoverFounderAuthoredForumUrls(domain: string, verifiedTeam: TeamMember[]): Promise<string[]> {
  const apex = normalizedApex(domain);
  if (!apex || !verifiedTeam.length) return [];
  const verifiedAuthors = new Set(verifiedTeam.flatMap((person) => [person.name, person.handle?.replace(/^@/, "")])
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLowerCase()));
  const searches = ["cofounder", "co-founder"];
  const hosts = [`discuss.${apex}`, `forum.${apex}`];
  const results = await Promise.all(hosts.flatMap((host) => searches.map(async (query) => {
    try {
      const response = await fetch(`https://${host}/search.json?q=${encodeURIComponent(query)}`, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return [];
      const payload = await response.json() as {
        posts?: { username?: string; name?: string; topic_id?: number; post_number?: number }[];
        topics?: { id?: number; slug?: string }[];
      };
      const slugs = new Map((payload.topics ?? [])
        .filter((topic) => Number.isInteger(topic.id) && typeof topic.slug === "string" && topic.slug)
        .map((topic) => [topic.id!, topic.slug!]));
      return (payload.posts ?? []).flatMap((post) => {
        const authorNames = [post.username, post.name]
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) => value.trim().toLowerCase());
        const slug = slugs.get(post.topic_id ?? -1);
        if (!authorNames.some((author) => verifiedAuthors.has(author)) || !slug || !Number.isInteger(post.post_number)) return [];
        return [`https://${host}/t/${slug}/${post.topic_id}/${post.post_number}`];
      });
    } catch {
      return [];
    }
  })));
  return [...new Set(results.flat())].slice(0, 8);
}

export async function fetchTeamPage(domain: string, projectName?: string): Promise<TeamMember[]> {
  const apex = normalizedApex(domain);
  if (!apex) return [];
  const [primaryCandidates = [], fallbackCandidates = []] = candidateUrlTiers(domain);
  const primaryUrls = [...new Set([
    ...(await discoverTeamDocumentUrls(domain)),
    ...primaryCandidates,
  ])];
  if (!primaryUrls.length) return [];
  let pages = (await Promise.all(primaryUrls.map((u) => fetchPage(u, apex)))).filter(Boolean) as TeamPage[];
  if (!pages.length && fallbackCandidates.length) {
    pages = (await Promise.all(fallbackCandidates.map((u) => fetchPage(u, apex)))).filter(Boolean) as TeamPage[];
  }
  if (!pages.length) return [];
  const directTeam = await extractTeamFromPages(pages, projectName);
  const forumUrls = await discoverFounderAuthoredForumUrls(domain, directTeam);
  const forumPages = (await Promise.all(forumUrls.map((u) => fetchPage(u, apex)))).filter(Boolean) as TeamPage[];
  const forumTeam = await extractTeamFromPages(forumPages, projectName, true);
  const seen = new Set<string>();
  return [...directTeam, ...forumTeam].filter((person) => {
    const key = (person.handle ?? person.name).replace(/^@/, "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
