import { afterEach, describe, expect, it, vi } from "vitest";
import { grokAccessFailure, recordGrokAccessFailure, withProviderAccessScope } from "./providerAccess";
import { structured } from "./agent";
import { getCost, withCostLedger } from "./cost";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("request-local provider access failures", () => {
  it("isolates scans and distinguishes endpoint/model permission from account authentication", async () => {
    await withProviderAccessScope(async () => {
      await recordGrokAccessFailure(new Response("model access denied", { status: 403 }), "model-a", "search");
      expect(grokAccessFailure("model-a", "search")?.diagnostic).toBe("model_access_denied");
      expect(grokAccessFailure("model-a")).toBeUndefined();
      expect(grokAccessFailure("model-b", "search")).toBeUndefined();
      await withProviderAccessScope(async () => { expect(grokAccessFailure("model-a", "search")).toBeUndefined(); });
      await recordGrokAccessFailure(new Response("invalid key", { status: 401 }), "model-a");
      expect(grokAccessFailure("model-b", "search")?.httpStatus).toBe(401);
    });
    expect(grokAccessFailure("model-a")).toBeUndefined();
  });
  it("does not stop calls for transient rate limits or server errors", async () => {
    await withProviderAccessScope(async () => {
      for (const status of [429, 500, 503]) await recordGrokAccessFailure(new Response("failed", { status }), "model");
      expect(grokAccessFailure("model")).toBeUndefined();
    });
  });
  it("records controlled diagnostics without logging provider bodies", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await withProviderAccessScope(async () => {
      await recordGrokAccessFailure(new Response("Insufficient credit; private account detail secret-123", { status: 403, headers: { "x-request-id": "request_123" } }), "model");
      expect(grokAccessFailure("model")).toMatchObject({ diagnostic: "billing_required", requestId: "request_123" });
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-123");
  });
  it("suppresses repeat physical requests without fake usage and allows a fresh scan", async () => {
    vi.stubEnv("XAI_API_KEY", "test");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "off");
    const fetch = vi.fn().mockImplementation(async () => new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const tool = { name: "record_test", description: "test", input_schema: { type: "object", properties: { ok: { type: "boolean" } } } };
    await withProviderAccessScope(() => withCostLedger(async () => {
      await structured("system", "user", tool);
      await structured("system", "user", tool);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(getCost().grokCalls).toBe(1);
    }));
    await withProviderAccessScope(() => structured("system", "user", tool));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

it("preserves explicitly enabled fallback after access rejection", async () => {
  vi.stubEnv("XAI_API_KEY", "test");
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
  const fetch = vi.fn().mockImplementation(async (url: string) => String(url).includes("api.x.ai")
    ? new Response("denied", { status: 403 })
    : new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_test", input: { ok: true } }], stop_reason: "tool_use", usage: { input_tokens: 20, output_tokens: 10 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const tool = { name: "record_test", description: "test", input_schema: { type: "object", properties: { ok: { type: "boolean" } } } };
  await withProviderAccessScope(() => withCostLedger(async () => {
    expect(await structured("system", "user", tool)).toEqual({ ok: true });
    expect(await structured("system", "user", tool)).toEqual({ ok: true });
    expect(getCost().grokCalls).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  }));
});
