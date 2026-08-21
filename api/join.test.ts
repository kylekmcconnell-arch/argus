import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  serviceCredentials: vi.fn(),
  signInWithOtp: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  stageWaitlistSignup: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("./_auth.js", () => ({
  serviceCredentials: mocks.serviceCredentials,
}));

vi.mock("./_growth.js", () => ({
  stageWaitlistSignup: mocks.stageWaitlistSignup,
}));

import handler from "./join";

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

function request(body: Record<string, unknown>): VercelRequest {
  return {
    method: "POST",
    body,
    headers: {
      origin: "https://argus.example",
      host: "argus.example",
      "x-forwarded-for": "203.0.113.7",
    },
  } as unknown as VercelRequest;
}

describe("waitlist join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serviceCredentials.mockReturnValue({
      url: "https://database.example",
      key: "service-role-key",
    });
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("ARGUS_APP_ORIGIN", "https://argus.example");
    const admin = { from: mocks.from, rpc: mocks.rpc };
    const login = { auth: { signInWithOtp: mocks.signInWithOtp } };
    mocks.createClient.mockImplementation((_url: string, key: string) =>
      key === "service-role-key" ? admin : login);
    mocks.rpc.mockResolvedValue({ data: [{ allowed: true }], error: null });
    mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    mocks.stageWaitlistSignup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stages a waitlist signup and sends a create-user magic link", async () => {
    const { res, captured } = response();
    await handler(request({
      email: "  Enigma@Enigma-Fund.com  ",
      publicName: "Enigma",
      referralCode: "ABCD1234EF",
      returnTo: "/",
    }), res);

    expect(captured.statusCode).toBe(202);
    expect(captured.body).toEqual({
      ok: true,
      message: "If this email can join, a secure ARGUS link is on its way.",
    });
    expect(mocks.stageWaitlistSignup).toHaveBeenCalledWith(
      expect.anything(),
      EMAIL,
      "Enigma",
      "ABCD1234EF",
    );
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: EMAIL,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: "https://argus.example/",
      },
    });
  });

  it("rejects a public name that looks like an email", async () => {
    const { res, captured } = response();
    await handler(request({
      email: EMAIL,
      publicName: "owner@argus.example",
    }), res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toMatchObject({ error: "valid_public_name_required" });
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });
});
