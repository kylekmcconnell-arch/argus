/**
 * A deployer who documents defeating a safety scanner.
 *
 * Contract-safety checks measure what a contract can do right now: mint,
 * freeze, tax, block sells. A deployer who tunes a contract until the scanners
 * go quiet passes every one of them, and the clean result is the product of
 * the tuning rather than evidence of good intent. MUMU's verified source, from
 * a launch factory, carries the line:
 *
 *   "anti-snipe transfer hook makes GMGN stop flagging honeypot / TradeRestriction"
 *
 * That is the deployer stating the goal in their own words, and it sits in a
 * field anyone can read. Detection is deliberately narrow: a comment must name
 * a detection surface AND express intent to stop it firing. Discussing a
 * honeypot, or asserting a token is not one, is not evasion.
 */
export interface ScannerEvasionFinding {
  /** The comment exactly as written in the source, trimmed. */
  quote: string;
  /** Detection surfaces the comment names. */
  detectors: string[];
}

/** Named detection surfaces, plus the generic flag vocabulary they share. */
const DETECTOR_PATTERNS: Array<[RegExp, string]> = [
  [/\bgmgn\b/i, "GMGN"],
  [/\bhoneypot\.is\b/i, "honeypot.is"],
  [/\btoken\s*sniffer\b/i, "TokenSniffer"],
  [/\bgo\s*plus\b/i, "GoPlus"],
  [/\bquick\s*intel\b/i, "QuickIntel"],
  [/\bde\.fi\b|\bdefi\s*scanner\b/i, "De.Fi scanner"],
  [/\bdex\s*tools\b/i, "DEXTools"],
  [/\brug\s*(?:check|checker|screen)s?\b/i, "rug checker"],
  [/\bhoneypot\b/i, "honeypot detection"],
  [/\btrade\s*restriction\b/i, "trade-restriction detection"],
  [/\bscanner?s?\b|\bdetector\b|\bbot\s*checks?\b/i, "automated scanners"],
];

/**
 * Intent to stop a detector firing. "stop flagging", "so it is not flagged",
 * "bypass", "evade", "avoid detection", "removed so it passes".
 */
const EVASION_INTENT = [
  /\b(?:stop|stops|stopped|prevent|prevents|avoid|avoids|bypass|bypasses|evade|evades|dodge|defeat|suppress)\b/i,
  /\bso\s+(?:it|they|we)\s+(?:do(?:es)?n'?t|won'?t|will\s+not|no\s+longer)\b/i,
  /\b(?:not|never|no\s+longer)\s+(?:get\s+)?(?:flag\w*|detect\w*|mark\w*|catch|caught|picked\s+up)\b/i,
  /\b(?:hide|hides|hidden|mask|masks|disguise)\b/i,
];

/** Flag/detect vocabulary, required so a bare "avoid" sentence cannot fire. */
const FLAGGING_VERB = /\b(?:flag|flags|flagged|flagging|detect|detects|detected|detection|mark|marks|marked|trigger|triggers|caught|catch|report|reports|classif\w*)\b/i;

const COMMENT = /\/\/[^\n\r]{4,400}|\/\*[\s\S]{4,1200}?\*\//g;

function cleanComment(raw: string): string {
  return raw
    .replace(/^\s*\/\*+/, "")
    .replace(/\*+\/\s*$/, "")
    .replace(/^\s*\/\/+/gm, "")
    .replace(/^\s*\*+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comments in Solidity source, normalized to single lines. */
export function sourceComments(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(COMMENT)) {
    const text = cleanComment(match[0]);
    // Licence headers and pragma noise carry no intent.
    if (text.length < 12) continue;
    if (/^SPDX-License-Identifier/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * Comments that name a detection surface AND state intent to stop it firing.
 * Both halves are required, so ordinary security commentary never matches.
 */
export function detectScannerEvasion(source: string | null | undefined): ScannerEvasionFinding[] {
  if (!source || typeof source !== "string") return [];
  const findings: ScannerEvasionFinding[] = [];
  const seen = new Set<string>();
  for (const comment of sourceComments(source)) {
    const detectors = [...new Set(
      DETECTOR_PATTERNS.filter(([pattern]) => pattern.test(comment)).map(([, name]) => name),
    )];
    if (!detectors.length) continue;
    if (!EVASION_INTENT.some((pattern) => pattern.test(comment))) continue;
    if (!FLAGGING_VERB.test(comment)) continue;
    const key = comment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Keep the most specific named surface first for the finding text.
    findings.push({ quote: comment.slice(0, 300), detectors });
    if (findings.length >= 3) break;
  }
  return findings;
}

/** One sentence naming what the deployer wrote, with the quote as its evidence. */
export function scannerEvasionClaim(finding: ScannerEvasionFinding): string {
  const surfaces = finding.detectors.slice(0, 2).join(" and ");
  return `The verified contract source documents defeating ${surfaces}: "${finding.quote}" A contract tuned until safety scanners go quiet passes those checks by construction, so a clean contract result here is weaker evidence than usual.`;
}
