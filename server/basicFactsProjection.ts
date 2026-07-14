import { createHash } from "node:crypto";
import { SubjectClass } from "../src/engine";
import {
  canonicalBasicFactComparisonValue,
  type BasicFact,
  type BasicFactPredicate,
  type BasicFactSource,
  type CollectedEvidence,
} from "../src/data/evidence";

const CRITICAL = new Set<BasicFactPredicate>([
  "official_identity",
  "current_role",
  "product",
  "founder",
  "executive",
  "official_token",
]);

const FOUNDER_ROLE = /\b(?:co[- ]?)?founder\b|\bcreator\b/i;
const CURRENT_AUTHORITY_ROLE = /\b(?:co[- ]?)?founder\b|\b(?:chief\s+executive\s+officer|ceo|chair(?:man|woman)?|president|owner|managing\s+partner|general\s+partner|director|head|lead)\b/i;

const normalizeValue = (value: string): string => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^a-z0-9@$.'-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const normalizeFactValue = (predicate: BasicFactPredicate, value: string): string =>
  canonicalBasicFactComparisonValue(predicate, normalizeValue(value));

const hash = (value: unknown): string => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");

function factId(subjectKey: string, predicate: BasicFactPredicate, value: string): string {
  return `basic_v1_${hash(`${subjectKey.toLowerCase()}::${predicate}::${normalizeFactValue(predicate, value)}`)}`;
}

function officialHost(evidence: CollectedEvidence): string | null {
  try {
    return evidence.profile.website ? new URL(evidence.profile.website).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

function isOfficialUrl(url: string, host: string | null): boolean {
  if (!host) return false;
  try {
    const candidate = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return candidate === host || candidate.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

function safePublicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function containsPhrase(text: string, phrase: string): boolean {
  const phraseValue = (value: string) => normalizeValue(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const haystack = ` ${phraseValue(text)} `;
  const needle = phraseValue(phrase);
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const VENTURE_HOST_STOP_WORDS = new Set([
  "company", "foundation", "global", "group", "holdings", "labs", "limited",
  "network", "project", "protocol", "technologies", "technology", "the",
]);

function hostIdentifiesVenture(host: string, projectName: string): boolean {
  const labels = host.split(".").map((label) => label.replace(/[^a-z0-9]/g, ""));
  const tokens = normalizeValue(projectName)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !VENTURE_HOST_STOP_WORDS.has(token));
  return tokens.some((token) => labels.includes(token));
}

function verifiedVentureHosts(venture: CollectedEvidence["ventures"][number]): string[] {
  const hosts: string[] = [];
  const domain = safePublicUrl(venture.domain?.includes("://") ? venture.domain : venture.domain ? `https://${venture.domain}` : null);
  const domainHost = domain ? sourceHost(domain) : null;
  if (domainHost) hosts.push(domainHost);
  const evidenceUrl = safePublicUrl(venture.evidence_url);
  const evidenceHost = evidenceUrl ? sourceHost(evidenceUrl) : null;
  if (evidenceHost && hostIdentifiesVenture(evidenceHost, venture.project_name)) hosts.push(evidenceHost);
  return [...new Set(hosts)];
}

function sourceMatchesVenture(
  candidate: BasicFactSource,
  venture: CollectedEvidence["ventures"][number],
): boolean {
  const host = sourceHost(candidate.url);
  if (!host) return false;
  if (venture.domain) {
    const ventureUrl = safePublicUrl(venture.domain.includes("://") ? venture.domain : `https://${venture.domain}`);
    const ventureHost = ventureUrl ? sourceHost(ventureUrl) : null;
    if (ventureHost && (host === ventureHost || host.endsWith(`.${ventureHost}`))) return true;
  }
  return verifiedVentureHosts(venture).some((ventureHost) =>
    host === ventureHost || host.endsWith(`.${ventureHost}`));
}

const MATERIAL_AUTHORITY_ROLES: Array<{ claimed: RegExp; supportedPattern: string }> = [
  { claimed: /\b(?:co[- ]?)?founder\b|\bcreator\b/i, supportedPattern: "(?:co[- ]?founder|founder|creator)" },
  { claimed: /\b(?:chief\s+executive\s+officer|ceo)\b/i, supportedPattern: "(?:chief\\s+executive\\s+officer|ceo)" },
  { claimed: /\bchair(?:man|woman|person)?\b/i, supportedPattern: "chair(?:man|woman|person)?" },
  { claimed: /\bpresident\b/i, supportedPattern: "president" },
  { claimed: /\bowner\b/i, supportedPattern: "owner" },
  { claimed: /\bmanaging\s+partner\b/i, supportedPattern: "managing\\s+partner" },
  { claimed: /\bgeneral\s+partner\b/i, supportedPattern: "general\\s+partner" },
  { claimed: /\bdirector\b/i, supportedPattern: "director" },
  { claimed: /\bhead\b/i, supportedPattern: "head" },
  { claimed: /\blead\b/i, supportedPattern: "lead" },
];

function passageBindsSpecificAuthorityRole(
  passage: string,
  aliases: readonly string[],
  venture: CollectedEvidence["ventures"][number],
  rolePattern: string,
): boolean {
  const venturePattern = escapePattern(venture.project_name.trim()).replace(/\s+/g, "\\s+");
  const anyAuthorityRole = "(?:co[- ]?founder|founder|creator|chief\\s+executive\\s+officer|ceo|chair(?:man|woman|person)?|president|owner|managing\\s+partner|general\\s+partner|director|head|lead)";
  const roleConnector = `(?:(?:${anyAuthorityRole})\\s*(?:,|&|and)\\s*|(?:has\\s+served|serves?|served|serving)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)`;
  return aliases.some((alias) => {
    const aliasPattern = escapePattern(alias).replace(/\s+/g, "\\s+");
    const subjectFirst = new RegExp(
      `\\b${aliasPattern}\\b\\s*(?:,\\s*)?`
      + `(?:(?:is|was|remains|became|serves?|served|serving|has\\s+served|currently\\s+serves?)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)?`
      + `(?:${venturePattern}\\s+)?(?:${roleConnector}){0,4}\\b${rolePattern}\\b`,
      "i",
    );
    const titleFirst = new RegExp(
      `\\b${rolePattern}\\s+(?:of|at)\\s+${venturePattern}\\s*,?\\s*${aliasPattern}\\b`,
      "i",
    );
    const foundedBy = /founder|creator/.test(rolePattern)
      && new RegExp(`\\b${venturePattern}\\s+(?:was\\s+)?(?:co[- ]?founded|founded|created)\\s+by\\s+${aliasPattern}\\b`, "i").test(passage);
    return subjectFirst.test(passage) || titleFirst.test(passage) || foundedBy;
  });
}

function currentRoleIsFullySupported(
  sources: readonly BasicFactSource[],
  venture: CollectedEvidence["ventures"][number],
  aliases: readonly string[],
): boolean {
  const claimedRoles = MATERIAL_AUTHORITY_ROLES.filter(({ claimed }) => claimed.test(venture.role));
  if (!claimedRoles.length) return false;
  return claimedRoles.every(({ supportedPattern }) => sources.some((candidate) => {
    const sourceScopeMatches = sourceMatchesVenture(candidate, venture);
    return boundedSourcePassages(candidate.excerpt).some((passage) =>
      passageBindsSpecificAuthorityRole(passage, aliases, venture, supportedPattern)
      && (containsPhrase(passage, venture.project_name) || sourceScopeMatches));
  }));
}

function sourceMentionsSubject(candidate: BasicFactSource, aliases: readonly string[]): boolean {
  return aliases.some((alias) => containsPhrase(candidate.excerpt, alias));
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedSourcePassages(value: string): string[] {
  return value
    .split(/(?<=[.!?;])\s+|[\n|]+/)
    .map((passage) => passage.trim())
    .filter(Boolean);
}

function passageBindsSubjectRole(
  passage: string,
  aliases: readonly string[],
  venture: CollectedEvidence["ventures"][number],
  predicate: "founder" | "current_role",
): boolean {
  const venturePattern = escapePattern(venture.project_name.trim()).replace(/\s+/g, "\\s+");
  return aliases.some((alias) => {
    const aliasPattern = escapePattern(alias).replace(/\s+/g, "\\s+");
    if (predicate === "founder") {
      const founderRole = "(?:co[- ]?founder|founder|creator)";
      return new RegExp(
        `(?:\\b${aliasPattern}\\b\\s*(?:,\\s*)?(?:(?:is|was|remains|became|serves?|served|serving|has\\s+served)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)?(?:${venturePattern}\\s+)?${founderRole}\\b)`
        + `|(?:\\b${aliasPattern}\\b\\s+(?:co[- ]?founded|founded|created)\\s+(?:${venturePattern})\\b)`
        + `|(?:\\b(?:${venturePattern}\\s+)?(?:co[- ]?founded|founded|created)\\s+by\\s+${aliasPattern}\\b)`,
        "i",
      ).test(passage);
    }
    const authorityRole = "(?:co[- ]?founder|founder|chief\\s+executive\\s+officer|ceo|chair(?:man|woman|person)?|president|owner|managing\\s+partner|general\\s+partner|director|head|lead)";
    return new RegExp(
      `(?:\\b${aliasPattern}\\b\\s*(?:,\\s*)?(?:(?:is|was|remains|became|serves?|served|serving|has\\s+served|currently\\s+serves?)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)?(?:${venturePattern}\\s+)?${authorityRole}\\b)`
      + `|(?:\\b${authorityRole}\\s+(?:of|at)\\s+${venturePattern}\\s*,?\\s*${aliasPattern}\\b)`,
      "i",
    ).test(passage);
  });
}

function sourceSupportsRelationship(
  candidate: BasicFactSource,
  venture: CollectedEvidence["ventures"][number],
  aliases: readonly string[],
  predicate: "founder" | "current_role",
): boolean {
  if (!sourceMentionsSubject(candidate, aliases)) return false;
  const sourceScopeMatches = sourceMatchesVenture(candidate, venture);
  return boundedSourcePassages(candidate.excerpt).some((passage) =>
    passageBindsSubjectRole(passage, aliases, venture, predicate)
    && (containsPhrase(passage, venture.project_name) || sourceScopeMatches));
}

function source(input: {
  url: string;
  title: string;
  excerpt: string;
  capturedAt: string;
  provider: string;
  sourceClass: BasicFactSource["sourceClass"];
}): BasicFactSource {
  return {
    ...input,
    relation: "supports",
    contentHash: hash(input),
    artifactVerified: true,
  };
}

function makeFact(
  evidence: CollectedEvidence,
  predicate: BasicFactPredicate,
  value: string,
  sources: BasicFactSource[],
  qualifier?: string,
): BasicFact {
  const subjectKey = evidence.profile.handle;
  return {
    factId: factId(subjectKey, predicate, value),
    subjectKey,
    predicate,
    value,
    normalizedValue: normalizeFactValue(predicate, value),
    status: "verified",
    critical: CRITICAL.has(predicate),
    sources,
    ...(qualifier ? { qualifier } : {}),
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
  };
}

function profileSource(evidence: CollectedEvidence, capturedAt: string): BasicFactSource {
  const handle = evidence.profile.handle.replace(/^@/, "");
  return source({
    url: `https://x.com/${encodeURIComponent(handle)}`,
    title: "Official X profile",
    excerpt: evidence.profile.bio.trim()
      ? `${evidence.profile.display_name} (${evidence.profile.handle}): ${evidence.profile.bio.trim()}`
      : `${evidence.profile.display_name} (${evidence.profile.handle}) is the provider-resolved identity for this account.`,
    capturedAt,
    provider: "twitterapi",
    sourceClass: "official_subject",
  });
}

function githubIdentitySource(evidence: CollectedEvidence, capturedAt: string): BasicFactSource | null {
  if (!/links?\s+back\s+to\s+(?:this\s+)?X\s+handle/i.test(evidence.profile.identity_note)) return null;
  const login = evidence.profile.identity_note.match(/GitHub\s+github\.com\/([A-Za-z0-9_.-]+)/i)?.[1];
  if (!login) return null;
  return source({
    url: `https://github.com/${login}`,
    title: "Identity-bound GitHub profile",
    excerpt: evidence.profile.identity_note,
    capturedAt,
    provider: "github",
    sourceClass: "other_public",
  });
}

function profileSupportsVenture(
  evidence: CollectedEvidence,
  venture: CollectedEvidence["ventures"][number],
  predicate: "founder" | "current_role",
): boolean {
  const clauses = evidence.profile.bio.split(/[.;|\n]+/).filter((clause) =>
    containsPhrase(clause, venture.project_name)
    || Boolean(venture.x_handle && containsPhrase(clause, venture.x_handle)));
  return clauses.some((clause) => predicate === "founder"
    ? FOUNDER_ROLE.test(clause)
    : CURRENT_AUTHORITY_ROLE.test(clause));
}

function mergeProjectedFact(evidence: CollectedEvidence, fact: BasicFact): BasicFact {
  const existing = evidence.basicFacts ?? (evidence.basicFacts = []);
  const same = existing.find((candidate) =>
    candidate.predicate === fact.predicate
    && candidate.normalizedValue === fact.normalizedValue,
  );
  if (!same) {
    existing.push(fact);
    return fact;
  }
  const known = new Set(same.sources.map((candidate) => candidate.url));
  same.sources.push(...fact.sources.filter((candidate) => !known.has(candidate.url)));
  // A deterministic projection may add support, but it cannot erase a frozen
  // conflict that was established by competing values or sources.
  if (same.status !== "conflicted") same.status = "verified";
  // Floor eligibility is monotonic upward: if a strict (floor-eligible) fact
  // merges onto a recall-only fact, the merged fact regains floor eligibility.
  if (fact.floorEligible !== false && same.floorEligible === false) delete same.floorEligible;
  return same;
}

function reconcileQuestionLedger(evidence: CollectedEvidence, facts: readonly BasicFact[]): void {
  const singletonPredicates = new Set<BasicFactPredicate>(["official_identity"]);
  const projectedByPredicate = new Map<BasicFactPredicate, BasicFact[]>();
  for (const fact of facts) {
    if (fact.status !== "verified" && fact.status !== "corroborated") continue;
    const rows = projectedByPredicate.get(fact.predicate) ?? [];
    rows.push(fact);
    projectedByPredicate.set(fact.predicate, rows);
  }
  for (const entry of evidence.basicFactQuestionLedger ?? []) {
    const answers = projectedByPredicate.get(entry.predicate) ?? [];
    if (!answers.length) continue;
    if (singletonPredicates.has(entry.predicate)) {
      const allPredicateFacts = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === entry.predicate);
      const acceptedValues = new Set(allPredicateFacts
        .filter((fact) => fact.status === "verified" || fact.status === "corroborated")
        .map((fact) => fact.normalizedValue));
      if (allPredicateFacts.some((fact) => fact.status === "conflicted") || acceptedValues.size !== 1) continue;
    }
    entry.answerRefs = [...new Set([...entry.answerRefs, ...answers.map((fact) => fact.factId)])];
    entry.status = "answered";
  }
}

function formatUsd(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(absolute >= 10_000_000_000 ? 0 : 1)}B`;
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Reuse identity-bound provider records for basic questions that ARGUS has
 * already answered elsewhere in the same frozen report. This prevents the
 * Basic Facts panel from contradicting the token, profile, and GitHub panels.
 * No model lead is promoted here.
 */
export function projectProviderBackedBasicFacts(evidence: CollectedEvidence): void {
  const projected: BasicFact[] = [];
  const capturedAt = evidence.profile.profile_captured_at
    ?? evidence.projectToken?.capturedAt
    ?? new Date().toISOString();

  const resolvedProviderProfile = evidence.profile.profile_collection_state === "resolved"
    && evidence.profile.profile_provider === "twitterapi"
    && evidence.profile.display_name.trim();
  const officialProfileSource = resolvedProviderProfile ? profileSource(evidence, capturedAt) : null;

  if (officialProfileSource && evidence.roles.includes(SubjectClass.PROJECT)) {
    projected.push(makeFact(
      evidence,
      "official_identity",
      evidence.profile.display_name.trim(),
      [officialProfileSource],
      evidence.profile.handle,
    ));
  }

  if (
    officialProfileSource
    && evidence.roles.includes(SubjectClass.FOUNDER)
    && evidence.profile.identity_confidence !== "SuspectedImpersonation"
  ) {
    const existingVerifiedSources = (evidence.basicFacts ?? [])
      .filter((fact) => fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated"))
      .flatMap((fact) => fact.sources)
      .filter((candidate) =>
        candidate.relation === "supports"
        && candidate.provider !== "twitterapi"
        && candidate.url !== officialProfileSource.url);
    const aliases = [...new Set([
      evidence.profile.display_name.trim(),
      evidence.profile.resolved_name?.trim() ?? "",
    ].filter(Boolean))];
    const namedFrozenSource = existingVerifiedSources.find((candidate) => sourceMentionsSubject(candidate, aliases));
    const githubSource = githubIdentitySource(evidence, capturedAt);
    const identityAnchor = namedFrozenSource ?? githubSource;
    if (identityAnchor) {
      projected.push(makeFact(
        evidence,
        "official_identity",
        evidence.profile.resolved_name?.trim() || evidence.profile.display_name.trim(),
        [officialProfileSource, identityAnchor],
        evidence.profile.handle,
      ));
    }

    const personVentures = evidence.ventures.filter((venture) =>
      venture.artifact_verified === true
      && venture.evidence_origin !== "model_lead"
      && venture.project_name.trim()
      && venture.role.trim());
    for (const venture of personVentures) {
      const founderSources = existingVerifiedSources.filter((candidate) =>
        sourceSupportsRelationship(candidate, venture, aliases, "founder"));
      if (FOUNDER_ROLE.test(venture.role) && founderSources.length) {
        const sources = [...founderSources];
        if (officialProfileSource && profileSupportsVenture(evidence, venture, "founder")) sources.push(officialProfileSource);
        projected.push(makeFact(
          evidence,
          "founder",
          venture.project_name.trim(),
          [...new Map(sources.map((candidate) => [candidate.url, candidate])).values()],
        ));
      }

      const currentSources = existingVerifiedSources.filter((candidate) =>
        sourceSupportsRelationship(candidate, venture, aliases, "current_role"));
      if (
        CURRENT_AUTHORITY_ROLE.test(venture.role)
        && currentSources.length
        && currentRoleIsFullySupported(currentSources, venture, aliases)
      ) {
        const sources = [...currentSources];
        if (officialProfileSource && profileSupportsVenture(evidence, venture, "current_role")) sources.push(officialProfileSource);
        projected.push(makeFact(
          evidence,
          "current_role",
          `${venture.role.trim()} at ${venture.project_name.trim()}`,
          [...new Map(sources.map((candidate) => [candidate.url, candidate])).values()],
        ));
      }
    }
  }

  const teamKeys = new Set<string>();
  for (const member of evidence.roles.includes(SubjectClass.PROJECT) ? evidence.webTeam ?? [] : []) {
    if (
      member.artifact_verified !== true
      || member.evidence_origin !== "deterministic"
      || (member.provider !== "team-page" && member.provider !== "twitterapi")
      || !member.sourceUrl
      || !member.name.trim()
    ) continue;
    const predicate: BasicFactPredicate | null = /\b(?:co[- ]?founder|founder|creator)\b/i.test(member.role)
      ? "founder"
      : /\b(?:ceo|cto|coo|cfo|chief|president|director|head|lead)\b/i.test(member.role)
        ? "executive"
        : null;
    if (!predicate) continue;
    const identityKey = member.handle?.replace(/^@/, "").toLowerCase() || normalizeValue(member.name);
    if (teamKeys.has(identityKey)) continue;
    teamKeys.add(identityKey);
    const excerpt = member.evidence?.trim()
      || `${member.name} is listed as ${member.role} by the project's fetched ${member.source}.`;
    projected.push(makeFact(evidence, predicate, member.name.trim(), [source({
      url: member.sourceUrl,
      title: member.source || "Project team source",
      excerpt,
      capturedAt,
      provider: member.provider,
      sourceClass: member.provider === "twitterapi" || isOfficialUrl(member.sourceUrl, officialHost(evidence))
        ? "official_subject"
        : "other_public",
    })], member.role));
  }

  const token = evidence.roles.includes(SubjectClass.PROJECT) ? evidence.projectToken : undefined;
  if (token?.verified) {
    const tokenExcerpt = `${token.name} (${token.symbol}) is the canonical project token on ${token.chain}; its identity matched the project's ${token.verification === "official_x" ? "official X account" : "official domain"}.`;
    const tokenSource = source({
      url: token.sourceUrl,
      title: "CoinGecko token record",
      excerpt: tokenExcerpt,
      capturedAt: token.capturedAt,
      provider: (token.providers ?? ["coingecko"]).join(" + "),
      sourceClass: "regulatory_or_onchain",
    });
    projected.push(makeFact(evidence, "official_token", `$${token.symbol.toUpperCase()}`, [tokenSource], token.name));
    projected.push(makeFact(evidence, "network", token.chain, [tokenSource]));

    // Market/on-chain liveness. A verified canonical token that is ranked,
    // capitalized, and liquid across multiple market providers is hard evidence
    // of a live, actively-used product — evidence that CANNOT be hallucinated
    // and does not depend on fetching the homepage. This is what lets a real
    // protocol (Aave, Uniswap, …) whose site sits behind Cloudflare bot
    // management still complete its traction and product-substance questions,
    // instead of returning INCOMPLETE because a Node fetch was challenged.
    const rank = typeof token.rank === "number" && token.rank > 0 ? token.rank : null;
    const marketCap = typeof token.marketCapUsd === "number" && token.marketCapUsd > 0 ? token.marketCapUsd : null;
    const liquidity = typeof token.liquidityUsd === "number" && token.liquidityUsd > 0 ? token.liquidityUsd : null;
    const volume = typeof token.volume24hUsd === "number" && token.volume24hUsd > 0 ? token.volume24hUsd : null;
    const marketDescriptor = [
      rank !== null ? `CoinGecko rank #${rank}` : null,
      marketCap !== null ? `${formatUsd(marketCap)} market cap` : null,
      liquidity !== null ? `${formatUsd(liquidity)} on-chain liquidity` : null,
      volume !== null ? `${formatUsd(volume)} 24h volume` : null,
    ].filter((part): part is string => Boolean(part)).join(" · ");

    // Traction: any real market footprint proves the token trades and is used.
    const hasLiveMarket = rank !== null || marketCap !== null || liquidity !== null || volume !== null;
    if (hasLiveMarket) {
      projected.push(makeFact(
        evidence,
        "traction",
        marketDescriptor,
        [tokenSource],
        `captured ${token.capturedAt.slice(0, 10)}`,
      ));
    }

    // Product substance: an established, canonical protocol token (ranked or
    // materially capitalized) is a live operating product, even when the
    // marketing site cannot be fetched. Reserved for the established tier so a
    // thin new token does not inherit product substance for free.
    const establishedProtocol = (rank !== null && rank <= 3000) || (marketCap !== null && marketCap >= 10_000_000);
    if (establishedProtocol) {
      const providerLabel = (token.providers ?? ["coingecko"]).join(" + ");
      projected.push(makeFact(
        evidence,
        "product",
        `${token.name} operates a live on-chain protocol; its canonical token ${token.symbol.toUpperCase()} is established and actively traded (${marketDescriptor})`,
        [source({
          url: token.sourceUrl,
          title: "On-chain market liveness",
          excerpt: `${token.name} (${token.symbol}) is a verified canonical token corroborated across ${providerLabel} with ${marketDescriptor}. An established, liquid, market-listed protocol token is direct evidence of a live operating product.`,
          capturedAt: token.capturedAt,
          provider: providerLabel,
          sourceClass: "regulatory_or_onchain",
        })],
      ));
    }
  }

  const github = evidence.roles.includes(SubjectClass.PROJECT)
    ? evidence.profile.identity_note.match(/GitHub\s+github\.com\/([A-Za-z0-9_.-]+)/i)?.[1]
    : undefined;
  if (github) {
    const url = `https://github.com/${github}`;
    projected.push(makeFact(evidence, "repository", `github.com/${github}`, [source({
      url,
      title: "Verified GitHub account",
      excerpt: evidence.profile.identity_note,
      capturedAt,
      provider: "github",
      sourceClass: isOfficialUrl(url, officialHost(evidence)) ? "official_subject" : "other_public",
    })]));
  }

  const materialized = projected.map((fact) => mergeProjectedFact(evidence, fact));
  reconcileQuestionLedger(evidence, materialized);
}
