import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./_collector.js", () => ({ fetchPublicText: vi.fn() }));
vi.mock("./_cache.js", () => ({ cacheGetJson: vi.fn(async () => null), cacheSetJson: vi.fn() }));
import { fetchPublicText } from "./_collector.js";
import handler from "./site-safety";
const response = () => {
  const captured = { body: {} as Record<string, unknown> };
  const res = { status() { return this; }, setHeader() { return this; }, json(body: Record<string, unknown>) { captured.body = body; return this; } };
  return { res, captured };
};
beforeEach(() => { vi.stubEnv("GOOGLE_SAFE_BROWSING_KEY", ""); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("site safety coverage", () => {
  it.each(["unsafe_redirect", "transport_error"])("keeps %s plus a failed feed unknown", async (reason) => {
    vi.mocked(fetchPublicText).mockResolvedValue({ status: "failed", reason });
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("goplus")
      ? new Response(JSON.stringify({ result: { phishing_site: 0 } })) : new Response("rate limited", { status: 429 })));
    const { res, captured } = response();
    await handler({ query: { url: "https://example.com" } } as never, res as never);
    expect(fetchPublicText).toHaveBeenCalledWith("https://example.com");
    expect(captured.body).toMatchObject({ verdict: "unknown", checked: ["GoPlus"], unavailable: ["URLhaus", `page: ${reason}`] });
  });
});
