import { describe, expect, it, vi } from "vitest";

import { emptyEvidence } from "../src/data/evidence";
import { getProfile, SubjectClass } from "../src/engine";
import { deriveDecisionReadiness } from "../src/lib/decisionReadiness";
import type { ScanCheck } from "../src/lib/scanChecklist";
import { officialSiteAccessDeniedFinding, type SiteSubstance } from "./adapters/sitecheck";
import { buildScoringEvidencePacket, deriveProjectStrengthBands } from "./agent";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { PersonCheckTracker } from "./checks";
import { applySiteSubstanceOutcome, bioWebsiteDomain } from "./orchestrate";

function context(roles: SubjectClass[] = [SubjectClass.PROJECT]) {
  const evidence = emptyEvidence("@subject");
  evidence.roles = roles;
  const checks: CheckObservation[] = [];
  const emit = vi.fn();
  const ctx: CollectContext = {
    handle: "@subject",
    evidence,
    emit,
    recordCheck: (check) => checks.push(check),
  };
  return { ctx, evidence, checks, emit };
}

const failure = (
  status: "access_blocked" | "unavailable" | "unreachable",
): SiteSubstance => ({
  url: "https://project.example",
  status,
  reason: status === "access_blocked" ? "anti_bot" : status === "unavailable" ? "http" : "dns",
  detail: status === "access_blocked"
    ? "the site served an anti-bot challenge"
    : status === "unavailable"
      ? "the liveness request returned HTTP 503"
      : "DNS resolution failed for project.example",
});

const PROJECT_REQUIRED_CHECK_IDS = [
  "project-token-identity",
  "project-product-substance",
  "project-team-identity",
  "project-backing-partners",
  "project-traction-liveness",
  "project-transparency",
  "trust-graph-connections",
] as const;

describe("site-liveness evidence attribution", () => {
  it.each(["unavailable", "unreachable"] as const)(
    "keeps a project %s result an open neutral gap and emits no SiteNotLive evidence",
    (status) => {
      const { ctx, evidence, checks, emit } = context();

      applySiteSubstanceOutcome(ctx, "project.example", failure(status));

      expect(evidence.findings).toEqual([]);
      expect(checks).toEqual([expect.objectContaining({
        id: "project-product-substance",
        status: "unavailable",
      })]);
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({
        label: "Website check unavailable",
        tone: "neutral",
        detail: expect.stringContaining("not evidence that the website or product is offline"),
      }));
      expect(JSON.stringify({ checks, calls: emit.mock.calls })).not.toContain("promoting a token");
    },
  );

  it("finishes a confirmed official-site access block as an access-denied result, not an open check", () => {
    const { ctx, evidence, checks, emit } = context();

    applySiteSubstanceOutcome(ctx, "project.example", failure("access_blocked"));

    expect(evidence.findings).toEqual([]);
    expect(checks).toEqual([expect.objectContaining({
      id: "project-product-substance",
      status: "checked-empty",
      note: officialSiteAccessDeniedFinding("project.example"),
    })]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      label: "Official site blocked the request",
      tone: "neutral",
      detail: expect.stringContaining("could not read the page"),
    }));
    expect(JSON.stringify({ checks, calls: emit.mock.calls })).not.toMatch(/Website live|live site|promoting a token/i);
  });

  it("does not let a neutral fetch gap override independent confirmed product evidence", () => {
    const evidence = emptyEvidence("@project");
    evidence.roles = [SubjectClass.PROJECT];
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "project-product-substance",
      status: "confirmed",
      note: "official product documentation and application were fetched",
      provider: "basic-facts-web",
      sourceCount: 2,
    });
    const ctx: CollectContext = {
      handle: "@project",
      evidence,
      emit: vi.fn(),
      recordCheck: (check) => tracker.record(check),
    };

    applySiteSubstanceOutcome(ctx, "project.example", failure("access_blocked"));

    const productCheck = tracker.snapshot([SubjectClass.PROJECT])
      .find((check) => check.checkId === "project-product-substance");
    expect(productCheck).toMatchObject({
      status: "confirmed",
      provider: expect.stringContaining("basic-facts-web"),
    });
    expect(productCheck?.note).not.toContain("anti-bot");
  });

  it("completes the EARN / earnonhood.com required website check after a confirmed HTTP 403 without inflating score or gates", () => {
    const { ctx, evidence, checks, emit } = context();
    applySiteSubstanceOutcome(ctx, "earnonhood.com", {
      url: "https://earnonhood.com",
      status: "access_blocked",
      reason: "http_access",
      detail: "the site denied the automated liveness request (HTTP 403)",
    });

    expect(evidence.findings).toEqual([]);
    expect(evidence.profile.site_substance_status).toBe("access_blocked");
    expect(checks).toEqual([expect.objectContaining({
      id: "project-product-substance",
      status: "checked-empty",
      note: officialSiteAccessDeniedFinding("earnonhood.com"),
    })]);
    expect(JSON.stringify({ checks, calls: emit.mock.calls, evidence })).not.toMatch(
      /Website live|live site|Dashboard|docs|whitepaper|page content/i,
    );

    const requiredChecks: ScanCheck[] = PROJECT_REQUIRED_CHECK_IDS.map((checkId) => (
      checkId === "project-product-substance"
        ? {
            checkId,
            label: "Product and website substance",
            status: "checked-empty" as const,
            note: officialSiteAccessDeniedFinding("earnonhood.com"),
            decisionCritical: true,
          }
        : {
            checkId,
            label: checkId,
            status: "confirmed" as const,
            note: "completed",
            decisionCritical: true,
          }
    ));
    const readiness = deriveDecisionReadiness(requiredChecks);
    expect(readiness).toMatchObject({
      status: "ready",
      successful: 7,
      applicable: 7,
      unresolved: 0,
      providerUnavailable: 0,
    });
    expect(readiness.findings).toBe(0);

    const axes = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@earnonhood",
        display_name: "EARN",
        bio: "On-chain product",
        website: "https://earnonhood.com",
        site_substance_status: "access_blocked",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-08-25T00:00:00.000Z",
      },
      checkOutcomes: requiredChecks,
    }, axes);
    const bands = deriveProjectStrengthBands(packet, axes);
    expect(bands.P2_product_substance.tier).toBe("assessed_null");
    expect(bands.P2_product_substance).not.toHaveProperty("floorTier");
    expect(bands.P2_product_substance.minScore ?? 0).toBe(0);
  });

  it.each([
    ["coming_soon", "the served homepage explicitly presents a coming-soon surface"],
    ["parked", "the served homepage is a registrar parking page"],
  ] as const)("creates SiteNotLive only for verified %s served-page evidence", (reason, detail) => {
    const { ctx, evidence, checks, emit } = context();

    applySiteSubstanceOutcome(ctx, "project.example", {
      url: "https://project.example",
      status: "coming_soon",
      reason,
      detail,
    });

    expect(checks).toEqual([expect.objectContaining({
      id: "project-product-substance",
      status: "finding",
      sourceCount: 1,
    })]);
    expect(evidence.findings).toEqual([expect.objectContaining({
      finding_type: "SiteNotLive",
      verification_status: "Verified",
      polarity: -1,
      artifact_verified: true,
    })]);
    expect(evidence.findings[0].claim).not.toContain("promoting a token");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      label: "Website not live",
      tone: "bad",
      detail: expect.stringContaining("no token-promotion claim was inferred"),
    }));
  });

  it("refuses to create SiteNotLive from an ungrounded coming-soon status", () => {
    const { ctx, evidence, checks, emit } = context();

    applySiteSubstanceOutcome(ctx, "project.example", {
      url: "https://project.example",
      status: "coming_soon",
      detail: "legacy payload without direct marker attribution",
    });

    expect(evidence.findings).toEqual([]);
    expect(checks).toEqual([expect.objectContaining({ status: "unavailable" })]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      tone: "neutral",
      detail: expect.stringContaining("without direct served-page evidence"),
    }));
  });

  it("mentions token promotion only when the project token is verified", () => {
    const { ctx, evidence, emit } = context();
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Project Token",
      symbol: "PRJ",
      coingeckoId: "project-token",
      rank: 100,
      address: "0x0000000000000000000000000000000000000001",
      chain: "ethereum",
      officialX: "@subject",
      sourceUrl: "https://www.coingecko.com/en/coins/project-token",
      capturedAt: "2026-07-13T12:00:00.000Z",
    };

    applySiteSubstanceOutcome(ctx, "project.example", {
      url: "https://project.example",
      status: "coming_soon",
      reason: "coming_soon",
      detail: "the served homepage explicitly says coming soon",
    });

    expect(evidence.findings[0].claim).toContain("promoting the verified $PRJ project token");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining("verified $PRJ project token"),
    }));
  });

  it("never creates project counter-evidence or token-promoter copy for a person profile", () => {
    const { ctx, evidence, checks, emit } = context([SubjectClass.FOUNDER]);

    applySiteSubstanceOutcome(ctx, "person.example", {
      url: "https://person.example",
      status: "coming_soon",
      reason: "coming_soon",
      detail: "the served homepage explicitly says coming soon",
    });

    expect(checks).toEqual([]);
    expect(evidence.findings).toEqual([]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      label: "Profile website is not launched",
      tone: "neutral",
      detail: expect.stringContaining("personal-profile"),
    }));
    expect(JSON.stringify(emit.mock.calls)).not.toContain("promoting a token");
  });

  it("does not repeat an ungrounded coming-soon label as fact for a person profile", () => {
    const { ctx, evidence, checks, emit } = context([SubjectClass.FOUNDER]);

    applySiteSubstanceOutcome(ctx, "person.example", {
      url: "https://person.example",
      status: "coming_soon",
      detail: "legacy payload without marker attribution",
    });

    expect(checks).toEqual([]);
    expect(evidence.findings).toEqual([]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      label: "Profile website check unavailable",
      tone: "neutral",
      detail: expect.stringContaining("ungrounded coming-soon label"),
    }));
  });

  it("records accessible project pages without creating counter-evidence", () => {
    const { ctx, evidence, checks } = context();

    applySiteSubstanceOutcome(ctx, "project.example", {
      url: "https://project.example",
      status: "client_rendered",
      detail: "client-rendered app; static read could not confirm a product surface",
    });

    expect(evidence.findings).toEqual([]);
    expect(checks).toEqual([expect.objectContaining({
      id: "project-product-substance",
      status: "confirmed",
      sourceCount: 1,
    })]);
  });
});

describe("bio website domain extraction", () => {
  it("never treats a contact email's host as the subject's website", () => {
    expect(bioWebsiteDomain("DeFi degen. Contact: team@gmail.com")).toBeUndefined();
  });

  it("still finds the real domain when the bio also lists a contact email first", () => {
    expect(bioWebsiteDomain("team@gmail.com | myproject.xyz")).toBe("myproject.xyz");
  });

  it("keeps extracting a bare domain from bio text", () => {
    expect(bioWebsiteDomain("building the future at myproject.xyz")).toBe("myproject.xyz");
  });
});
