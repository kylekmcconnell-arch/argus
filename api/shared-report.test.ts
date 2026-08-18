import { describe, expect, it, vi } from "vitest";
import handler, { sanitizeSharedPayload } from "./shared-report";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("./_auth.js", () => ({
  serviceCredentials: vi.fn(() => null),
  serviceHeaders: vi.fn(() => ({})),
}));
vi.mock("./report.js", () => ({
  loadExactVersionReport: vi.fn(),
}));

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as VercelResponse & { statusCode: number; body: unknown };
}

describe("shared-report sanitization", () => {
  it("strips workspace internals from the shared payload, including embedded dossiers", () => {
    const payload = {
      handle: "@subject",
      cost: { usd: 12.4 },
      persistence: { state: "persisted", reportVersionId: "x" },
      token: { symbol: "BULL", cost: { usd: 3 }, score: 89 },
      projectAccount: { handle: "@bullcoinrh", viewPersistence: { state: "persisted" } },
      report: { governing_score: 89 },
    };
    const clean = sanitizeSharedPayload(payload) as Record<string, unknown>;

    expect(clean.cost).toBeUndefined();
    expect(clean.persistence).toBeUndefined();
    expect((clean.token as Record<string, unknown>).cost).toBeUndefined();
    expect((clean.token as Record<string, unknown>).score).toBe(89);
    expect((clean.projectAccount as Record<string, unknown>).viewPersistence).toBeUndefined();
    expect(clean.report).toEqual({ governing_score: 89 });
    // The original payload is never mutated.
    expect(payload.cost).toEqual({ usd: 12.4 });
  });

  it("rejects malformed tokens before touching storage", async () => {
    for (const share of ["", "short", "has spaces", "bad$chars!", "x".repeat(101)]) {
      const res = mockRes();
      await handler({ method: "GET", query: { share } } as unknown as VercelRequest, res);
      expect(res.statusCode).toBe(400);
      expect((res.body as { error?: string }).error).toBe("invalid_share_token");
    }
  });

  it("only answers GET", async () => {
    const res = mockRes();
    await handler({ method: "POST", query: {} } as unknown as VercelRequest, res);
    expect(res.statusCode).toBe(405);
  });
});
