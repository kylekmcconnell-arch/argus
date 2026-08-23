import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mocks = vi.hoisted(() => ({ requireArgusAuth: vi.fn() }));

vi.mock("./_auth.js", () => ({ requireArgusAuth: mocks.requireArgusAuth }));

import handler from "./changelog";

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
    setHeader: vi.fn(),
  } as unknown as VercelResponse;
  return { res, captured };
}

const request = (method = "GET") => ({ method, headers: {} }) as unknown as VercelRequest;

describe("owner changelog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "github-test-key";
    mocks.requireArgusAuth.mockResolvedValue({
      userId: "owner-1",
      email: "owner@example.com",
      organizationId: "org-1",
      role: "owner",
      displayName: "Owner",
    });
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.unstubAllGlobals();
  });

  it("requires the owner role before reading GitHub", async () => {
    mocks.requireArgusAuth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res } = response();

    await handler(request(), res);

    expect(mocks.requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "owner");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the latest main-branch commits with stable public fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      sha: "1234567890abcdef",
      author: { login: "kylekmcconnell-arch" },
      commit: {
        message: "Navigation: simplify the account rail\n\nDetails",
        author: { name: "Kyle McConnell", email: "kylekmcconnell@gmail.com", date: "2026-08-23T04:12:00Z" },
      },
    }]), { status: 200, headers: { "content-type": "application/json" } })));
    const { res, captured } = response();

    await handler(request(), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      commits: [{
        sha: "1234567",
        subject: "Navigation: simplify the account rail",
        category: "Navigation",
        author: "Kyle McConnell",
        login: "kylekmcconnell-arch",
        date: "2026-08-23T04:12:00Z",
      }],
    });
  });

  it("rejects non-GET requests without contacting GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST"), res);

    expect(captured.statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.requireArgusAuth).not.toHaveBeenCalled();
  });
});
