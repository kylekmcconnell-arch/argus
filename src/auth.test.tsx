// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AuthCallback = (event: string, session: { access_token: string; user: { id: string } } | null) => void;

const harness = vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  return {
    authCallback: null as AuthCallback | null,
    signOut: vi.fn(async () => ({ error: null })),
    mounts: 0,
    unmounts: 0,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (callback: AuthCallback) => {
        harness.authCallback = callback;
        return { data: { subscription: { unsubscribe: () => { harness.authCallback = null; } } } };
      },
      refreshSession: vi.fn(async () => ({ data: { session: null } })),
      signOut: harness.signOut,
      passkey: { list: vi.fn(async () => ({ data: [{ id: "passkey" }], error: null })) },
    },
  }),
}));
vi.mock("./components/PublicAccessHome", () => ({ PublicAccessHome: () => <div>PUBLIC-HOME</div> }));
vi.mock("./components/WaitlistPortal", () => ({ WaitlistPortal: () => <div>WAITLIST</div> }));
vi.mock("./components/ArgusMark", () => ({ ArgusMark: () => null }));
vi.mock("./lib/analyst", () => ({ setAnalyst: vi.fn() }));
vi.mock("./lib/signInRequest", () => ({ requestArgusSignInLink: vi.fn() }));
vi.mock("./graph/store", () => ({ clearGraphStoreForSignOut: vi.fn() }));

import { AuthGate } from "./auth";

function AppProbe() {
  useEffect(() => {
    harness.mounts += 1;
    return () => { harness.unmounts += 1; };
  }, []);
  return <div data-testid="app">APP-MOUNTED</div>;
}

const member = (id: string) => ({
  user: { id, email: `${id}@argus.example`, displayName: id },
  organizationId: "org-1",
  role: "analyst",
});

let container: HTMLDivElement;
let root: Root;
let sessionResponses: Array<() => Response>;
let sessionCalls: string[];

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function emit(event: string, token: string | null, userId = "user-a"): Promise<void> {
  await act(async () => {
    harness.authCallback?.(event, token ? { access_token: token, user: { id: userId } } : null);
  });
  await settle();
}

beforeEach(async () => {
  harness.mounts = 0;
  harness.unmounts = 0;
  sessionResponses = [];
  sessionCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/session")) {
      sessionCalls.push(String(new Headers(init?.headers).get("authorization")));
      const next = sessionResponses.shift();
      return next ? next() : new Response(JSON.stringify(member("user-a")), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AuthGate><AppProbe /></AuthGate>);
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AuthGate across access-token refreshes", () => {
  it("keeps the App mounted and re-validates in the background when the same user's token refreshes", async () => {
    await emit("SIGNED_IN", "token-a");
    expect(container.textContent).toContain("APP-MOUNTED");
    expect(harness.mounts).toBe(1);
    expect(sessionCalls).toEqual(["Bearer token-a"]);

    // Hold the second validation open to observe the gate state mid-flight.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async (input: string | URL | Request) => {
      sessionCalls.push(`deferred:${String(input)}`);
      await gate;
      return new Response(JSON.stringify(member("user-a")), { status: 200 });
    });
    await emit("TOKEN_REFRESHED", "token-b");
    expect(sessionCalls).toEqual(["Bearer token-a", "deferred:/api/session"]);
    expect(container.textContent).toContain("APP-MOUNTED");
    expect(container.textContent).not.toContain("Verifying secure access");
    release();
    await settle();

    expect(container.textContent).toContain("APP-MOUNTED");
    expect(harness.mounts).toBe(1);
    expect(harness.unmounts).toBe(0);
  });

  it("keeps the verified session when the background re-validation hits an outage", async () => {
    await emit("SIGNED_IN", "token-a");
    sessionResponses.push(() => new Response(JSON.stringify({ message: "session service unavailable" }), { status: 503 }));
    await emit("TOKEN_REFRESHED", "token-b");

    expect(container.textContent).toContain("APP-MOUNTED");
    expect(container.textContent).not.toContain("Access not provisioned");
    expect(harness.unmounts).toBe(0);
  });

  it("still withdraws access when the refreshed token is explicitly refused", async () => {
    await emit("SIGNED_IN", "token-a");
    sessionResponses.push(() => new Response(JSON.stringify({ message: "Membership revoked." }), { status: 403 }));
    await emit("TOKEN_REFRESHED", "token-b");

    expect(container.textContent).not.toContain("APP-MOUNTED");
    expect(container.textContent).toContain("Access not provisioned");
    expect(harness.unmounts).toBe(1);
  });

  it("re-gates when a different user signs in on the same tab", async () => {
    await emit("SIGNED_IN", "token-a");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await gate;
      return new Response(JSON.stringify(member("user-b")), { status: 200 });
    });
    await emit("SIGNED_IN", "token-b", "user-b");
    // Another identity is never shown the previous member's workspace.
    expect(container.textContent).not.toContain("APP-MOUNTED");
    expect(container.textContent).toContain("Verifying secure access");
    release();
    await settle();

    expect(harness.unmounts).toBe(1);
    expect(harness.mounts).toBe(2);
    expect(container.textContent).toContain("APP-MOUNTED");
  });

  it("unmounts the App on sign-out", async () => {
    await emit("SIGNED_IN", "token-a");
    await emit("SIGNED_OUT", null);
    expect(container.textContent).not.toContain("APP-MOUNTED");
    expect(harness.unmounts).toBe(1);
  });
});
