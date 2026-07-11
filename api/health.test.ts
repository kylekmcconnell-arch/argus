import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "./health";

function response() {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return this; },
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

describe("provider readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports configuration without making provider calls", () => {
    vi.stubEnv("XAI_API_KEY", "xai-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("TWITTERAPI_KEY", "");
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      mode: "configuration",
      down: 1,
      services: [
        { id: "xai", ok: true },
        { id: "anthropic", ok: true },
        { id: "twitterapi", ok: false, detail: "not configured in this deployment" },
      ],
    });
    expect(captured.headers["cache-control"]).toContain("s-maxage=300");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects mutating methods", () => {
    const { res, captured } = response();

    handler({ method: "POST" } as never, res as never);

    expect(captured.status).toBe(405);
    expect(captured.headers.allow).toBe("GET, HEAD");
    expect(captured.body).toEqual({ error: "method_not_allowed" });
  });
});
