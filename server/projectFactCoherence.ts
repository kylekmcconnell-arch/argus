import { SubjectClass } from "../src/engine";
import type { BasicFact, BasicFactPredicate, CollectedEvidence } from "../src/data/evidence";
import { projectLeadIsRelevant } from "../src/lib/projectLeadRelevance";

const COLLISION_PRONE_PROJECT_FACTS = new Set<BasicFactPredicate>([
  "official_identity",
  "founder",
  "executive",
  "funding",
  "investor",
  "product",
  "public_security",
]);

export interface ProjectFactCoherenceRejection {
  factId: string;
  predicate: BasicFactPredicate;
  value: string;
  reason: "no_identity_bound_support" | "corroboration_collapsed";
  rejectedSourceUrls: string[];
}

export interface ProjectFactCoherenceResult {
  checked: number;
  rejected: ProjectFactCoherenceRejection[];
}

function subjectFor(evidence: CollectedEvidence) {
  return {
    handle: evidence.profile.handle,
    display_name: evidence.profile.resolved_name?.trim()
      || evidence.profile.display_name.trim()
      || evidence.profile.handle.replace(/^@/, ""),
    website: evidence.profile.website ?? evidence.projectToken?.homepage ?? null,
  };
}

function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function independentHostCount(fact: BasicFact): number {
  return new Set(fact.sources
    .filter((source) => source.relation === "supports"
      && source.artifactVerified === true
      && source.sourceClass === "independent_press")
    .map((source) => sourceHost(source.url))
    .filter((host): host is string => Boolean(host))).size;
}

/**
 * Defense-in-depth entity binding for the assembled project dossier.
 *
 * Retrieval verification proves that a page says a sentence. It does not, by
 * itself, prove that the sentence belongs to the audited entity when several
 * companies share a display name. Research-origin facts therefore receive a
 * second, report-wide binding pass before they can reach scoring or freezing.
 */
export function enforceProjectFactCoherence(evidence: CollectedEvidence): ProjectFactCoherenceResult {
  if (!evidence.roles.includes(SubjectClass.PROJECT) || !evidence.basicFacts?.length) {
    return { checked: 0, rejected: [] };
  }

  const subject = subjectFor(evidence);
  const rejected: ProjectFactCoherenceRejection[] = [];
  const retained: BasicFact[] = [];
  let checked = 0;

  for (const fact of evidence.basicFacts) {
    // Deterministic provider projections are already bound by exact domain,
    // canonical token id/address, or licensed company-domain joins. This pass
    // targets web-research facts, where display-name collisions originate.
    if (!fact.discoveryProvider || !COLLISION_PRONE_PROJECT_FACTS.has(fact.predicate)) {
      retained.push(fact);
      continue;
    }
    checked += 1;
    const supporting = fact.sources.filter((source) => source.relation === "supports");
    const bound = supporting.filter((source) => projectLeadIsRelevant(subject, {
      predicate: fact.predicate,
      value: fact.value,
      qualifier: fact.qualifier,
      sourceUrl: source.url,
      sourceTitle: source.title,
      excerpt: source.excerpt,
    }));
    const rejectedSourceUrls = supporting
      .filter((source) => !bound.includes(source))
      .map((source) => source.url);

    if (!bound.length) {
      rejected.push({
        factId: fact.factId,
        predicate: fact.predicate,
        value: fact.value,
        reason: "no_identity_bound_support",
        rejectedSourceUrls,
      });
      continue;
    }

    const boundUrls = new Set(bound.map((source) => source.url));
    const cleaned = {
      ...fact,
      sources: fact.sources.filter((source) => source.relation !== "supports" || boundUrls.has(source.url)),
    };
    if (fact.status === "corroborated" && independentHostCount(cleaned) < 2) {
      rejected.push({
        factId: fact.factId,
        predicate: fact.predicate,
        value: fact.value,
        reason: "corroboration_collapsed",
        rejectedSourceUrls,
      });
      continue;
    }
    retained.push(cleaned);
  }

  if (rejected.length) {
    evidence.basicFacts = retained;
    const rejectedIds = new Set(rejected.map((entry) => entry.factId));
    for (const question of evidence.basicFactQuestionLedger ?? []) {
      question.answerRefs = question.answerRefs.filter((ref) => !rejectedIds.has(ref));
      if (!question.answerRefs.length) question.status = "unanswered";
    }
  }
  return { checked, rejected };
}
