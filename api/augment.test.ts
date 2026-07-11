import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireArgusAuth, serviceCredentials, serviceHeaders } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn((key: string, extra?: Record<string, string>) => ({ apikey: key, ...extra })),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth, serviceCredentials, serviceHeaders }));

import handler from "./augment";

const ORG_A = "00000000-0000-4000-8000-000000000001";
const USER_A = "00000000-0000-4000-8000-000000000010";
const ITEM_ID = "00000000-0000-4000-8000-000000000101";
const ITEM_ID_2 = "00000000-0000-4000-8000-000000000102";
const EVM_ONE = "0x1111111111111111111111111111111111111111";
const EVM_TWO = "0x2222222222222222222222222222222222222222";
const SOLANA = "So11111111111111111111111111111111111111112";

function auth(role: "viewer" | "analyst" | "owner" = "viewer") {
  return {
    organizationId: ORG_A,
    userId: USER_A,
    email: "analyst@example.com",
    displayName: "Real Analyst",
    role,
  };
}

function response() {
  const captured: { status?: number; body?: unknown; allow?: string; cacheControl?: string } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "allow") captured.allow = value;
      if (name.toLowerCase() === "cache-control") captured.cacheControl = value;
      return this;
    },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function augmentationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    subject_kind: "person",
    canonical_ref: "alice",
    subject_label: "Alice",
    subject_graph_key: "@alice",
    item_type: "x",
    target_kind: "",
    relationship: "",
    value: "@target",
    label: "@target",
    url: "https://x.com/target",
    detail: "account exists",
    graph_key: "@target",
    verification_reason: "verified to exist, but not corroborated as this subject's",
    status: "pending",
    submitted_by_label: "Real Analyst",
    submitted_at: "2026-07-11T12:00:00.000Z",
    ...overrides,
  };
}

function request(method: string, body?: unknown, query: Record<string, unknown> = {}) {
  return {
    method,
    query,
    ...(body === undefined ? {} : { body }),
  } as never;
}

describe("atomic augmentation API", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset();
    serviceCredentials.mockReset();
    serviceHeaders.mockClear();
    serviceCredentials.mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.stubEnv("ARGUS_EDIT_WEBHOOK", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ARGUS_ADMIN_EMAIL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects unsupported methods before authentication", async () => {
    const { res, captured } = response();

    await handler(request("DELETE"), res as never);

    expect(captured).toMatchObject({
      status: 405,
      allow: "GET, POST, PATCH",
      body: { error: "method_not_allowed" },
    });
    expect(requireArgusAuth).not.toHaveBeenCalled();
  });

  it("lists an exact typed subject identity only within the viewer organization", async () => {
    requireArgusAuth.mockResolvedValue(auth("viewer"));
    const fetchMock = vi.fn().mockResolvedValue(json([
      augmentationRow({
        subject_kind: "token",
        canonical_ref: EVM_ONE,
        subject_label: "$TWIN",
        item_type: "contract",
        value: EVM_ONE,
        label: "$TWIN",
        graph_key: "$TWIN",
      }),
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", undefined, {
      subject: "$TWIN",
      subjectKind: "token",
      canonicalRef: EVM_ONE.toUpperCase().replace("0X", "0x"),
    }), res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "viewer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const readUrl = String(fetchMock.mock.calls[0][0]);
    expect(readUrl).toContain(`organization_id=eq.${ORG_A}`);
    expect(readUrl).toContain("subject_kind=eq.token");
    expect(readUrl).toContain(`canonical_ref=eq.${EVM_ONE}`);
    expect(readUrl).toContain("status=in.%28live%2Cpending%29");
    expect(captured).toMatchObject({
      status: 200,
      cacheControl: "private, no-store",
      body: {
        subject: "$TWIN",
        subjectKind: "token",
        canonicalRef: EVM_ONE,
        items: [expect.objectContaining({ id: ITEM_ID, canonicalRef: EVM_ONE })],
      },
    });
  });

  it("lists only pending rows for an owner organization", async () => {
    requireArgusAuth.mockResolvedValue(auth("owner"));
    const fetchMock = vi.fn().mockResolvedValue(json([augmentationRow()]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", undefined, { view: "pending" }), res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner");
    expect(String(fetchMock.mock.calls[0][0])).toContain(`organization_id=eq.${ORG_A}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("status=eq.pending");
    expect(captured).toMatchObject({
      status: 200,
      body: { ok: true, pending: [expect.objectContaining({ id: ITEM_ID, status: "pending" })] },
    });
  });

  it("lists diagnosed learnings only for an owner organization", async () => {
    requireArgusAuth.mockResolvedValue(auth("owner"));
    const fetchMock = vi.fn().mockResolvedValue(json([{
      metadata: {
        subject: "Alice",
        label: "@target",
        kind: "x",
        reason: "The X adapter missed the alias.",
        fix: "Add an exact alias search to the X adapter.",
      },
      created_at: "2026-07-11T12:30:00.000Z",
    }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", undefined, { view: "learnings" }), res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner");
    const readUrl = String(fetchMock.mock.calls[0][0]);
    expect(readUrl).toContain("/rest/v1/augmentation_events?");
    expect(readUrl).toContain(`organization_id=eq.${ORG_A}`);
    expect(readUrl).toContain("event_type=eq.augmentation.diagnosed");
    expect(captured).toMatchObject({
      status: 200,
      body: {
        ok: true,
        learnings: [expect.objectContaining({
          subject: "Alice",
          reason: "The X adapter missed the alias.",
        })],
      },
    });
  });

  it("submits a verified fact through the atomic RPC with server-owned tenant and actor attribution", async () => {
    requireArgusAuth.mockResolvedValue(auth("analyst"));
    const rpcBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://unavatar.io/x/")) return new Response(null, { status: 200 });
      if (url.endsWith("/rest/v1/rpc/submit_augmentation_item")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rpcBodies.push(body);
        return json([augmentationRow({
          subject_kind: body.p_subject_kind,
          canonical_ref: body.p_canonical_ref,
          subject_label: body.p_subject_label,
          subject_graph_key: body.p_subject_graph_key,
          item_type: body.p_item_type,
          target_kind: body.p_target_kind,
          relationship: body.p_relationship,
          value: body.p_value,
          label: body.p_label,
          graph_key: body.p_graph_key,
          verification_reason: body.p_verification_reason,
        })]);
      }
      if (url.includes("/rest/v1/augmentation_items?")) return json([]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      subject: "Alice",
      subjectKind: "person",
      canonicalRef: "@Alice",
      subjectGraphKey: "person:alice",
      type: "x",
      value: "@Target",
      by: "Spoofed Name",
    }), res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "analyst");
    expect(rpcBodies).toHaveLength(1);
    expect(rpcBodies[0]).toMatchObject({
      p_organization_id: ORG_A,
      p_actor_user_id: USER_A,
      p_subject_kind: "person",
      p_canonical_ref: "alice",
      p_subject_label: "Alice",
      p_subject_graph_key: "person:alice",
      p_item_type: "x",
      p_target_canonical_ref: "@target",
      p_value: "@Target",
      p_graph_key: "@target",
      p_auto_publish: false,
    });
    expect(rpcBodies[0]).not.toHaveProperty("by");
    expect(rpcBodies[0]).not.toHaveProperty("p_submitted_by_label");
    expect(captured).toMatchObject({
      status: 200,
      body: {
        verified: true,
        status: "pending",
        item: expect.objectContaining({ by: "Real Analyst", canonicalRef: "alice" }),
      },
    });
  });

  it("preserves the case of Solana subject and target canonical references", async () => {
    requireArgusAuth.mockResolvedValue(auth("analyst"));
    const rpcBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.dexscreener.com/")) {
        return json({ pairs: [{ chainId: "solana", baseToken: { symbol: "SOL" } }] });
      }
      if (url.endsWith("/rest/v1/rpc/submit_augmentation_item")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rpcBodies.push(body);
        return json([augmentationRow({
          subject_kind: body.p_subject_kind,
          canonical_ref: body.p_canonical_ref,
          subject_label: body.p_subject_label,
          item_type: body.p_item_type,
          value: body.p_value,
          label: body.p_label,
          graph_key: body.p_graph_key,
        })]);
      }
      if (url.includes("/rest/v1/augmentation_items?")) return json([]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      subject: "$SOL",
      subjectKind: "token",
      canonicalRef: SOLANA,
      type: "contract",
      value: SOLANA,
    }), res as never);

    expect(captured.status).toBe(200);
    expect(rpcBodies[0]).toMatchObject({
      p_subject_kind: "token",
      p_canonical_ref: SOLANA,
      p_target_canonical_ref: SOLANA,
      p_value: SOLANA,
    });
  });

  it("keeps same-ticker submissions for different contracts under distinct canonical identities", async () => {
    requireArgusAuth.mockResolvedValue(auth("analyst"));
    const rpcBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.dexscreener.com/")) {
        return json({ pairs: [{ chainId: "ethereum", baseToken: { symbol: "TWIN" } }] });
      }
      if (url.endsWith("/rest/v1/rpc/submit_augmentation_item")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rpcBodies.push(body);
        return json([augmentationRow({
          id: rpcBodies.length === 1 ? ITEM_ID : ITEM_ID_2,
          subject_kind: body.p_subject_kind,
          canonical_ref: body.p_canonical_ref,
          subject_label: body.p_subject_label,
          item_type: body.p_item_type,
          value: body.p_value,
          label: body.p_label,
          graph_key: body.p_graph_key,
        })]);
      }
      if (url.includes("/rest/v1/augmentation_items?")) return json([]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const address of [EVM_ONE, EVM_TWO]) {
      const { res, captured } = response();
      await handler(request("POST", {
        subject: "$TWIN",
        subjectKind: "token",
        canonicalRef: address,
        type: "contract",
        value: address,
      }), res as never);
      expect(captured.status).toBe(200);
    }

    expect(rpcBodies.map((body) => body.p_subject_label)).toEqual(["$TWIN", "$TWIN"]);
    expect(rpcBodies.map((body) => body.p_canonical_ref)).toEqual([EVM_ONE, EVM_TWO]);
    expect(rpcBodies.map((body) => body.p_target_canonical_ref)).toEqual([EVM_ONE, EVM_TWO]);
    expect(rpcBodies.map((body) => body.p_graph_key)).toEqual([
      `token:ethereum:${EVM_ONE}`,
      `token:ethereum:${EVM_TWO}`,
    ]);
  });

  it("rejects localhost website verification before any network or storage fetch", async () => {
    requireArgusAuth.mockResolvedValue(auth("analyst"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      subject: "argus.example",
      subjectKind: "site",
      canonicalRef: "argus.example",
      type: "website",
      value: "http://localhost:3000/admin",
    }), res as never);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured).toMatchObject({
      status: 200,
      body: { verified: false, reason: "not a public web URL" },
    });
  });

  it.each([
    ["approve", "live"],
    ["deny", "denied"],
  ])("lets an owner %s one exact tenant item through the review RPC", async (action, status) => {
    requireArgusAuth.mockResolvedValue(auth("owner"));
    const rpcBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/augmentation_items?")) return json([augmentationRow()]);
      if (url.endsWith("/rest/v1/rpc/review_augmentation_item")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rpcBodies.push(body);
        return json([augmentationRow({ status })]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", { action, id: ITEM_ID, note: "Owner decision" }), res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner");
    const loadUrl = String(fetchMock.mock.calls[0][0]);
    expect(loadUrl).toContain(`organization_id=eq.${ORG_A}`);
    expect(loadUrl).toContain(`id=eq.${ITEM_ID}`);
    expect(rpcBodies[0]).toEqual({
      p_organization_id: ORG_A,
      p_actor_user_id: USER_A,
      p_item_id: ITEM_ID,
      p_decision: action,
      p_review_note: "Owner decision",
    });
    expect(captured).toMatchObject({
      status: 200,
      body: { ok: true, action, item: expect.objectContaining({ id: ITEM_ID, status }) },
    });
  });

  it("records an owner-requested diagnosis through the atomic learning RPC", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    requireArgusAuth.mockResolvedValue(auth("owner"));
    const diagnosisBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/augmentation_items?")) return json([augmentationRow({ status: "live" })]);
      if (url === "https://api.anthropic.com/v1/messages") {
        return json({ content: [{ text: '{"reason":"Alias lookup was absent.","fix":"Add exact alias lookup."}' }] });
      }
      if (url.endsWith("/rest/v1/rpc/record_augmentation_diagnosis")) {
        diagnosisBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", { action: "diagnose", id: ITEM_ID }), res as never);

    expect(diagnosisBodies[0]).toEqual({
      p_organization_id: ORG_A,
      p_actor_user_id: USER_A,
      p_item_id: ITEM_ID,
      p_reason: "Alias lookup was absent.",
      p_fix: "Add exact alias lookup.",
    });
    expect(captured).toMatchObject({
      status: 200,
      body: {
        ok: true,
        diagnosis: { reason: "Alias lookup was absent.", fix: "Add exact alias lookup." },
      },
    });
  });

  it("returns 404 before a review RPC when the item is outside the owner organization", async () => {
    requireArgusAuth.mockResolvedValue(auth("owner"));
    const fetchMock = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", { action: "approve", id: ITEM_ID }), res as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`organization_id=eq.${ORG_A}`);
    expect(captured).toMatchObject({ status: 404, body: { error: "augmentation_not_found" } });
  });

  it("does not touch storage when authentication fails", async () => {
    requireArgusAuth.mockImplementation(async (_req, res) => {
      res.status(401).json({ error: "authentication_required" });
      return null;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", undefined, {
      subject: "Alice",
      subjectKind: "person",
      canonicalRef: "alice",
    }), res as never);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(serviceCredentials).not.toHaveBeenCalled();
    expect(captured).toMatchObject({ status: 401, body: { error: "authentication_required" } });
  });

  it("returns a storage error after authentication when service credentials are unavailable", async () => {
    requireArgusAuth.mockResolvedValue(auth("viewer"));
    serviceCredentials.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", undefined, {
      subject: "Alice",
      subjectKind: "person",
      canonicalRef: "alice",
    }), res as never);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured).toMatchObject({ status: 503, body: { error: "storage_not_configured" } });
  });
});
