import { describe, expect, it, vi } from "vitest";
import {
  collectEvmControlReality,
  collectEvmControlRealityFromTransport,
  EXPECTED_EVM_CHAIN_IDS,
  ERC1967_ADMIN_SLOT,
  ERC1967_BEACON_SLOT,
  ERC1967_IMPLEMENTATION_SLOT,
  OWNER_SELECTOR,
  PUBLIC_EVM_RPC,
  SAFE_GET_OWNERS_SELECTOR,
  SAFE_GET_THRESHOLD_SELECTOR,
  type EvmRpcReply,
  type EvmRpcTransport,
} from "./evmControlReality";

const TARGET = "0x1000000000000000000000000000000000000001";
const IMPLEMENTATION_A = "0x2000000000000000000000000000000000000002";
const IMPLEMENTATION_B = "0x3000000000000000000000000000000000000003";
const ADMIN = "0x4000000000000000000000000000000000000004";
const SAFE = "0x5000000000000000000000000000000000000005";
const OWNER_A = "0x6000000000000000000000000000000000000006";
const OWNER_B = "0x7000000000000000000000000000000000000007";
const OWNER_C = "0x8000000000000000000000000000000000000008";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const ZERO_WORD = `0x${"0".repeat(64)}`;

const word = (value: number | string): string => {
  const hex = typeof value === "number" ? value.toString(16) : value.replace(/^0x/, "");
  return hex.padStart(64, "0");
};

const addressWord = (address: string): string => `0x${word(address)}`;

const addressArray = (addresses: string[]): string =>
  `0x${word(32)}${word(addresses.length)}${addresses.map(word).join("")}`;

interface RpcCall {
  method: string;
  params: unknown[];
}

class MockRpc implements EvmRpcTransport {
  providerHost = "rpc.test";
  calls = 0;
  readonly seen: RpcCall[] = [];
  blockReads = 0;

  constructor(
    private readonly handle: (method: string, params: unknown[], self: MockRpc) => EvmRpcReply,
    private readonly chainId = "0x1",
  ) {}

  async request(method: string, params: unknown[]): Promise<EvmRpcReply> {
    this.calls += 1;
    this.seen.push({ method, params });
    if (method === "eth_chainId") return { ok: true, result: this.chainId };
    if (method === "eth_blockNumber") return { ok: true, result: "0x64" };
    if (method === "eth_getBlockByNumber") {
      this.blockReads += 1;
      return {
        ok: true,
        result: { number: "0x64", hash: BLOCK_HASH, timestamp: "0x65920080" },
      };
    }
    return this.handle(method, params, this);
  }
}

const targetOf = (params: unknown[]): string => {
  const first = params[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "to" in first) return String((first as { to: unknown }).to);
  return "";
};

const selectorOf = (params: unknown[]): string => {
  const first = params[0];
  return first && typeof first === "object" && "data" in first ? String((first as { data: unknown }).data) : "";
};

describe("point-in-time EVM control reality", () => {
  it("has an expected chain id for every configured public RPC lane", () => {
    expect(Object.keys(EXPECTED_EVM_CHAIN_IDS).sort()).toEqual(Object.keys(PUBLIC_EVM_RPC).sort());
    expect(EXPECTED_EVM_CHAIN_IDS).toEqual({
      ethereum: "0x1",
      base: "0x2105",
      bsc: "0x38",
      polygon: "0x89",
      arbitrum: "0xa4b1",
      optimism: "0xa",
      avalanche: "0xa86a",
    });
  });

  it("returns unavailable before block reads when the RPC is on a different chain", async () => {
    const rpc = new MockRpc(() => ({ ok: false, error: "must not be called" }), "0x2105");

    const snapshot = await collectEvmControlRealityFromTransport("ethereum", TARGET, rpc);

    expect(snapshot).toMatchObject({
      state: "unavailable",
      chain: "ethereum",
      chainIdentity: {
        method: "eth_chainId",
        providerHost: "rpc.test",
        expectedChain: "ethereum",
        expectedChainId: "0x1",
        observedChainId: "0x2105",
        rawResult: "0x2105",
        state: "mismatch",
      },
      collection: { rpcCalls: 1 },
      receipts: [],
    });
    expect(snapshot).not.toHaveProperty("capture");
    expect(snapshot).not.toHaveProperty("targetCode");
    expect(rpc.seen).toEqual([{ method: "eth_chainId", params: [] }]);
    expect(snapshot.note).toContain("No block or contract reads were attempted");
  });

  it("does not fall through to another endpoint after a chain mismatch", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      expect(request.method).toBe("eth_chainId");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const snapshot = await collectEvmControlReality("ethereum", TARGET, {
      fetchImpl,
      rpcUrls: ["https://wrong-chain.test", "https://must-not-be-used.test"],
    });

    expect(snapshot).toMatchObject({
      state: "unavailable",
      chainIdentity: {
        providerHost: "wrong-chain.test",
        state: "mismatch",
        observedChainId: "0x2105",
      },
      collection: { rpcCalls: 1 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never persists local paths or credentials from RPC errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("fetch failed at /Users/alice/project/.env?api_key=super-secret");
    });

    const snapshot = await collectEvmControlReality("ethereum", TARGET, {
      fetchImpl,
      rpcUrls: ["https://rpc-one.test", "https://rpc-two.test"],
    });

    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.note).toContain("RPC request failed");
    expect(snapshot.note).not.toContain("/Users/");
    expect(snapshot.note).not.toContain("super-secret");
  });

  it("returns unavailable before block reads when eth_chainId is malformed", async () => {
    const rpc = new MockRpc(() => ({ ok: false, error: "must not be called" }), "0x01");

    const snapshot = await collectEvmControlRealityFromTransport("ethereum", TARGET, rpc);

    expect(snapshot.chainIdentity).toMatchObject({
      expectedChainId: "0x1",
      rawResult: "0x01",
      state: "malformed",
    });
    expect(snapshot.state).toBe("unavailable");
    expect(rpc.seen.map((row) => row.method)).toEqual(["eth_chainId"]);
  });

  it("freezes ERC-1967 implementation and admin evidence at one verified block", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode") {
        const target = targetOf(params);
        if (target === TARGET) return { ok: true, result: "0x6000600055" };
        if (target === IMPLEMENTATION_A) return { ok: true, result: "0x6001600155" };
        if (target === ADMIN) return { ok: true, result: "0x" };
      }
      if (method === "eth_getStorageAt") {
        if (params[1] === ERC1967_IMPLEMENTATION_SLOT) return { ok: true, result: addressWord(IMPLEMENTATION_A) };
        if (params[1] === ERC1967_ADMIN_SLOT) return { ok: true, result: addressWord(ADMIN) };
        if (params[1] === ERC1967_BEACON_SLOT) return { ok: true, result: ZERO_WORD };
      }
      if (method === "eth_call" && selectorOf(params) === OWNER_SELECTOR) return { ok: true, result: ZERO_WORD };
      return { ok: false, error: "not configured" };
    });

    const snapshot = await collectEvmControlRealityFromTransport("ethereum", TARGET, rpc);

    expect(snapshot).toMatchObject({
      state: "observed",
      target: TARGET,
      capture: {
        blockNumber: 100,
        blockHash: BLOCK_HASH,
        providerHost: "rpc.test",
      },
      proxy: {
        state: "standard_proxy_observed",
        indicators: ["erc_1967_implementation_slot", "erc_1967_admin_slot"],
        admin: { address: ADMIN },
      },
      collection: { modelCalls: 0, marginalUsd: 0 },
      chainIdentity: {
        expectedChainId: "0x1",
        observedChainId: "0x1",
        rawResult: "0x1",
        state: "verified",
      },
    });
    expect(snapshot.proxy?.implementationCandidates).toEqual([
      expect.objectContaining({
        address: IMPLEMENTATION_A,
        evidence: "erc_1967_implementation_slot",
        code: expect.objectContaining({ accountType: "contract" }),
      }),
    ]);
    expect(snapshot.authorities).toEqual([
      expect.objectContaining({ address: ADMIN, relations: ["proxy_admin"], accountType: "no_code" }),
    ]);
    expect(snapshot.ownerProbes).toEqual([
      expect.objectContaining({ subject: TARGET, state: "zero_address" }),
    ]);
    for (const call of rpc.seen.filter((row) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(row.method))) {
      expect(call.params.at(-1)).toBe("0x64");
    }
    expect(rpc.blockReads).toBe(2);
  });

  it("keeps a failed owner read unavailable instead of converting it to renounced ownership", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
      if (method === "eth_getStorageAt") return { ok: true, result: ZERO_WORD };
      if (method === "eth_call") return { ok: false, error: "execution reverted" };
      return { ok: false, error: "not configured" };
    }, "0x2105");

    const snapshot = await collectEvmControlRealityFromTransport("base", TARGET, rpc);

    expect(snapshot.proxy).toMatchObject({ state: "no_standard_proxy_indicator", indicators: [] });
    expect(snapshot.ownerProbes).toEqual([
      expect.objectContaining({ state: "unavailable" }),
    ]);
    expect(snapshot.ownerProbes[0]).not.toHaveProperty("owner");
    expect(snapshot.authorities).toEqual([]);
    expect(snapshot.receipts.find((row) => row.locator === OWNER_SELECTOR)).toMatchObject({ state: "rpc_error" });
  });

  it("does not publish no standard proxy indicator when a storage read failed", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
      if (method === "eth_getStorageAt") {
        if (params[1] === ERC1967_ADMIN_SLOT) return { ok: false, error: "rate limited" };
        return { ok: true, result: ZERO_WORD };
      }
      if (method === "eth_call") return { ok: false, error: "not implemented" };
      return { ok: false, error: "not configured" };
    }, "0x2105");

    const snapshot = await collectEvmControlRealityFromTransport("base", TARGET, rpc);

    expect(snapshot.proxy).toMatchObject({ state: "standard_proxy_assessment_incomplete", indicators: [] });
    expect(snapshot.receipts.find((row) => row.locator === ERC1967_ADMIN_SLOT)).toMatchObject({ state: "rpc_error" });
  });

  it("does not publish a negative proxy result from a malformed storage word", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
      if (method === "eth_getStorageAt") {
        if (params[1] === ERC1967_IMPLEMENTATION_SLOT) return { ok: true, result: "0x1234" };
        return { ok: true, result: ZERO_WORD };
      }
      if (method === "eth_call") return { ok: false, error: "not implemented" };
      return { ok: false, error: "not configured" };
    }, "0x2105");

    const snapshot = await collectEvmControlRealityFromTransport("base", TARGET, rpc);

    expect(snapshot.proxy?.state).toBe("standard_proxy_assessment_incomplete");
  });

  it("rejects an address word whose ABI padding contains nonzero bytes", async () => {
    const nonzeroPaddedAddress = `0x${"11".repeat(12)}${IMPLEMENTATION_A.slice(2)}`;
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
      if (method === "eth_getStorageAt") {
        if (params[1] === ERC1967_IMPLEMENTATION_SLOT) return { ok: true, result: nonzeroPaddedAddress };
        return { ok: true, result: ZERO_WORD };
      }
      if (method === "eth_call" && selectorOf(params) === OWNER_SELECTOR) {
        return { ok: true, result: nonzeroPaddedAddress };
      }
      return { ok: false, error: "not configured" };
    }, "0x2105");

    const snapshot = await collectEvmControlRealityFromTransport("base", TARGET, rpc);

    expect(snapshot.proxy).toMatchObject({
      state: "standard_proxy_assessment_incomplete",
      indicators: [],
      implementationCandidates: [],
    });
    expect(snapshot.ownerProbes).toEqual([
      expect.objectContaining({ state: "malformed" }),
    ]);
    expect(snapshot.authorities).toEqual([]);
  });

  it("reports a valid multisig threshold only as a Safe-compatible interface observation", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode") {
        if (targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
        if (targetOf(params) === SAFE) return { ok: true, result: "0x60016001" };
      }
      if (method === "eth_getStorageAt") return { ok: true, result: ZERO_WORD };
      if (method === "eth_call") {
        const target = targetOf(params);
        const selector = selectorOf(params);
        if (target === TARGET && selector === OWNER_SELECTOR) return { ok: true, result: addressWord(SAFE) };
        if (target === SAFE && selector === SAFE_GET_OWNERS_SELECTOR) {
          return { ok: true, result: addressArray([OWNER_A, OWNER_B, OWNER_C]) };
        }
        if (target === SAFE && selector === SAFE_GET_THRESHOLD_SELECTOR) return { ok: true, result: `0x${word(2)}` };
      }
      return { ok: false, error: "not configured" };
    }, "0xa4b1");

    const snapshot = await collectEvmControlRealityFromTransport("arbitrum", TARGET, rpc);

    expect(snapshot.authorities).toEqual([
      expect.objectContaining({ address: SAFE, relations: ["target_owner"], accountType: "contract" }),
    ]);
    expect(snapshot.safeCompatibleMultisigs).toEqual([{
      address: SAFE,
      state: "observed",
      owners: [OWNER_A, OWNER_B, OWNER_C],
      threshold: 2,
      receiptIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
      qualification: "safe_compatible_interface_only",
    }]);
  });

  it("withholds a multisig claim when owner and threshold responses are inconsistent", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode") {
        if (targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
        if (targetOf(params) === SAFE) return { ok: true, result: "0x60016001" };
      }
      if (method === "eth_getStorageAt") return { ok: true, result: ZERO_WORD };
      if (method === "eth_call") {
        const target = targetOf(params);
        const selector = selectorOf(params);
        if (target === TARGET && selector === OWNER_SELECTOR) return { ok: true, result: addressWord(SAFE) };
        if (target === SAFE && selector === SAFE_GET_OWNERS_SELECTOR) return { ok: true, result: addressArray([OWNER_A, OWNER_B]) };
        if (target === SAFE && selector === SAFE_GET_THRESHOLD_SELECTOR) return { ok: true, result: `0x${word(3)}` };
      }
      return { ok: false, error: "not configured" };
    }, "0xa");

    const snapshot = await collectEvmControlRealityFromTransport("optimism", TARGET, rpc);

    expect(snapshot.safeCompatibleMultisigs).toEqual([
      expect.objectContaining({ address: SAFE, state: "malformed" }),
    ]);
    expect(snapshot.safeCompatibleMultisigs[0]).not.toHaveProperty("owners");
    expect(snapshot.safeCompatibleMultisigs[0]).not.toHaveProperty("threshold");
  });

  it("preserves conflicting proxy implementation receipts instead of selecting one", async () => {
    const minimalRuntime = `0x363d3d373d3d3d363d73${IMPLEMENTATION_A.slice(2)}5af43d82803e903d91602b57fd5bf3`;
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode") {
        const target = targetOf(params);
        if (target === TARGET) return { ok: true, result: minimalRuntime };
        if (target === IMPLEMENTATION_A || target === IMPLEMENTATION_B) return { ok: true, result: "0x60006000" };
      }
      if (method === "eth_getStorageAt") {
        if (params[1] === ERC1967_IMPLEMENTATION_SLOT) return { ok: true, result: addressWord(IMPLEMENTATION_B) };
        return { ok: true, result: ZERO_WORD };
      }
      if (method === "eth_call") return { ok: false, error: "not implemented" };
      return { ok: false, error: "not configured" };
    }, "0x89");

    const snapshot = await collectEvmControlRealityFromTransport("polygon", TARGET, rpc);

    expect(snapshot.proxy?.state).toBe("conflicting_implementation_candidates");
    expect(snapshot.proxy?.implementationCandidates.map((row) => [row.address, row.evidence])).toEqual([
      [IMPLEMENTATION_A, "eip_1167_runtime"],
      [IMPLEMENTATION_B, "erc_1967_implementation_slot"],
    ]);
  });

  it("does not extract an EIP-1167 implementation from an embedded byte sequence", async () => {
    const canonicalRuntime = `363d3d373d3d3d363d73${IMPLEMENTATION_A.slice(2)}5af43d82803e903d91602b57fd5bf3`;
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) {
        return { ok: true, result: `0x6000${canonicalRuntime}6000` };
      }
      if (method === "eth_getStorageAt") return { ok: true, result: ZERO_WORD };
      if (method === "eth_call") return { ok: false, error: "not implemented" };
      return { ok: false, error: "not configured" };
    }, "0x89");

    const snapshot = await collectEvmControlRealityFromTransport("polygon", TARGET, rpc);

    expect(snapshot.proxy).toMatchObject({
      state: "no_standard_proxy_indicator",
      indicators: [],
      implementationCandidates: [],
    });
  });

  it("rejects a capture when the block hash changes before completion", async () => {
    const changedHash = `0x${"cd".repeat(32)}`;
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) return { ok: true, result: "0x60006000" };
      if (method === "eth_getStorageAt") return { ok: true, result: ZERO_WORD };
      if (method === "eth_call") return { ok: false, error: "not implemented" };
      return { ok: false, error: "not configured" };
    });
    const originalRequest = rpc.request.bind(rpc);
    rpc.request = async (method, params) => {
      if (method === "eth_getBlockByNumber" && rpc.blockReads === 1) {
        rpc.calls += 1;
        rpc.seen.push({ method, params });
        rpc.blockReads += 1;
        return { ok: true, result: { number: "0x64", hash: changedHash, timestamp: "0x65920080" } };
      }
      return originalRequest(method, params);
    };

    await expect(collectEvmControlRealityFromTransport("ethereum", TARGET, rpc))
      .rejects.toThrow("capture block changed during collection");
  });

  it("records a verified no-code result as not_contract", async () => {
    const rpc = new MockRpc((method, params) => {
      if (method === "eth_getCode" && targetOf(params) === TARGET) return { ok: true, result: "0x" };
      return { ok: false, error: "not configured" };
    });

    const snapshot = await collectEvmControlRealityFromTransport("ethereum", TARGET, rpc);

    expect(snapshot).toMatchObject({
      state: "not_contract",
      targetCode: { accountType: "no_code", byteLength: 0 },
      authorities: [],
      ownerProbes: [],
    });
  });
});
