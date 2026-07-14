import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  serviceCredentials: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  signInWithOtp: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("./_auth.js", () => ({
  serviceCredentials: mocks.serviceCredentials,
}));

import handler from "./signin";

const USER_ID = "051d67b6-7abd-46f2-a4b2-646cbab407b4";
const EMAIL = "enigma@enigma-fund.com";

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): VercelRequest {
  return {
    method: "POST",
    body,
    headers: {
      origin: "https://argus.example",
      host: "argus.example",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
  } as unknown as VercelRequest;
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: EMAIL,
    email_confirmed_at: "2026-07-14T06:59:38.191Z",
    confirmed_at: "2026-07-14T06:59:38.191Z",
    invited_at: "2026-07-11T00:39:58.979Z",
    deleted_at: null,
    banned_until: null,
    ...overrides,
  };
}

function memberLookup(active: boolean | null = true) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: active === null ? null : { user_id: USER_ID, normalized_email: EMAIL, active },
      error: null,
    }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  mocks.from.mockReturnValue(chain);
}

describe("approved-member sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serviceCredentials.mockReturnValue({
      url: "https://database.example",
      key: "service-role-key",
    });
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("ARGUS_APP_ORIGIN", "https://argus.example");
    const admin = {
      auth: { admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } },
      from: mocks.from,
      rpc: mocks.rpc,
    };
    const login = { auth: { signInWithOtp: mocks.signInWithOtp } };
    mocks.createClient.mockImplementation((_url: string, key: string) =>
      key === "service-role-key" ? admin : login);
    mocks.getUserById.mockResolvedValue({ data: { user: authUser() }, error: null });
    mocks.updateUserById.mockResolvedValue({ data: { user: authUser() }, error: null });
    mocks.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    mocks.rpc.mockResolvedValue({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null });
    memberLookup(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("normalizes an approved email and sends one bounded magic link", async () => {
    const { res, captured } = response();

    await handler(request({
      email: "  Enigma@Enigma-Fund.com  ",
      returnTo: "/?version=one",
    }), res);

    expect(captured.statusCode).toBe(202);
    expect(captured.body).toEqual({
      ok: true,
      message: "If this email is approved, a secure sign-in link is on its way.",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "consume_auth_request_limit", expect.objectContaining({
      p_scope: "signin_ip",
      p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_window_seconds: 3_600,
      p_limit: 10,
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "consume_auth_request_limit", expect.objectContaining({
      p_scope: "signin_email",
      p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_window_seconds: 3_600,
      p_limit: 2,
    }));
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: EMAIL,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://argus.example/?version=one",
      },
    });
  });

  it("keeps a local development sign-in session on the loopback origin", async () => {
    const { res, captured } = response();

    await handler(request({
      email: EMAIL,
      returnTo: "/case/stani?version=one",
    }, {
      origin: "http://localhost:5173",
      host: "localhost:5173",
    }), res);

    expect(captured.statusCode).toBe(202);
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: EMAIL,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:5173/case/stani?version=one",
      },
    });
  });

  it("recovers an active legacy invitation before sending the link", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: authUser({ email_confirmed_at: null, confirmed_at: null }) },
      error: null,
    });
    const confirmed = authUser();
    mocks.updateUserById.mockResolvedValue({ data: { user: confirmed }, error: null });
    const { res } = response();

    await handler(request({ email: EMAIL, returnTo: "/" }), res);

    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, { email_confirm: true });
    expect(mocks.updateUserById.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.signInWithOtp.mock.invocationCallOrder[0]);
    expect(mocks.signInWithOtp).toHaveBeenCalledOnce();
  });

  it("does not promote an arbitrary unconfirmed auth user", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: authUser({
        email_confirmed_at: null,
        confirmed_at: null,
        invited_at: null,
      }) },
      error: null,
    });
    const { res, captured } = response();

    await handler(request({ email: EMAIL }), res);

    expect(captured.statusCode).toBe(202);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", null, null],
    ["disabled", authUser(), false],
    ["deleted", authUser({ deleted_at: "2026-07-14T00:00:00.000Z" }), true],
    ["banned", authUser({ banned_until: "2099-01-01T00:00:00.000Z" }), true],
  ])("returns the same response for an ineligible %s account", async (_case, user, active) => {
    if (user) mocks.getUserById.mockResolvedValue({ data: { user }, error: null });
    memberLookup(active);
    const { res, captured } = response();

    await handler(request({ email: EMAIL }, { "x-forwarded-for": `203.0.113.${String(_case).length}` }), res);

    expect(captured.statusCode).toBe(202);
    expect(captured.body).toEqual({
      ok: true,
      message: "If this email is approved, a secure sign-in link is on its way.",
    });
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects malformed email input", async () => {
    const { res, captured } = response();
    await handler(request({ email: "not-an-email" }), res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "valid_email_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/safe#token",
    "/\\evil",
  ])("rejects an unsafe return path: %s", async (returnTo) => {
    const { res, captured } = response();
    await handler(request({ email: EMAIL, returnTo }), res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "relative_return_path_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the browser origin to match the ARGUS request host", async () => {
    const { res, captured } = response();
    await handler(request({ email: EMAIL }, { origin: "https://evil.example" }), res);
    expect(captured.statusCode).toBe(403);
    expect(captured.body).toEqual({ error: "same_origin_required" });
  });

  it("uses the atomic email gate to suppress a duplicate link request", async () => {
    let emailRequests = 0;
    mocks.rpc.mockImplementation(async (_name: string, input: { p_scope: string }) => {
      if (input.p_scope === "signin_email") emailRequests += 1;
      return {
        data: [{ allowed: input.p_scope !== "signin_email" || emailRequests === 1 }],
        error: null,
      };
    });
    const first = response();
    const second = response();
    await handler(request({ email: EMAIL }), first.res);
    await handler(request({ email: EMAIL }), second.res);

    expect(first.captured.statusCode).toBe(202);
    expect(second.captured.statusCode).toBe(202);
    expect(mocks.signInWithOtp).toHaveBeenCalledOnce();
  });

  it("stops before member lookup when the durable IP gate denies", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ allowed: false }], error: null });
    const { res, captured } = response();

    await handler(request({ email: EMAIL }), res);

    expect(captured.statusCode).toBe(202);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("does not expose a provider delivery error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });
    const { res, captured } = response();

    await handler(request({ email: EMAIL }), res);

    expect(captured.statusCode).toBe(202);
    expect(captured.body).not.toHaveProperty("error");
    expect(JSON.stringify(captured.body)).not.toContain("rate");
  });
});
