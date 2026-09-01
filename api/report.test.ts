import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { issuePanelCostToken, persistReportVersionBundle } = vi.hoisted(() => ({
  issuePanelCostToken: vi.fn(),
  persistReportVersionBundle: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ issuePanelCostToken }));

vi.mock("./_auth.js", () => ({
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    displayName: "Owner",
  })),
  serviceCredentials: vi.fn(() => ({ url: "https://database.example", key: "test-service-key" })),
  serviceHeaders: vi.fn(() => ({ "content-type": "application/json" })),
}));

vi.mock("./_provenance.js", () => ({
  persistProvenance: vi.fn(async () => undefined),
  activateReportVersion: vi.fn(async () => undefined),
  persistReportVersionBundle,
}));

import { requireArgusAuth } from "./_auth.js";
import { activateReportVersion } from "./_provenance.js";
import handler, { reportSearchParams } from "./report";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(name: string, value: string) { captured.headers[name] = value; return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(
  method: string,
  options: { query?: Record<string, string>; url?: string; body?: unknown } = {},
): VercelRequest {
  const query = options.query ?? {};
  const search = new URLSearchParams(query).toString();
  return {
    method,
    url: options.url ?? (search ? `/api/report?${search}` : "/api/report"),
    query,
    body: options.body,
    headers: {},
  } as unknown as VercelRequest;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("report case lifecycle API", () => {
  beforeEach(() => {
    vi.mocked(requireArgusAuth).mockClear();
    vi.mocked(activateReportVersion).mockClear();
    issuePanelCostToken.mockReset().mockReturnValue("signed-panel-token");
    persistReportVersionBundle.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires owner access and submits one normalized, deduplicated PATCH batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { subject_kind: "person", subject_ref: "alice", case_status: "archived" },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        action: "archive",
        subjects: [
          { kind: "person", ref: "@Alice" },
          { kind: "person", ref: "alice" },
        ],
      },
    }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "owner");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/manage_case_lifecycle");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      p_action: "archive",
      p_subjects: [{ kind: "person", ref: "alice" }],
    });
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, action: "archive" });
  });

  it("rejects invalid or oversized subject batches before touching storage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        action: "archive",
        subjects: Array.from({ length: 51 }, (_, index) => ({ kind: "person", ref: `person-${index}` })),
      },
    }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "valid_action_and_subjects_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps watch deletion separate and analyst-authorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("DELETE", { query: { ref: "watch-1", kind: "watch" } }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "analyst");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/reports?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("kind=eq.watch");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(captured.body).toEqual({ ok: true, deleted: "watch" });
  });

  it("turns case DELETE into an archive RPC instead of deleting its projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("DELETE", { query: { ref: "@Alice", kind: "person" } }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "owner");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/manage_case_lifecycle");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      p_action: "archive",
      p_subjects: [{ kind: "person", ref: "alice" }],
    });
    expect(captured.body).toMatchObject({ ok: true, action: "archive" });
  });

  it("relies on atomic immutable persistence without a second projection write", async () => {
    const address = "0x00000000000000000000000000000000000000aa";
    const versionId = "00000000-0000-4000-8000-000000000301";
    const clientRunId = "00000000-0000-4000-8000-000000000302";
    persistReportVersionBundle.mockResolvedValue({
      caseId: "00000000-0000-4000-8000-000000000201",
      reportVersionId: versionId,
      version: 1,
    });
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "token",
        ref: address,
        query: "$TEST",
        payload: { address },
        clientRunId,
        completenessState: "complete",
        checkRuns: [{ label: "Contract safety", status: "unknown" }],
      },
    }), res);

    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      { url: "https://database.example", key: "test-service-key" },
      expect.objectContaining({
        kind: "token",
        canonicalRef: address,
        completenessState: "partial",
        checks: [{ label: "Contract safety", status: "unknown" }],
        methodologyVersion: "argus-token-v2-terminal-outcomes",
        runId: clientRunId,
      }),
    );
    expect(activateReportVersion).toHaveBeenCalledWith(
      { url: "https://database.example", key: "test-service-key" },
      "00000000-0000-4000-8000-000000000001",
      versionId,
    );
    expect(issuePanelCostToken).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      versionId,
    );
    expect(captured.body).toEqual({
      ok: true,
      reportVersionId: versionId,
      caseId: "00000000-0000-4000-8000-000000000201",
      version: 1,
      panelCostToken: "signed-panel-token",
    });
  });

  it("freezes the highest-priority material change from the exact previous active version", async () => {
    const address = "0x00000000000000000000000000000000000000ab";
    const previousVersionId = "00000000-0000-4000-8000-000000000401";
    const currentVersionId = "00000000-0000-4000-8000-000000000402";
    const safety = (ownerRenounced: boolean) => ({
      contractPropertiesAssessed: true,
      ownerRenounced,
      mintable: false,
      freezable: false,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        payload: { address, safety: safety(true) },
        report_version_id: previousVersionId,
        ts: "2026-08-23T01:00:00.000Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        version: 4,
        created_at: "2026-08-23T01:00:00.000Z",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    persistReportVersionBundle.mockResolvedValue({
      caseId: "00000000-0000-4000-8000-000000000201",
      reportVersionId: currentVersionId,
      version: 5,
    });
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "token",
        ref: address,
        query: "$TEST",
        payload: { address, safety: safety(false) },
        clientRunId: "00000000-0000-4000-8000-000000000403",
        completenessState: "complete",
        checkRuns: [],
      },
    }), res);

    expect(fetchMock.mock.calls[0][0]).toContain("kind=eq.token");
    expect(fetchMock.mock.calls[1][0]).toContain(previousVersionId);
    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          reportDelta: expect.objectContaining({
            category: "contract_control",
            previous: expect.objectContaining({ reportVersionId: previousVersionId, version: 4 }),
          }),
        }),
      }),
    );
    expect(captured.body).toMatchObject({
      ok: true,
      reportVersionId: currentVersionId,
      caseId: "00000000-0000-4000-8000-000000000201",
      version: 5,
      reportDelta: { category: "contract_control" },
    });
  });

  it("returns the complete save receipt when a person POST only links an existing server version", async () => {
    // The browser's syncReport treats a receipt without a panel capability as
    // a failed save. Linking the server-collected version therefore has to
    // return the same receipt shape as every other successful persist, or a
    // token-less project report reads as "not saved" despite being durable.
    const caseId = "00000000-0000-4000-8000-000000000201";
    const versionId = "00000000-0000-4000-8000-000000000301";
    const storedPayload = { report: { audit_id: "server-audit-1" }, checkRuns: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: versionId,
        case_id: caseId,
        payload: storedPayload,
        attestation_state: "server_collected",
        version: 3,
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: caseId,
        canonical_ref: "alice",
        kind: "person",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "person",
        ref: "alice",
        payload: {
          persistence: { state: "persisted", reportVersionId: versionId },
          report: { audit_id: "server-audit-1" },
        },
      },
    }), res);

    expect(captured.body).toEqual({
      ok: true,
      reportVersionId: versionId,
      caseId,
      version: 3,
      linked: true,
      attestationState: "server_collected",
      panelCostToken: "signed-panel-token",
    });
    expect(issuePanelCostToken).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", versionId);
  });

  it("persists the token leg the server itself attributed from the subject's own bio", async () => {
    // orchestrate.ts announces a bio contract as the token leg when no verified
    // project token exists. Refusing to persist that same attribution here
    // turned every such finished scan into a failed combined save.
    const caseId = "00000000-0000-4000-8000-000000000201";
    const baseVersionId = "00000000-0000-4000-8000-000000000301";
    const finalVersionId = "00000000-0000-4000-8000-000000000302";
    const address = "0xFEAC2eae96899709a43e252b6b92971d32f9c0f9";
    const storedPayload = {
      handle: "@bio_ca_project",
      bio: `Official token CA: ${address}`,
      report: { audit_id: "server-audit-2", composite_verdict: "CAUTION", governing_score: 61 },
      checkRuns: [],
      completeness_state: "complete",
      persistence: { state: "persisted", reportVersionId: baseVersionId },
    };
    const threat = {
      address: address.toLowerCase(),
      chain: "ethereum",
      symbol: "BIO",
      name: "Bio Token",
      dossier: { address: address.toLowerCase(), score: 40, verdict: "CAUTION", axes: [], socials: [], safety: { available: true } },
      call: { verdict: "CAUTION", risk: 55 },
      checks: [],
      scannedAt: 1_788_000_000_000,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: baseVersionId,
        case_id: caseId,
        payload: storedPayload,
        attestation_state: "server_collected",
        version: 1,
      }]))
      .mockResolvedValueOnce(jsonResponse([{ id: caseId, canonical_ref: "bio_ca_project", kind: "person" }]));
    vi.stubGlobal("fetch", fetchMock);
    persistReportVersionBundle.mockResolvedValue({ caseId, reportVersionId: finalVersionId, version: 2 });
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "person",
        ref: "bio_ca_project",
        payload: {
          persistence: { state: "persisted", reportVersionId: baseVersionId },
          report: { audit_id: "server-audit-2" },
          threat,
          threatNote: "Token attributed via the contract in the subject's own bio.",
        },
      },
    }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, enriched: true, reportVersionId: finalVersionId, version: 2 });
    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          handle: "@bio_ca_project",
          threat: expect.objectContaining({ address: address.toLowerCase() }),
        }),
      }),
    );
  });

  it("still rejects a token the server never attributed to the subject", async () => {
    const caseId = "00000000-0000-4000-8000-000000000201";
    const versionId = "00000000-0000-4000-8000-000000000301";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: versionId,
        case_id: caseId,
        payload: {
          bio: "Building things. No contract here.",
          evidence: { promotions: [] },
          report: { audit_id: "server-audit-3" },
          checkRuns: [],
        },
        attestation_state: "server_collected",
        version: 1,
      }]))
      .mockResolvedValueOnce(jsonResponse([{ id: caseId, canonical_ref: "namesake", kind: "person" }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "person",
        ref: "namesake",
        payload: {
          persistence: { state: "persisted", reportVersionId: versionId },
          report: { audit_id: "server-audit-3" },
          threat: {
            address: "0x00000000000000000000000000000000000000aa",
            dossier: { address: "0x00000000000000000000000000000000000000aa" },
          },
        },
      },
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toEqual({ error: "person_token_subject_mismatch" });
    expect(persistReportVersionBundle).not.toHaveBeenCalled();
  });

  it("persists a matching completed token dossier as a second immutable person version", async () => {
    const caseId = "00000000-0000-4000-8000-000000000201";
    const baseVersionId = "00000000-0000-4000-8000-000000000301";
    const finalVersionId = "00000000-0000-4000-8000-000000000302";
    const clientRunId = "00000000-0000-4000-8000-000000000303";
    const address = "0xfeac2eae96899709a43e252b6b92971d32f9c0f9";
    const serverChecks = [{ label: "Project identity", status: "complete" }];
    const storedPayload = {
      handle: "@AnyoneFDN",
      report: {
        audit_id: "server-audit-1",
        composite_verdict: "PASS",
        governing_score: 79,
      },
      projectToken: { address, verified: true, symbol: "ANYONE" },
      checkRuns: serverChecks,
      completeness_state: "complete",
      persistence: { state: "persisted", reportVersionId: baseVersionId },
    };
    const threat = {
      address,
      chain: "ethereum",
      symbol: "ANYONE",
      name: "Anyone Protocol",
      dossier: {
        address,
        score: 84,
        verdict: "PASS",
        axes: [],
        socials: [],
        safety: { available: true },
      },
      call: { verdict: "SAFE", risk: 18 },
      checks: [],
      scannedAt: 1_788_000_000_000,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: baseVersionId,
        case_id: caseId,
        payload: storedPayload,
        attestation_state: "server_collected",
        version: 3,
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: caseId,
        canonical_ref: "anyonefdn",
        kind: "person",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    persistReportVersionBundle.mockResolvedValue({
      caseId,
      reportVersionId: finalVersionId,
      version: 4,
    });
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "person",
        ref: "anyonefdn",
        query: "@AnyoneFDN",
        clientRunId,
        payload: {
          // These untrusted project fields must never replace server evidence.
          handle: "@Imposter",
          report: { audit_id: "server-audit-1", governing_score: 1 },
          persistence: { state: "persisted", reportVersionId: baseVersionId },
          threat,
          threatNote: "Token attributed via the verified project token.",
        },
      },
    }), res);

    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      { url: "https://database.example", key: "test-service-key" },
      expect.objectContaining({
        kind: "person",
        canonicalRef: "anyonefdn",
        runId: clientRunId,
        attestationState: "analyst_submitted",
        verdict: "PASS",
        score: 79,
        completenessState: "complete",
        checks: serverChecks,
        payload: expect.objectContaining({
          handle: "@AnyoneFDN",
          threat: expect.objectContaining({
            address,
            dossier: expect.objectContaining({ score: 84 }),
          }),
          threatNote: "Token attributed via the verified project token.",
        }),
      }),
    );
    const persistedPayload = persistReportVersionBundle.mock.calls[0][1].payload as Record<string, unknown>;
    expect(persistedPayload).not.toHaveProperty("persistence");
    expect(activateReportVersion).toHaveBeenCalledWith(
      { url: "https://database.example", key: "test-service-key" },
      "00000000-0000-4000-8000-000000000001",
      finalVersionId,
    );
    expect(captured.body).toEqual({
      ok: true,
      reportVersionId: finalVersionId,
      caseId,
      version: 4,
      enriched: true,
      baseReportVersionId: baseVersionId,
      panelCostToken: "signed-panel-token",
    });
  });

  it("rejects a person token dossier that does not match the server-verified project token", async () => {
    const caseId = "00000000-0000-4000-8000-000000000201";
    const versionId = "00000000-0000-4000-8000-000000000301";
    const address = "0xfeac2eae96899709a43e252b6b92971d32f9c0f9";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: versionId,
        case_id: caseId,
        payload: {
          report: { audit_id: "server-audit-1" },
          projectToken: { address, verified: true },
          checkRuns: [],
        },
        attestation_state: "server_collected",
        version: 3,
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: caseId,
        canonical_ref: "anyonefdn",
        kind: "person",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: {
        kind: "person",
        ref: "anyonefdn",
        payload: {
          persistence: { state: "persisted", reportVersionId: versionId },
          report: { audit_id: "server-audit-1" },
          threat: {
            address: "0x00000000000000000000000000000000000000aa",
            dossier: { address: "0x00000000000000000000000000000000000000aa" },
          },
        },
      },
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toEqual({ error: "person_token_subject_mismatch" });
    expect(persistReportVersionBundle).not.toHaveBeenCalled();
    expect(activateReportVersion).not.toHaveBeenCalled();
  });

  it("reuses one case across two investigation persists of the same contract and increments version", async () => {
    const address = "0xa3b6aee90017b72c0812dc1e013de70eb2917ba3";
    const caseId = "00000000-0000-4000-8000-000000000277";
    persistReportVersionBundle
      .mockResolvedValueOnce({
        caseId,
        reportVersionId: "00000000-0000-4000-8000-000000000401",
        version: 1,
      })
      .mockResolvedValueOnce({
        caseId,
        reportVersionId: "00000000-0000-4000-8000-000000000402",
        version: 2,
      });

    const first = response();
    await handler(request("POST", {
      body: {
        kind: "investigation",
        ref: address,
        query: "$EARN",
        payload: { token: { address, symbol: "EARN", report: { audit_id: "PA-AAF133F87A134DF0AE17" } } },
        clientRunId: "00000000-0000-4000-8000-000000000501",
      },
    }), first.res);
    const second = response();
    await handler(request("POST", {
      body: {
        kind: "investigation",
        ref: address,
        query: "$EARN",
        caseId,
        versionContext: { caseId },
        payload: { token: { address, symbol: "EARN", report: { audit_id: "PA-A74E3B463FCB43C89558" } } },
        clientRunId: "00000000-0000-4000-8000-000000000502",
      },
    }), second.res);

    expect(first.captured.body).toMatchObject({
      ok: true,
      caseId,
      version: 1,
      reportVersionId: "00000000-0000-4000-8000-000000000401",
    });
    expect(second.captured.body).toMatchObject({
      ok: true,
      caseId,
      version: 2,
      reportVersionId: "00000000-0000-4000-8000-000000000402",
    });
    expect((first.captured.body as { caseId: string }).caseId)
      .toBe((second.captured.body as { caseId: string }).caseId);
    expect((first.captured.body as { reportVersionId: string }).reportVersionId)
      .not.toBe((second.captured.body as { reportVersionId: string }).reportVersionId);
  });

  it("maps archived cases from their last published immutable version", async () => {
    const caseId = "00000000-0000-4000-8000-000000000101";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: caseId,
        kind: "token",
        canonical_ref: "0xabc",
        display_query: "$ABC",
        updated_at: "2026-07-11T01:00:00.000Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        case_id: caseId,
        report_version_id: versionId,
        created_at: "2026-07-10T23:01:00.000Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: versionId,
        case_id: caseId,
        version: 2,
        verdict: "CAUTION",
        score: 54,
        completeness_state: "partial",
        attestation_state: "analyst_submitted",
        methodology_version: "v2",
        created_at: "2026-07-10T23:00:00.000Z",
        cost: { usd: 0.25 },
        contributor_label: "Kyle",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        report_version_id: versionId,
        provider: "grok",
        operation: "panel:namesake",
        calls: 1,
        usd: 0.1,
        meta: "cached search",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { list: "1", status: "archived" } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({
      available: true,
      reports: [{
        caseId,
        ref: "0xabc",
        kind: "token",
        query: "$ABC",
        contributor: "Kyle",
        verdict: "CAUTION",
        score: 54,
        ts: "2026-07-10T23:00:00.000Z",
        cost: {
          usd: 0.35,
          calls: [{ provider: "grok", op: "panel:namesake", calls: 1, usd: 0.1, meta: "cached search" }],
        },
        status: "archived",
        archivedAt: "2026-07-11T01:00:00.000Z",
        reportVersionId: versionId,
        version: 2,
        completenessState: "partial",
        attestationState: "analyst_submitted",
        methodologyVersion: "v2",
        createdAt: "2026-07-10T23:00:00.000Z",
      }],
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/rest/v1/case_events?");
    expect(String(fetchMock.mock.calls[1][0])).toContain("report.version.activated");
    expect(String(fetchMock.mock.calls[1][0])).toContain("order=created_at.desc,id.desc");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/rest/v1/report_versions?");
    expect(String(fetchMock.mock.calls[2][0])).toContain(versionId);
  });

  it("pages archived activation events past the PostgREST row cap instead of dropping older cases", async () => {
    const noisyCaseId = "00000000-0000-4000-8000-000000000101";
    const quietCaseId = "00000000-0000-4000-8000-000000000102";
    const noisyVersionId = "00000000-0000-4000-8000-000000000201";
    const quietVersionId = "00000000-0000-4000-8000-000000000202";
    // A heavily re-activated case fills the whole first page, pushing the
    // quiet case's only activation event onto the second page.
    const fullFirstPage = Array.from({ length: 1000 }, (_, index) => ({
      case_id: noisyCaseId,
      report_version_id: noisyVersionId,
      created_at: `2026-07-10T22:${String(59 - Math.floor(index / 60)).padStart(2, "0")}:00.000Z`,
    }));
    const versionRow = (id: string, caseId: string) => ({
      id,
      case_id: caseId,
      version: 1,
      verdict: "CAUTION",
      score: 50,
      completeness_state: "partial",
      attestation_state: "analyst_submitted",
      methodology_version: "v2",
      created_at: "2026-07-10T22:00:00.000Z",
      cost: { usd: 0.1 },
      contributor_label: "Kyle",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        { id: noisyCaseId, kind: "token", canonical_ref: "0xaaa", display_query: "$AAA", updated_at: "2026-07-11T01:00:00.000Z" },
        { id: quietCaseId, kind: "token", canonical_ref: "0xbbb", display_query: "$BBB", updated_at: "2026-07-11T02:00:00.000Z" },
      ]))
      .mockResolvedValueOnce(jsonResponse(fullFirstPage))
      .mockResolvedValueOnce(jsonResponse([{
        case_id: quietCaseId,
        report_version_id: quietVersionId,
        created_at: "2026-07-09T00:00:00.000Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([
        versionRow(noisyVersionId, noisyCaseId),
        versionRow(quietVersionId, quietCaseId),
      ]))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { list: "1", status: "archived" } }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as { reports: Array<{ ref: string; reportVersionId: string }> };
    expect(body.reports.map((report) => report.ref)).toEqual(["0xaaa", "0xbbb"]);
    expect(body.reports.map((report) => report.reportVersionId)).toEqual([noisyVersionId, quietVersionId]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("limit=1000");
    expect(String(fetchMock.mock.calls[1][0])).toContain("offset=0");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/rest/v1/case_events?");
    expect(String(fetchMock.mock.calls[2][0])).toContain("offset=1000");
  });

  it("exposes exact case and immutable version metadata in the active library", async () => {
    const caseId = "00000000-0000-4000-8000-000000000101";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        ref: "0xabc",
        kind: "token",
        query: "$ABC",
        contributor: "Kyle",
        verdict: "CAUTION",
        score: 54,
        ts: "2026-07-11T01:00:00.000Z",
        report_version_id: versionId,
        attestation_state: "server_collected",
        cost: {},
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: versionId,
        case_id: caseId,
        version: 4,
        completeness_state: "partial",
        attestation_state: "server_collected",
        methodology_version: "v4",
        created_at: "2026-07-11T01:00:00.000Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { list: "1" } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      reports: [{
        caseId,
        reportVersionId: versionId,
        version: 4,
        completenessState: "partial",
        attestationState: "server_collected",
      }],
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("select=id,case_id,version,");
  });

  it("aggregates spend from the usage event stream plus run counts, org-scoped to the last 30 days", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/provider_usage_events")) {
        return jsonResponse([
          { created_at: "2026-07-15T07:08:57.926Z", provider: "claude", usd: 0.65 },
          { created_at: "2026-07-15T07:10:00.000Z", provider: "grok", usd: 0.01 },
          { created_at: "2026-07-14T20:00:00.000Z", provider: "claude", usd: "0.25" },
          { created_at: null, provider: "claude", usd: 5 },
        ]);
      }
      if (url.includes("/rest/v1/report_versions")) {
        return jsonResponse([
          { created_at: "2026-07-15T07:08:57.926Z" },
          { created_at: "2026-07-14T20:00:00.000Z" },
          { created_at: 17 },
        ]);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { spend: "1" } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      truncated: false,
      events: [
        { createdAt: "2026-07-15T07:08:57.926Z", usd: 0.65, claudeUsd: 0.65 },
        { createdAt: "2026-07-15T07:10:00.000Z", usd: 0.01, claudeUsd: 0 },
        { createdAt: "2026-07-14T20:00:00.000Z", usd: 0.25, claudeUsd: 0.25 },
      ],
      runs: ["2026-07-15T07:08:57.926Z", "2026-07-14T20:00:00.000Z"],
    });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    const eventsUrl = urls.find((u) => u.includes("provider_usage_events")) ?? "";
    expect(eventsUrl).toContain("select=created_at,provider,usd");
    expect(eventsUrl).toContain("organization_id=eq.00000000-0000-4000-8000-000000000001");
    expect(eventsUrl).toContain("usd=gt.0");
    expect(eventsUrl).toContain("created_at=gte.");
    expect(eventsUrl).toContain("limit=1000");
    const runsUrl = urls.find((u) => u.includes("report_versions")) ?? "";
    expect(runsUrl).toContain("select=created_at&");
    expect(runsUrl).toContain("organization_id=eq.00000000-0000-4000-8000-000000000001");
    expect(runsUrl).toContain("created_at=gte.");
    expect(runsUrl).toContain("limit=1000");
  });

  it("opens an exact immutable report version for evidence review", async () => {
    const caseId = "00000000-0000-4000-8000-000000000101";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const payload = { address: "0xabc", headline: "Frozen evidence" };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("report_versions?select=id,case_id,payload")) {
        return jsonResponse([{
          id: versionId,
          case_id: caseId,
          payload,
          verdict: "CAUTION",
          score: 54,
          contributor_label: "Kyle",
          created_at: "2026-07-10T23:00:00.000Z",
        }]);
      }
      if (url.includes("/rest/v1/cases?select=id,kind,canonical_ref")) {
        return jsonResponse([{
          id: caseId,
          kind: "token",
          canonical_ref: "0xabc",
          display_query: "$ABC",
          status: "archived",
        }]);
      }
      if (url.includes("report_versions?select=id,case_id,version")) {
        return jsonResponse([{
          id: versionId,
          case_id: caseId,
          version: 2,
          completeness_state: "partial",
          attestation_state: "analyst_submitted",
          methodology_version: "v2",
          created_at: "2026-07-10T23:00:00.000Z",
        }]);
      }
      if (url.includes("/rest/v1/check_runs?")) return jsonResponse([]);
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { versionId } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      caseStatus: "archived",
      report: {
        kind: "token",
        ref: "0xabc",
        payload,
        versionContext: { caseId, reportVersionId: versionId, version: 2 },
      },
    });
    expect(issuePanelCostToken).not.toHaveBeenCalled();
  });

  it("returns an archived case state instead of treating a missing projection as a new subject", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        case_id: "00000000-0000-4000-8000-000000000101",
        subject_kind: "person",
        subject_ref: "alice",
        display_query: "@Alice",
        case_status: "archived",
      }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ status: "archived" }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { ref: "@Alice", kind: "person" } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({ available: true, report: null, caseStatus: "archived" });
  });

  it("resolves labels and legacy case-folded refs from durable cases", async () => {
    const canonical = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{
      case_id: "00000000-0000-4000-8000-000000000101",
      subject_kind: "token",
      subject_ref: canonical,
      display_query: "$PEPEBULL",
      case_status: "archived",
      updated_at: "2026-07-11T01:00:00.000Z",
    }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { resolve: "$pepebull" } }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/resolve_case_subject");
    expect(captured.body).toEqual({
      available: true,
      subjects: [{
        caseId: "00000000-0000-4000-8000-000000000101",
        kind: "token",
        ref: canonical,
        query: "$PEPEBULL",
        status: "archived",
        updatedAt: "2026-07-11T01:00:00.000Z",
      }],
    });
  });

  it("rejects a direct read when one label resolves to multiple contracts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      {
        case_id: "00000000-0000-4000-8000-000000000201",
        subject_kind: "token",
        subject_ref: "0x1111111111111111111111111111111111111111",
        display_query: "$SAME",
        case_status: "open",
      },
      {
        case_id: "00000000-0000-4000-8000-000000000202",
        subject_kind: "token",
        subject_ref: "0x2222222222222222222222222222222222222222",
        display_query: "$SAME",
        case_status: "open",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { ref: "$SAME", kind: "token" } }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "case_subject_ambiguous" });
  });

  it("follows WHATWG request-URL flags even when a stubbed query object disagrees", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{
      case_id: "00000000-0000-4000-8000-000000000101",
      subject_kind: "token",
      subject_ref: "0xabc",
      display_query: "$ABC",
      case_status: "open",
    }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", {
      url: "/api/report?resolve=%24ABC",
      query: { spend: "1" },
    }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/resolve_case_subject");
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ available: true });
  });

  it("treats a malformed request URL as an empty query instead of throwing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { url: "http://%" }), res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "ref_required" });
  });
});

describe("reportSearchParams", () => {
  it("reads search flags from the request URL without using url.parse", () => {
    expect(reportSearchParams({ url: "/api/report?list&status=archived" }).get("status")).toBe("archived");
    expect(reportSearchParams({ url: "/api/report?list&status=archived" }).has("list")).toBe(true);
    expect(reportSearchParams({ url: "/api/report" }).has("list")).toBe(false);
    expect([...reportSearchParams({ url: "http://%" }).keys()]).toEqual([]);
  });
});
