import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_auth.js", () => ({
  serviceCredentials: vi.fn(() => ({ url: "https://db.example", key: "secret" })),
  serviceHeaders: vi.fn((_key: string, options?: { prefer?: string }) => ({ authorization: "Bearer secret", "content-type": "application/json", ...(options?.prefer ? { prefer: options.prefer } : {}) })),
}));

import { recordScanReceipt } from "./_scanReceipts";

const auth = { userId: "00000000-0000-4000-8000-000000000010", organizationId: "00000000-0000-4000-8000-000000000001", role: "analyst", email: "a@example.com", displayName: "A" } as const;

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (
  init?.method === "PATCH" ? new Response(JSON.stringify([{ id: "receipt" }]), { status: 200 }) : new Response(null, { status: 201 })
))));
afterEach(() => vi.unstubAllGlobals());

describe("scan receipt storage", () => {
  it("writes a tenant-scoped running receipt with insert-only conflict handling", async () => {
    await expect(recordScanReceipt(auth, {
      runKey: "scan-key-123", route: "/app/scan", kind: "token", canonicalRef: "0xabc",
      displayQuery: "$ARGUS", status: "running", creditsCharged: 1,
      startedAt: "2026-08-23T20:00:00Z",
    })).resolves.toBe(true);
    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).prefer).toContain("ignore-duplicates");
    expect(JSON.parse(String(init.body))).toMatchObject({
      organization_id: auth.organizationId, initiated_by: auth.userId,
      status: "running", credits_charged_millis: 1000,
    });
  });

  it("redacts credential-shaped failure text before storage", async () => {
    await recordScanReceipt(auth, {
      runKey: "scan-key-456", route: "/api/v1/token", kind: "token", canonicalRef: "0xabc",
      displayQuery: "$ARGUS", status: "failed", startedAt: "2026-08-23T20:00:00Z",
      finishedAt: "2026-08-23T20:00:01Z", durationMs: 1000,
      failureDetail: "upstream rejected Bearer sensitive-value at ?api_key=sensitive-value",
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.failure_detail).toBe("upstream rejected Bearer [redacted] at ?api_key=[redacted]");
    expect(init.method).toBe("PATCH");
  });

  it("patches only the outcome so a renormalised subject cannot strand the receipt", async () => {
    // The reserving caller writes a lowercased ref; the finishing caller has a
    // checksummed address and a resolved symbol. Sending either again would
    // trip the immutability guard and leave the run stuck in `running`.
    await expect(recordScanReceipt(auth, {
      runKey: "scan-key-123", route: "/app/scan", kind: "token",
      canonicalRef: "0xAbC0000000000000000000000000000000000001",
      displayQuery: "$ARGUS", status: "complete", creditsCharged: 1,
      startedAt: "2026-08-23T20:00:00Z", finishedAt: "2026-08-23T20:00:02Z", durationMs: 2000,
    })).resolves.toBe(true);
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(init.method).toBe("PATCH");
    expect(body.status).toBe("complete");
    for (const identity of ["organization_id", "run_key", "initiated_by", "route", "kind", "canonical_ref", "display_query", "private_run", "credits_charged_millis", "started_at"]) {
      expect(body).not.toHaveProperty(identity);
    }
  });

  it("rejects a terminal receipt without a valid finish time and duration", async () => {
    await expect(recordScanReceipt(auth, {
      runKey: "scan-key-123", route: "/app/scan", kind: "token", canonicalRef: "0xabc",
      displayQuery: "$ARGUS", status: "failed", startedAt: "2026-08-23T20:00:00Z",
    })).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
