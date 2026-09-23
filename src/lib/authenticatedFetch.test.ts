import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthenticatedFetch,
  shouldRevalidateSession,
  type FetchLike,
} from "./authenticatedFetch";
import { clearPanelToken, setPanelToken } from "./panelToken";

function recorder() {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  };
  return { calls, fetch };
}

describe("createAuthenticatedFetch", () => {
  it("adds the cached bearer token to same-origin API requests", async () => {
    const native = recorder();
    const fetch = createAuthenticatedFetch(
      native.fetch,
      "https://argus.example",
      () => "session-token",
    );

    await fetch("/api/session");

    expect(native.calls).toHaveLength(1);
    expect(new Headers(native.calls[0].init?.headers).get("authorization"))
      .toBe("Bearer session-token");
  });

  it("preserves a caller-supplied authorization header", async () => {
    const native = recorder();
    const fetch = createAuthenticatedFetch(
      native.fetch,
      "https://argus.example",
      () => "cached-token",
    );

    await fetch("/api/session", {
      headers: { authorization: "Bearer explicit-token" },
    });

    expect(new Headers(native.calls[0].init?.headers).get("authorization"))
      .toBe("Bearer explicit-token");
  });

  it("does not attach tokens outside the ARGUS API boundary", async () => {
    const native = recorder();
    const fetch = createAuthenticatedFetch(
      native.fetch,
      "https://argus.example",
      () => "session-token",
    );

    await fetch("/reports/123");
    await fetch("https://provider.example/api/data");

    expect(native.calls).toEqual([
      { input: "/reports/123", init: undefined },
      { input: "https://provider.example/api/data", init: undefined },
    ]);
  });

  it("passes API requests through unchanged when signed out", async () => {
    const native = recorder();
    const fetch = createAuthenticatedFetch(
      native.fetch,
      "https://argus.example",
      () => null,
    );

    await fetch("/api/health");

    expect(native.calls).toEqual([{ input: "/api/health", init: undefined }]);
  });

  it("reads the latest cached token for every request", async () => {
    const native = recorder();
    let token = "first-token";
    const fetch = createAuthenticatedFetch(
      native.fetch,
      "https://argus.example",
      () => token,
    );

    await fetch("/api/session");
    token = "refreshed-token";
    await fetch("/api/session");

    expect(native.calls.map(({ init }) => new Headers(init?.headers).get("authorization")))
      .toEqual(["Bearer first-token", "Bearer refreshed-token"]);
  });
});

describe("shouldRevalidateSession", () => {
  it("ignores repeated focus events for the validated token", () => {
    expect(shouldRevalidateSession("token-a", "token-a", null)).toBe(false);
  });

  it("coalesces repeated events while the same token is being verified", () => {
    expect(shouldRevalidateSession("token-a", null, "token-a")).toBe(false);
  });

  it("validates initial, refreshed, and signed-out session states", () => {
    expect(shouldRevalidateSession("token-a", null, null)).toBe(true);
    expect(shouldRevalidateSession("token-b", "token-a", null)).toBe(true);
    expect(shouldRevalidateSession(null, "token-a", null)).toBe(true);
  });
});

describe("panel capability attachment (#356)", () => {
  afterEach(() => clearPanelToken());

  const origin = "https://argus.example";
  const wrap = (native: FetchLike) => createAuthenticatedFetch(native, origin, () => "session-token");

  it("attaches the held capability to API calls, so paid panels are admitted", async () => {
    setPanelToken("panel-capability-abc");
    const native = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }));

    await wrap(native)(`${origin}/api/cluster?address=0xabc`);

    const headers = new Headers((native.mock.calls[0]?.[1] as RequestInit)?.headers);
    expect(headers.get("x-argus-panel-token")).toBe("panel-capability-abc");
  });

  it("never overrides a capability the caller supplied", async () => {
    // Only a component's own version-bound token names a report version for
    // cost attribution, so it must win over the ambient one.
    setPanelToken("ambient-capability");
    const native = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }));

    await wrap(native)(`${origin}/api/cluster`, { headers: { "x-argus-panel-token": "version-bound" } });

    const headers = new Headers((native.mock.calls[0]?.[1] as RequestInit)?.headers);
    expect(headers.get("x-argus-panel-token")).toBe("version-bound");
  });

  it("sends no capability header when none is held", async () => {
    const native = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }));

    await wrap(native)(`${origin}/api/cluster`);

    expect(new Headers((native.mock.calls[0]?.[1] as RequestInit)?.headers).has("x-argus-panel-token")).toBe(false);
  });

  it("leaves other origins untouched", async () => {
    setPanelToken("panel-capability-abc");
    const native = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }));

    await wrap(native)("https://elsewhere.example/api/cluster");

    expect(native).toHaveBeenCalledWith("https://elsewhere.example/api/cluster", undefined);
  });
});
