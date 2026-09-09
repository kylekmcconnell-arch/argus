// Who the page actually names, with the role it gives them. Three readers, all
// deterministic and all gated by the same person-name discipline that #341
// introduced (a Title-case desk phrase is not a person; a bio @mention is not
// a handle):
//
//   roster       - the structural shape of a team page: a line that is only a
//                  name, followed by a line that is only a title ("Alex Monje" /
//                  "Partner, Chief Legal Officer"), or both on one line split by
//                  a dash, pipe, or comma. This is how the rendering crawler's
//                  markdown and block-aware HTML text both present a card grid.
//   inline-role  - a name immediately adjacent to a role word inside prose
//                  ("Jane Smith, Managing Partner leads the fund").
//   founded-by   - "founded by … Hans Thomas", the one prose claim that names a
//                  principal without a title next to the name.
//
// Nothing here invents a person. A name without a role is not promoted.
import { isPlausiblePersonRosterName } from "../lib/personName";

export interface NamedPerson {
  name: string;
  /** The title exactly as the page gives it, or null when only prose named them. */
  role: string | null;
  /** A first-party link attached to the name (personal site, LinkedIn profile). */
  link?: string;
  basis: "roster" | "inline-role" | "founded-by";
}

// Spaces only: `\s` also matches newlines and glued "Al Yousuf\nSenior Advisor"
// into a fake three-word name sitting next to the role.
const NAME = "[A-Z][a-z]+(?:[ \\t][A-Z][a-z]+){1,2}";
const ROLES = "co-?founder|cofounder|founder|ceo|cto|coo|cfo|chief[\\w ]{2,24}officer|managing partner|general partner|head of [\\w ]{2,24}|advisor|lead engineer";
const NAME_ROLE = new RegExp(`\\b(${NAME})\\b[\\s,\\u2013\\u2014|·\\-]{1,4}(${ROLES})\\b`, "gi");
const ROLE_NAME = new RegExp(`\\b(${ROLES})\\b[\\s:\\u2013\\u2014\\-]{1,4}(${NAME})\\b`, "gi");
// "founded by" followed by at most a short run of lowercase descriptors and then
// the name. A preposition in that run ("veterans from Goldman Sachs") means an
// organization follows, so the run stops there and no name is read.
// Case-sensitive on purpose: the name group must stay Title-case, or the
// excluded preposition would be swallowed into it ("from Goldman Sachs").
const FOUNDED_BY = new RegExp(`\\b[Ff]ounded [Bb]y\\s+(?:(?!(?:from|at|of|in|by|the|a|an)\\b)[a-z][a-z-]*\\s+){0,8}(${NAME})\\b`, "g");

// Words that begin a phrase but never a person's first name, and brand-ish
// second tokens, both of which produce false "names".
const FIRST_BAD = /^(Visit|Join|Read|Learn|Meet|Our|The|Built|Get|Start|Explore|Discover|View|See|Watch|Click|Live|Real|Privacy|Verified|Edge|Why|How|What|Contact|About|Back|Next|Powered|Coming|Buy|Trade|Connect|Emerging|Alternative|Institutional|Global|Digital|Private|Public|Corporate|International|Advanced|Strategic|Native|Decentralized)$/;
const SECOND_BAD = /^(App|Protocol|Labs?|Partner|Marketplace|Ecosystem|Ecosistema|Network|Capital|Ventures?|Team|Model|Layer|Round|Raise|Introduction|Vault|Stack|Compute|Hoja|Officer|Officers|Markets?|Digital|Assets?|Treasur(?:y|ies)|Management|Strateg(?:y|ies)|University|College|Holdings?|Group|Advisors?|Solutions?|Technologies|Services|Global|International|Institutional|Alternative|Equity|Credit|Infrastructure|Finance|Company|Companies|Corporation|Foundation|Exchange|Studios?|Systems|Wallet|Research|Consulting|Associates|Limited|Llc|Ltd|Inc|Dao)$/;
// Navigation, legal, and section chrome that a card grid interleaves with its
// people. Any of these in a would-be name line means it is not a name line.
// Real surnames (Read, Page, Close, Story) are deliberately NOT here; those are
// handled positionally by FIRST_BAD.
const UI_WORD = /^(Mission|Statement|Swipe|More|Us|Up|Policy|Terms|Service|Follow|Portfolio|Careers|News|Press|Blog|Home|Products?|Platform|Roadmap|Whitepaper|Tokenomics|Community|Docs|Documentation|Sign|Log|Started|Launch|Menu|Open|Toggle|Navigation|Skip|Content|Cookies?|Settings|Accept|Decline|Email|Address|Subscribe|Newsletter|Copyright|Rights|Reserved|Chapter|Section|Frequently|Asked|Questions?|Featured|Latest|Recent|Trusted|Backed|Investors?|Partners|Board|Members?|Leadership|Executive|Overview|Features?|Pricing|Faq|Faqs|Support|Download|Login|Register|Dashboard|Stake|Staking|Governance|Values|Journey|Timeline|Milestones?|Events?|Media|Resources?|Legal|Disclaimer|Disclosures?|Sitemap|Language|Loading|Error|Not)$/;

const CONNECTOR = /^(of|the|and|both|for|to|in|on|at|a|an|our|your|with|by|from|is|are|that|this)$/i;

export function validName(n: string): boolean {
  if (/\n|\r/.test(n)) return false;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return false;
  // every token must read like a real name part: Title-case, not a connector,
  // not a brand/structure/desk word. Kills "of both the" / "of the Fund" /
  // "Emerging Markets Digital".
  for (const p of parts) {
    if (!/^[A-Z][A-Za-z.'’-]{1,}$/.test(p)) return false;
    if (CONNECTOR.test(p)) return false;
    if (SECOND_BAD.test(p)) return false;
    if (UI_WORD.test(p)) return false;
  }
  if (FIRST_BAD.test(parts[0])) return false;
  return isPlausiblePersonRosterName(parts.join(" "));
}

// A title, not a sentence: short, no terminal punctuation, at most one period
// (for "Sr." or "Jr."), no URL or @mention, and at least one role word. Bio
// lines ("Fmr. CEO @Kraken EMEA. Co-Founder @NY Bitcoin Center") fail on the
// @mention and the period count, which is exactly the #341 boundary.
const ROLE_WORD = /\b(?:founder|co-?founder|ceo|cto|coo|cfo|cmo|cio|cpo|cso|ciso|cro|chief|officer|president|chair(?:man|woman|person)?|partner|principal|director|managing|general counsel|counsel|advis[eo]r|head|lead|vp|vice president|engineer|developer|designer|researcher|scientist|analyst|architect|manager|strategist|economist|treasurer|secretary|operations|marketing|growth|community|business development|product|investor relations|portfolio|associate|fellow|ambassador|evangelist|contributor|maintainer|core dev|devrel|trader|quant)\b/i;
const ROLE_LINE_MAX = 80;
// "Name — Role", "Name | Role", "Name, Role" (or the reverse) on one line.
const SPLIT_LINE = /^(.{2,40}?)\s*(?:[\u2013\u2014|·]|,|\s-\s)\s*(.{2,80})$/;

export function isRoleLine(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > ROLE_LINE_MAX) return false;
  if (/[.!?]$/.test(l)) return false;
  if (/https?:\/\/|@|\bwww\./i.test(l)) return false;
  if ((l.match(/\./g) ?? []).length > 1) return false;
  if (l.split(/\s+/).length > 10) return false;
  if (!ROLE_WORD.test(l)) return false;
  // "Head of Growth | Mei Lin" is a row holding a second person, not the title
  // of the person on the line above.
  const split = l.match(SPLIT_LINE);
  if (split && [split[1], split[2]].some((side) => nameOnLine(side) && !ROLE_WORD.test(side))) return false;
  return true;
}

const CREDENTIAL_SUFFIX = /,?\s*(?:Ph\.?D\.?|MBA|CFA|CPA|JD|Esq\.?|MD|CFP)\.?$/i;

/** The name on a line that holds nothing but a name (2–4 Title-case tokens). */
export function nameOnLine(line: string): string | null {
  const l = line.trim().replace(CREDENTIAL_SUFFIX, "").trim();
  if (l.length < 4 || l.length > 40) return null;
  if (!/^[A-Z][A-Za-z.'’-]+(?: [A-Z][A-Za-z.'’-]+){1,3}$/.test(l)) return null;
  return validName(l) ? l : null;
}

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g;

/** Markdown / block text reduced to one clean string per line. */
export function contentLines(content: string): string[] {
  return content.split(/\r?\n/).map((raw) => raw
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim());
}

function linkOnName(rawLine: string, name: string): string | undefined {
  for (const m of rawLine.matchAll(LINK)) {
    if (m[1].replace(/\s+/g, " ").trim().replace(CREDENTIAL_SUFFIX, "").trim() === name && /^https?:\/\//i.test(m[2])) return m[2];
  }
  return undefined;
}

const PERSON_PROFILE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s)"'<>]+/i;

function nextNonEmpty(lines: string[], from: number, within: number): number {
  for (let j = from; j < lines.length && j <= from + within; j++) {
    if (lines[j]) return j;
  }
  return -1;
}

function pushPerson(out: NamedPerson[], seen: Set<string>, person: NamedPerson): void {
  const key = person.name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(person);
}

/**
 * The people the page names with a role, in page order. Bounded to twelve; a
 * team page longer than that is still a named team.
 */
export function readRoster(content: string): NamedPerson[] {
  const out: NamedPerson[] = [];
  const seen = new Set<string>();
  const raw = content.split(/\r?\n/);
  const lines = contentLines(content);

  // 1. Structural roster: a name line and a role line.
  for (let i = 0; i < lines.length && out.length < 12; i++) {
    const line = lines[i];
    if (!line) continue;

    const split = line.match(SPLIT_LINE);
    if (split) {
      const left = nameOnLine(split[1]);
      if (left && isRoleLine(split[2])) {
        pushPerson(out, seen, { name: left, role: split[2].trim(), link: linkOnName(raw[i] ?? "", left), basis: "roster" });
        continue;
      }
      const right = nameOnLine(split[2]);
      if (right && split[1].length <= 40 && isRoleLine(split[1])) {
        pushPerson(out, seen, { name: right, role: split[1].trim(), link: linkOnName(raw[i] ?? "", right), basis: "roster" });
        continue;
      }
    }

    const name = nameOnLine(line);
    if (!name) continue;
    const j = nextNonEmpty(lines, i + 1, 2);
    if (j < 0 || !isRoleLine(lines[j])) continue;
    let link = linkOnName(raw[i] ?? "", name);
    if (!link) {
      // A profile link sitting in this card, before the next name line.
      for (let k = i + 1; k < raw.length && k <= i + 4; k++) {
        if (k > j && nameOnLine(lines[k] ?? "")) break;
        const profile = raw[k]?.match(PERSON_PROFILE)?.[0];
        if (profile) { link = profile; break; }
      }
    }
    pushPerson(out, seen, { name, role: lines[j], link, basis: "roster" });
  }

  // 2. Role line followed by a name line ("CEO" / "Jane Doe"), only for short
  //    pure titles, and only where the name was not already read.
  for (let i = 0; i < lines.length && out.length < 12; i++) {
    const line = lines[i];
    if (!line || line.length > 40 || !isRoleLine(line)) continue;
    const j = nextNonEmpty(lines, i + 1, 2);
    if (j < 0) continue;
    const name = nameOnLine(lines[j]);
    if (!name) continue;
    // A name line that itself heads a card (its own role follows) belongs to
    // the forward reading above, not to the title before it.
    const k = nextNonEmpty(lines, j + 1, 2);
    if (k >= 0 && isRoleLine(lines[k])) continue;
    pushPerson(out, seen, { name, role: line, link: linkOnName(raw[j] ?? "", name), basis: "roster" });
  }

  // 3. Inline prose adjacency, both orders.
  const flat = lines.join("\n");
  for (const [re, nameIdx, roleIdx] of [[NAME_ROLE, 1, 2], [ROLE_NAME, 2, 1]] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) && out.length < 12) {
      const name = trimName(m[nameIdx]);
      if (name && validName(name)) pushPerson(out, seen, { name, role: m[roleIdx].trim(), basis: "inline-role" });
    }
  }

  // 4. "founded by … Name".
  FOUNDED_BY.lastIndex = 0;
  let f: RegExpExecArray | null;
  while ((f = FOUNDED_BY.exec(flat)) && out.length < 12) {
    const name = trimName(f[1]);
    if (name && validName(name)) pushPerson(out, seen, { name, role: "Founder (per site copy)", basis: "founded-by" });
  }

  return out.slice(0, 12);
}

// The inline patterns run case-insensitively so the ROLE word matches in any
// case, which lets a lowercase neighbour ("by Jane Smith", "Hans Thomas today")
// ride along inside the name group. Only the Title-case core is the name.
function trimName(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const parts = candidate.split(/[ \t]+/);
  while (parts.length && !/^[A-Z]/.test(parts[0])) parts.shift();
  while (parts.length && !/^[A-Z]/.test(parts[parts.length - 1])) parts.pop();
  return parts.length >= 2 ? parts.join(" ") : null;
}
