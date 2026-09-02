// Surface-intel extraction over retrieved site content, with the same evidence
// discipline as the retrieval layer: every signal is reported with the epistemic
// state it was actually observed in. The team signal in particular has FOUR
// distinct states that the old engine collapsed into a confident "anonymous":
//
//   named            - the page names verifiable individuals
//   unnamed-section  - a team section exists but names no individuals ("Built by
//                      pioneers"), a real CAUTION grounded in rendered evidence
//   absent           - rendered fine, no team section at all
//   not-retrieved    - the site never rendered; a COVERAGE GAP, not a finding
import { retrieveSite, type Retrieval } from "./retrieve";
import { pivotOnChain, type OnChainPivot } from "./onchain";
import { scoreProject, type ProjectVerdict } from "./projectverdict";
import { readRoster, type NamedPerson } from "./roster";
import { buildSiteProfile, profileOf, selfDescribesAsFund, STRONG_TOKEN, type SiteProfile } from "./siteProfile";

export type TeamState = "named" | "unnamed-section" | "absent" | "not-retrieved";

export interface ReconFinding { claim: string; tone: "good" | "warn" | "bad" | "gap"; }

export interface Recon {
  retrieval: Retrieval;
  title: string | null;
  team: {
    state: TeamState;
    names: string[];
    note: string;
    /** The same people with the role the page gives each. Absent on records saved before roles were read. */
    people?: NamedPerson[];
  };
  socials: { label: string; url: string }[];
  funding: string[];          // raise / FDV / valuation claims found in copy
  tokenSignals: string[];     // on-chain / token signals (this is a token project?)
  findings: ReconFinding[];
  identityLine: string;       // the one honest sentence that replaces "anonymous team"
  pivot?: OnChainPivot;       // on-chain reality check, when it reads as a token project
  isFund?: boolean;           // self-describes as a VC / fund / studio (skip token reality-check)
  /** What this is, whether it is live, official vs linked accounts, the bound next step. */
  profile?: SiteProfile;
  verdict?: ProjectVerdict;   // synthesized PASS / CAUTION / FAIL / INCOMPLETE
}

const SOCIAL = /\bhttps?:\/\/(?:www\.)?(x\.com|twitter\.com|t\.me|discord\.(?:gg|com)|github\.com|linkedin\.com|youtube\.com|medium\.com|[a-z0-9-]+\.medium\.com|warpcast\.com|instagram\.com)\/[^\s)"'<>]+/gi;
// A share button points at the reader's own account, not the project's. Reading
// the markup surfaces these for the first time, and "x.com/intent/tweet" is not
// a social presence, so they are dropped from both scans.
const SHARE_INTENT = /(?:x\.com|twitter\.com)\/(?:intent|share)(?:\/|\?|$)|linkedin\.com\/(?:shareArticle|sharing|cws\/share)|t\.me\/share(?:\/|\?|$)|\/sharer(?:\/|\?|$)/i;
const TEAM_HEADING = /\b(the team|our team|meet the team|(?:core|executive|founding|management|leadership) team|leadership|founders?|built by|who we are|advisors?)\b/i;
const TOKEN_SIG = /\b(token|tokenomics|airdrop|presale|\$[A-Z]{2,8}\b|on-chain|onchain|solana|ethereum|tge|staking|whitepaper)\b/i;
// A VC / fund / studio / advisory site naturally discusses "tokens" and
// "tokenomics" about the projects it BACKS — it is not itself a token project.
// When the site self-describes as an investor, we do NOT reality-check it as a
// token (that chased a random same-ticker DEX coin and defamed the site). The
// gate (selfDescribesAsFund) lives in ./siteProfile next to the classifier.
// STRONG_TOKEN (first-party evidence that THIS site is the token project) lives
// in ./siteProfile so the profile can be rebuilt for stored records.
// Funding claim: a dollar figure that is explicitly tied to a raise/valuation —
// not any dollar amount (market-size and price copy must not read as funding).
const FUNDING = /\$[\d.]+\s?[mMbBkK](?:illion)?\b(?:[^.\n]{0,30}\b(?:raise|raised|round|seed|series\s?[a-d]|fdv|valuation|funding|backed|led by)\b)|\bat\s+\$[\d.]+\s?[mMbB]\s*fdv\b/gi;

// Named individuals are read by ./roster: the structural name-line / role-line
// shape of a team page, strict inline adjacency in prose, and "founded by".
// Every reader shares the same person-name discipline, so a capitalized
// marketing phrase is never promoted into a "named founder".

function uniq(a: string[]): string[] { return [...new Set(a)]; }

const JUNK_HANDLE = /^(gmail|outlook|hotmail|proton|icloud|yahoo|email|mail|university|college|network|capital|finance|protocol|official|home|about|team|contact|support|help|news|blog|info|admin|www|the|and|for)$/i;
const FIRST_PARTY_HANDLE_CUE = /follow(?:\s+us)?(?:\s+on)?|twitter|\bx\b|t(?:elegram)?\.me|discord|github|linkedin|official(?:\s+account)?|socials?|handle/i;

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function handleHasFirstPartyCue(handle: string, content: string): boolean {
  return new RegExp(
    `(?:${FIRST_PARTY_HANDLE_CUE.source})\\b[:\\s@/]{0,16}${escapeRe(handle)}\\b`,
    "i",
  ).test(content);
}

function handleMatchesHost(handle: string, url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    const label = (host.split(".")[0] ?? "").toLowerCase().replace(/-/g, "");
    const h = handle.toLowerCase().replace(/_/g, "");
    if (label.length < 4 || h.length < 3) return false;
    return h === label || h.includes(label) || (label.includes(h) && h.length >= 5);
  } catch {
    return false;
  }
}

function isProjectBareHandle(handle: string, content: string, pageUrl: string): boolean {
  if (handle.length < 3 || /^\d+$/.test(handle) || JUNK_HANDLE.test(handle)) return false;
  return handleHasFirstPartyCue(handle, content) || handleMatchesHost(handle, pageUrl);
}

export function analyzeContent(retrieval: Retrieval): Recon {
  const c = retrieval.content;
  const findings: ReconFinding[] = [];

  // ---- retrieval gap short-circuits every content claim ----
  if (retrieval.status === "gap") {
    findings.push({ claim: retrieval.coverageNote, tone: "gap" });
    const gap: Recon = {
      retrieval, title: retrieval.title,
      team: { state: "not-retrieved", names: [], people: [], note: "Site never rendered; team could not be assessed." },
      socials: [], funding: [], tokenSignals: [], findings,
      identityLine: "Could not render the site. The team could not be established from available evidence (coverage gap, not a finding).",
    };
    gap.profile = buildSiteProfile({ retrieval, socials: [], people: [], isFund: false, strongToken: false, tokenSignalCount: 0, content: "" });
    return gap;
  }

  // Full social URLs, PLUS bare handles the page shows as text (@EnigmaFund) or
  // protocol-less links (x.com/foo) — a JS-rendered site often surfaces the
  // handle without a full anchor, so a URL-only scan wrongly reported "no socials".
  //
  // The scan covers the extracted anchors as well as the text. It has to: the
  // retrieval strips every tag, so a footer of icon-only anchors (an <svg> inside
  // the <a>, no link text at all) leaves nothing in `content` and used to report
  // "no social links" about a page whose socials were sitting right there in the
  // markup. Same deterministic fix as the LinkedIn extraction miss: read the
  // anchors, do not ask a model. We read them, we never follow them.
  const anchors = retrieval.links ?? [];
  const socialScan = anchors.length ? `${c}\n${anchors.join("\n")}` : c;
  const socialSet = new Map<string, { label: string; url: string }>();
  for (const raw of socialScan.match(SOCIAL) ?? []) {
    // Trailing punctuation is prose noise; a trailing slash is markup noise. Both
    // must go, or the same account arrives twice from the two scans.
    const url = raw.replace(/[).,]+$/, "").replace(/\/+$/, "");
    if (SHARE_INTENT.test(url)) continue;
    const label = (url.match(/\/\/(?:www\.)?([^/]+)/)?.[1] ?? url).replace(/^www\./, "");
    socialSet.set(url.toLowerCase(), { label, url });
  }
  // protocol-less social links: x.com/foo, t.me/bar
  for (const m of socialScan.matchAll(/\b((?:x\.com|twitter\.com|t\.me|discord\.gg)\/[A-Za-z0-9_]{2,40})\b/gi)) {
    const url = "https://" + m[1];
    if (SHARE_INTENT.test(url)) continue;
    if (!socialSet.has(url.toLowerCase())) socialSet.set(url.toLowerCase(), { label: m[1].split("/")[0], url });
  }
  // Bare @handles are the common JS-rendered first-party case (@EnigmaFund),
  // but bios also write affiliation mentions (MBA @UNC, CEO @Kraken, @Siemens
  // AG). Those are not the project's accounts. Only promote a bare handle that
  // is framed as first-party or matches the site host. Real x.com / t.me /
  // linkedin URLs still come from the scans above.
  const handles = uniq(
    [...c.matchAll(/(?:^|[\s(:>])@([A-Za-z0-9_]{2,30})\b/g)]
      .map((m) => m[1])
      .filter((h) => isProjectBareHandle(h, c, retrieval.url)),
  ).slice(0, 6);
  for (const h of handles) {
    const url = "https://x.com/" + h;
    if (![...socialSet.values()].some((s) => new RegExp(`/${h}$`, "i").test(s.url))) {
      socialSet.set("@" + h.toLowerCase(), { label: "@" + h, url });
    }
  }
  const socials = [...socialSet.values()].slice(0, 12);
  const funding = uniq((c.match(FUNDING) ?? []).map((s) => s.trim())).slice(0, 6);
  const tokenSignals = uniq((c.match(new RegExp(TOKEN_SIG, "gi")) ?? []).map((s) => s.toLowerCase())).slice(0, 10);
  const people = readRoster(c);
  const names = people.map((p) => p.name);
  const hasTeamSection = TEAM_HEADING.test(c);

  // Only call it a token project on FIRST-PARTY evidence (a launch/economics
  // claim or an on-page contract) AND when the site isn't a fund/VC/studio.
  // Two generic keywords ("token", "tokenomics") on an investor's site is not it.
  const isFund = selfDescribesAsFund(c, retrieval.title);
  const strongToken = STRONG_TOKEN.test(c);
  const profile = buildSiteProfile({ retrieval, socials, people, isFund, strongToken, tokenSignalCount: tokenSignals.length, content: c });

  // A bot wall or a parking page is not the project's page. Nothing on it can
  // name a team or an account, and saying "no team section" about it would be
  // the same false-absence error the retrieval layer exists to prevent.
  if (profile.kind === "blocked" || profile.kind === "parked") {
    findings.push({ claim: profile.availabilityNote, tone: profile.kind === "blocked" ? "gap" : "bad" });
    if (profile.kindEvidence) findings.push({ claim: `Page text: “${profile.kindEvidence}”`, tone: "gap" });
    return {
      retrieval, title: retrieval.title,
      team: { state: profile.kind === "blocked" ? "not-retrieved" : "absent", names: [], people: [], note: profile.kind === "blocked" ? "A challenge page was returned; the team could not be assessed." : "A parked domain names no team." },
      socials: [], funding: [], tokenSignals: [], findings,
      identityLine: profile.summary, isFund: false, profile,
    };
  }

  let team: Recon["team"];
  if (people.length > 0) {
    team = { state: "named", names, people, note: `Names ${people.length} individual${people.length === 1 ? "" : "s"} with roles.` };
    findings.push({ claim: `Named on the page with roles: ${describePeople(people, 5)}${people.length > 5 ? `, and ${people.length - 5} more` : ""}.`, tone: "good" });
  } else if (hasTeamSection) {
    team = { state: "unnamed-section", names: [], people: [], note: "A team section exists but names no individuals." };
    findings.push({ claim: "A team section is present but names no individuals, so identity is unverifiable. This is an evidence-based caution, not an inferred one.", tone: "warn" });
  } else {
    team = { state: "absent", names: [], people: [], note: "No team or leadership section found on the rendered page." };
    findings.push({ claim: "Rendered fine, but no team or leadership section was found.", tone: "warn" });
  }

  // What this is, in the site's own words, leads the ledger.
  if (profile.kind === "fund") findings.unshift({ claim: `Self-describes as a fund / investment firm (“${profile.kindEvidence}”). Not treated as a token project; no same-ticker reality check.`, tone: "good" });
  else if (profile.kind === "token-project") findings.unshift({ claim: `Reads as a token project. ${profile.kindEvidence ?? ""} Run the token audit on the contract for the on-chain verdict.`.trim(), tone: "warn" });
  else if (profile.kind === "studio") findings.unshift({ claim: `Self-describes as a studio / agency (“${profile.kindEvidence}”).`, tone: "good" });
  else if (profile.kind === "coming-soon") findings.unshift({ claim: `${profile.availabilityNote} (“${profile.kindEvidence}”)`, tone: "warn" });
  else if (!profile.selfDescription) findings.unshift({ claim: "The rendered page never says what the project is in plain language.", tone: "warn" });

  if (retrieval.status === "recovered") {
    findings.unshift({ claim: retrieval.coverageNote, tone: "good" });
  }

  const official = profile.officialAccounts;
  const linked = profile.linkedAccounts;
  if (official.length) findings.push({ claim: `Official accounts linked on the page: ${official.map((a) => `${a.label} (${a.why.replace(/\.$/, "").replace(/^./, (ch) => ch.toLowerCase())})`).join("; ")}.`, tone: "good" });
  else findings.push({ claim: "No official X, Telegram, Discord, GitHub, or LinkedIn account is linked on the rendered page.", tone: "warn" });
  if (linked.length) findings.push({ claim: `Also links ${linked.length} account${linked.length === 1 ? "" : "s"} it does not claim as its own (${linked.slice(0, 5).map((a) => a.label).join(", ")}); not counted as official.`, tone: "warn" });
  if (funding.length) findings.push({ claim: `Funding/valuation claim in copy: ${funding[0]} (claim only, not independently verified here).`, tone: "warn" });

  // ---- the single honest sentence that replaces "anonymous team" ----
  let identityLine: string;
  if (team.state === "named") identityLine = `Team identified on the site: ${describePeople(people, 4)}${people.length > 4 ? `, and ${people.length - 4} more` : ""}.`;
  else if (team.state === "unnamed-section") identityLine = "Team section present but names no principals, so identity is unverifiable. Distinct from anonymous: it is a stated-but-unnamed team.";
  else identityLine = "No team section was found on the rendered site. The team could not be established. This records an observed absence in content ARGUS actually rendered.";

  return { retrieval, title: retrieval.title, team, socials, funding, tokenSignals, findings, identityLine, isFund, profile };
}

function describePeople(people: NamedPerson[], max: number): string {
  return people.slice(0, max).map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(", ");
}

export { profileOf };

export async function runRecon(
  url: string,
  emit?: (s: import("./retrieve").RetrievalStage) => void,
  onPivot?: (label: string) => void,
): Promise<Recon> {
  const retrieval = await retrieveSite(url, emit);
  const recon = analyzeContent(retrieval);
  // Skip the on-chain reality check on fund/VC/studio sites — they discuss
  // portfolio tokens they don't own, and name-searching a portfolio ticker
  // pulled a random same-ticker DEX coin and dragged the site's verdict.
  if (retrieval.status !== "gap" && !recon.isFund && recon.profile?.kind !== "blocked" && recon.profile?.kind !== "parked") {
    const pivot = await pivotOnChain(retrieval.content, recon.tokenSignals.length, onPivot);
    if (pivot.attempted) {
      recon.pivot = pivot;
      // A contract the page links is the strongest bound next step; the profile
      // is rebuilt so it can point there instead of at an account.
      recon.profile = profileOf({ ...recon, profile: undefined });
    }
  }
  recon.verdict = scoreProject(recon);
  return recon;
}
