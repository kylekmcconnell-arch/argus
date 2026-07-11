import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { requireArgusAuth, serviceCredentials, serviceHeaders } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn((key: string, extra?: Record<string, string>) => ({
    apikey: key,
    "content-type": "application/json",
    ...extra,
  })),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth, serviceCredentials, serviceHeaders }));

import { activateReportVersionWithAuthoritativeGraph } from "./_graph";
import handler from "./graph";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const REPORT_VERSION_ID = "00000000-0000-4000-8000-000000000201";
const CREDENTIALS = { url: "https://database.example", key: "service-key" };

function response() {
  const captured: { status?: number; body?: unknown; allow?: string } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "allow") captured.allow = value;
      return this;
    },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res: res as unknown as VercelResponse, captured };
}

describe("trust graph provenance", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset().mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      displayName: "Analyst",
    });
    serviceCredentials.mockReset().mockReturnValue(CREDENTIALS);
    serviceHeaders.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses one database transaction for complete report activation and graph publication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(activateReportVersionWithAuthoritativeGraph(CREDENTIALS, {
      organizationId: ORGANIZATION_ID,
      reportVersionId: REPORT_VERSION_ID,
      userId: USER_ID,
      attestationState: "server_collected",
      completeness: "complete",
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://database.example/rest/v1/rpc/activate_report_version_with_graph");
    expect(JSON.parse(String(init?.body))).toEqual({
      p_organization_id: ORGANIZATION_ID,
      p_report_version_id: REPORT_VERSION_ID,
      p_actor_user_id: USER_ID,
    });
  });

  it.each([
    ["partial coverage", ORGANIZATION_ID, "server_collected", "partial"],
    ["analyst-submitted evidence", ORGANIZATION_ID, "analyst_submitted", "complete"],
    ["malformed tenant", "attacker-controlled-org", "server_collected", "complete"],
  ] as const)("does not call the atomic graph activation RPC for %s", async (_label, organizationId, attestationState, completeness) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(activateReportVersionWithAuthoritativeGraph(CREDENTIALS, {
      organizationId,
      reportVersionId: REPORT_VERSION_ID,
      userId: USER_ID,
      attestationState,
      completeness,
    })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an existing server-collected contribution from a later client write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { provenance_state: "server_collected" },
    ]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({
      method: "POST",
      headers: {},
      body: {
        handle: "@Alice",
        nodes: [{ type: "Person", key: "@Alice", subject: true }],
        edges: [],
        verdict: "FAIL",
        report_version_id: "attacker-version",
        provenance_state: "server_collected",
      },
    } as unknown as VercelRequest, res);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain(`organization_id=eq.${ORGANIZATION_ID}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("canonical_key=eq.alice");
    expect(captured).toMatchObject({
      status: 200,
      body: { ok: true, canonicalKey: "alice", preserved: true },
    });
  });

  it("labels accepted browser contributions client-submitted and ignores provenance spoofing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { provenance_state: "legacy" },
      ]), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({
      method: "POST",
      headers: {},
      body: {
        handle: "@Alice",
        nodes: [{ type: "Person", key: "@Alice", subject: true }],
        edges: [],
        verdict: "CAUTION",
        report_version_id: REPORT_VERSION_ID,
        provenance_state: "server_collected",
      },
    } as unknown as VercelRequest, res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const inserted = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Record<string, unknown>;
    expect(inserted).toMatchObject({
      organization_id: ORGANIZATION_ID,
      canonical_key: "alice",
      provenance_state: "client_submitted",
      verdict: "CAUTION",
    });
    expect(inserted).not.toHaveProperty("report_version_id");
    expect(captured).toMatchObject({ status: 200, body: { ok: true, canonicalKey: "alice" } });
  });

  it("returns immutable provenance fields on organization-scoped reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      handle: "@Alice",
      aliases: ["Alice"],
      verdict: "PASS",
      nodes: [],
      edges: [],
      report_version_id: REPORT_VERSION_ID,
      provenance_state: "server_collected",
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET", headers: {} } as unknown as VercelRequest, res);

    expect(String(fetchMock.mock.calls[0][0])).toContain(`organization_id=eq.${ORGANIZATION_ID}`);
    expect(captured.body).toEqual({
      available: true,
      contributions: [{
        handle: "@Alice",
        aliases: ["Alice"],
        verdict: "PASS",
        nodes: [],
        edges: [],
        reportVersionId: REPORT_VERSION_ID,
        provenanceState: "server_collected",
      }],
    });
  });
});
