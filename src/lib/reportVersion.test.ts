import { describe, expect, it } from "vitest";
import type { Dossier } from "../data/dossier";
import type { Investigation } from "./investigation";
import {
  storedInvestigation,
  storedPersonDossier,
  storedTokenDossier,
  type StoredReport,
} from "./reports";
import { mapStoredCheckRuns, type ReportVersionContext } from "./reportVersion";
import type { TokenDossier } from "../token/audit";

const context: ReportVersionContext = {
  reportVersionId: "00000000-0000-4000-8000-000000000123",
  completenessState: "partial",
  attestationState: "analyst_submitted",
  methodologyVersion: "test-v1",
  createdAt: "2026-07-10T12:00:00.000Z",
  checks: [{ label: "Identity resolution", status: "confirmed" }],
};

describe("stored report version context", () => {
  it("restores persisted check distinctions, order, and expiry", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const checks = mapStoredCheckRuns([
      {
        check_id: "news-and-press",
        state: "not_run",
        metadata: { label: "News & press", status: "unknown", order: 2 },
      },
      {
        check_id: "identity-resolution",
        state: "complete",
        metadata: { label: "Identity resolution", status: "finding", note: "probable confidence", order: 0 },
      },
      {
        check_id: "vc-track-record",
        state: "not_run",
        metadata: { label: "VC portfolio track record", status: "not-applicable", notApplicable: true, order: 3 },
      },
      {
        check_id: "associates",
        state: "complete",
        stale_at: "2026-07-10T11:59:59.000Z",
        metadata: { label: "Affiliations & associates", status: "confirmed", order: 1 },
      },
    ], now);

    expect(checks).toEqual([
      { checkId: "identity-resolution", label: "Identity resolution", status: "finding", note: "probable confidence" },
      { checkId: "associates", label: "Affiliations & associates", status: "stale" },
      { checkId: "news-and-press", label: "News & press", status: "unknown" },
      { checkId: "vc-track-record", label: "VC portfolio track record", status: "not-applicable" },
    ]);
  });

  it("keeps failed storage states unresolved even when metadata claims success", () => {
    expect(mapStoredCheckRuns([{
      check_id: "legal-history",
      state: "failed",
      error_code: "provider_timeout",
      metadata: { status: "confirmed" },
    }], 0)).toEqual([{
      checkId: "legal-history",
      label: "Legal History",
      status: "unknown",
      note: "Check failed (provider_timeout)",
    }]);
  });

  it("attaches context by cloning rather than mutating the immutable payload", () => {
    const payload = { handle: "@alice" } as Dossier;
    const report: StoredReport = { kind: "person", payload, versionContext: context };

    const hydrated = storedPersonDossier(report);

    expect(hydrated).not.toBe(payload);
    expect(hydrated.versionContext).toBe(context);
    expect(payload.versionContext).toBeUndefined();
  });

  it("attaches frozen context to stored token and investigation views", () => {
    const token = { address: "0xabc" } as TokenDossier;
    const investigation = { rootRef: "0xabc", token } as Investigation;

    const hydratedToken = storedTokenDossier({ kind: "token", payload: token, versionContext: context });
    const hydratedInvestigation = storedInvestigation({
      kind: "investigation",
      payload: investigation,
      versionContext: context,
    });

    expect(hydratedToken).not.toBe(token);
    expect(hydratedToken.versionContext).toBe(context);
    expect(token.versionContext).toBeUndefined();
    expect(hydratedInvestigation).not.toBe(investigation);
    expect(hydratedInvestigation.versionContext).toBe(context);
    expect(investigation.versionContext).toBeUndefined();
  });
});
