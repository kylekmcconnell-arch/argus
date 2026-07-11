import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({
  next: vi.fn(() => new Response(null, { status: 204 })),
}));

import { next } from "@vercel/functions";
import middleware from "./middleware";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Case Brief middleware policy", () => {
  beforeEach(() => {
    vi.mocked(next).mockClear();
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("advertises PATCH for configured Case Brief CORS origins", async () => {
    vi.stubEnv("ARGUS_CORS_ORIGINS", "https://partner.example");

    const response = await middleware(new Request("https://argus.example/api/case-brief", {
      method: "OPTIONS",
      headers: { origin: "https://partner.example" },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://partner.example");
    expect(response.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a viewer to read Case Brief without consuming analyst quota", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/case-brief?caseId=00000000-0000-4000-8000-000000000101",
      { headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows a viewer to read tenant-scoped alerts without consuming analyst quota", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/alerts",
      { headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires analyst access to dismiss an alert", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/alerts?ref=al%3Aone",
      { method: "DELETE", headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not classify a GET augmentation submission as a viewer read", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/augment?subject=alice&type=x&value=alice",
      { headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
  });

  it("meters an analyst augmentation submission even though the legacy route uses GET", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse([{ allowed: true, remaining: 299 }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/augment?subject=alice&type=x&value=alice",
      { headers: { authorization: "Bearer analyst-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"))).toBe(true);
  });

  it("requires owner access for augmentation review actions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/augment?action=pending-all",
      { headers: { authorization: "Bearer analyst-token" } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "owner" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not allow a viewer to mutate Case Brief", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/case-brief", {
      method: "PATCH",
      headers: { authorization: "Bearer viewer-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows an analyst collaboration mutation without consuming paid-scan quota", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/case-brief", {
      method: "POST",
      headers: { authorization: "Bearer analyst-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"))).toBe(false);
  });
});
