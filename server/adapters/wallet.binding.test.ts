import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveForHandle, resolveWalletsFromText } from "./wallet";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wallet binding provenance", () => {
  it("marks a directly published address self_disclosed", async () => {
    expect(await resolveWalletsFromText("wallet 0x1111111111111111111111111111111111111111"))
      .toEqual([expect.objectContaining({ binding: "self_disclosed" })]);
  });

  it("marks a handle-name lookup as an unconfirmed guess", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("warpcast.com")) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify([{ address: "0x2222222222222222222222222222222222222222" }]), { status: 200 });
    }));
    const wallets = await resolveForHandle("alice", "", { includePossible: true });
    expect(wallets.some((wallet) => wallet.binding === "handle_name_guess")).toBe(true);
  });
});
