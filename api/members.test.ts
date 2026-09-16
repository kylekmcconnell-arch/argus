import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  listUsers: vi.fn(),
  getUserById: vi.fn(),
  inviteUserByEmail: vi.fn(),
  resend: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  ensureGrowthProfile: vi.fn(),
  ensureStartingCredits: vi.fn(),
  grantManualTestCredits: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("./_auth.js", () => ({
  requireArgusAuth: mocks.requireArgusAuth,
  serviceCredentials: mocks.serviceCredentials,
}));

vi.mock("./_growth.js", () => ({
  ensureGrowthProfile: mocks.ensureGrowthProfile,
  ensureStartingCredits: mocks.ensureStartingCredits,
  grantManualTestCredits: mocks.grantManualTestCredits,
}));

import handler, { summarizeMemberBudgets } from "./members";

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
          getUserById: mocks.getUserById,
          inviteUserByEmail: mocks.inviteUserByEmail,
        },
        resend: mocks.resend,
      },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    // Default: the individual lookup answers from whatever the paged listing
    // holds, so the invitation cases below keep one source of auth users.
    mocks.getUserById.mockImplementation(async (id: string) => {
      const { data } = await mocks.listUsers({ page: 1, perPage: 1000 });
      const user = (data?.users ?? []).find((candidate: { id: string }) => candidate.id === id) ?? null;
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { status: 404, message: "User not found" } };
    });
    mocks.resend.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ data: member, error: null });
    mocks.ensureGrowthProfile.mockResolvedValue({
      userId: MEMBER_ID,
      publicName: "Enigma",
      code: "ABCD1234",
      status: "admitted",
      createdAt: member.created_at,
    });
    mocks.ensureStartingCredits.mockResolvedValue(undefined);
    mocks.grantManualTestCredits.mockResolvedValue(undefined);
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

  it("lets an owner make an idempotent bounded grant to an active analyst", async () => {
    useExistingMember();
    mocks.listUsers.mockResolvedValue({ data: { users: [authUser(true)] }, error: null });
    const analyst = { ...member, role: "analyst" };
    const chain = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: analyst, error: null }),
    };
    chain.eq.mockReturnValue(chain);
    mocks.from.mockReturnValue({ select: vi.fn(() => chain) });
    const { res, captured } = response();

    await handler(request("PUT", {
      userId: MEMBER_ID,
      grantTestCredits: 5,
      idempotencyKey: "00000000-0000-4000-8000-000000000030",
    }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ grantedCredits: 5 });
    expect(mocks.grantManualTestCredits).toHaveBeenCalledWith(expect.anything(), {
      userId: MEMBER_ID,
      organizationId: ORGANIZATION_ID,
      actorUserId: OWNER_ID,
      credits: 5,
      requestId: "00000000-0000-4000-8000-000000000030",
    });
  });

  it("rejects grants above the hard per-request ceiling", async () => {
    useExistingMember();
    const { res, captured } = response();

    await handler(request("PUT", {
      userId: MEMBER_ID,
      grantTestCredits: 50_001,
      idempotencyKey: "00000000-0000-4000-8000-000000000030",
    }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "test_credit_grant_out_of_range" });
    expect(mocks.grantManualTestCredits).not.toHaveBeenCalled();
  });
});

describe("workspace member budgets", () => {
  // 2026-09-14 deep-dive API-6: one page of 1000 was treated as the whole
  // auth directory, so members past it had no email, could not be re-invited
  // and could not be edited.
  it("finds an already registered invitee on the second directory page", async () => {
    vi.clearAllMocks();
    mocks.requireArgusAuth.mockResolvedValue({ userId: OWNER_ID, email: "owner@example.com", organizationId: ORGANIZATION_ID, role: "owner", displayName: "Owner" });
    mocks.serviceCredentials.mockReturnValue({ url: "https://database.example", key: "test-service-key" });
    mocks.createClient.mockReturnValue({
      auth: { admin: { listUsers: mocks.listUsers, getUserById: mocks.getUserById, inviteUserByEmail: mocks.inviteUserByEmail }, resend: mocks.resend },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    mocks.resend.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ data: member, error: null });
    mocks.ensureGrowthProfile.mockResolvedValue(undefined);
    mocks.ensureStartingCredits.mockResolvedValue(undefined);
    usePostCount();
    const filler = Array.from({ length: 1000 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, email: `user${index}@example.com` }));
    mocks.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
      data: { users: page === 1 ? filler : page === 2 ? [authUser(true)] : [] },
      error: null,
    }));
    const { res, captured } = response();

    await handler(request("POST", { email: EMAIL }), res);

    expect(captured.statusCode).toBe(200);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.listUsers).toHaveBeenCalledWith({ page: 2, perPage: 1000 });
    expect(captured.body).toMatchObject({ member: { email: EMAIL }, invitationSent: false });
  });

  it("edits a member by direct id lookup instead of scanning one directory page", async () => {
    vi.clearAllMocks();
    mocks.requireArgusAuth.mockResolvedValue({ userId: OWNER_ID, email: "owner@example.com", organizationId: ORGANIZATION_ID, role: "owner", displayName: "Owner" });
    mocks.serviceCredentials.mockReturnValue({ url: "https://database.example", key: "test-service-key" });
    mocks.createClient.mockReturnValue({
      auth: { admin: { listUsers: mocks.listUsers, getUserById: mocks.getUserById, inviteUserByEmail: mocks.inviteUserByEmail }, resend: mocks.resend },
      from: mocks.from,
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValue({ data: { ...member, role: "analyst" }, error: null });
    useExistingMember();
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: authUser(true) }, error: null });
    const { res, captured } = response();

    await handler(request("PUT", { userId: MEMBER_ID, role: "analyst" }), res);

    expect(captured.statusCode).toBe(200);
    expect(mocks.getUserById).toHaveBeenCalledWith(MEMBER_ID);
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({ member: { email: EMAIL, role: "analyst" } });
  });

  it("sums the append-only ledger and keeps the latest grant timestamp", () => {
    const budgets = summarizeMemberBudgets([
      { user_id: MEMBER_ID, amount_millis: 10_000, reason: "beta_start", created_at: "2026-08-01T00:00:00Z" },
      { user_id: MEMBER_ID, amount_millis: -1_000, reason: "investigation_debit", created_at: "2026-08-02T00:00:00Z" },
      { user_id: MEMBER_ID, amount_millis: 5_000, reason: "manual_adjustment", created_at: "2026-08-03T00:00:00Z" },
    ]);
    expect(budgets.get(MEMBER_ID)).toEqual({
      balance: 14,
      lastGrantAt: "2026-08-03T00:00:00Z",
    });
  });
});
