import { describe, expect, it } from "vitest";
import { classifyMarketAddress } from "./marketAddresses";

// Every address here is real and was pulled from live provider responses while
// diagnosing why ARGUS reported a fresh pump.fun launch as 57% insider-held.
const LINKR_POOL = "FNZk3jfkVwd1uNn8EmNsyVxou2WpQx8BEEdGnQwv6Qkx";
const BINANCE_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DEV_WALLET = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";

describe("classifyMarketAddress", () => {
  it("knows the token's own pool is the market, not a holder", () => {
    expect(classifyMarketAddress(LINKR_POOL, { poolAddresses: [LINKR_POOL] })).toEqual({
      label: "liquidity pool",
      kind: "pool",
    });
  });

  it("knows an exchange hot wallet holds customer float", () => {
    // ARGUS named this address Binance in the deployer trail while counting it
    // as an anonymous insider wallet on BONK's holder list.
    expect(classifyMarketAddress(BINANCE_SOL)).toEqual({ label: "Binance", kind: "exchange" });
  });

  it("matches EVM custody addresses regardless of checksum casing", () => {
    expect(classifyMarketAddress("0xF977814E90DA44BFA03B6295A0616A897441ACEC")?.label).toBe("Binance");
    expect(classifyMarketAddress("0xf977814e90da44bfa03b6295a0616a897441acec")?.label).toBe("Binance");
  });

  it("leaves an ordinary wallet alone, which is the direction that must never fail", () => {
    expect(classifyMarketAddress(DEV_WALLET, { poolAddresses: [LINKR_POOL] })).toBeNull();
    expect(classifyMarketAddress("")).toBeNull();
    expect(classifyMarketAddress(undefined)).toBeNull();
  });

  it("trusts a provider's structured type but never a name that anyone can choose", () => {
    const knownAccounts = {
      [LINKR_POOL]: { name: "Pump Fun AMM", type: "AMM" },
      GYZymWPd: { name: "Streamflow Vault", type: "LOCKER" },
      // An attacker can name a withdrawable contract anything at all.
      IMPOSTOR: { name: "Uniswap V2 Locker", type: "" },
    };
    expect(classifyMarketAddress(LINKR_POOL, { knownAccounts })).toEqual({ label: "Pump Fun AMM", kind: "pool" });
    expect(classifyMarketAddress("GYZymWPd", { knownAccounts })).toEqual({ label: "Streamflow Vault", kind: "locker" });
    expect(classifyMarketAddress("IMPOSTOR", { knownAccounts })).toBeNull();
  });
});
