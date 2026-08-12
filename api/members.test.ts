import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  listUsers: vi.fn(),
  inviteUserByEmail: vi.fn(),
  resend: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("./_auth.js", () => ({
  requireArgusAuth: mocks.requireArgusAuth,
  serviceCredentials: mocks.serviceCredentials,
}));

import handler from "./members";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000010";
const MEMBER_ID = "00000000-0000-4000-8000-000000000020";
const EMAIL = "enigma@enigma-fund.com";
const APP_ORIGIN = "https://argus-one-flax.vercel.app";

const member = {
  user_id: MEMBER_ID,
  organization_id: ORGANIZATION_ID,
  role: "owner",
  display_name: "Enigma",
  active: true,
  created_at: "2026-07-11T00:39:59.000Z",
  updated_at: "2026-07-11T00:39:59.000Z",
};

function authUser(verified: boolean) {
  return {
    id: MEMBER_ID,
    email: EMAIL,
    email_confirmed_at: verified ? "2026-07-11T00:42:15.000Z" : null,
    confirmed_at: verified ? "2026-07-11T00:42:15.000Z" : null,
    last_sign_in_at: null,
  };
}

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

function request(method: string, body: Record<string, unknown>): VercelRequest {
  return { method, body, headers: {} } as unknown as VercelRequest;
}

function usePostCount(count = 1) {
  const eq = vi.fn().mockResolvedValue({ count, error: null });
  mocks.from.mockReturnValue({ select: vi.fn(() => ({ eq })) });
}

function useExistingMember() {
  const chain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: member, error: null }),
  };
  chain.eq.mockReturnValue(chain);
  mocks.from.mockReturnValue({ select: vi.fn(() => chain) });
}

describe("workspace member invitation recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ARGUS_APP_ORIGIN = APP_ORIGIN;
    mocks.requireArgusAuth.mockResolvedValue({
      userId: OWNER_ID,
      email: "owner@example.com",
      organizationId: ORGANIZATION_ID,
      role: "owner",
      displayName: "Owner",
    });
    mocks.serviceCredentials.mockReturnValue({
      url: "https://database.example",
      key: "test-service-key",
    });
    mocks.createClient.mockReturnValue({
      auth: {
        admin: {
          listUsers: mocks.listUsers,
          inviteUserByEmail: mocks.inviteUserByEmail,
        },
        resend: mocks.resend,
      },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    mocks.resend.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ data: member, error: null });
  });

  afterEach(() => {
    delete process.env.ARGUS_APP_ORIGIN;
  });

  it("resends when an owner submits an existing unverified member", async () => {
    usePostCount();
    mocks.listUsers.mockResolvedValue({ data: { users: [authUser(false)] }, error: null });
    const { res, captured } = response();

    await handler(request("POST", { email: EMAIL, displayName: "Enigma", role: "owner" }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ invitationSent: true, invitationResent: true });
    expect(mocks.resend).toHaveBeenCalledWith({
      type: "signup",
      email: EMAIL,
      options: { emailRedirectTo: APP_ORIGIN },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("manage_member_access", expect.objectContaining({
      p_event_type: "member.invited",
      p_target_email: EMAIL,
      p_target_user_id: MEMBER_ID,
    }));
  });

  it("does not send another invitation to a verified member", async () => {
    usePostCount();
    mocks.listUsers.mockResolvedValue({ data: { users: [authUser(true)] }, error: null });
    const { res, captured } = response();

    await handler(request("POST", { email: EMAIL, displayName: "Enigma", role: "owner" }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ invitationSent: false, invitationResent: false });
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("manage_member_access", expect.objectContaining({
      p_event_type: "member.access_granted",
    }));
  });

  it("lets an owner resend a pending invitation from the member row", async () => {
    useExistingMember();
    mocks.listUsers.mockResolvedValue({ data: { users: [authUser(false)] }, error: null });
    const { res, captured } = response();

    await handler(request("PUT", { userId: MEMBER_ID, resendInvitation: true }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ invitationSent: true, invitationResent: true });
    expect(mocks.resend).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("manage_member_access", expect.objectContaining({
      p_event_type: "member.invited",
      p_active: true,
    }));
  });

  it("refuses to resend after the member has verified their email", async () => {
    useExistingMember();
    mocks.listUsers.mockResolvedValue({ data: { users: [authUser(true)] }, error: null });
    const { res, captured } = response();

    await handler(request("PUT", { userId: MEMBER_ID, resendInvitation: true }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "email_already_verified" });
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase cannot resend the invitation", async () => {
    useExistingMember();
    mocks.listUsers.mockResolvedValue({ data: { users: [authUser(false)] }, error: null });
    mocks.resend.mockResolvedValue({ error: new Error("mail provider unavailable") });
    const { res, captured } = response();

    await handler(request("PUT", { userId: MEMBER_ID, resendInvitation: true }), res);

    expect(captured.statusCode).toBe(502);
    expect(captured.body).toEqual({
      error: "invitation_resend_failed",
      message: "Supabase could not resend the invitation.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
