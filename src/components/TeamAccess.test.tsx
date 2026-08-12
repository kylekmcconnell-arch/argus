// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  auth: {
    role: "owner",
    user: { id: "00000000-0000-4000-8000-000000000010" },
  },
}));

vi.mock("../auth-context", () => ({
  useArgusAuth: () => harness.auth,
}));

import { TeamAccess } from "./TeamAccess";

const pendingMember = {
  userId: "00000000-0000-4000-8000-000000000020",
  email: "enigma@enigma-fund.com",
  displayName: "Enigma",
  role: "owner",
  active: true,
  emailVerified: false,
  lastSignInAt: null,
  createdAt: "2026-07-11T00:39:59.000Z",
  updatedAt: "2026-07-11T00:39:59.000Z",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TeamAccess invitation recovery", () => {
  it("shows a pending member action and resends through the owner-only API", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/members");
      if (init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({
          userId: pendingMember.userId,
          resendInvitation: true,
        });
        return new Response(JSON.stringify({
          member: pendingMember,
          invitationSent: true,
          invitationResent: true,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ members: [pendingMember], events: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<TeamAccess />));
    await vi.waitFor(() => expect(container.textContent).toContain("invitation pending"));
    const resend = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "resend invite");
    expect(resend).toBeDefined();

    await act(async () => resend?.click());
    await vi.waitFor(() => expect(container.textContent).toContain(
      "Fresh invitation sent to enigma@enigma-fund.com.",
    ));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
  });

  it("shows a confirmed account as sign-in ready until its first real session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      members: [{ ...pendingMember, emailVerified: true }],
      events: [],
    }), { status: 200 })));

    await act(async () => root.render(<TeamAccess />));
    await vi.waitFor(() => expect(container.textContent).toContain("sign-in ready"));
    expect(container.textContent).not.toContain("resend invite");
  });
});
