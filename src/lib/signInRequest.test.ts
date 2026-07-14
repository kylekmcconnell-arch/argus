import { describe, expect, it, vi } from "vitest";
import { requestArgusSignInLink } from "./signInRequest";

describe("requestArgusSignInLink", () => {
  it("normalizes the email and uses the server-gated sign-in endpoint", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      message: "If this email is approved, a secure sign-in link is on its way.",
    }), { status: 202, headers: { "content-type": "application/json" } }));

    await expect(requestArgusSignInLink(
      fetch,
      "  Enigma@Enigma-Fund.com  ",
      "/?version=one",
    )).resolves.toContain("secure sign-in link");

    expect(fetch).toHaveBeenCalledWith("/api/signin", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        email: "enigma@enigma-fund.com",
        returnTo: "/?version=one",
      }),
    }));
  });

  it("returns a safe generic error when the endpoint is unavailable", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 503 }));

    await expect(requestArgusSignInLink(fetch, "enigma@enigma-fund.com", "/"))
      .rejects.toThrow("The sign-in link could not be sent.");
  });
});
