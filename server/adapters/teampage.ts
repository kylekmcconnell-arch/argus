// Direct team-page reader. Grok's web search summarizes; it can miss the one page
// that matters — the project's own /team roster (e.g. docs.vulcanforged.com/team).
// This fetches the likely team/about pages directly, strips them to text, and has
// Claude pull the named roster. Keyless fetch + ANTHROPIC_API_KEY for extraction.
import { structured } from "../agent";
import { recordCall } from "../cost";
import { fetchPublicTextWithRecovery, type PublicTextWithRecoveryResult } from "../publicWeb";
import type { TeamMember } from "./x";

const normalizedApex = (domain: string) =>
  domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./i, "").toLowerCase();

/**
 * One bounded retry on a thrown fetch (DNS blip, dropped connection, timeout).
 * The roster fetches arrive in a burst right after the substance fetch, and an
 * origin that resets one connection under that burst routinely serves the
 * retry; a scan that lost its team page, doc index, AND credits page to
 * transport_error published "3 sources temporarily unavailable" for what one
 * retry would have covered. `init` is a factory so each attempt gets a fresh
 * AbortSignal (a fired timeout signal would instantly abort the retry).
 */
async function fetchWithOneRetry(url: string, init: () => RequestInit): Promise<Response> {
  try {
    return await fetch(url, init());
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return fetch(url, init());
  }
}

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

const TEAM_DOCUMENT_HINT = /(?:^|[/_-])(team|leadership|founders?|people|company|about(?:-us)?|tokenomics|governance|transparency|contributors?)(?:[/_\-.]|$)/i;

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
      const response = await fetchWithOneRetry(url, () => ({
        headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/plain,application/xml,text/xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      }));
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

export interface OfficialPortraitAnchor {
  /** HTTPS image URL stated directly in the fetched first-party page markup. */
  url: string;
  /** Character offset of the image tag in the fetched HTML. */
  index: number;
  /** Nearby author-supplied label when present. */
  label: string;
}

const PORTRAIT_IMAGE_HINT = /(?:team[-_ ]?(?:image|photo)|avatar|headshot|portrait|profile[-_ ]?(?:image|photo)|person[-_ ]?(?:image|photo)|member[-_ ]?(?:image|photo)|advisor[-_ ]?(?:image|photo)|founder[-_ ]?(?:image|photo))/i;
const PORTRAIT_FILE = /\.(?:avif|jpe?g|png|webp)(?:$|[?#])/i;

const htmlAttribute = (tag: string, name: string): string => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i"));
  return (match?.[1] ?? match?.[2] ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
};

const srcsetCandidate = (value: string): string => {
  const candidates = value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  return candidates[candidates.length - 1] ?? "";
};

/**
 * Extract only portrait-like image tags from a fetched first-party page.
 * The model never supplies these URLs: the exact tag, URL, and offset all come
 * from the saved page HTML so an arbitrary search image cannot become a face.
 */
export function officialPortraitAnchors(html: string, pageUrl: string): OfficialPortraitAnchor[] {
  const out: OfficialPortraitAnchor[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const label = [htmlAttribute(tag, "alt"), htmlAttribute(tag, "title")].filter(Boolean).join(" ");
    const hintCorpus = [
      htmlAttribute(tag, "class"),
      htmlAttribute(tag, "id"),
      label,
      htmlAttribute(tag, "data-name"),
      htmlAttribute(tag, "data-testid"),
    ].join(" ");
    const raw = htmlAttribute(tag, "data-src")
      || htmlAttribute(tag, "data-lazy-src")
      || htmlAttribute(tag, "src")
      || srcsetCandidate(htmlAttribute(tag, "srcset"));
    if (!raw || (!PORTRAIT_IMAGE_HINT.test(hintCorpus) && !PORTRAIT_IMAGE_HINT.test(raw))) continue;
    try {
      const url = new URL(raw, pageUrl);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol !== "https:"
        || url.username
        || url.password
        || (url.port && url.port !== "443")
        || !host
        || host === "localhost"
        || host.endsWith(".localhost")
        || host.endsWith(".local")
        || host.endsWith(".internal")
        || !PORTRAIT_FILE.test(url.pathname)
      ) continue;
      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ url: normalized, index: match.index ?? 0, label });
    } catch {
      // Malformed image tags remain ordinary page decoration.
    }
    if (out.length >= 80) break;
  }
  return out;
}

/** Bind a named roster row to the nearest portrait-like image in the same page. */
export function bindOfficialPortrait(
  name: string,
  html: string,
  portraits: readonly OfficialPortraitAnchor[],
): string | undefined {
  if (!portraits.length) return undefined;
  const lower = html.toLowerCase();
  const normalizedName = name.trim().toLowerCase();
  const tokens = nameTokens(name);
  let namePosition = normalizedName ? lower.indexOf(normalizedName) : -1;
  if (namePosition < 0 && tokens.length) namePosition = lower.indexOf(tokens[0]);
  if (namePosition < 0) return undefined;

  const ranked = portraits.map((portrait) => {
    const labelTokens = nameTokens(portrait.label);
    const filenameTokens = nameTokens(new URL(portrait.url).pathname.split("/").pop() ?? "");
    const labelMatch = tokens.length > 0 && tokens.every((token) => labelTokens.includes(token));
    const filenameMatch = tokens.length > 1 && tokens.every((token) => filenameTokens.includes(token));
    const distance = Math.abs(portrait.index - namePosition);
    return {
      portrait,
      distance,
      beforeName: portrait.index <= namePosition,
      score: distance - (labelMatch ? 3000 : 0) - (filenameMatch ? 1200 : 0),
      strong: labelMatch || filenameMatch,
    };
  }).sort((a, b) => a.score - b.score);
  const strong = ranked.find((candidate) => candidate.strong);
  if (strong) return strong.portrait.url;
  // Team cards conventionally place the portrait before the name. Prefer the
  // nearest preceding portrait so the next card's shorter markup cannot steal
  // the identity (ANYONE's Webflow srcset makes this exact ordering visible).
  const preceding = ranked
    .filter((candidate) => candidate.beforeName && candidate.distance <= 2400)
    .sort((a, b) => a.distance - b.distance)[0];
  if (preceding) return preceding.portrait.url;
  const following = ranked
    .filter((candidate) => !candidate.beforeName && candidate.distance <= 1000)
    .sort((a, b) => a.distance - b.distance)[0];
  return following?.portrait.url;
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

// ── First-party credit-grammar scan ──
// The Clutch Markets case: the founder was credited ONLY in the page footer
// ("Built by OxSimpleFarmer", "© … Built by OxSimpleFarmer") — no team
// section, no "founder" word anywhere, so both the roster gate and the LLM
// extractor had nothing to read. Credits follow a tiny grammar ("built by X",
// "founded by X", "founder: X", "a X production"), so mine them the same way
// scanPostsForRoles mines posts: bind ONLY the immediately adjacent name or
// @handle, deterministically, and let the fetched first-party page itself be
// the artifact that verifies the claim.

/** Credit verb -> the role the credit actually states. Nothing here upgrades
 *  a "built by" into "founder"; the page said builder, we say builder. */
const CREDIT_ROLES: Record<string, string> = {
  built: "builder", founded: "founder", created: "creator", developed: "developer", made: "creator",
};

// A credited identity: an @handle, or 1-3 words whose casing says "name"
// ("OxSimpleFarmer", "John Smith"). Matched case-insensitively with the
// grammar, then re-validated case-sensitively below so "built by the
// community" never binds "the".
const CREDIT_NAME = "(@[A-Za-z0-9_]{2,30}|[A-Za-z0-9][\\w.'-]{1,29}(?:\\s+[A-Za-z0-9][\\w.'-]{1,29}){0,2})";
const CREDIT_GRAMMARS: { pattern: RegExp; role: (match: RegExpMatchArray) => string }[] = [
  // "built by X", "founded by X", "created with ❤ by X"
  {
    pattern: new RegExp(`\\b(built|founded|created|developed|made)(?:\\s+with\\s+\\S{1,16})?\\s+by\\s+${CREDIT_NAME}`, "gi"),
    role: (match) => CREDIT_ROLES[match[1].toLowerCase()] ?? "team",
  },
  // "Founder: X", "Co-founders: X"
  {
    pattern: new RegExp(`\\b(co-?founders?|founders?)\\s*[::]\\s*${CREDIT_NAME}`, "gi"),
    role: (match) => (/^co/i.test(match[1]) ? "cofounder" : "founder"),
  },
  // "a X production"
  {
    pattern: new RegExp(`\\ban?\\s+${CREDIT_NAME}\\s+production\\b`, "gi"),
    role: () => "creator",
  },
];

// Footers credit site builders and platforms in the same grammar ("Built by
// Webflow"); a platform is not a person. Also drops articles/collectives the
// name shape can't reject on its own.
const NON_PERSON_CREDITS = new Set([
  "the", "a", "an", "our", "us", "we", "you", "team", "community", "fans", "ai",
  "webflow", "framer", "wix", "squarespace", "wordpress", "shopify", "vercel", "netlify",
  "gitbook", "notion", "carrd", "canva", "gamma", "figma", "react", "nextjs", "next.js",
  "bubble", "durable", "lovable", "bolt", "v0", "replit", "cursor", "claude", "chatgpt",
]);

const creditKey = (value: string): string => value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");

/**
 * Deterministic scan of fetched first-party page text for credit grammars.
 * Mirrors the scanPostsForRoles doctrine: a narrow adjacent-binding grammar,
 * dedupe, hard cap — a model may keep broader candidates as leads, but
 * governing evidence requires this grammar inside a fetched first-party page.
 * When the page's anchors are supplied, a credited bare name whose footer
 * link points at their X profile gets that handle bound deterministically.
 */
export function scanPageTextForCredits(
  text: string,
  sourceUrl: string,
  projectName?: string,
  anchors?: readonly ProfileAnchor[],
): TeamMember[] {
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  const corpus = text.replace(/\s+/g, " ").slice(0, 40_000);
  const projectKey = projectName?.trim() ? creditKey(projectName) : "";
  for (const grammar of CREDIT_GRAMMARS) {
    for (const match of corpus.matchAll(grammar.pattern)) {
      const captured = match[match.length - 1].trim();
      // Case-sensitive re-validation: keep leading words that look like a
      // name or handle ("OxSimpleFarmer team" -> "OxSimpleFarmer"); reject
      // the match entirely when the FIRST word already fails.
      const words: string[] = [];
      for (const word of captured.split(/\s+/)) {
        if (!/^[@0-9A-Z]/.test(word) || NON_PERSON_CREDITS.has(word.toLowerCase())) break;
        words.push(word);
      }
      if (!words.length) continue;
      const name = words.join(" ").replace(/[.,;:]+$/, "");
      const key = creditKey(name);
      if (!key || NON_PERSON_CREDITS.has(name.toLowerCase()) || seen.has(key)) continue;
      // A project crediting itself ("Built by Clutch") names no person.
      if (projectKey && (key === projectKey || projectKey.startsWith(key))) continue;
      seen.add(key);
      const handle = name.startsWith("@")
        ? name
        : anchors?.find((anchor) => anchor.kind === "x"
            && (creditKey(anchor.anchorText) === key || creditKey(anchor.value) === key))?.value;
      const phrase = match[0].replace(/\s+/g, " ").trim();
      out.push({
        name,
        handle,
        role: grammar.role(match),
        kind: "team",
        evidence: `the project's own page credits "${phrase}"`,
        source: "site credit scan",
        sourceUrl,
      });
    }
  }
  return out.slice(0, 6);
}

type TeamPageDependencies = {
  recoverOfficialText?: (url: string) => Promise<PublicTextWithRecoveryResult>;
};

function recoveredTeamPage(
  recovered: PublicTextWithRecoveryResult,
  url: string,
  expectedApex: string,
  purpose: "roster" | "credits",
  failureMeta: string,
): TeamPage | null {
  const op = purpose === "credits" ? "site-credits" : "team-page";
  if (recovered.status !== "ok") return null;
  try {
    const finalHost = new URL(recovered.url).hostname.toLowerCase();
    if (finalHost !== expectedApex && !finalHost.endsWith(`.${expectedApex}`)) return null;
  } catch {
    return null;
  }
  const text = recovered.text.replace(/\s+/g, " ").trim();
  if (purpose === "credits") {
    if (text.length < 40) return null;
  } else if (text.length < 300 || !/founder|ceo|cto|team|advisor|lead|head of|engineer|officer/i.test(text)) {
    return null;
  }
  recordCall("site-fetch", op, 0, `reader_recovery_after_${failureMeta}`, "succeeded");
  const sourceUrl = recovered.url || url;
  return {
    url: sourceUrl,
    text,
    html: recovered.text,
    anchors: profileAnchors(recovered.text),
    portraits: officialPortraitAnchors(recovered.text, sourceUrl),
    capturedAt: recovered.capturedAt,
  };
}

async function fetchPage(
  url: string,
  expectedApex: string,
  purpose: "roster" | "credits" = "roster",
  recoverOfficialText: (url: string) => Promise<PublicTextWithRecoveryResult> = fetchPublicTextWithRecovery,
  allowRecovery = false,
): Promise<TeamPage | null> {
  const op = purpose === "credits" ? "site-credits" : "team-page";
  let response: Response;
  try {
    response = await fetchWithOneRetry(url, () => ({ headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html,text/markdown,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(8000) }));
  } catch {
    if (allowRecovery) {
      const recovered = recoveredTeamPage(await recoverOfficialText(url), url, expectedApex, purpose, "transport_error");
      if (recovered) return recovered;
    }
    recordCall("site-fetch", op, 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    if (allowRecovery && (response.status === 403 || response.status === 429)) {
      const recovered = recoveredTeamPage(await recoverOfficialText(url), url, expectedApex, purpose, `http_${response.status}`);
      if (recovered) return recovered;
    }
    recordCall(
      "site-fetch",
      op,
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
      recordCall("site-fetch", op, 0, "redirected_offsite", "partial");
      return null;
    }
  } catch {
    recordCall("site-fetch", op, 0, "redirected_offsite", "partial");
    return null;
  }
  const ct = response.headers.get("content-type") ?? "";
  if (!/html|markdown|text\/plain/i.test(ct)) {
    recordCall("site-fetch", op, 0, "unexpected_content_type", "partial");
    return null;
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    recordCall("site-fetch", op, 0, "response_text_error", "failed");
    return null;
  }
  // Markdown variants are already text; only HTML needs stripping.
  const text = /markdown|text\/plain/i.test(ct) || url.endsWith(".md") ? raw.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() : htmlToText(raw);
  // A real team page mentions roles; skip thin/404-ish pages. The credit scan
  // exists precisely for pages with NO role words (the Clutch footer), so its
  // fetch only requires enough text to scan.
  if (purpose === "credits") {
    if (text.length < 40) {
      recordCall("site-fetch", op, 0, "insufficient_page_content", "partial");
      return null;
    }
  } else if (text.length < 300 || !/founder|ceo|cto|team|advisor|lead|head of|engineer|officer/i.test(text)) {
    recordCall("site-fetch", op, 0, "insufficient_team_content", "partial");
    return null;
  }
  recordCall("site-fetch", op, 0, undefined, "succeeded");
  return {
    url: finalUrl,
    text,
    html: raw,
    anchors: profileAnchors(raw),
    portraits: officialPortraitAnchors(raw, finalUrl),
    capturedAt: new Date().toISOString(),
  };
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

type TeamPage = {
  url: string;
  text: string;
  html?: string;
  anchors?: ProfileAnchor[];
  portraits?: OfficialPortraitAnchor[];
  capturedAt?: string;
};

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
      const officialPortraitUrl = sourcePage?.html && sourcePage.portraits
        ? bindOfficialPortrait(displayName, sourcePage.html, sourcePage.portraits)
        : undefined;
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
        ...(officialPortraitUrl ? {
          officialPortraitUrl,
          officialPortraitSourceUrl: sourcePage.url,
          officialPortraitCapturedAt: sourcePage.capturedAt ?? new Date().toISOString(),
        } : {}),
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

export async function fetchTeamPage(
  domain: string,
  projectName?: string,
  dependencies: TeamPageDependencies = {},
): Promise<TeamMember[]> {
  const apex = normalizedApex(domain);
  if (!apex) return [];
  const recoverOfficialText = dependencies.recoverOfficialText ?? fetchPublicTextWithRecovery;
  const [primaryCandidates = [], fallbackCandidates = []] = candidateUrlTiers(domain);
  const discoveredUrls = await discoverTeamDocumentUrls(domain);
  const discoveredSet = new Set(discoveredUrls);
  const primaryUrls = [...new Set([
    ...discoveredUrls,
    ...primaryCandidates,
  ])];
  if (!primaryUrls.length) return [];
  let pages = (await Promise.all(primaryUrls.map((u) => fetchPage(u, apex, "roster", recoverOfficialText, discoveredSet.has(u))))).filter(Boolean) as TeamPage[];
  if (!pages.length && fallbackCandidates.length) {
    pages = (await Promise.all(fallbackCandidates.map((u) => fetchPage(u, apex, "roster", recoverOfficialText)))).filter(Boolean) as TeamPage[];
  }
  // The homepage never qualifies as a roster page, but its footer is where a
  // one-person project credits its builder (the Clutch Markets case). Fetch it
  // for the deterministic credit scan only — it is never fed to the LLM lane.
  const homePage = await fetchPage(`https://${apex}/`, apex, "credits", recoverOfficialText, true)
    ?? await fetchPage(`https://www.${apex}/`, apex, "credits", recoverOfficialText, true);
  const apexLabel = apex.split(".")[0];
  const creditSeen = new Set<string>();
  const creditTeam = [...pages, ...(homePage ? [homePage] : [])]
    .flatMap((page) => scanPageTextForCredits(page.text, page.url, projectName, page.anchors))
    .filter((person) => {
      const key = (person.handle ?? person.name).replace(/^@/, "").trim().toLowerCase();
      // A credit naming the site itself ("Built by Clutch") is self-reference.
      if (!key || key === apexLabel || creditSeen.has(key)) return false;
      creditSeen.add(key);
      return true;
    })
    .slice(0, 6);
  if (!pages.length && !creditTeam.length) return [];
  const directTeam = pages.length ? await extractTeamFromPages(pages, projectName) : [];
  const forumUrls = await discoverFounderAuthoredForumUrls(domain, directTeam);
  const forumPages = (await Promise.all(forumUrls.map((u) => fetchPage(u, apex, "roster", recoverOfficialText, true)))).filter(Boolean) as TeamPage[];
  const forumTeam = forumPages.length ? await extractTeamFromPages(forumPages, projectName, true) : [];
  const seen = new Set<string>();
  // Credit hits come LAST so an LLM-extracted roster row for the same person
  // (usually richer: exact stated role, profile links) wins the dedupe.
  return [...directTeam, ...forumTeam, ...creditTeam].filter((person) => {
    const key = (person.handle ?? person.name).replace(/^@/, "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
