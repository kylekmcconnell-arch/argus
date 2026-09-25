import { afterEach, describe, expect, it, vi } from "vitest";

import { robinhoodCreation, robinhoodCreationFromRpc } from "./launch";

afterEach(() => { vi.unstubAllGlobals(); });

const word = (addr: string) => `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}`;
const PONS_V2 = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const CREATOR = "0x5ded38b5b4cbb97a44323609156c3e182e5202ad";

function stub(opts: { index: "ok" | "429" | "html"; factory?: string }) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("blockscout")) {
      if (opts.index === "429") return new Response("Too Many Requests", { status: 429 });
      if (opts.index === "html") return new Response("<html>challenge</html>", { status: 200 });
      return new Response(JSON.stringify({ result: [{ contractFactory: PONS_V2, contractCreator: CREATOR, txHash: "0xabc" }] }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const data = body.params?.[0]?.data;
    const result = data === "0x536dac9b" ? word(opts.factory ?? PONS_V2) : data === "0xd5f39488" ? word(CREATOR) : "0x";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }));
}

describe("Robinhood creation falls back to the token's own getters", () => {
  it("uses the index when it answers", async () => {
    stub({ index: "ok" });
    expect(await robinhoodCreation("0x923d915ddf0fe60c04addac68e13f0d5af03164f")).toMatchObject({ venue: "pons", factory: PONS_V2, creator: CREATOR, txHash: "0xabc" });
  });
  it("resolves a Pons v2 token over RPC when the index is throttled or challenged", async () => {
    stub({ index: "429" });
    expect(await robinhoodCreation("0x923d915ddf0fe60c04addac68e13f0d5af03164f")).toMatchObject({ venue: "pons", factory: PONS_V2, creator: CREATOR, txHash: null });
    stub({ index: "html" });
    expect(await robinhoodCreation("0x923d915ddf0fe60c04addac68e13f0d5af03164f")).toMatchObject({ venue: "pons" });
  });
  it("does not invent a venue for a token whose launchFactory() is not a known Pons factory", async () => {
    stub({ index: "429", factory: "0x1111111111111111111111111111111111111111" });
    expect(await robinhoodCreationFromRpc("0x923d915ddf0fe60c04addac68e13f0d5af03164f")).toBeNull();
  });
});
