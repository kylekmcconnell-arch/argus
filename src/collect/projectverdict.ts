// Synthesize a site recon into one forensic verdict, the way the token audit
// and the person engine do. The rubric follows ARGUS's principles:
//   - Evidence over inference: a coverage gap yields INCOMPLETE, never a guess.
//   - Pseudonymity is neutral: an unnamed team is a mild caution, not a heavy
//     penalty. The real negatives are evidence-based — a token you cannot verify
//     on-chain, fabricated metrics, manipulation language.
//   - Hard caps over scores: a disqualifying finding ceilings the result.
import { isPlausiblePersonRosterName } from "../lib/personName";
import type { Recon } from "./recon";
import { profileOf } from "./siteProfile";

export interface HypeSignals {
  fabricatedMetrics: string[]; // precise vanity stats from an unproven project
  giantTam: string | null;     // "$500B market"
  guaranteed: string[];        // guaranteed-returns / manipulation language
  buzzwords: number;           // density of empty superlatives
}

export interface VerdictReason { tone: "good" | "warn" | "bad" | "gap"; text: string; }

export interface ProjectVerdict {
  verdict: "PASS" | "CAUTION" | "FAIL" | "INCOMPLETE";
  score: number | null;
  reasons: VerdictReason[];
  hype: HypeSignals;
  capApplied: string | null;
}

const VANITY_NOUN = "robots|users|nodes|proofs?|transactions|holders|members|clients|launches|receipts|policies|validators|devices|agents|wallets|downloads";
const METRIC = new RegExp(`\\b\\d{1,3}(?:,\\d{3})+\\b\\s*(?:${VANITY_NOUN})|\\b\\d{1,2}\\.\\d{1,2}\\s?%\\s*(?:uptime|accuracy|success)|\\b\\d+(?:\\.\\d+)?[mMbB]\\s+(?:${VANITY_NOUN})`, "gi");
const TAM = /\$\s?\d{2,4}\s?(?:b|billion|t|trillion)\b[^.\n]{0,28}(?:market|tam|opportunity|industry|economy)/i;
const GUARANTEED = /\bguaranteed\b|\brisk[-\s]?free\b|\bpassive income\b|\b\d{2,4}x\s+returns?\b|\bguaranteed\s+(?:returns?|profit|engagement|volume)\b/gi;
const BUZZ = /\b(revolutionary|next[-\s]?gen|world'?s first|paradigm|cutting[-\s]?edge|game[-\s]?chang\w+|unprecedented|disrupt\w*|unparalleled|seamless)\b/gi;

function uniq(a: string[]): string[] { return [...new Set(a.map((s) => s.trim()))]; }

export function detectHype(content: string): HypeSignals {
  return {
    fabricatedMetrics: uniq((content.match(METRIC) ?? [])).slice(0, 8),
    giantTam: content.match(TAM)?.[0]?.trim() ?? null,
    guaranteed: uniq((content.match(GUARANTEED) ?? [])).slice(0, 6),
    buzzwords: (content.match(BUZZ) ?? []).length,
  };
}

function band(score: number): ProjectVerdict["verdict"] {
  return score >= 70 ? "PASS" : score >= 40 ? "CAUTION" : "FAIL";
}

export function scoreProject(recon: Recon): ProjectVerdict {
  const hype = detectHype(recon.retrieval.content);
  const reasons: VerdictReason[] = [];

  // Coverage gap -> cannot deliver a content verdict. Evidence discipline.
  if (recon.retrieval.status === "gap") {
    return {
      verdict: "INCOMPLETE", score: null, hype, capApplied: "coverage_gap",
      reasons: [{ tone: "gap", text: "Site could not be retrieved or rendered. No verdict can be issued on content never seen." }],
    };
  }

  const profile = profileOf(recon);

  // A bot-protection challenge is the same thing as a failed fetch: the page
  // ARGUS holds is not the site. No content verdict.
  if (profile.kind === "blocked") {
    return {
      verdict: "INCOMPLETE", score: null, hype, capApplied: "bot_wall",
      reasons: [{ tone: "gap", text: "The URL answered with a bot-protection challenge, not the site. No verdict can be issued on a page ARGUS never saw." }],
    };
  }

  // ---- Verifiability (0-40): the on-chain reality check ----
  let verifiability: number;
  const p = recon.pivot;
  if (!p || p.method === "none" || !p.attempted) {
    verifiability = 32; // not a token project — nothing on-chain to contradict
  } else if (p.found && p.method === "contract-on-page") {
    // The contract was linked ON THE SITE — its on-chain health IS the project's.
    const v = p.found.verdict;
    verifiability = v === "PASS" ? 40 : v === "CAUTION" ? 26 : 8;
    reasons.push({ tone: p.reconcile.tone, text: p.reconcile.line });
  } else if (p.found) {
    // Name-search only — we can't confirm this token is theirs, so it must NOT
    // move the site's score up OR down. Neutral, informational.
    verifiability = 30;
    reasons.push({ tone: "warn", text: p.reconcile.line });
  } else {
    verifiability = 4; // advertises a token, but it cannot be verified on-chain
    reasons.push({ tone: p.reconcile.tone, text: p.reconcile.line });
  }

  // ---- Claims hygiene (0-30) ----
  let claims = 30;
  if (hype.fabricatedMetrics.length) { claims -= 9; reasons.push({ tone: "bad", text: `Grandiose, unverifiable metrics presented as fact: ${hype.fabricatedMetrics.slice(0, 3).join("; ")}.` }); }
  if (hype.giantTam) { claims -= 7; reasons.push({ tone: "warn", text: `Giant total-addressable-market framing: "${hype.giantTam}".` }); }
  if (hype.guaranteed.length) { claims -= 16; reasons.push({ tone: "bad", text: `Manipulation / guaranteed-return language: ${hype.guaranteed.slice(0, 3).join(", ")}.` }); }
  if (hype.buzzwords >= 4) { claims -= Math.min(8, hype.buzzwords); reasons.push({ tone: "warn", text: `Heavy on empty superlatives (${hype.buzzwords} buzzword hits) with thin substance.` }); }
  claims = Math.max(0, claims);

  // ---- Team & transparency (0-20). Pseudonymity is neutral. ----
  // A Title-case org/desk phrase that slipped past extraction must not mint
  // the named-team bonus. Honest unnamed / absent is the fallback.
  const namedPeople = recon.team.names.filter((name) =>
    !/[\n\r]/.test(name) && isPlausiblePersonRosterName(name.replace(/\s+/g, " ").trim()),
  );
  let team: number;
  if (recon.team.state === "named" && namedPeople.length) {
    team = 18;
    reasons.push({ tone: "good", text: recon.identityLine });
  } else if (recon.team.state === "unnamed-section" || recon.team.state === "named") {
    team = 11;
    reasons.push({ tone: "warn", text: "Stated-but-unnamed team: no disclosure bonus, but not penalized for pseudonymity alone." });
  } else { team = 9; reasons.push({ tone: "warn", text: "No team section on the rendered site." }); }
  const hasDocs = recon.socials.some((s) => /github|gitbook|docs/i.test(s.label) || /docs|whitepaper/i.test(s.url));
  // Only an account the page claims as its own is a transparency signal. A
  // portfolio company's X link or a bio @mention is not the project's presence.
  if (profile.officialAccounts.length) {
    team += 1;
    reasons.push({ tone: "good", text: `Official accounts linked on the page: ${profile.officialAccounts.slice(0, 4).map((a) => a.label).join(", ")}.` });
  } else {
    reasons.push({ tone: "warn", text: "No official X, Telegram, Discord, GitHub, or LinkedIn account is linked on the page." });
  }
  if (hasDocs) team += 1;
  team = Math.min(20, team);

  // ---- Coverage & corroboration (0-10) ----
  let coverage = recon.retrieval.status === "rendered" ? 9 : 8;
  if (recon.funding.length) coverage += 1;
  coverage = Math.min(10, coverage);

  let score = Math.round(verifiability + claims + team + coverage);
  let capApplied: string | null = null;

  if (profile.kind === "fund") {
    reasons.push({ tone: "good", text: `Self-describes as a fund / investment firm; not reality-checked as a token.` });
  }

  // ---- Hard caps ----
  if (hype.guaranteed.length) { score = Math.min(score, 25); capApplied = "manipulation_language"; }
  if (p && p.attempted && !p.found && (p.claim.live || p.claim.fdv)) {
    score = Math.min(score, 38); capApplied = capApplied ?? "unverifiable_token_claim";
  }
  // A parking page or a placeholder is not a project. Nothing on it can PASS.
  if (profile.kind === "parked") {
    score = Math.min(score, 40); capApplied = capApplied ?? "parked_domain";
    reasons.push({ tone: "bad", text: "The domain is parked / for sale. There is no project content at this URL to assess." });
  } else if (profile.kind === "coming-soon") {
    score = Math.min(score, 55); capApplied = capApplied ?? "coming_soon";
    reasons.push({ tone: "warn", text: "A placeholder page: the site is live but shows no product, team, or documentation yet. Nothing here can be verified." });
  }
  // Empty identity must not mint a confident PASS. Pseudonymity stays neutral
  // (one signal is enough to escape this); a page with no self-description, no
  // named person, no official account, and no docs has given ARGUS nothing.
  if (profile.identitySignals === 0 && profile.kind !== "parked" && profile.kind !== "coming-soon") {
    score = Math.min(score, 60); capApplied = capApplied ?? "no_identity_evidence";
    reasons.push({ tone: "warn", text: "Nothing on the rendered page establishes who runs this: no self-description, no named person, no official account, no documentation." });
  }

  reasons.sort((a, b) => order(b.tone) - order(a.tone));
  return { verdict: band(score), score, reasons, hype, capApplied };
}

function order(t: VerdictReason["tone"]): number {
  return t === "bad" ? 3 : t === "warn" ? 2 : t === "gap" ? 2 : 1;
}
