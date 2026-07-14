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

  it("allows the public sign-in request without a bearer token", async () => {
    const response = await middleware(new Request("https://argus.example/api/signin", {
      method: "POST",
      headers: { origin: "https://argus.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "enigma@enigma-fund.com" }),
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not expose a nearby sign-in path", async () => {
    const response = await middleware(new Request("https://argus.example/api/signin/admin", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
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

  it("requires analyst access for an augmentation POST", async () => {
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

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "POST",
      headers: { authorization: "Bearer viewer-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
  });

  it("meters an analyst augmentation POST", async () => {
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

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "POST",
      headers: { authorization: "Bearer analyst-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"))).toBe(true);
  });

  it("requires owner access for augmentation review views", async () => {
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
      "https://argus.example/api/augment?view=pending",
      { headers: { authorization: "Bearer analyst-token" } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "owner" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not meter an owner augmentation review view", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "owner",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/augment?view=learnings",
      { headers: { authorization: "Bearer owner-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires owner access for augmentation PATCH decisions", async () => {
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

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "PATCH",
      headers: { authorization: "Bearer analyst-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "owner" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows and meters an owner augmentation PATCH decision", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "owner",
        active: true,
      }]))
      .mockResolvedValueOnce(jsonResponse([{ allowed: true, remaining: 1499 }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "PATCH",
      headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", id: "00000000-0000-4000-8000-000000000101" }),
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    const quotaCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"));
    expect(quotaCall).toBeDefined();
    expect(JSON.parse(String(quotaCall?.[1]?.body))).toMatchObject({
      p_organization_id: "00000000-0000-4000-8000-000000000001",
      p_user_id: "00000000-0000-4000-8000-000000000010",
      p_route: "/api/augment",
      p_metadata: { method: "PATCH" },
      p_units: 1,
    });
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
