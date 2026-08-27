import type { ProjectTokenSnapshot, SubjectOrientation } from "../data/evidence";
import { neutralizeProductCopy } from "./productLanguage";

const EVM_CONTRACT = /\b0x[a-f0-9]{40}\b/gi;
const SOLANA_CONTRACT = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const URL_PATTERN = /https?:\/\/\S+/gi;
const PRODUCT_VERBS = /\b(?:builds?|provides?|offers?|lets?|enables?|uses?|routes?|connects?|turns?|powers?|issues?|operates?|manages?|delivers?|gives?|trades?|swaps?|lends?|borrows?|stakes?|earns?|allocates?|automates?|supplies?|pools?|vaults?)\b/i;
const GENERIC_IDENTITY_COPY = /\b(?:official product surface|project behind|official (?:site|website)|linked to (?:the )?(?:site|website|domain))\b/i;

function hasProductMechanism(value: string): boolean {
  // A ticker-like project name (for example EARN) must not accidentally count
  // as the verb "earn". Remove only an all-caps leading label before testing.
  return PRODUCT_VERBS.test(value.replace(/^[A-Z][A-Z0-9$._-]{1,19}\b\s*/, ""));
}

function tidySentence(value: string): string {
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(URL_PATTERN, " ")
    .replace(EVM_CONTRACT, " ")
    .replace(SOLANA_CONTRACT, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[|•·]+/g, ", ")
    .replace(/\b(?:ca|contract(?:\s+address)?)\s*:?\s*(?=[,.;]|$)/gi, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\s]+|[,;:\s]+$/g, "")
    .trim();
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function narrativeWords(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function substantiallyRepeats(value: string, source: string): boolean {
  const valueWords = narrativeWords(value);
  const sourceWords = narrativeWords(source);
  if (valueWords.size < 4 || sourceWords.size < 4) return false;
  let overlap = 0;
  for (const word of valueWords) if (sourceWords.has(word)) overlap += 1;
  return overlap / valueWords.size >= 0.75;
}

interface NarrativeProductFact {
  predicate: string;
  value?: unknown;
}

function narrativeProductFact(facts: NarrativeProductFact[] | undefined, bio: string): string {
  return (facts ?? [])
    .filter((fact) => fact.predicate === "product")
    .map((fact) => typeof fact.value === "string" ? tidySentence(neutralizeProductCopy(fact.value)) : "")
    .filter((value) => value.length >= 24 && hasProductMechanism(value) && !GENERIC_IDENTITY_COPY.test(value) && !substantiallyRepeats(value, bio))
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function boundGrokOverview(orientation: SubjectOrientation | undefined, bio: string): string {
  if (!orientation || orientation.kind === "UNKNOWN") return "";
  const overview = tidySentence(neutralizeProductCopy(orientation.what));
  if (overview.length < 24 || !hasProductMechanism(overview) || GENERIC_IDENTITY_COPY.test(overview) || substantiallyRepeats(overview, bio)) return "";
  return overview;
}

function projectTokenSentence(token: ProjectTokenSnapshot | undefined, overview: string): string {
  if (!token?.verified || !token.symbol || overview.toLowerCase().includes(`$${token.symbol.toLowerCase()}`)) return "";
  const chain = token.chain?.trim();
  return tidySentence(`Its linked $${token.symbol} token${chain ? ` is issued on ${chain}` : " is assessed separately"}`);
}

export interface ReportOpeningNarrativeInput {
  name: string;
  handle: string;
  bio: string;
  website?: string;
  subjectOrientation?: SubjectOrientation;
  basicFacts?: NarrativeProductFact[];
  projectToken?: ProjectTokenSnapshot;
}

/**
 * Builds the Style 2 product opening from Grok's bound-source orientation and
 * fetched product facts. The raw X bio is comparison input only and is never
 * published as the report overview.
 */
export function reportOpeningNarrative(input: ReportOpeningNarrativeInput): string {
  const grokOverview = boundGrokOverview(input.subjectOrientation, input.bio);
  const productFact = narrativeProductFact(input.basicFacts, input.bio);
  const overview = grokOverview || productFact;
  const tokenSentence = projectTokenSentence(input.projectToken, overview);
  if (overview) return [overview, tokenSentence].filter(Boolean).join(" ");

  let host = "";
  if (input.website) {
    try { host = new URL(input.website).hostname.replace(/^www\./i, ""); } catch { host = ""; }
  }
  const token = input.projectToken?.verified && input.projectToken.symbol
    ? ` and its linked $${input.projectToken.symbol} token${input.projectToken.chain ? ` on ${input.projectToken.chain}` : ""}`
    : "";
  const identity = host ? `${input.name} is linked to ${host}${token}` : `${input.name} is bound to ${input.handle}${token}`;
  return `${tidySentence(identity)} This saved report did not establish a source-backed explanation of what the product does. Rescan to refresh its first-party product description.`;
}
