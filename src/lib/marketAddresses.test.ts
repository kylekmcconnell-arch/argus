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

// Four API routes each carried their own copy of the exchange lists, and the
// EVM deployer route's copy was the longest. Twelve custody wallets it knew
// about were absent here, so holder concentration counted exchange float as
// insider supply on any token those wallets hold. One list now, and these are
// the entries that were nearly lost when the copies were collapsed.
describe("exchange custody the concentration filter must recognise", () => {
  const MERGED_FROM_THE_DEPLOYER_ROUTE: ReadonlyArray<[string, string]> = [
    ["0x9696f59e4d72e237be84ffd425dcad154bf96976", "Binance"],
    ["0x4976a4a02f38326660d17bf34b431dc6e2eb2327", "Binance"],
    ["0x0681d8db095565fe8a346fa0277bffde9c0edbbf", "Binance"],
    ["0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0", "Coinbase"],
    ["0x3cd751e6b0078be393132286c442345e5dc49699", "Coinbase"],
    ["0xeb2629a2734e272bcc07bda959863f316f4bd4cf", "Coinbase"],
    ["0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43", "Coinbase"],
    ["0x2910543af39aba0cd09dbb2d50200b3e800a63d2", "Kraken"],
    ["0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13", "Kraken"],
    ["0x6cc5f688a315f3dc28a7781717a9a798a59fda7b", "OKX"],
    ["0x236f9f97e0e62388479bf9e5ba4889e46b0273c3", "OKX"],
    ["0x1522900b6dafac587d499a862861c0869be6e428", "Bitfinex"],
  ];

  it.each(MERGED_FROM_THE_DEPLOYER_ROUTE)("classifies %s as %s custody", (address, exchange) => {
    const seen = classifyMarketAddress(address, {});
    expect(seen).not.toBeNull();
    expect(seen?.kind).toBe("exchange");
    expect(seen?.label).toBe(exchange);
  });

  it("matches an exchange wallet whatever case it arrives in", () => {
    const mixed = "0x9696F59E4D72E237BE84FFD425DCAD154BF96976";
    expect(classifyMarketAddress(mixed, {})?.kind).toBe("exchange");
  });

  it("still refuses an address that only looks like one", () => {
    expect(classifyMarketAddress("0x9696f59e4d72e237be84ffd425dcad154bf96977", {})).toBeNull();
  });
});
