import { createHash } from "node:crypto";
import type {
  EvmAuthorityObservation,
  EvmAuthorityRelation,
  EvmChainIdentityReceipt,
  EvmCodeObservation,
  EvmControlReadReceipt,
  EvmControlRealitySnapshot,
  EvmImplementationObservation,
  EvmOwnerProbe,
  EvmOwnerProbePurpose,
  EvmSafeCompatibleMultisigObservation,
} from "../../src/data/evmControlReality";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HEX = /^0x[0-9a-fA-F]*$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Standard slots from ERC-1967: https://eips.ethereum.org/EIPS/eip-1967
export const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const ERC1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
export const ERC1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

// Verified ABI selectors. implementation() is required by ERC-1967 beacons.
// owner() is the ERC-173 ownership getter. The Safe-compatible functions are
// from the official Safe smart-account ABI. A valid response is not treated as
// proof that the contract is an official Safe deployment.
export const IMPLEMENTATION_SELECTOR = "0x5c60da1b";
export const OWNER_SELECTOR = "0x8da5cb5b";
export const SAFE_GET_OWNERS_SELECTOR = "0xa0e67e2b";
export const SAFE_GET_THRESHOLD_SELECTOR = "0xe75235b8";

export const PUBLIC_EVM_RPC: Readonly<Record<string, readonly string[]>> = {
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  bsc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  arbitrum: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  optimism: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  avalanche: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
};

/** Canonical EIP-155 chain identifiers for every configured direct RPC lane. */
export const EXPECTED_EVM_CHAIN_IDS: Readonly<Record<string, string>> = {
  ethereum: "0x1",
  base: "0x2105",
  bsc: "0x38",
  polygon: "0x89",
  arbitrum: "0xa4b1",
  optimism: "0xa",
  avalanche: "0xa86a",
};

export interface EvmRpcReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface EvmRpcTransport {
  providerHost: string;
  calls: number;
  request(method: string, params: unknown[]): Promise<EvmRpcReply>;
}

export interface CollectEvmControlRealityOptions {
  fetchImpl?: typeof fetch;
  rpcUrls?: readonly string[];
  timeoutMs?: number;
}

interface FrozenBlock {
  number: number;
  tag: string;
  hash: string;
  timestamp: string;
}

interface CollectorState {
  transport: EvmRpcTransport;
  block: FrozenBlock;
  receipts: EvmControlReadReceipt[];
}

const normalizeAddress = (value: string): string => value.toLowerCase();

const wordAddress = (value: string | undefined): string | null => {
  if (!value || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) return null;
  const address = `0x${value.slice(-40)}`.toLowerCase();
  return address === ZERO_ADDRESS ? null : address;
};

const hexBytes = (value: string): number => Math.max(0, (value.length - 2) / 2);

const sha256 = (value: string): string => createHash("sha256").update(value.toLowerCase()).digest("hex");

const safeError = (value: unknown): string => {
  const text = value instanceof Error ? value.message : String(value ?? "rpc error");
  if (/\bhttp\s+\d{3}\b/i.test(text)) return text.match(/\bhttp\s+\d{3}\b/i)?.[0].toLowerCase() ?? "http error";
  if (/abort|timed?\s*out|timeout/i.test(text)) return "request timed out";
  if (/malformed|invalid json|parse/i.test(text)) return "malformed RPC response";
  if (/different block|block consistency/i.test(text)) return "block consistency check failed";
  if (/missing (?:result|block)|no usable result/i.test(text)) return "RPC returned no usable result";
  if (/fetch|network|socket|connect|dns|enotfound|econn/i.test(text)) return "transport failure";
  return "RPC request failed";
};

const normalizeChainIdQuantity = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 66 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    return null;
  }
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return null;
  }
};

interface ChainIdentityCheck {
  receipt: EvmChainIdentityReceipt;
  note?: string;
}

const captureChainIdentity = async (
  chain: string,
  transport: EvmRpcTransport,
): Promise<ChainIdentityCheck> => {
  const expectedChainId = EXPECTED_EVM_CHAIN_IDS[chain];
  if (!expectedChainId) throw new Error(`No expected chain id is configured for chain '${chain}'.`);
  const base = {
    id: "evm-chain-identity" as const,
    method: "eth_chainId" as const,
    providerHost: transport.providerHost,
    expectedChain: chain,
    expectedChainId,
  };
  const reply = await transport.request("eth_chainId", []);
  if (!reply.ok) {
    return {
      receipt: { ...base, state: "rpc_error" },
      note: `RPC chain identity unavailable: eth_chainId ${safeError(reply.error)}. No block or contract reads were attempted.`,
    };
  }

  const rawResult = typeof reply.result === "string" && reply.result.length <= 128
    ? reply.result
    : undefined;
  const observedChainId = normalizeChainIdQuantity(reply.result);
  if (!observedChainId) {
    return {
      receipt: { ...base, state: "malformed", ...(rawResult !== undefined ? { rawResult } : {}) },
      note: "RPC chain identity response was malformed. No block or contract reads were attempted.",
    };
  }
  if (observedChainId !== expectedChainId) {
    return {
      receipt: { ...base, state: "mismatch", observedChainId, rawResult: rawResult! },
      note: `RPC chain identity mismatch: expected ${chain} (${expectedChainId}), received ${observedChainId} from ${transport.providerHost}. No block or contract reads were attempted.`,
    };
  }
  return {
    receipt: { ...base, state: "verified", observedChainId, rawResult: rawResult! },
  };
};

export function createHttpEvmRpcTransport(
  rpcUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 9_000,
): EvmRpcTransport {
  let calls = 0;
  const providerHost = (() => {
    try { return new URL(rpcUrl).host; } catch { return "invalid-rpc-url"; }
  })();
  return {
    providerHost,
    get calls() { return calls; },
    async request(method, params) {
      calls += 1;
      try {
        const response = await fetchImpl(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: calls, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return { ok: false, error: `http ${response.status}` };
        const body = await response.json() as { result?: unknown; error?: { message?: unknown } };
        if (body.result !== undefined && body.result !== null) return { ok: true, result: body.result };
        return { ok: false, error: typeof body.error?.message === "string" ? body.error.message : "missing result" };
      } catch (error) {
        return { ok: false, error: safeError(error) };
      }
    },
  };
}

const requiredString = async (transport: EvmRpcTransport, method: string, params: unknown[]): Promise<string> => {
  const reply = await transport.request(method, params);
  if (!reply.ok || typeof reply.result !== "string") throw new Error(`${method}: ${reply.error ?? "missing result"}`);
  return reply.result;
};

const captureBlock = async (transport: EvmRpcTransport): Promise<FrozenBlock> => {
  const tag = await requiredString(transport, "eth_blockNumber", []);
  if (!/^0x[0-9a-fA-F]+$/.test(tag)) throw new Error("eth_blockNumber: malformed block number");
  const reply = await transport.request("eth_getBlockByNumber", [tag, false]);
  if (!reply.ok || reply.result == null) throw new Error(`eth_getBlockByNumber: ${reply.error ?? "missing block"}`);
  let block: { number?: unknown; hash?: unknown; timestamp?: unknown };
  try {
    block = typeof reply.result === "string"
      ? JSON.parse(reply.result) as typeof block
      : reply.result as typeof block;
  } catch { throw new Error("eth_getBlockByNumber: malformed block"); }
  if (typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) throw new Error("eth_getBlockByNumber: malformed block hash");
  if (typeof block.timestamp !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("eth_getBlockByNumber: malformed timestamp");
  const number = Number.parseInt(tag.slice(2), 16);
  const timestampSeconds = Number.parseInt(block.timestamp.slice(2), 16);
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestampSeconds)) throw new Error("eth_getBlockByNumber: unsafe numeric field");
  if (typeof block.number === "string" && Number.parseInt(block.number.slice(2), 16) !== number) {
    throw new Error("eth_getBlockByNumber: returned a different block number");
  }
  return {
    number,
    tag: `0x${number.toString(16)}`,
    hash: block.hash.toLowerCase(),
    timestamp: new Date(timestampSeconds * 1_000).toISOString(),
  };
};

const verifyBlock = async (transport: EvmRpcTransport, block: FrozenBlock): Promise<void> => {
  const reply = await transport.request("eth_getBlockByNumber", [block.tag, false]);
  if (!reply.ok || reply.result == null) throw new Error("capture block could not be verified");
  let current: { hash?: unknown };
  try {
    current = typeof reply.result === "string"
      ? JSON.parse(reply.result) as typeof current
      : reply.result as typeof current;
  } catch { throw new Error("capture block verification was malformed"); }
  if (typeof current.hash !== "string" || current.hash.toLowerCase() !== block.hash) {
    throw new Error("capture block changed during collection");
  }
};

const addReceipt = (
  state: CollectorState,
  input: Omit<EvmControlReadReceipt, "id" | "blockNumber" | "blockHash">,
): EvmControlReadReceipt => {
  const receipt: EvmControlReadReceipt = {
    id: `evm-read-${String(state.receipts.length + 1).padStart(3, "0")}`,
    blockNumber: state.block.number,
    blockHash: state.block.hash,
    ...input,
  };
  state.receipts.push(receipt);
  return receipt;
};

const read = async (
  state: CollectorState,
  method: EvmControlReadReceipt["method"],
  target: string,
  params: unknown[],
  locator?: string,
  keepRaw = true,
): Promise<{ result: string | null; receipt: EvmControlReadReceipt }> => {
  const reply = await state.transport.request(method, params);
  if (!reply.ok || typeof reply.result !== "string" || !HEX.test(reply.result)) {
    return {
      result: null,
      receipt: addReceipt(state, { method, target, locator, state: "rpc_error" }),
    };
  }
  const result = reply.result.toLowerCase();
  const bytes = hexBytes(result);
  return {
    result,
    receipt: addReceipt(state, {
      method,
      target,
      locator,
      state: "returned",
      ...(keepRaw && bytes <= 8_192 ? { rawResult: result } : {}),
      resultSha256: sha256(result),
      byteLength: bytes,
    }),
  };
};

const readCode = async (state: CollectorState, address: string): Promise<EvmCodeObservation | null> => {
  const normalized = normalizeAddress(address);
  const { result, receipt } = await read(
    state,
    "eth_getCode",
    normalized,
    [normalized, state.block.tag],
    undefined,
    false,
  );
  if (result == null) return null;
  const bytes = hexBytes(result);
  return {
    address: normalized,
    accountType: result === "0x" || bytes === 0 ? "no_code" : "contract",
    byteLength: bytes,
    ...(bytes > 0 ? { sha256Fingerprint: sha256(result) } : {}),
    receiptId: receipt.id,
  };
};

const readStorageAddress = async (
  state: CollectorState,
  target: string,
  slot: string,
): Promise<{
  address: string | null;
  decodeState: "observed" | "zero_address" | "unavailable" | "malformed";
  receipt: EvmControlReadReceipt;
}> => {
  const normalized = normalizeAddress(target);
  const { result, receipt } = await read(
    state,
    "eth_getStorageAt",
    normalized,
    [normalized, slot, state.block.tag],
    slot,
  );
  if (result == null) return { address: null, decodeState: "unavailable", receipt };
  const address = wordAddress(result);
  if (address) return { address, decodeState: "observed", receipt };
  return {
    address: null,
    decodeState: /^0x0{64}$/.test(result) ? "zero_address" : "malformed",
    receipt,
  };
};

const ethCall = async (
  state: CollectorState,
  target: string,
  selector: string,
): Promise<{ result: string | null; receipt: EvmControlReadReceipt }> => {
  const normalized = normalizeAddress(target);
  return read(
    state,
    "eth_call",
    normalized,
    [{ to: normalized, data: selector }, state.block.tag],
    selector,
  );
};

const minimalProxyImplementation = (code: string | undefined): { address: string; proof: string } | null => {
  if (!code) return null;
  const match = code.toLowerCase().match(
    /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/,
  );
  return match ? { address: `0x${match[1]}`, proof: match[0] } : null;
};

const decodeAddressCall = (result: string | null): "zero" | "malformed" | string => {
  if (result == null) return "malformed";
  const address = wordAddress(result);
  if (address) return address;
  return /^0x0{64}$/.test(result) ? "zero" : "malformed";
};

const decodeUintWord = (result: string | null): number | null => {
  if (!result || !/^0x[0-9a-f]{64}$/.test(result)) return null;
  const value = Number.parseInt(result.slice(2), 16);
  return Number.isSafeInteger(value) ? value : null;
};

const decodeAddressArray = (result: string | null): string[] | null => {
  if (!result || !/^0x[0-9a-f]+$/.test(result) || (result.length - 2) % 64 !== 0) return null;
  const words = result.slice(2).match(/.{64}/g) ?? [];
  if (words.length < 2) return null;
  const offset = Number.parseInt(words[0]!, 16) / 32;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= words.length) return null;
  const length = Number.parseInt(words[offset]!, 16);
  if (!Number.isSafeInteger(length) || length < 1 || length > 50 || offset + 1 + length > words.length) return null;
  const addresses = words.slice(offset + 1, offset + 1 + length).map((word) => wordAddress(`0x${word}`));
  if (addresses.some((address) => address == null)) return null;
  const values = addresses as string[];
  return new Set(values).size === values.length ? values : null;
};

const ownerProbe = async (
  state: CollectorState,
  subject: string,
  purpose: EvmOwnerProbePurpose,
): Promise<EvmOwnerProbe> => {
  const { result, receipt } = await ethCall(state, subject, OWNER_SELECTOR);
  if (receipt.state === "rpc_error") return { subject, purpose, state: "unavailable", receiptId: receipt.id };
  const decoded = decodeAddressCall(result);
  if (decoded === "zero") return { subject, purpose, state: "zero_address", receiptId: receipt.id };
  if (decoded === "malformed") return { subject, purpose, state: "malformed", receiptId: receipt.id };
  return { subject, purpose, state: "observed", owner: decoded, receiptId: receipt.id };
};

const safeCompatibleProbe = async (
  state: CollectorState,
  address: string,
): Promise<EvmSafeCompatibleMultisigObservation> => {
  const ownersRead = await ethCall(state, address, SAFE_GET_OWNERS_SELECTOR);
  const thresholdRead = await ethCall(state, address, SAFE_GET_THRESHOLD_SELECTOR);
  const receiptIds = [ownersRead.receipt.id, thresholdRead.receipt.id];
  const qualification = "safe_compatible_interface_only" as const;
  if (ownersRead.receipt.state === "rpc_error" || thresholdRead.receipt.state === "rpc_error") {
    return { address, state: "unavailable", receiptIds, qualification };
  }
  const owners = decodeAddressArray(ownersRead.result);
  const threshold = decodeUintWord(thresholdRead.result);
  if (!owners || threshold == null || threshold < 1 || threshold > owners.length) {
    return { address, state: "malformed", receiptIds, qualification };
  }
  return { address, state: "observed", owners, threshold, receiptIds, qualification };
};

const mergeAuthorities = (
  rows: Array<{ address: string; relation: EvmAuthorityRelation; receiptId: string }>,
  codeByAddress: Map<string, EvmCodeObservation | null>,
): EvmAuthorityObservation[] => {
  const merged = new Map<string, EvmAuthorityObservation>();
  for (const row of rows) {
    const address = normalizeAddress(row.address);
    const existing = merged.get(address);
    if (existing) {
      if (!existing.relations.includes(row.relation)) existing.relations.push(row.relation);
      if (!existing.receiptIds.includes(row.receiptId)) existing.receiptIds.push(row.receiptId);
      continue;
    }
    const code = codeByAddress.get(address);
    merged.set(address, {
      address,
      relations: [row.relation],
      accountType: code?.accountType ?? "unknown",
      receiptIds: [row.receiptId, ...(code ? [code.receiptId] : [])],
      qualification: "standard_role_observation_not_complete_permission_map",
    });
  }
  return [...merged.values()].sort((left, right) => left.address.localeCompare(right.address));
};

const unavailableSnapshot = (
  chain: string,
  target: string,
  rpcCalls: number,
  note: string,
  chainIdentity?: EvmChainIdentityReceipt,
): EvmControlRealitySnapshot => ({
  schemaVersion: 1,
  state: "unavailable",
  chain,
  target,
  mode: "point_in_time",
  scoringImpact: "none",
  ...(chainIdentity ? { chainIdentity } : {}),
  collection: { sourceClass: "direct_chain_rpc", rpcCalls, modelCalls: 0, marginalUsd: 0 },
  ownerProbes: [],
  authorities: [],
  safeCompatibleMultisigs: [],
  receipts: [],
  limitations: [
    "No direct-chain control claim was made because a block-consistent RPC capture was unavailable.",
  ],
  note,
});

export async function collectEvmControlRealityFromTransport(
  chainInput: string,
  targetInput: string,
  transport: EvmRpcTransport,
): Promise<EvmControlRealitySnapshot> {
  const chain = chainInput.trim().toLowerCase();
  const target = normalizeAddress(targetInput.trim());
  if (!EVM_ADDRESS.test(target)) throw new Error("valid EVM target address required");

  if (!EXPECTED_EVM_CHAIN_IDS[chain]) {
    return unavailableSnapshot(
      chain,
      target,
      transport.calls,
      `No expected chain id is configured for chain '${chain}'. No RPC reads were attempted.`,
    );
  }
  const chainIdentity = await captureChainIdentity(chain, transport);
  if (chainIdentity.receipt.state !== "verified") {
    return unavailableSnapshot(
      chain,
      target,
      transport.calls,
      chainIdentity.note ?? "RPC chain identity could not be verified. No block or contract reads were attempted.",
      chainIdentity.receipt,
    );
  }

  const block = await captureBlock(transport);
  const state: CollectorState = { transport, block, receipts: [] };
  const targetCodeRead = await read(
    state,
    "eth_getCode",
    target,
    [target, block.tag],
    undefined,
    false,
  );
  if (targetCodeRead.result == null) throw new Error("target bytecode read failed");
  const targetBytes = hexBytes(targetCodeRead.result);
  const targetCode: EvmCodeObservation = {
    address: target,
    accountType: targetBytes === 0 ? "no_code" : "contract",
    byteLength: targetBytes,
    ...(targetBytes > 0 ? { sha256Fingerprint: sha256(targetCodeRead.result) } : {}),
    receiptId: targetCodeRead.receipt.id,
  };

  if (targetCode.accountType === "no_code") {
    await verifyBlock(transport, block);
    return {
      schemaVersion: 1,
      state: "not_contract",
      chain,
      target,
      mode: "point_in_time",
      scoringImpact: "none",
      chainIdentity: chainIdentity.receipt,
      capture: { blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, providerHost: transport.providerHost },
      collection: { sourceClass: "direct_chain_rpc", rpcCalls: transport.calls, modelCalls: 0, marginalUsd: 0 },
      targetCode,
      ownerProbes: [],
      authorities: [],
      safeCompatibleMultisigs: [],
      receipts: state.receipts,
      limitations: ["The verified token address had no contract bytecode at the captured block."],
    };
  }

  const runtimeImplementation = minimalProxyImplementation(targetCodeRead.result);
  const implementationSlot = await readStorageAddress(state, target, ERC1967_IMPLEMENTATION_SLOT);
  const beaconSlot = await readStorageAddress(state, target, ERC1967_BEACON_SLOT);
  const adminSlot = await readStorageAddress(state, target, ERC1967_ADMIN_SLOT);

  const indicators: NonNullable<EvmControlRealitySnapshot["proxy"]>["indicators"] = [];
  const implementationCandidates: EvmImplementationObservation[] = [];
  if (runtimeImplementation) {
    indicators.push("eip_1167_minimal_proxy");
    implementationCandidates.push({
      address: runtimeImplementation.address,
      evidence: "eip_1167_runtime",
      receiptIds: [targetCodeRead.receipt.id],
      extractionProof: runtimeImplementation.proof,
    });
  }
  if (implementationSlot.address) {
    indicators.push("erc_1967_implementation_slot");
    implementationCandidates.push({
      address: implementationSlot.address,
      evidence: "erc_1967_implementation_slot",
      receiptIds: [implementationSlot.receipt.id],
    });
  }
  let beaconImplementation: string | null = null;
  let beaconImplementationReceiptId: string | null = null;
  if (beaconSlot.address) {
    indicators.push("erc_1967_beacon_slot");
    const implementationRead = await ethCall(state, beaconSlot.address, IMPLEMENTATION_SELECTOR);
    beaconImplementationReceiptId = implementationRead.receipt.id;
    beaconImplementation = wordAddress(implementationRead.result ?? undefined);
    if (beaconImplementation) {
      implementationCandidates.push({
        address: beaconImplementation,
        evidence: "erc_1967_beacon_call",
        receiptIds: [beaconSlot.receipt.id, implementationRead.receipt.id],
      });
    }
  }
  if (adminSlot.address) indicators.push("erc_1967_admin_slot");

  const uniqueImplementations = [...new Set(implementationCandidates.map((row) => row.address))];
  const implementationCode = new Map<string, EvmCodeObservation | null>();
  for (const address of uniqueImplementations.slice(0, 3)) {
    implementationCode.set(address, await readCode(state, address));
  }
  for (const row of implementationCandidates) {
    row.code = implementationCode.get(row.address) ?? undefined;
    if (row.code && !row.receiptIds.includes(row.code.receiptId)) row.receiptIds.push(row.code.receiptId);
  }

  const ownerProbes: EvmOwnerProbe[] = [await ownerProbe(state, target, "target_owner")];
  const authorityRows: Array<{ address: string; relation: EvmAuthorityRelation; receiptId: string }> = [];
  if (adminSlot.address) authorityRows.push({ address: adminSlot.address, relation: "proxy_admin", receiptId: adminSlot.receipt.id });
  const targetOwner = ownerProbes[0];
  if (targetOwner.state === "observed" && targetOwner.owner) {
    authorityRows.push({ address: targetOwner.owner, relation: "target_owner", receiptId: targetOwner.receiptId });
  }

  const codeByAddress = new Map<string, EvmCodeObservation | null>();
  for (const row of authorityRows) {
    if (!codeByAddress.has(row.address)) codeByAddress.set(row.address, await readCode(state, row.address));
  }

  if (adminSlot.address && codeByAddress.get(adminSlot.address)?.accountType === "contract") {
    const probe = await ownerProbe(state, adminSlot.address, "proxy_admin_owner");
    ownerProbes.push(probe);
    if (probe.state === "observed" && probe.owner) {
      authorityRows.push({ address: probe.owner, relation: "proxy_admin_owner", receiptId: probe.receiptId });
      if (!codeByAddress.has(probe.owner)) codeByAddress.set(probe.owner, await readCode(state, probe.owner));
    }
  }

  if (beaconSlot.address) {
    if (!codeByAddress.has(beaconSlot.address)) codeByAddress.set(beaconSlot.address, await readCode(state, beaconSlot.address));
    if (codeByAddress.get(beaconSlot.address)?.accountType === "contract") {
      const probe = await ownerProbe(state, beaconSlot.address, "beacon_owner");
      ownerProbes.push(probe);
      if (probe.state === "observed" && probe.owner) {
        authorityRows.push({ address: probe.owner, relation: "beacon_owner", receiptId: probe.receiptId });
        if (!codeByAddress.has(probe.owner)) codeByAddress.set(probe.owner, await readCode(state, probe.owner));
      }
    }
  }

  const authorities = mergeAuthorities(authorityRows, codeByAddress);
  const safeCompatibleMultisigs: EvmSafeCompatibleMultisigObservation[] = [];
  for (const authority of authorities.filter((row) => row.accountType === "contract").slice(0, 4)) {
    safeCompatibleMultisigs.push(await safeCompatibleProbe(state, authority.address));
  }

  await verifyBlock(transport, block);
  const conflicting = uniqueImplementations.length > 1;
  const standardSlotReadsComplete = [implementationSlot, beaconSlot, adminSlot]
    .every((row) => row.decodeState === "observed" || row.decodeState === "zero_address");
  const proxy = {
    state: conflicting
      ? "conflicting_implementation_candidates" as const
      : indicators.length
        ? "standard_proxy_observed" as const
        : !standardSlotReadsComplete
          ? "standard_proxy_assessment_incomplete" as const
        : "no_standard_proxy_indicator" as const,
    indicators,
    implementationCandidates,
    ...(beaconSlot.address ? { beacon: { address: beaconSlot.address, receiptId: beaconSlot.receipt.id } } : {}),
    ...(adminSlot.address ? { admin: { address: adminSlot.address, receiptId: adminSlot.receipt.id } } : {}),
  };

  const limitations = [
    "No standard proxy indicator does not prove that the contract is immutable; custom proxy and diamond patterns were not assessed.",
    "owner() probes do not enumerate role-based permissions, guardians, pausers, or off-chain signer arrangements.",
    "Safe-compatible owner and threshold responses are interface evidence only, not proof of an official Safe deployment.",
    "This frozen control snapshot does not claim that any observed authority has exercised its power.",
  ];
  if (!standardSlotReadsComplete) {
    limitations.push("At least one standard proxy storage read failed, so absence of a proxy indicator was withheld.");
  }
  if (beaconSlot.address && !beaconImplementation) {
    limitations.push(`The ERC-1967 beacon slot was observed, but implementation() was unavailable at receipt ${beaconImplementationReceiptId ?? "unknown"}.`);
  }

  return {
    schemaVersion: 1,
    state: "observed",
    chain,
    target,
    mode: "point_in_time",
    scoringImpact: "none",
    chainIdentity: chainIdentity.receipt,
    capture: { blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, providerHost: transport.providerHost },
    collection: { sourceClass: "direct_chain_rpc", rpcCalls: transport.calls, modelCalls: 0, marginalUsd: 0 },
    targetCode,
    proxy,
    ownerProbes,
    authorities,
    safeCompatibleMultisigs,
    receipts: state.receipts,
    limitations,
  };
}

export async function collectEvmControlReality(
  chainInput: string,
  targetInput: string,
  options: CollectEvmControlRealityOptions = {},
): Promise<EvmControlRealitySnapshot> {
  const chain = chainInput.trim().toLowerCase();
  const target = normalizeAddress(targetInput.trim());
  if (!EVM_ADDRESS.test(target)) throw new Error("valid EVM target address required");
  const urls = options.rpcUrls ?? PUBLIC_EVM_RPC[chain];
  if (!urls?.length) return unavailableSnapshot(chain, target, 0, `No direct RPC is configured for chain '${chain}'.`);

  let totalCalls = 0;
  let lastError = "RPC capture failed";
  let lastIdentityFailure: EvmControlRealitySnapshot | null = null;
  for (const rpcUrl of urls) {
    const transport = createHttpEvmRpcTransport(rpcUrl, options.fetchImpl, options.timeoutMs);
    try {
      const snapshot = await collectEvmControlRealityFromTransport(chain, target, transport);
      if (
        snapshot.state === "unavailable"
        && (snapshot.chainIdentity?.state === "rpc_error" || snapshot.chainIdentity?.state === "malformed")
      ) {
        totalCalls += transport.calls;
        lastError = snapshot.note ?? "RPC chain identity unavailable";
        lastIdentityFailure = snapshot;
        continue;
      }
      if (totalCalls > 0) snapshot.collection.rpcCalls += totalCalls;
      return snapshot;
    } catch (error) {
      totalCalls += transport.calls;
      lastError = safeError(error);
    }
  }
  if (lastIdentityFailure) {
    lastIdentityFailure.collection.rpcCalls = totalCalls;
    lastIdentityFailure.note = `Direct RPC capture unavailable: ${lastError}`;
    return lastIdentityFailure;
  }
  return unavailableSnapshot(chain, target, totalCalls, `Direct RPC capture unavailable: ${lastError}`);
}
