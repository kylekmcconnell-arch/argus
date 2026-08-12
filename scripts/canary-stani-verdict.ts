import { emptyEvidence, type BasicFactLead } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import {
  analyzeSubject,
  buildScoringEvidencePacket,
  extractScoringEvidenceCatalog,
  inspectAnalystScoringPreflight,
  type AnalystAxis,
} from "../server/agent";
import { collectBasicFacts } from "../server/adapters/basicFacts";
import type { CollectContext } from "../server/adapters/types";
import { getCost, withCostLedger } from "../server/cost";
import { fetchPublicTextWithRecovery } from "../server/publicWeb";

const OFFICIAL_AAVE_SOURCE = "https://aave.com/blog/stable-acquire";
const OFFICIAL_EXCERPT = "said Stani Kulechov, founder of Aave Labs.";
const OFFICIAL_PRODUCT_EXCERPT = "Founded by Stani Kulechov, original author of ETHLend (2017) and the Aave Protocol (2020), Aave Labs continues to drive major upgrades to Aave, including the upcoming V4 release.";
const MAX_RUNTIME_MS = 120_000;
const MAX_GROK_CALLS = 2;
const MAX_ESTIMATED_USD = 0.05;

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

function verifiedLead(
  predicate: BasicFactLead["predicate"],
  value: string,
  questionId: string,
  excerpt = OFFICIAL_EXCERPT,
): BasicFactLead {
  return {
    subject: "Stani Kulechov",
    predicate,
    value,
    questionId,
    excerpt,
    sourceUrl: OFFICIAL_AAVE_SOURCE,
    sourceTitle: "Aave Labs Acquires Stable Finance",
    evidence_origin: "model_lead",
    artifact_verified: false,
    provider: "grok",
  };
}

async function run(): Promise<void> {
  assertCanary(process.env.XAI_API_KEY, "XAI_API_KEY is required for the live verdict canary");
  const startedAt = Date.now();
  const evidence = emptyEvidence("@StaniKulechov");
  evidence.profile.handle = "@StaniKulechov";
  evidence.profile.display_name = "Stani Kulechov";
  evidence.profile.resolved_name = "Stani Kulechov";
  evidence.profile.bio = "Founder & CEO @Aave";
  evidence.profile.website = "https://aave.com/";
  evidence.profile.followers = "301K";
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = new Date().toISOString();
  evidence.roles = [SubjectClass.FOUNDER];
  const ctx: CollectContext = {
    handle: "@StaniKulechov",
    evidence,
    emit: () => undefined,
  };
  const axes: AnalystAxis[] = [
    { axis: "F1_identity_verifiability", weight: 12, role: SubjectClass.FOUNDER },
    { axis: "F2_track_record", weight: 28, role: SubjectClass.FOUNDER },
  ];
  const realFetch = globalThis.fetch;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  let sourceFetches = 0;
  let forcedAnthropicFailures = 0;
  let grokCalls = 0;

  const result = await withCostLedger(async () => {
    const collector = await collectBasicFacts(ctx, {
      discover: async () => [
        verifiedLead("official_identity", "Stani Kulechov", "person.official_identity"),
        verifiedLead("founder", "Aave Labs", "person.founder"),
        verifiedLead("product", "Aave Protocol", "person.product", OFFICIAL_PRODUCT_EXCERPT),
      ],
      fetchSource: async (url) => {
        sourceFetches += 1;
        return fetchPublicTextWithRecovery(url);
      },
    });
    const identity = evidence.basicFacts?.find((fact) =>
      fact.predicate === "official_identity" && fact.value === "Stani Kulechov");
    const founder = evidence.basicFacts?.find((fact) =>
      fact.predicate === "founder" && fact.value === "Aave Labs");
    const product = evidence.basicFacts?.find((fact) =>
      fact.predicate === "product" && fact.value === "Aave Protocol");
    assertCanary(collector.state === "executed", `basic facts collector ended ${collector.state}`);
    assertCanary(identity?.status === "verified", "official Aave source did not verify Stani's identity");
    assertCanary(founder?.status === "verified", "official Aave source did not verify Stani's founder relationship");
    assertCanary(product?.status === "verified", "official Aave source did not verify Stani's Aave Protocol work");
    assertCanary(identity.sources.some((source) =>
      source.sourceClass === "official_subject" && isAaveUrl(source.url)), "identity fact lacks official Aave evidence");
    assertCanary(founder.sources.some((source) =>
      source.sourceClass === "official_subject" && isAaveUrl(source.url)), "founder fact lacks official Aave evidence");
    assertCanary(product.sources.some((source) =>
      source.sourceClass === "official_subject" && isAaveUrl(source.url)), "product fact lacks official Aave evidence");

    const evidenceJson = buildScoringEvidencePacket({
      profile: evidence.profile,
      basicFacts: evidence.basicFacts,
      checkOutcomes: [{
        checkId: "affiliations-associates",
        status: "confirmed",
        note: "4 of 6 claimed relationships were observed in the X follow graph",
        provider: "twitterapi.io",
      }],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(evidenceJson, axes);
    const preflight = inspectAnalystScoringPreflight(axes, evidenceJson);
    assertCanary(preflight.state === "ready", `analyst preflight ended ${preflight.state}`);
    const founderArtifact = catalog.find((artifact) => artifact.operation === "basicFacts:founder");
    const productArtifact = catalog.find((artifact) => artifact.operation === "basicFacts:product");
    assertCanary(founderArtifact?.verification === "verified", "founder artifact is not verified in the frozen scorer catalog");
    assertCanary(founderArtifact.eligibleAxes.includes("F2_track_record"), "founder artifact is not eligible for track record");
    assertCanary(productArtifact?.eligibleAxes.includes("F2_track_record"), "product artifact is not eligible for track record");
    assertCanary(catalog.filter((artifact) =>
      artifact.section === "profile" || artifact.operation === "checkOutcomes:affiliations-associates")
      .every((artifact) => !artifact.eligibleAxes.includes("F2_track_record")), "social evidence leaked into F2 eligibility");

    process.env.ANTHROPIC_API_KEY = "forced-canary-failure";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://api.anthropic.com/v1/messages") {
        forcedAnthropicFailures += 1;
        return new Response(JSON.stringify({ error: { message: "forced canary failure" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.x.ai/v1/chat/completions") {
        grokCalls += 1;
        if (grokCalls > MAX_GROK_CALLS) throw new Error("Grok verdict-call budget exhausted");
      }
      return realFetch(input, init);
    };
    let verdict;
    try {
      verdict = await analyzeSubject(
        "@StaniKulechov",
        [SubjectClass.FOUNDER],
        axes,
        evidenceJson,
        { analystDeadlineAt: Date.now() + MAX_RUNTIME_MS },
      );
    } finally {
      globalThis.fetch = realFetch;
      if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    assertCanary(verdict, "Grok did not return a valid analyst verdict after Anthropic failed");
    const f2 = verdict.axes.find((axis) => axis.axis === "F2_track_record");
    assertCanary(f2, "valid verdict omitted F2 track record");
    assertCanary(f2.evidenceRefs.includes(founderArtifact.artifactId), "F2 did not cite the verified founder artifact");
    assertCanary(!/301K|followers?|follow graph/i.test(f2.rationale), "F2 rationale used social reach as track record");
    assertCanary(!/no documented (?:products?|protocols?)/i.test(f2.rationale), "F2 ignored the verified Aave Protocol artifact");
    assertCanary(!/\b(?:claimed|inferred|presents as|self[- ]reported|unverified|unresolved)\b/i.test(
      `${verdict.headline} ${verdict.identity_note} ${f2.rationale}`,
    ), "verdict weakened the verified founder relationship into a claim");
    assertCanary(/Aave/i.test(`${verdict.headline} ${verdict.identity_note} ${f2.rationale}`), "verdict omitted Aave");
    return { collector, identity, founder, product, verdict, catalog, cost: getCost() };
  });
  const elapsedMs = Date.now() - startedAt;
  assertCanary(forcedAnthropicFailures >= 1, "Anthropic failure path was not exercised");
  assertCanary(grokCalls >= 1 && grokCalls <= MAX_GROK_CALLS, `unexpected Grok call count: ${grokCalls}`);
  assertCanary(sourceFetches === 1, `unexpected official-source fetch count: ${sourceFetches}`);
  assertCanary(elapsedMs <= MAX_RUNTIME_MS, `verdict canary exceeded ${MAX_RUNTIME_MS}ms`);
  assertCanary(result.cost.usd <= MAX_ESTIMATED_USD, `estimated cost $${result.cost.usd} exceeded $${MAX_ESTIMATED_USD}`);
  assertCanary(result.cost.calls.some((call) =>
    call.provider === "claude" && call.op === "record_verdict" && call.failed >= 1), "cost ledger missed the Anthropic failure");
  assertCanary(result.cost.calls.some((call) =>
    call.provider === "grok" && call.op === "record_verdict" && call.succeeded >= 1), "cost ledger missed the Grok success");

  const f2 = result.verdict.axes.find((axis) => axis.axis === "F2_track_record")!;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    officialSource: result.founder.sources[0]?.url,
    identity: result.identity.value,
    founderOf: result.founder.value,
    verifiedProduct: result.product.value,
    anthropicFailures: forcedAnthropicFailures,
    grokCalls,
    sourceFetches,
    f2Score: f2.score,
    f2Rationale: f2.rationale,
    headline: result.verdict.headline,
    identityNote: result.verdict.identity_note,
    elapsedMs,
    estimatedUsd: result.cost.usd,
  }, null, 2)}\n`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Stani verdict canary failed: ${message}\n`);
  process.exitCode = 1;
});
