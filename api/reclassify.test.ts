import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  reserveSupplementalBudget: vi.fn(),
  grokChat: vi.fn(),
}));

vi.mock("./_auth.js", async () => {
  const actual = await vi.importActual<typeof import("./_auth.js")>("./_auth.js");
  return {
    requireArgusAuth: harness.requireArgusAuth,
    reserveSupplementalBudget: harness.reserveSupplementalBudget,
    rejectSupplementalReservation: actual.rejectSupplementalReservation,
  };
});
vi.mock("./_llm.js", () => ({
  grokChat: harness.grokChat,
  claudeMessages: vi.fn(),
  claudeToolInput: vi.fn(),
  parseJsonObject: (text: string) => JSON.parse(text),
  providerFallbacksEnabled: () => false,
}));

import handler from "./reclassify";

const owner = { userId: "00000000-0000-4000-8000-000000000010", email: "owner@example.com", organizationId: "00000000-0000-4000-8000-000000000001", role: "owner", displayName: "Owner" };

function response() {
  const captured = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn().mockReturnThis(),
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res: res as never, captured };
}
const post = (body: unknown) => ({ method: "POST", body, headers: {} }) as never;

describe("POST /api/reclassify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("XAI_API_KEY", "xai-test");
    harness.requireArgusAuth.mockResolvedValue(owner);
    harness.reserveSupplementalBudget.mockResolvedValue({ allowed: true, limit: 100 });
    harness.grokChat.mockResolvedValue({ ok: true, text: JSON.stringify({ results: [{ ref: "alice", roles: ["FOUNDER"] }] }) });
  });

  // 2026-09-14 deep-dive API-8: the handler trusted the edge alone and parsed
  // the body outside any try, so a bad payload crashed the function.
  it("verifies owner access in the handler, not only at the edge", async () => {
    harness.requireArgusAuth.mockImplementation(async (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(403).json({ error: "insufficient_role" });
      return null;
    });
    const { res, captured } = response();
    await handler(post({ subjects: [{ ref: "alice", summary: "founder" }] }), res);
    expect(captured.status).toBe(403);
    expect(harness.grokChat).not.toHaveBeenCalled();
  });

  it("rejects an unparseable body with 400 and spends nothing", async () => {
    const { res, captured } = response();
    await handler(post("{not json"), res);
    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({ error: "invalid_json_body" });
    expect(harness.reserveSupplementalBudget).not.toHaveBeenCalled();
  });

  // 2026-09-14 deep-dive API-2: the daily supplemental unit is reserved after
  // validation, immediately before the model call.
  it("spends no supplemental unit on an empty subject list", async () => {
    const { res, captured } = response();
    await handler(post({ subjects: [] }), res);
    expect(captured.status).toBe(400);
    expect(harness.reserveSupplementalBudget).not.toHaveBeenCalled();
  });

  it("reserves the supplemental unit after validation and before the model call", async () => {
    const { res, captured } = response();
    await handler(post({ subjects: [{ ref: "alice", summary: "Founded a protocol." }] }), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({ available: true, results: [{ ref: "alice", roles: ["FOUNDER"] }] });
    expect(harness.reserveSupplementalBudget).toHaveBeenCalledWith(owner, "/api/reclassify");
    expect(harness.reserveSupplementalBudget.mock.invocationCallOrder[0]).toBeLessThan(harness.grokChat.mock.invocationCallOrder[0]);
  });

  it("stops with 429 before the model when the allowance is exhausted", async () => {
    harness.reserveSupplementalBudget.mockResolvedValue({ allowed: false, limit: 100 });
    const { res, captured } = response();
    await handler(post({ subjects: [{ ref: "alice", summary: "Founded a protocol." }] }), res);
    expect(captured.status).toBe(429);
    expect(captured.body).toMatchObject({ error: "supplemental_daily_limit_reached" });
    expect(harness.grokChat).not.toHaveBeenCalled();
  });

  // 2026-09-14 deep-dive API-10: a provider failure answered 200.
  it("reports a provider failure with a stable code instead of a 200", async () => {
    harness.grokChat.mockResolvedValue({ ok: false, status: 429, text: "" });
    const { res, captured } = response();
    await handler(post({ subjects: [{ ref: "alice", summary: "Founded a protocol." }] }), res);
    expect(captured.status).toBe(503);
    expect(captured.body).toMatchObject({ error: "analyst_provider_unavailable", results: [] });
  });
});
