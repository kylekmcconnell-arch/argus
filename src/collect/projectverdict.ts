// Synthesize a site recon into one forensic verdict, the way the token audit
// and the person engine do. The rubric follows ARGUS's principles:
//   - Evidence over inference: a coverage gap yields INCOMPLETE, never a guess.
//   - Pseudonymity is neutral: an unnamed team is a mild caution, not a heavy
//     penalty. The real negatives are evidence-based — a token you cannot verify
//     on-chain, fabricated metrics, manipulation language.
//   - Hard caps over scores: a disqualifying finding ceilings the result.
import type { Recon } from "./recon";

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
      reasons: [{ tone: "gap", text: "Site could not be retrieved or rendered — no verdict can be issued on content never seen." }],
    };
  }

  // ---- Verifiability (0-40): the on-chain reality check ----
  let verifiability: number;
  const p = recon.pivot;
  if (!p || p.method === "none" || !p.attempted) {
    verifiability = 32; // not a token project — nothing on-chain to contradict
  } else if (p.found) {
    const v = p.found.verdict;
    verifiability = v === "PASS" ? 40 : v === "CAUTION" ? 26 : 8;
    reasons.push({ tone: p.reconcile.tone, text: p.reconcile.line });
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
  let team: number;
  if (recon.team.state === "named") { team = 18; reasons.push({ tone: "good", text: recon.identityLine }); }
  else if (recon.team.state === "unnamed-section") { team = 11; reasons.push({ tone: "warn", text: "Stated-but-unnamed team — no disclosure bonus, but not penalized for pseudonymity alone." }); }
  else { team = 9; reasons.push({ tone: "warn", text: "No team section on the rendered site." }); }
  const hasDocs = recon.socials.some((s) => /github|gitbook|docs/i.test(s.label) || /docs|whitepaper/i.test(s.url));
  if (recon.socials.length) team += 1;
  if (hasDocs) team += 1;
  team = Math.min(20, team);

  // ---- Coverage & corroboration (0-10) ----
  let coverage = recon.retrieval.status === "rendered" ? 9 : 8;
  if (recon.funding.length) coverage += 1;
  coverage = Math.min(10, coverage);

  let score = Math.round(verifiability + claims + team + coverage);
  let capApplied: string | null = null;

  // ---- Hard caps ----
  if (hype.guaranteed.length) { score = Math.min(score, 25); capApplied = "manipulation_language"; }
  if (p && p.attempted && !p.found && (p.claim.live || p.claim.fdv)) {
    score = Math.min(score, 38); capApplied = capApplied ?? "unverifiable_token_claim";
  }

  reasons.sort((a, b) => order(b.tone) - order(a.tone));
  return { verdict: band(score), score, reasons, hype, capApplied };
}

function order(t: VerdictReason["tone"]): number {
  return t === "bad" ? 3 : t === "warn" ? 2 : t === "gap" ? 2 : 1;
}
