import { createHash } from "node:crypto";
import { SubjectClass } from "../src/engine";
import type {
  BasicFact,
  BasicFactPredicate,
  BasicFactSource,
  CollectedEvidence,
} from "../src/data/evidence";

const CRITICAL = new Set<BasicFactPredicate>([
  "official_identity",
  "product",
  "founder",
  "executive",
  "official_token",
]);

const normalizeValue = (value: string): string => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^a-z0-9@$.'-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const hash = (value: unknown): string => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");

function factId(subjectKey: string, predicate: BasicFactPredicate, value: string): string {
  return `basic_v1_${hash(`${subjectKey.toLowerCase()}::${predicate}::${normalizeValue(value)}`)}`;
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
    normalizedValue: normalizeValue(value),
    status: "verified",
    critical: CRITICAL.has(predicate),
    sources,
    ...(qualifier ? { qualifier } : {}),
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
  };
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
  if (!evidence.roles.includes(SubjectClass.PROJECT)) return;

  const projected: BasicFact[] = [];
  const capturedAt = evidence.profile.profile_captured_at
    ?? evidence.projectToken?.capturedAt
    ?? new Date().toISOString();

  if (
    evidence.profile.profile_collection_state === "resolved"
    && evidence.profile.profile_provider === "twitterapi"
    && evidence.profile.display_name.trim()
  ) {
    const handle = evidence.profile.handle.replace(/^@/, "");
    const url = `https://x.com/${encodeURIComponent(handle)}`;
    const excerpt = `${evidence.profile.display_name} (${evidence.profile.handle}) is the provider-resolved identity for this official project account${evidence.profile.website ? ` and links to ${evidence.profile.website}` : ""}.`;
    projected.push(makeFact(evidence, "official_identity", evidence.profile.display_name.trim(), [source({
      url,
      title: "Official X profile",
      excerpt,
      capturedAt,
      provider: "twitterapi",
      sourceClass: "official_subject",
    })], evidence.profile.handle));
  }

  const teamKeys = new Set<string>();
  for (const member of evidence.webTeam ?? []) {
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

  const token = evidence.projectToken;
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
    if (typeof token.volume24hUsd === "number" && token.volume24hUsd > 0) {
      projected.push(makeFact(
        evidence,
        "traction",
        `${formatUsd(token.volume24hUsd)} 24h trading volume`,
        [tokenSource],
        `captured ${token.capturedAt.slice(0, 10)}`,
      ));
    }
  }

  const github = evidence.profile.identity_note.match(/GitHub\s+github\.com\/([A-Za-z0-9_.-]+)/i)?.[1];
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

  const existing = evidence.basicFacts ?? (evidence.basicFacts = []);
  for (const fact of projected) {
    const same = existing.find((candidate) =>
      candidate.predicate === fact.predicate
      && candidate.normalizedValue === fact.normalizedValue,
    );
    if (same) {
      const known = new Set(same.sources.map((candidate) => candidate.url));
      same.sources.push(...fact.sources.filter((candidate) => !known.has(candidate.url)));
      if (fact.status === "verified") same.status = "verified";
      continue;
    }
    existing.push(fact);
  }
}
