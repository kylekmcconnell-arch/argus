import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { emptyEvidence } from "./evidence";
import {
  assembleDossier,
  type DossierBasicFact,
  type DossierBasicFactLead,
} from "./dossier";

describe("assembleDossier basic facts", () => {
  it("passes verified facts and unverified leads into both live and reopened report payloads", () => {
    const facts: DossierBasicFact[] = [{
      factId: "founder-meow",
      subjectKey: "jupiter",
      predicate: "founder",
      value: "Meow",
      normalizedValue: "meow",
      status: "verified",
      critical: true,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
      discoveryProvider: "claude-web-search",
      sources: [{
        url: "https://docs.jup.ag/user-docs/more/jup-token/tokenomics",
        title: "Jupiter tokenomics",
        sourceClass: "official_subject",
        relation: "supports",
        excerpt: "Jupiter was founded by Meow.",
        contentHash: "source-hash",
        capturedAt: "2026-07-12T20:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
    }];
    const leads: DossierBasicFactLead[] = [{
      subject: "Jupiter",
      predicate: "funding",
      value: "Funding candidate",
      excerpt: "Jupiter may have raised funding.",
      sourceUrl: "https://example.com/candidate",
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "claude-web-search",
      candidateUrls: ["https://example.com/candidate"],
    }];
    const evidence = emptyEvidence("@JupiterExchange");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.basicFacts = facts;
    evidence.basicFactLeads = leads;
    evidence.basicFactQuestionLedger = [{
      questionId: "project.founder",
      audience: "project",
      batch: "identity",
      predicate: "founder",
      question: "Who founded the project?",
      critical: true,
      status: "answered",
      answerRefs: ["founder-meow"],
      providerRuns: [{
        phase: "primary",
        provider: "claude-web-search",
        state: "succeeded",
      }],
    }];

    const dossier = assembleDossier(evidence, true);

    expect(dossier.basicFacts).toEqual(facts);
    expect(dossier.basicFactLeads).toEqual(leads);
    expect(dossier.basicFacts).not.toBe(facts);
    expect(dossier.basicFacts?.[0]?.sources).not.toBe(facts[0].sources);
    expect(dossier.basicFactLeads?.[0]?.candidateUrls).not.toBe(leads[0].candidateUrls);
    expect(dossier.basicFactQuestionLedger).toEqual(evidence.basicFactQuestionLedger);
    expect(dossier.basicFactQuestionLedger).not.toBe(evidence.basicFactQuestionLedger);
    expect(dossier.basicFactQuestionLedger?.[0]?.answerRefs)
      .not.toBe(evidence.basicFactQuestionLedger?.[0]?.answerRefs);
    expect(dossier.basicFactQuestionLedger?.[0]?.providerRuns)
      .not.toBe(evidence.basicFactQuestionLedger?.[0]?.providerRuns);
  });
});
