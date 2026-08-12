import { afterEach, describe, expect, it, vi } from "vitest";
import { collectHolderProfile } from "./tokenHolders";

const goplusBody = (over: Record<string, unknown> = {}) => ({
  result: {
    "0xabc": {
      holder_count: "370041",
      holders: [
        { address: "0x1", percent: "0.056", is_contract: 1 },
        { address: "0x2", percent: "0.04" },
        { address: "0x3", percent: "0.03" },
      ],
      lp_holders: [
        { address: "0x000000000000000000000000000000000000dead", percent: "0.6" },
        { address: "0x4", percent: "0.25", is_locked: 1 },
        { address: "0x5", percent: "0.15", is_locked: 0 },
      ],
      ...over,
    },
  },
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const notFound = () => new Response("no", { status: 404 });

/** Routes GoPlus vs the chain explorer, so a test can hold one silent and answer the other. */
const routedFetch = (routes: { goplus?: unknown; explorerMeta?: unknown; explorerHolders?: unknown }) =>
  vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("gopluslabs.io")) return jsonResponse(routes.goplus ?? goplusBody());
    if (url.includes("blockscout") && url.endsWith("/holders")) {
      return routes.explorerHolders ? jsonResponse(routes.explorerHolders) : notFound();
    }
    if (url.includes("blockscout")) return routes.explorerMeta ? jsonResponse(routes.explorerMeta) : notFound();
    throw new Error(`unexpected fetch: ${url}`);
  });

describe("collectHolderProfile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("profiles concentration and burned-or-locked liquidity from the GoPlus register", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody())));
    const out = await collectHolderProfile("Ethereum", "0xabc");
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    // 0x1 holds the most supply but is a CONTRACT, so it is not a wallet
    // holder and does not set concentration: 4% and 3% are the wallet rows.
    expect(out.value.topHolderPct).toBeCloseTo(4, 5);
    expect(out.value.top10Pct).toBeCloseTo(7, 5);
    expect(out.value.assessedWalletCount).toBe(2);
    expect(out.value.top10PctIsFloor).toBe(true);
    expect(out.value.distributionNote).toContain("floor across those assessed wallets");
    expect(out.value.holderCount).toBe(370_041);
    // 60% burned (dead address) + 25% locked; the 15% unlocked wallet does not count.
    expect(out.value.lpLockedOrBurnedPct).toBeCloseTo(85, 5);
    expect(out.value.sourceUrl).toContain("gopluslabs.io/token-security/1/0xabc");
  });

  it("returns a completed no-data outcome for an unmapped chain without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await collectHolderProfile("Solana", "So11111111111111111111111111111111111111112");
    expect(out.available).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an empty register as no-data rather than minting a zero profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ result: { "0xabc": {} } })));
    const out = await collectHolderProfile("ethereum", "0xabc");
    expect(out.available).toBe(false);
  });

  it("reads the largest holder by percent, not by position in the register", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      holders: [
        { address: "0x1", percent: "0.004" },
        { address: "0x2", percent: "0.0417" },
        { address: "0x3", percent: "0.01" },
      ],
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeCloseTo(4.17, 5);
    expect(out.value.top10Pct).toBeCloseTo(5.57, 5);
    expect(out.value.holdersAssessed).toBe(true);
    expect(out.value.distributionSource).toBe("goplus");
  });

  it("marks a complete ten-wallet aggregate as a top-10 total rather than a floor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      holders: Array.from({ length: 12 }, (_, index) => ({
        address: `0x${index + 1}`,
        percent: "0.01",
      })),
    }))));

    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.top10Pct).toBeCloseTo(10, 5);
    expect(out.value.assessedWalletCount).toBe(10);
    expect(out.value.top10PctIsFloor).toBe(false);
    expect(out.value.distributionNote).toBeNull();
  });

  it("suppresses a self-inconsistent register whose shares sum past supply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      holders: [
        { address: "0x1", percent: "0.9" },
        { address: "0x2", percent: "0.8" },
      ],
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeNull();
    expect(out.value.top10Pct).toBeNull();
    expect(out.value.holdersAssessed).toBe(false);
    expect(out.value.assessedWalletCount).toBeNull();
    expect(out.value.top10PctIsFloor).toBe(false);
    expect(out.value.distributionSource).toBeNull();
    expect(out.value.distributionNote).toMatch(/sum past/i);
    // Only the ordering is unusable: the count and the LP register still stand.
    expect(out.value.holderCount).toBe(370_041);
    expect(out.value.lpLockedOrBurnedPct).toBeCloseTo(85, 5);
  });

  it("goes silent on concentration where GoPlus does not order its register and no explorer answers", async () => {
    vi.stubGlobal("fetch", routedFetch({}));
    const out = await collectHolderProfile("robinhood", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeNull();
    expect(out.value.top10Pct).toBeNull();
    expect(out.value.holdersAssessed).toBe(false);
    expect(out.value.distributionNote).toMatch(/order/i);
    expect(out.value.holderCount).toBe(370_041);
  });

  it("takes the distribution from the chain explorer where GoPlus order is untrusted", async () => {
    vi.stubGlobal("fetch", routedFetch({
      goplus: goplusBody({ is_mintable: "1" }),
      explorerMeta: { total_supply: "1000000" },
      explorerHolders: {
        items: [
          { value: "41700", address: { hash: "0xbig", is_contract: false } },
          { value: "10000", address: { hash: "0xnext", is_contract: false } },
        ],
      },
    }));
    const out = await collectHolderProfile("robinhood", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeCloseTo(4.17, 5);
    expect(out.value.top10Pct).toBeCloseTo(5.17, 5);
    expect(out.value.holdersAssessed).toBe(true);
    expect(out.value.distributionSource).toBe("explorer");
    expect(out.value.distributionSourceUrl).toBe("https://robinhoodchain.blockscout.com/api/v2/tokens/0xabc/holders");
    expect(Date.parse(out.value.distributionCapturedAt ?? "")).not.toBeNaN();
    // Count and flags remain tied to GoPlus even though concentration does not.
    expect(out.value.holderCount).toBe(370_041);
    expect(out.value.contractFlags).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "mint_authority_active", source: "goplus" }),
    ]));
    expect(out.value.sourceUrl).toBe("https://gopluslabs.io/token-security/4663/0xabc");
    expect(Date.parse(out.value.sourceCapturedAt)).not.toBeNaN();
    expect(out.value.distributionSourceUrl).not.toBe(out.value.sourceUrl);
    // The figure is no longer GoPlus's, and the note says so.
    expect(out.value.distributionNote).toMatch(/chain explorer/i);
  });

  it("discards a holder row whose share exceeds supply rather than publishing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      holders: [{ address: "0x1", percent: "2.5" }],
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeNull();
    expect(out.value.holdersAssessed).toBe(false);
    expect(out.value.distributionNote).toMatch(/no usable share/i);
  });

  it("discards an LP row whose share exceeds the pool instead of clamping it to a full lock", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      lp_holders: [{ address: "0x9", percent: "255324.35", is_locked: 1 }],
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.lpLockedOrBurnedPct).toBeNull();
  });

  it("surfaces the deployer's honeypot history and the live contract authorities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      honeypot_with_same_creator: "1",
      is_mintable: "1",
      can_take_back_ownership: "1",
      selfdestruct: "1",
      transfer_pausable: "1",
      owner_change_balance: "1",
      owner_address: "0xowner",
      creator_address: "0xdeployer",
      creator_percent: "0.21",
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    const keys = out.value.contractFlags.map((flag) => flag.key);
    expect(keys).toContain("serial_scammer_creator");
    expect(keys).toContain("mint_authority_active");
    expect(keys).toContain("reclaimable_ownership");
    expect(keys).toContain("selfdestruct");
    expect(keys).toContain("transfer_pausable");
    expect(keys).toContain("owner_can_modify_balance");
    const balance = out.value.contractFlags.find((flag) => flag.key === "owner_can_modify_balance");
    expect(balance?.claim).toMatch(/not proof of intent/);
    const serial = out.value.contractFlags.find((flag) => flag.key === "serial_scammer_creator");
    // Worded exactly as the token lane words it, so the two lanes cannot
    // describe the same GoPlus flag differently.
    expect(serial?.claim).toBe("The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.");
    expect(serial?.tone).toBe("bad");
    expect(serial?.source).toBe("goplus");
    // A live authority is a capability, never proof of intent.
    const mint = out.value.contractFlags.find((flag) => flag.key === "mint_authority_active");
    expect(mint?.claim).toContain("Mint authority is live: supply can be minted.");
    expect(mint?.claim).toMatch(/Confirm the controller/);
    expect(mint?.tone).toBe("warn");
    expect(out.value.creatorPct).toBeCloseTo(21, 5);
    expect(out.value.contractFlags.some((flag) => flag.key === "creator_holds_supply")).toBe(true);
  });

  it("names a hidden owner as deception and does not also claim reclaimable ownership", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      hidden_owner: "1",
      can_take_back_ownership: "1",
      owner_address: "0xowner",
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    const keys = out.value.contractFlags.map((flag) => flag.key);
    expect(keys).toContain("hidden_owner");
    expect(keys).not.toContain("reclaimable_ownership");
    expect(out.value.contractFlags.find((flag) => flag.key === "hidden_owner")?.claim).toBe("Hidden owner detected.");
  });

  it("reports no flags at all when GoPlus reported none, and never a clean bill", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({ owner_address: "0x0000000000000000000000000000000000000000" }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.contractFlags).toEqual([]);
    // An unreported creator share is not a zero share.
    expect(out.value.creatorPct).toBeNull();
  });

  it("drops owner-power flags a renounced owner cannot exercise, and says so when the owner is unreported", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      owner_change_balance: "1",
      transfer_pausable: "1",
      owner_address: "0x0000000000000000000000000000000000000000",
    }))));
    const renounced = await collectHolderProfile("ethereum", "0xabc");
    if (!renounced.available) throw new Error("expected available");
    expect(renounced.value.contractFlags.map((flag) => flag.key)).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      owner_change_balance: "1",
      transfer_pausable: "1",
    }))));
    const unreported = await collectHolderProfile("ethereum", "0xabc");
    if (!unreported.available) throw new Error("expected available");
    const balance = unreported.value.contractFlags.find((flag) => flag.key === "owner_can_modify_balance");
    expect(balance?.claim).toContain("Owner can modify holder balances directly; they can zero your wallet.");
    expect(balance?.claim).toMatch(/not measured/i);
  });

  it("publishes contract flags even when the register carries no holder or liquidity rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      result: { "0xabc": { honeypot_with_same_creator: "1" } },
    })));
    const out = await collectHolderProfile("ethereum", "0xabc");
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.holdersAssessed).toBe(false);
    expect(out.value.contractFlags.map((flag) => flag.key)).toEqual(["serial_scammer_creator"]);
  });

  // The token lane measures concentration over non-contract wallets and names
  // what it excluded. Reading every row instead publishes the DEX pool as the
  // project's largest holder, which is both wrong and a different number than
  // the token report shows for the same token from the same provider.
  it("measures concentration over wallets, not the pool the token trades in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      holders: [
        { address: "0xpool", percent: "0.42", is_contract: 1, tag: "Uniswap V3: Pool" },
        { address: "0xcex", percent: "0.2", tag: "Coinbase Exchange" },
        { address: "0xlocked", percent: "0.11", is_locked: 1 },
        { address: "0xwallet", percent: "0.03" },
        { address: "0xwallet2", percent: "0.01" },
      ],
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeCloseTo(3, 5);
    expect(out.value.top10Pct).toBeCloseTo(4, 5);
    expect(out.value.distributionNote).toMatch(/pool|contract|locked/i);
  });

  it("suppresses concentration when every holder row was a contract or a pool", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      holders: [
        { address: "0xpool", percent: "0.42", is_contract: 1, tag: "Uniswap V3: Pool" },
        { address: "0xlocked", percent: "0.11", is_locked: 1 },
      ],
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    expect(out.value.holdersAssessed).toBe(false);
    expect(out.value.topHolderPct).toBeNull();
    expect(out.value.top10Pct).toBeNull();
  });

  // GoPlus's creator_address is whichever address GoPlus called the creator; on
  // a real project that is often the authority account, not the dev. This lane
  // has no deployer attribution, so it may never promote that to "Creator".
  it("never names the creator role the register did not prove", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody({
      creator_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      creator_percent: "0.26",
    }))));
    const out = await collectHolderProfile("ethereum", "0xabc");
    if (!out.available) throw new Error("expected available");
    const creator = out.value.contractFlags.find((flag) => flag.key === "creator_holds_supply");
    expect(creator?.claim).toContain("The creator or authority wallet");
    expect(creator?.claim.startsWith("Creator ")).toBe(false);
  });
});
