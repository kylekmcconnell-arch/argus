import { afterEach, describe, expect, it, vi } from "vitest";

import { robinhoodCreatorVenue } from "./launch";

// Regression: the v2 REST route (/api/v2/addresses/{addr}) 500s on lowercase
// addresses on Robinhood's Blockscout, and the handler lowercases everything -
// so Pons detection silently returned null for every token ($SWIRL, and likely
// the earlier KERMIT "creator not a Pons factory" read). The v1 route is
// case-tolerant and reports the deploying factory directly.

function stub(payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    // The fix must use the case-tolerant v1 route, never the v2 REST route.
    if (url.includes("/api/v2/")) return Promise.resolve(new Response('"Internal server error"', { status: 500 }));
    if (url.includes("action=getcontractcreation")) {
      return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("robinhoodCreatorVenue - factory via case-tolerant v1 route", () => {
  it("detects a Pons v2 launch from a LOWERCASE address ($SWIRL shape)", async () => {
    stub({ message: "OK", result: [{ contractCreator: "0xd4beea7980753dc38ec4659e4324d9b42d4380f9", contractFactory: "0x3711cea4feade896c913c68f01eda97cb06d1a42" }] });
    expect(await robinhoodCreatorVenue("0xff23d2eab1e714949afa26851855a0a70e51bff3")).toBe("pons");
  });

  it("detects a Pons v1 launch via the original factory", async () => {
    stub({ message: "OK", result: [{ contractCreator: "0xabc", contractFactory: "0xA5aAB3F0C6EEadf30eF1D3eB997108e976351fEB" }] });
    expect(await robinhoodCreatorVenue("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).toBe("pons");
  });

  it("returns null for a direct (EOA) deployment", async () => {
    stub({ message: "OK", result: [{ contractCreator: "0x1111111111111111111111111111111111111111", contractFactory: "" }] });
    expect(await robinhoodCreatorVenue("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).toBe(null);
  });

  it("returns null, not a throw, when Blockscout errors", async () => {
    stub("Internal server error", 500);
    expect(await robinhoodCreatorVenue("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).toBe(null);
  });
});
