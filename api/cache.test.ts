import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPanelCost } from "./_cache.js";

const originalUrl = process.env.SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl == null) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalSecret == null) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSecret;
});

describe("post-report cost ledger", () => {
  it("attributes a panel line to the exact organization and immutable version", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ report_version_id: "version-1" }]))
      .mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await attachPanelCost(
      "org-1",
      "@Alice",
      { provider: "claude", op: "panel:pfp-check", calls: 1, usd: 0.123456, meta: "vision" },
      "person",
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain("organization_id=eq.org-1");
    expect(String(fetchMock.mock.calls[0][0])).toContain("ref=eq.alice");
    expect(String(fetchMock.mock.calls[0][0])).toContain("kind=eq.person");
    expect(fetchMock.mock.calls[1][0]).toBe("https://database.example/rest/v1/rpc/upsert_report_cost_line");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      p_organization_id: "org-1",
      p_report_version_id: "version-1",
      p_provider: "claude",
      p_operation: "panel:pfp-check",
      p_calls: 1,
      p_usd: 0.1235,
      p_meta: "vision",
    });
    expect(fetchMock.mock.calls[1][1]?.headers).not.toHaveProperty("authorization");
  });
});
