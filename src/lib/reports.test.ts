import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import type { Investigation } from "./investigation";
import { fetchReport, reportChecks, reportCompleteness } from "./reports";
import type { TokenDossier } from "../token/audit";
import type { ReportVersionContext } from "./reportVersion";

const legacyDossier = {
  report: { identity_confidence: "Confirmed", roles: ["FOUNDER"] },
  display_name: "Example Founder",
  handle: "@example",
  evidence: { associates: [] },
} as unknown as Dossier;

describe("person report synchronization", () => {
  it("prefers server-frozen check runs over evidence-derived guesses", () => {
    const dossier = {
      ...legacyDossier,
      checkRuns: [{
        checkId: "identity-resolution",
        label: "Identity resolution",
        status: "checked-empty" as const,
        note: "licensed resolver returned no match",
        provider: "peopledatalabs",
      }],
      completeness_state: "partial" as const,
    };

    expect(reportChecks("person", dossier)).toEqual(dossier.checkRuns);
    expect(reportCompleteness("person", dossier)).toBe("partial");
  });

  it("keeps legacy dossiers compatible by deriving their checklist", () => {
    const checks = reportChecks("person", legacyDossier);

    expect(checks.length).toBeGreaterThan(1);
    expect(checks.find((check) => check.label === "Profile-photo authenticity")?.status).toBe("unknown");
    expect(reportCompleteness("person", legacyDossier, checks)).toBe("partial");
  });
});

describe("stored token and investigation checks", () => {
  const versionContext: ReportVersionContext = {
    reportVersionId: "00000000-0000-4000-8000-000000000123",
    completenessState: "partial",
    attestationState: "server_collected",
    methodologyVersion: "test-v1",
    createdAt: "2026-07-10T12:00:00.000Z",
    checks: [{ checkId: "frozen", label: "Frozen provider result", status: "unknown" }],
  };

  it("uses frozen token outcomes instead of re-deriving from the payload", () => {
    const token = { versionContext } as TokenDossier;
    expect(reportChecks("token", token)).toEqual(versionContext.checks);
  });

  it("treats an authoritative empty frozen checklist as empty", () => {
    const token = {
      versionContext: { ...versionContext, checks: [] },
    } as unknown as TokenDossier;

    expect(reportChecks("token", token)).toEqual([]);
  });

  it("uses frozen investigation outcomes instead of re-deriving from the payload", () => {
    const investigation = { token: {}, versionContext } as Investigation;
    expect(reportChecks("investigation", investigation)).toEqual(versionContext.checks);
  });
});

describe("fetchReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests an exact report kind when a dossier facet supplies one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchReport("$0xabc", "investigation");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/report?ref=0xabc&kind=investigation");
  });

  it("keeps legacy unqualified opens compatible", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchReport("@alice");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/report?ref=alice");
  });

  it("rejects a mismatched response for an exact facet request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report: { kind: "token", payload: {} } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReport("0xabc", "investigation")).resolves.toBeNull();
  });
});
