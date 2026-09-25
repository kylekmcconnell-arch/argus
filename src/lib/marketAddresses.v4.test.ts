import { describe, expect, it } from "vitest";

import { classifyMarketAddress } from "./marketAddresses";

describe("V4 pool managers and launch lockers are market contracts, not holders", () => {
  it("names the Robinhood PoolManager and lockers", () => {
    expect(classifyMarketAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951")).toEqual({ label: "Uniswap V4 PoolManager (Robinhood Chain)", kind: "pool" });
    expect(classifyMarketAddress("0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952")?.kind).toBe("locker");
    expect(classifyMarketAddress("0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f")?.label).toBe("RobinhoodLocker");
  });
  it("leaves a Robinhood-app smart account as a holder", () => {
    expect(classifyMarketAddress("0xD7733504B996265F7A20eB4359924C0c993Ff789")).toBeNull();
  });
});
