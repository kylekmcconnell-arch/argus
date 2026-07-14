import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import {
  basicFactsResearchQuestions,
  collectBasicFacts,
  discoverBasicFactLeadsDetailed,
  discoverGrokBasicFactLeadsDetailed,
} from "../server/adapters/basicFacts";
import type { CollectContext } from "../server/adapters/types";
import { getCost, withCostLedger } from "../server/cost";
import { fetchPublicTextWithRecovery } from "../server/publicWeb";

const MAX_PROVIDER_HTTP_CALLS = 2;
const MAX_SOURCE_FETCHES = 6;
const MAX_RUNTIME_MS = 90_000;
const MAX_ESTIMATED_USD = 0.25;

function assertCanary(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isAaveUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host === "aave.com" || host.endsWith(".aave.com");
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const useGrok = process.argv.includes("--grok");
  assertCanary(
    useGrok ? process.env.XAI_API_KEY : process.env.ANTHROPIC_API_KEY,
    `${useGrok ? "XAI_API_KEY" : "ANTHROPIC_API_KEY"} is required for the live identity canary`,
  );

  const evidence = emptyEvidence("@StaniKulechov");
  evidence.profile.handle = "@StaniKulechov";
  evidence.profile.display_name = "Stani";
  evidence.profile.resolved_name = "Stani";
  evidence.profile.bio = "Founder & CEO @Aave";
  evidence.profile.website = "https://aave.com/";
  evidence.profile.followers = "301K";
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.identity_confidence = "Unverified";
  evidence.roles = [SubjectClass.FOUNDER];
  const ctx: CollectContext = {
    handle: "@StaniKulechov",
    evidence,
    emit: () => undefined,
  };
  const identityQuestions = basicFactsResearchQuestions(ctx).filter((question) =>
    question.id === "person.official_identity");
  assertCanary(identityQuestions.length === 1, "identity question was not configured");

  let providerHttpCalls = 0;
  let sourceFetches = 0;
  const startedAt = Date.now();
  const output = await withCostLedger(async () => {
    const discovery = useGrok
      ? await discoverGrokBasicFactLeadsDetailed(ctx, identityQuestions, "primary", { bypassCache: true })
      : await discoverBasicFactLeadsDetailed(ctx, {
          request: async (input, init) => {
            if (providerHttpCalls >= MAX_PROVIDER_HTTP_CALLS) {
              throw new Error("live identity canary provider-call budget exhausted");
            }
            providerHttpCalls += 1;
            return fetch(input, init);
          },
          cacheRead: async () => null,
          cacheWrite: async () => undefined,
        }, identityQuestions, "primary");

    const officialLeads = discovery.leads
      .filter((lead) => lead.predicate === "official_identity" && lead.value === "Stani Kulechov")
      .flatMap((lead) => [lead.sourceUrl, ...(lead.candidateUrls ?? [])]
        .filter(isAaveUrl)
        .map((sourceUrl) => ({ ...lead, sourceUrl, candidateUrls: [] })))
      .filter((lead, index, leads) => leads.findIndex((candidate) => candidate.sourceUrl === lead.sourceUrl) === index)
      .slice(0, MAX_SOURCE_FETCHES);
    const collector = await collectBasicFacts(ctx, {
      discover: async () => ({ ...discovery, leads: officialLeads }),
      fetchSource: async (url) => {
        sourceFetches += 1;
        return fetchPublicTextWithRecovery(url);
      },
    });
    return { discovery, officialLeads, collector, cost: getCost() };
  });
  const elapsedMs = Date.now() - startedAt;

  const identity = evidence.basicFacts?.find((fact) =>
    fact.predicate === "official_identity" && fact.value === "Stani Kulechov");
  assertCanary(output.discovery.leads.length > 0, "identity discovery returned no usable leads");
  if (useGrok) {
    assertCanary(output.cost.grokCalls >= 1, "Grok canary did not make a live provider call");
    assertCanary(output.cost.grokCalls <= MAX_PROVIDER_HTTP_CALLS, "Grok provider-call budget exceeded");
    assertCanary(
      !output.cost.calls.some((call) => call.provider === "cache"),
      "Grok identity canary used cached discovery",
    );
  }
  assertCanary(
    output.collector.state === "executed",
    `collector ended ${output.collector.state}; candidates ${output.officialLeads.map((lead) => lead.sourceUrl).join(", ")}; ${output.collector.detail ?? "no detail"}`,
  );
  assertCanary(identity?.status === "verified", "Stani Kulechov was not published as a verified identity fact");
  assertCanary(identity.artifact_verified === true, "identity fact was not artifact verified");
  assertCanary(identity.sources.some((source) =>
    source.sourceClass === "official_subject" && isAaveUrl(source.url)), "identity fact lacks an official Aave source");
  assertCanary(evidence.profile.resolved_name === "Stani Kulechov", "profile full name was not promoted");
  assertCanary(evidence.profile.identity_confidence === "Probable", "profile confidence was not promoted to Probable");
  assertCanary(evidence.basicFactQuestionLedger?.find((entry) =>
    entry.questionId === "person.official_identity")?.status === "answered", "identity ledger remains unanswered");
  assertCanary(useGrok || providerHttpCalls <= MAX_PROVIDER_HTTP_CALLS, "provider-call budget exceeded");
  assertCanary(sourceFetches > 0 && sourceFetches <= MAX_SOURCE_FETCHES, `source-fetch budget exceeded: ${sourceFetches}`);
  assertCanary(elapsedMs <= MAX_RUNTIME_MS, `identity canary exceeded ${MAX_RUNTIME_MS}ms`);
  assertCanary(output.cost.usd <= MAX_ESTIMATED_USD, `estimated cost $${output.cost.usd} exceeded $${MAX_ESTIMATED_USD}`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: useGrok ? "grok" : "claude",
    resolvedName: evidence.profile.resolved_name,
    source: identity.sources[0]?.url,
    providerHttpCalls,
    sourceFetches,
    elapsedMs,
    estimatedUsd: output.cost.usd,
  }, null, 2)}\n`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Stani identity canary failed: ${message}\n`);
  process.exitCode = 1;
});
