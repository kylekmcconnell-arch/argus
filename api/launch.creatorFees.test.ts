import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyCreatorFeeUsage, robinhoodCreatorFeeUsage, robinhoodCreatorVenue, type ClaimTrace } from "./launch";

// The fee-asset rule from the launchpad study: a venue that pays creators in
// the launched token is a note; a creator who keeps claiming the token leg
// and selling it, with nothing bought back or burned, is the warning.

const base: ClaimTrace = { claimCount: 0, claimedTokens: 0, directSold: 0, forwardedSold: 0, forwardedHeld: 0, burned: 0, boughtBack: 0, held: 0, firstClaimBlock: null, lastClaimBlock: null };

describe("classifyCreatorFeeUsage", () => {
  it("is unknown with no claims", () => {
    expect(classifyCreatorFeeUsage(base).usage).toBe("unknown");
  });

  it("calls repeated claims that are sold, directly or one hop out, a dump ($MEME shape)", () => {
    const r = classifyCreatorFeeUsage({ ...base, claimCount: 28, claimedTokens: 5_010_685, directSold: 0, forwardedSold: 5_000_000, held: 319_135 }, "MEME");
    expect(r.usage).toBe("dump");
    expect(r.note).toMatch(/28 claims of 5,010,685 MEME/);
    expect(r.note).toMatch(/one hop through fresh wallets/);
  });

  it("does not call two claims a dump even if sold - conduct needs a pattern", () => {
    expect(classifyCreatorFeeUsage({ ...base, claimCount: 2, claimedTokens: 1_000, directSold: 1_000 }).usage).toBe("unknown");
  });

  it("credits a claimer who burns the claims", () => {
    expect(classifyCreatorFeeUsage({ ...base, claimCount: 5, claimedTokens: 1_000, burned: 900 }).usage).toBe("buyback-burn");
  });

  it("credits a claimer who buys back more than they sell", () => {
    expect(classifyCreatorFeeUsage({ ...base, claimCount: 5, claimedTokens: 1_000, directSold: 200, boughtBack: 800, held: 800 }).usage).toBe("buyback");
  });

  it("reads a claimer who keeps the claims as holding", () => {
    expect(classifyCreatorFeeUsage({ ...base, claimCount: 5, claimedTokens: 1_000, held: 990 }).usage).toBe("hold");
  });
});

// A stubbed Blockscout token-transfer index in the $MEME shape: the deployer's
// own feed shows a launch buy, 28 claims in from Doppler's initializer, and a
// forward to wallet A, which sells into the PoolManager. The initializer's
// feed is deliberately NOT stubbed: the tracer must never read it.
const TOKEN = "0x385f4f8ae47651ce5f58f5265395a669f8281e18";
const INIT = "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544";
const DEP = "0xa72a5b06927badb020d235f5f43ce56507ab2399";
const A = "0x8e74a2b037d29934d12c04becccb627a7883acb7";
const POOL = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const RELAY = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const xfer = (from: string, to: string, tokens: number, blockNumber: number) => ({
  from, to, value: (BigInt(Math.round(tokens)) * 10n ** 18n).toString(), tokenDecimal: "18", blockNumber: String(blockNumber),
});
const LAUNCH_BUY = xfer(RELAY, DEP, 11_816_778, 53_697_543); // a buy BEFORE any claim: not a fee buyback
const CLAIMS = [xfer(INIT, DEP, 3_866_281, 53_800_000), ...Array.from({ length: 27 }, (_, i) => xfer(INIT, DEP, 42_385, 54_000_000 + i))];
const CLAIMED = 3_866_281 + 27 * 42_385;

function indexStub(byAddress: Record<string, unknown[]>) {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes("action=tokentx")) throw new Error(`unexpected request: ${url}`);
    const addr = new URL(url).searchParams.get("address")!.toLowerCase();
    if (addr === INIT) throw new Error("the tracer must not read the fee source's feed");
    const rows = byAddress[addr];
    if (!rows) return new Response(JSON.stringify({ status: "0", message: "No transactions found", result: [] }), { status: 200 });
    return new Response(JSON.stringify({ status: "1", message: "OK", result: rows }), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("robinhoodCreatorFeeUsage traces the claimer's feed one hop", () => {
  it("reads claims forwarded through a fresh wallet and sold as a dump ($MEME shape)", async () => {
    vi.stubGlobal("fetch", indexStub({
      [DEP]: [LAUNCH_BUY, ...CLAIMS, xfer(DEP, A, 5_000_000, 54_100_000)],
      [A]: [xfer(DEP, A, 5_000_000, 54_100_000), xfer(A, POOL, 5_000_000, 54_100_050)],
    }));
    const r = await robinhoodCreatorFeeUsage(TOKEN, [INIT], DEP, "MEME");
    expect(r?.claimer).toBe(DEP);
    expect(r?.claimCount).toBe(28);
    expect(Math.round(r!.claimedTokens)).toBe(CLAIMED);
    expect(Math.round(r!.soldTokens)).toBe(5_000_000);
    expect(r?.boughtBackTokens).toBe(0); // the launch buy predates the claims
    expect(r?.usage).toBe("dump");
    expect(r?.note).toMatch(/one hop through fresh wallets/);
  });

  it("reads a claimer that keeps every claim as holding, not dumping ($MOTION shape)", async () => {
    vi.stubGlobal("fetch", indexStub({ [DEP]: CLAIMS }));
    const r = await robinhoodCreatorFeeUsage(TOKEN, [INIT], DEP, "MOTION");
    expect(r?.usage).toBe("hold");
    expect(Math.round(r!.heldTokens)).toBe(CLAIMED);
    expect(r?.soldTokens).toBe(0);
  });

  it("credits a buy from the pool made after the claims began", async () => {
    vi.stubGlobal("fetch", indexStub({ [DEP]: [...CLAIMS, xfer(POOL, DEP, 3_000_000, 55_000_000)] }));
    const r = await robinhoodCreatorFeeUsage(TOKEN, [INIT], DEP, "MEME");
    expect(Math.round(r!.boughtBackTokens)).toBe(3_000_000);
    expect(r?.usage).toBe("buyback");
  });

  it("says no claims when the venue paid the creator nothing in the token", async () => {
    vi.stubGlobal("fetch", indexStub({ [DEP]: [LAUNCH_BUY] }));
    const r = await robinhoodCreatorFeeUsage(TOKEN, [INIT], DEP, "MEME");
    expect(r?.claimCount).toBe(0);
    expect(r?.usage).toBe("unknown");
  });

  it("returns null rather than 'no claims' when the index cannot answer, or the claimer is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 429 })));
    expect(await robinhoodCreatorFeeUsage(TOKEN, [INIT], DEP, "MEME")).toBeNull();
    expect(await robinhoodCreatorFeeUsage(TOKEN, [INIT], null, "MEME")).toBeNull();
  });

  it("uses at most one call per wallet read: the claimer plus two hops", async () => {
    const fetchMock = indexStub({ [DEP]: [...CLAIMS, xfer(DEP, A, 5_000_000, 54_100_000)], [A]: [xfer(A, POOL, 5_000_000, 54_100_050)] });
    vi.stubGlobal("fetch", fetchMock);
    await robinhoodCreatorFeeUsage(TOKEN, [INIT], DEP, "MEME");
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});

function creation(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("action=getcontractcreation")) return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    throw new Error(`unexpected request: ${url}`);
  }));
}

describe("robinhoodCreatorVenue resolves the venues the study identified", () => {
  it("names Pons v1 separately from v2, because v1 paid creators in the token", async () => {
    creation({ result: [{ contractFactory: "0xA5aAB3F0C6EEadf30eF1D3eB997108e976351fEB" }] });
    expect(await robinhoodCreatorVenue("0xb0fea401f1ee62f0e7cc3bdf94b20c25ab5117e2")).toBe("pons v1");
    creation({ result: [{ contractFactory: "0x3711cea4feade896c913c68f01eda97cb06d1a42" }] });
    expect(await robinhoodCreatorVenue("0xff23d2eab1e714949afa26851855a0a70e51bff3")).toBe("pons");
  });

  it("reports a Doppler token factory creation as doppler", async () => {
    creation({ result: [{ contractCreator: "0xa72a5b06927badb020d235f5f43ce56507ab2399", contractFactory: "0x1B37D3a72082029c44B35B604Ea473617580b69a" }] });
    expect(await robinhoodCreatorVenue("0x385f4f8ae47651ce5f58f5265395a669f8281e18")).toBe("doppler");
  });

  it("reports a StonkBrokers pad creation as stonkbrokers", async () => {
    creation({ result: [{ contractFactory: "0x4B9Dcd6CCFAeF0f6D23065Dd78E79d5E20ec8cFD" }] });
    expect(await robinhoodCreatorVenue("0x57548740ae9d73ef4b1bfa35651d5e91ed0f6666")).toBe("stonkbrokers");
  });
});
