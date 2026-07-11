import { describe, expect, it } from "vitest";
import { createAuthenticatedFetch, type FetchLike } from "./authenticatedFetch";

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
