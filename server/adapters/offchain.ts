// Frozen off-chain diligence: news, US court-caption leads, and exact-name OFAC
// screening run before the analyst and become part of the immutable dossier.

import { createHash } from "node:crypto";
import type { Finding } from "../../src/engine";
import type { SourceArtifact } from "../../src/data/evidence";
import {
  collectLegalCases,
  collectNews,
  collectOfacName,
  isPlausibleFullName,
  legalCaptionHasFullName,
  OFAC_SOURCE_URL,
  type OffchainAttempt,
  type OffchainAttemptStatus,
} from "../../src/lib/offchainEvidence";
import { cacheGet, cacheSet } from "../cache";
import { recordCall } from "../cost";
import type { Adapter, AdapterRunResult, CollectContext } from "./types";
import { collectProfilePhoto } from "./profilePhoto";

const asIso = (value: unknown): string | undefined => {
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return undefined;
};

type UnhashedArtifact = Omit<SourceArtifact, "contentHash">;

const hashArtifact = (artifact: UnhashedArtifact): string => createHash("sha256")
  .update(JSON.stringify({
    kind: artifact.kind,
    provider: artifact.provider,
    title: artifact.title,
    sourceUrl: artifact.sourceUrl,
    publishedAt: artifact.publishedAt ?? null,
    excerpt: artifact.excerpt ?? null,
    match: artifact.match,
    sourceContentHash: artifact.sourceContentHash ?? null,
  }))
  .digest("hex");

const addArtifact = (ctx: CollectContext, input: UnhashedArtifact): void => {
  const artifact: SourceArtifact = { ...input, contentHash: hashArtifact(input) };
  const exists = ctx.evidence.sourceArtifacts.some((candidate) =>
    candidate.provider === artifact.provider
    && candidate.kind === artifact.kind
    && candidate.sourceUrl === artifact.sourceUrl,
  );
  if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
};

const addFinding = (ctx: CollectContext, finding: Finding): void => {
  const exists = ctx.evidence.findings.some((candidate) =>
    candidate.finding_type === finding.finding_type
    && candidate.source_url === finding.source_url
    && candidate.claim === finding.claim,
  );
  if (!exists) ctx.evidence.findings.push(finding);
};

const recordAttempts = (attempts: readonly OffchainAttempt[]): void => {
  for (const attempt of attempts) {
    recordCall(attempt.provider, attempt.operation, 0, attempt.detail, attempt.status);
  }
};

const resolvedRealName = (ctx: CollectContext): string | null => {
  const confidence = ctx.evidence.profile.identity_confidence;
  const explicitName = ctx.evidence.profile.resolved_name?.trim() ?? "";
  const projectOnly = ctx.evidence.roles.length > 0
    && ctx.evidence.roles.every((role) => role === "PROJECT");
  const hasPersonRole = ctx.evidence.roles.some((role) => role !== "PROJECT");
  const confirmedDisplayName = confidence === "Confirmed" && hasPersonRole
    ? ctx.evidence.profile.display_name.trim()
    : "";
  const name = explicitName || confirmedDisplayName;
  const resolved = explicitName
    ? confidence === "Confirmed" || confidence === "Probable"
    : confidence === "Confirmed";
  return resolved && !projectOnly && isPlausibleFullName(name) ? name : null;
};

export function hasResolvedRealName(ctx: CollectContext): boolean {
  return resolvedRealName(ctx) !== null;
}

const failedCheckNote = (label: string, status: OffchainAttemptStatus, attempts: readonly OffchainAttempt[]) => {
  const details = attempts
    .filter((attempt) => attempt.status !== "succeeded")
    .map((attempt) => attempt.detail)
    .filter((detail): detail is string => Boolean(detail));
  return `${label} ${status === "partial" ? "completed only partially" : "was unavailable"}${details.length ? ` (${[...new Set(details)].join(", ")})` : ""}`;
};

export const offchainAdapter: Adapter = {
  id: "offchain-diligence",
  label: "Photo, news, legal, and sanctions",
  available: () => true,
  async run(ctx: CollectContext): Promise<AdapterRunResult> {
    const capturedAt = new Date().toISOString();
    const name = resolvedRealName(ctx);
    ctx.emit({
      phase: "Off-chain",
      label: "Photo / news / legal / sanctions",
      detail: name
        ? `Freezing the official profile-photo, exact-name news, US court, and OFAC outcomes for ${name} before scoring…`
        : "Freezing the official profile-photo and exact-name/handle news outcomes before scoring; legal and OFAC require a resolved real person.",
      tone: "neutral",
    });

    const newsPromise = collectNews(name ?? ctx.evidence.profile.display_name, ctx.handle);
    const profilePhotoPromise = collectProfilePhoto(ctx);
    const legalPromise = name ? collectLegalCases(name) : null;
    const ofacPromise = name
      ? collectOfacName(name, {
          cache: {
            read: () => cacheGet("ofacname:v2", {
              operation: "ofac-name-index-hit",
              meta: "24h OFAC name-index cache",
            }),
            write: (names) => cacheSet("ofacname:v2", names),
          },
        })
      : null;

    const [news, profilePhoto, legal, ofac] = await Promise.all([
      newsPromise,
      profilePhotoPromise,
      legalPromise ?? Promise.resolve(null),
      ofacPromise ?? Promise.resolve(null),
    ]);
    recordAttempts(news.attempts);
    if (legal) recordAttempts(legal.attempts);
    if (ofac) recordAttempts(ofac.attempts);

    if (news.status !== "succeeded") {
      ctx.recordCheck?.({
        id: "news-press",
        status: "unavailable",
        note: failedCheckNote("Google News search", news.status, news.attempts),
        provider: "google-news",
      });
    } else {
      ctx.recordCheck?.({
        id: "news-press",
        status: news.value.articles.length ? "confirmed" : "checked-empty",
        note: news.value.articles.length
          ? `${news.value.articles.length} exact-name or exact-handle crypto press result${news.value.articles.length === 1 ? "" : "s"} frozen`
          : "exact-name and exact-handle crypto press searches returned no matching article",
        provider: "google-news",
        sourceCount: news.value.articles.length,
      });
    }
    for (const article of news.value.articles) {
      if (!article.url) continue;
      addArtifact(ctx, {
        kind: "press",
        provider: "google-news",
        title: article.title,
        sourceUrl: article.url,
        capturedAt,
        ...(asIso(article.publishedAt) ? { publishedAt: asIso(article.publishedAt) } : {}),
        excerpt: article.source,
        match: news.matches[(article.url ?? article.title).toLowerCase()] ?? "exact_name",
      });
    }

    if (legal) {
      const exactCases = legal.value.available
        ? legal.value.cases.filter((item) => legalCaptionHasFullName(item.caseName, name!))
        : [];
      const inspectableCases = exactCases.filter(
        (item): item is typeof item & { url: string } => Boolean(item.url),
      );
      const legalIncomplete = !legal.value.available
        || legal.status !== "succeeded"
        || inspectableCases.length !== exactCases.length;
      if (legalIncomplete) {
        ctx.recordCheck?.({
          id: "us-legal-history",
          status: "unavailable",
          note: inspectableCases.length !== exactCases.length
            ? "CourtListener returned a matching caption without an inspectable docket URL"
            : failedCheckNote("CourtListener search", legal.status, legal.attempts),
          provider: "courtlistener",
          sourceCount: inspectableCases.length,
        });
      } else {
        ctx.recordCheck?.({
          id: "us-legal-history",
          status: exactCases.length ? "finding" : "checked-empty",
          note: exactCases.length
            ? `${exactCases.length} CourtListener case caption${exactCases.length === 1 ? "" : "s"} contained the full resolved name; identity match requires review${legal.status === "partial" ? " (other returned rows were malformed)" : ""}`
            : "CourtListener returned no case caption containing the full resolved name",
          provider: "courtlistener",
          sourceCount: exactCases.length,
        });
      }
      for (const item of inspectableCases) {
        addArtifact(ctx, {
          kind: "legal_case",
          provider: "courtlistener",
          title: item.caseName || "CourtListener case",
          sourceUrl: item.url,
          capturedAt,
          ...(asIso(item.date) ? { publishedAt: asIso(item.date) } : {}),
          excerpt: [item.court, item.docket == null ? "" : String(item.docket)].filter(Boolean).join(" · "),
          match: "candidate",
        });
        addFinding(ctx, {
          finding_type: "LegalCaseNameLead",
          claim: `${name} appears by full name in the caption of ${item.caseName || "a US court record"}; verify that the named party is the audited subject.`,
          source_url: item.url,
          source_date: asIso(item.date)?.slice(0, 10) ?? "",
          source_author: "CourtListener / RECAP",
          verification_status: "Reported",
          independent_source_count: 1,
          polarity: -1,
          evidence_origin: "deterministic",
          artifact_verified: true,
        });
      }
    }

    if (ofac) {
      if (ofac.status !== "succeeded" || !ofac.value.available) {
        ctx.recordCheck?.({
          id: "ofac-sanctions-name",
          status: "unavailable",
          note: failedCheckNote("OFAC name screen", ofac.status, ofac.attempts),
          provider: "opensanctions",
        });
      } else {
        ctx.recordCheck?.({
          id: "ofac-sanctions-name",
          status: ofac.value.sanctioned ? "finding" : "checked-empty",
          note: ofac.value.sanctioned
            ? "exact full-name or alias match in the US Treasury OFAC SDN mirror; identity match requires review"
            : `exact full-name and reversed-name screen completed against ${ofac.value.listSize.toLocaleString()} OFAC SDN names with no match`,
          provider: "opensanctions",
          sourceCount: 1,
        });
        addArtifact(ctx, {
          kind: "sanctions_screen",
          provider: "opensanctions",
          title: "US Treasury OFAC SDN exact-name screen",
          sourceUrl: OFAC_SOURCE_URL,
          capturedAt,
          excerpt: ofac.value.sanctioned
            ? `Exact name/alias match for ${name}; identity requires verification.`
            : `No exact full-name or reversed-name match for ${name} across ${ofac.value.listSize} indexed names.`,
          match: ofac.value.sanctioned ? "exact_name" : "no_match",
          ...(ofac.indexHash ? { sourceContentHash: ofac.indexHash } : {}),
        });
        if (ofac.value.sanctioned) {
          addFinding(ctx, {
            finding_type: "SanctionsNameLead",
            claim: `${name} exactly matches a person name or alias in the US Treasury OFAC SDN mirror; verify the identity before drawing a conclusion.`,
            source_url: OFAC_SOURCE_URL,
            source_date: capturedAt.slice(0, 10),
            source_author: "OpenSanctions mirror of US Treasury OFAC SDN",
            verification_status: "Reported",
            independent_source_count: 1,
            polarity: -1,
            evidence_origin: "deterministic",
            artifact_verified: true,
          });
        }
      }
    }

    const statuses = [news.status, profilePhoto.status, legal?.status, ofac?.status].filter(
      (status): status is OffchainAttemptStatus => Boolean(status),
    );
    const failed = statuses.filter((status) => status === "failed").length;
    const partial = statuses.filter((status) => status === "partial").length;
    const state: AdapterRunResult["state"] = failed === statuses.length
      ? "failed"
      : failed || partial
        ? "partial"
        : "executed";
    const artifactCount = ctx.evidence.sourceArtifacts.length;
    ctx.emit({
      phase: "Off-chain",
      label: state === "failed" ? "Off-chain screens unavailable" : "Off-chain evidence frozen",
      detail: `${artifactCount} source artifact${artifactCount === 1 ? "" : "s"} available before scoring${state === "partial" ? "; at least one provider path was incomplete" : ""}.`,
      source: "claude-vision · google-news · courtlistener · opensanctions",
      tone: state === "failed" ? "warn" : state === "partial" ? "warn" : "neutral",
    });
    return { state, detail: `${artifactCount} artifacts · ${failed} failed · ${partial} partial` };
  },
};
