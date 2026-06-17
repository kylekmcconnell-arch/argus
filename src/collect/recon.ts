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

export type TeamState = "named" | "unnamed-section" | "absent" | "not-retrieved";

export interface ReconFinding { claim: string; tone: "good" | "warn" | "bad" | "gap"; }

export interface Recon {
  retrieval: Retrieval;
  title: string | null;
  team: { state: TeamState; names: string[]; note: string };
  socials: { label: string; url: string }[];
  funding: string[];          // raise / FDV / valuation claims found in copy
  tokenSignals: string[];     // on-chain / token signals (this is a token project?)
  findings: ReconFinding[];
  identityLine: string;       // the one honest sentence that replaces "anonymous team"
  pivot?: OnChainPivot;       // on-chain reality check, when it reads as a token project
}

const SOCIAL = /\bhttps?:\/\/(?:www\.)?(x\.com|twitter\.com|t\.me|discord\.(?:gg|com)|github\.com|linkedin\.com)\/[^\s)"'<>]+/gi;
const TEAM_HEADING = /\b(the team|our team|meet the team|leadership|founders?|built by|who we are|advisors?)\b/i;
const TOKEN_SIG = /\b(token|tokenomics|airdrop|presale|\$[A-Z]{2,8}\b|on-chain|onchain|solana|ethereum|tge|staking|whitepaper)\b/i;
// Funding claim: a dollar figure that is explicitly tied to a raise/valuation —
// not any dollar amount (market-size and price copy must not read as funding).
const FUNDING = /\$[\d.]+\s?[mMbBkK](?:illion)?\b(?:[^.\n]{0,30}\b(?:raise|raised|round|seed|series\s?[a-d]|fdv|valuation|funding|backed|led by)\b)|\bat\s+\$[\d.]+\s?[mMbB]\s*fdv\b/gi;

// Named individual: a 2–3 word proper name with a role IMMEDIATELY adjacent
// (either order). Strict adjacency is deliberate — a forensic engine must not
// promote a capitalized marketing phrase into a "named founder".
const NAME = "[A-Z][a-z]+(?:\\s[A-Z][a-z]+){1,2}";
const ROLES = "co-?founder|cofounder|founder|ceo|cto|coo|cfo|chief[\\w ]{2,24}officer|managing partner|general partner|head of [\\w ]{2,24}|advisor|lead engineer";
const NAME_ROLE = new RegExp(`\\b(${NAME})\\b[\\s,\\u2013\\u2014|·\\-]{1,4}(?:${ROLES})\\b`, "gi");
const ROLE_NAME = new RegExp(`\\b(?:${ROLES})\\b[\\s:\\u2013\\u2014\\-]{1,4}(${NAME})\\b`, "gi");
// Words that begin a phrase but never a person's first name, and brand-ish
// second tokens, both of which produce false "names".
const FIRST_BAD = /^(Visit|Join|Read|Learn|Meet|Our|The|Built|Get|Start|Explore|Discover|View|See|Watch|Click|Live|Real|Privacy|Verified|Edge|Why|How|What|Contact|About|Back|Next|Powered|Coming|Buy|Trade|Connect)$/;
const SECOND_BAD = /^(App|Protocol|Labs?|Partner|Marketplace|Ecosystem|Ecosistema|Network|Capital|Ventures?|Team|Model|Layer|Round|Raise|Introduction|Vault|Stack|Compute|Hoja|Officer|Officers)$/;

function uniq(a: string[]): string[] { return [...new Set(a)]; }

function validName(n: string): boolean {
  const parts = n.split(/\s+/);
  if (FIRST_BAD.test(parts[0])) return false;
  if (parts[1] && SECOND_BAD.test(parts[1])) return false;
  return true;
}

function extractNames(content: string): string[] {
  const out: string[] = [];
  for (const re of [NAME_ROLE, ROLE_NAME]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const name = m[1];
      if (name && validName(name)) out.push(name);
    }
  }
  return uniq(out).slice(0, 12);
}

export function analyzeContent(retrieval: Retrieval): Recon {
  const c = retrieval.content;
  const findings: ReconFinding[] = [];

  // ---- retrieval gap short-circuits every content claim ----
  if (retrieval.status === "gap") {
    findings.push({ claim: retrieval.coverageNote, tone: "gap" });
    return {
      retrieval, title: retrieval.title,
      team: { state: "not-retrieved", names: [], note: "Site never rendered; team could not be assessed." },
      socials: [], funding: [], tokenSignals: [], findings,
      identityLine: "Could not render the site — team not established from available evidence (coverage gap, not a finding).",
    };
  }

  const socials = uniq((c.match(SOCIAL) ?? []).map((s) => s.replace(/[).,]+$/, "")))
    .slice(0, 10)
    .map((url) => ({ label: (url.match(/\/\/(?:www\.)?([^/]+)/)?.[1] ?? url).replace(/^www\./, ""), url }));
  const funding = uniq((c.match(FUNDING) ?? []).map((s) => s.trim())).slice(0, 6);
  const tokenSignals = uniq((c.match(new RegExp(TOKEN_SIG, "gi")) ?? []).map((s) => s.toLowerCase())).slice(0, 10);
  const names = extractNames(c);
  const hasTeamSection = TEAM_HEADING.test(c);

  let team: Recon["team"];
  if (names.length > 0) {
    team = { state: "named", names, note: `Names ${names.length} individual${names.length === 1 ? "" : "s"} with roles.` };
    findings.push({ claim: `Team names ${names.length} individual${names.length === 1 ? "" : "s"}: ${names.slice(0, 5).join(", ")}.`, tone: "good" });
  } else if (hasTeamSection) {
    team = { state: "unnamed-section", names: [], note: "A team section exists but names no individuals." };
    findings.push({ claim: "A team section is present but names no individuals — identity is unverifiable. This is an evidence-based caution, not an inferred one.", tone: "warn" });
  } else {
    team = { state: "absent", names: [], note: "No team or leadership section found on the rendered page." };
    findings.push({ claim: "Rendered fine, but no team or leadership section was found.", tone: "warn" });
  }

  if (retrieval.status === "recovered") {
    findings.unshift({ claim: retrieval.coverageNote, tone: "good" });
  }
  if (socials.length) findings.push({ claim: `${socials.length} social link${socials.length === 1 ? "" : "s"} found: ${socials.map((s) => s.label).join(", ")}.`, tone: "good" });
  else findings.push({ claim: "No social or community links found in the rendered content.", tone: "warn" });
  if (funding.length) findings.push({ claim: `Funding/valuation claim in copy: ${funding[0]} (claim only — not independently verified here).`, tone: "warn" });
  if (tokenSignals.length >= 2) findings.push({ claim: `Reads as a token project (signals: ${tokenSignals.slice(0, 5).join(", ")}). Run a token audit on the contract for the on-chain verdict.`, tone: "warn" });

  // ---- the single honest sentence that replaces "anonymous team" ----
  let identityLine: string;
  if (team.state === "named") identityLine = `Team identified: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""}.`;
  else if (team.state === "unnamed-section") identityLine = "Team section present but names no principals — identity unverifiable. Distinct from anonymous: it is a stated-but-unnamed team.";
  else identityLine = "No team section on the rendered site — team not established. Stated as observed absence, on content we actually rendered.";

  return { retrieval, title: retrieval.title, team, socials, funding, tokenSignals, findings, identityLine };
}

export async function runRecon(
  url: string,
  emit?: (s: import("./retrieve").RetrievalStage) => void,
  onPivot?: (label: string) => void,
): Promise<Recon> {
  const retrieval = await retrieveSite(url, emit);
  const recon = analyzeContent(retrieval);
  if (retrieval.status !== "gap") {
    const pivot = await pivotOnChain(retrieval.content, recon.tokenSignals.length, onPivot);
    if (pivot.attempted) recon.pivot = pivot;
  }
  return recon;
}
