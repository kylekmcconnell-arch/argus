/**
 * Frozen direct-chain evidence about an EVM contract's standard control surface.
 *
 * This snapshot is deliberately narrower than a general smart-contract audit. It
 * records only values returned by one RPC endpoint at one verified block. Missing
 * calls remain unavailable, and the absence of a standard slot never proves that
 * a custom upgrade or permission path does not exist.
 */

export type EvmControlRealityState = "observed" | "not_contract" | "unavailable";

/**
 * Exact preflight evidence binding an RPC endpoint to the requested network.
 * Block and contract reads are forbidden unless this receipt is verified.
 */
export interface EvmChainIdentityReceipt {
  id: "evm-chain-identity";
  method: "eth_chainId";
  providerHost: string;
  expectedChain: string;
  expectedChainId: string;
  state: "verified" | "mismatch" | "rpc_error" | "malformed";
  /** Canonical lowercase JSON-RPC quantity, when decoding succeeded. */
  observedChainId?: string;
  /** Exact bounded provider response, retained so the binding is auditable. */
  rawResult?: string;
}

export type EvmControlReceiptMethod =
  | "eth_getCode"
  | "eth_getStorageAt"
  | "eth_call";

export interface EvmControlReadReceipt {
  id: string;
  method: EvmControlReceiptMethod;
  target: string;
  blockNumber: number;
  blockHash: string;
  /** Storage slot or verified function selector, when the read has one. */
  locator?: string;
  state: "returned" | "rpc_error";
  /** Kept for bounded storage words and ABI responses, never for full bytecode. */
  rawResult?: string;
  resultSha256?: string;
  byteLength?: number;
}

export interface EvmCodeObservation {
  address: string;
  /**
   * eth_getCode can distinguish deployed bytecode from no bytecode at the
   * captured block. A no-code result does not prove an EOA, one key, or one
   * human controller.
   */
  accountType: "contract" | "no_code";
  byteLength: number;
  sha256Fingerprint?: string;
  receiptId: string;
}

export type EvmImplementationEvidence =
  | "eip_1167_runtime"
  | "erc_1967_implementation_slot"
  | "erc_1967_beacon_call";

export interface EvmImplementationObservation {
  address: string;
  evidence: EvmImplementationEvidence;
  receiptIds: string[];
  /** Bounded matching runtime segment when the address was embedded in an EIP-1167 clone. */
  extractionProof?: string;
  code?: EvmCodeObservation;
}

export interface EvmProxyObservation {
  state:
    | "standard_proxy_observed"
    | "conflicting_implementation_candidates"
    | "standard_proxy_assessment_incomplete"
    | "no_standard_proxy_indicator";
  indicators: Array<
    | "eip_1167_minimal_proxy"
    | "erc_1967_implementation_slot"
    | "erc_1967_beacon_slot"
    | "erc_1967_admin_slot"
  >;
  implementationCandidates: EvmImplementationObservation[];
  beacon?: {
    address: string;
    receiptId: string;
  };
  /** The exact value in the ERC-1967 admin slot, if nonzero. */
  admin?: {
    address: string;
    receiptId: string;
  };
}

export type EvmOwnerProbePurpose =
  | "target_owner"
  | "proxy_admin_owner"
  | "beacon_owner";

export interface EvmOwnerProbe {
  subject: string;
  purpose: EvmOwnerProbePurpose;
  state: "observed" | "zero_address" | "unavailable" | "malformed";
  owner?: string;
  receiptId: string;
}

export type EvmAuthorityRelation =
  | "target_owner"
  | "proxy_admin"
  | "proxy_admin_owner"
  | "beacon_owner";

export interface EvmAuthorityObservation {
  address: string;
  relations: EvmAuthorityRelation[];
  accountType: "contract" | "no_code" | "unknown";
  receiptIds: string[];
  /** owner() is a named role, not proof that every privileged path was found. */
  qualification: "standard_role_observation_not_complete_permission_map";
}

export interface EvmSafeCompatibleMultisigObservation {
  address: string;
  state: "observed" | "unavailable" | "malformed";
  owners?: string[];
  threshold?: number;
  receiptIds: string[];
  /**
   * A valid getOwners()/getThreshold() response is interface evidence only. It
   * does not authenticate a deployment as an official Safe contract.
   */
  qualification: "safe_compatible_interface_only";
}

export interface EvmControlRealitySnapshot {
  schemaVersion: 1;
  state: EvmControlRealityState;
  chain: string;
  target: string;
  mode: "point_in_time";
  scoringImpact: "none";
  chainIdentity?: EvmChainIdentityReceipt;
  capture?: {
    blockNumber: number;
    blockHash: string;
    blockTimestamp: string;
    providerHost: string;
  };
  collection: {
    sourceClass: "direct_chain_rpc";
    rpcCalls: number;
    modelCalls: 0;
    marginalUsd: 0;
  };
  targetCode?: EvmCodeObservation;
  proxy?: EvmProxyObservation;
  ownerProbes: EvmOwnerProbe[];
  authorities: EvmAuthorityObservation[];
  safeCompatibleMultisigs: EvmSafeCompatibleMultisigObservation[];
  receipts: EvmControlReadReceipt[];
  limitations: string[];
  note?: string;
}

/**
 * Copy every nested collection before a control snapshot crosses the immutable
 * report boundary. The collector keeps assembling arrays in memory, so a
 * shallow spread would let later mutation rewrite a persisted report.
 */
export function cloneEvmControlRealitySnapshot(
  snapshot: EvmControlRealitySnapshot,
): EvmControlRealitySnapshot {
  return {
    ...snapshot,
    ...(snapshot.chainIdentity ? { chainIdentity: { ...snapshot.chainIdentity } } : {}),
    ...(snapshot.capture ? { capture: { ...snapshot.capture } } : {}),
    collection: { ...snapshot.collection },
    ...(snapshot.targetCode ? { targetCode: { ...snapshot.targetCode } } : {}),
    ...(snapshot.proxy ? {
      proxy: {
        ...snapshot.proxy,
        indicators: [...snapshot.proxy.indicators],
        implementationCandidates: snapshot.proxy.implementationCandidates.map((candidate) => ({
          ...candidate,
          receiptIds: [...candidate.receiptIds],
          ...(candidate.code ? { code: { ...candidate.code } } : {}),
        })),
        ...(snapshot.proxy.beacon ? { beacon: { ...snapshot.proxy.beacon } } : {}),
        ...(snapshot.proxy.admin ? { admin: { ...snapshot.proxy.admin } } : {}),
      },
    } : {}),
    ownerProbes: snapshot.ownerProbes.map((probe) => ({ ...probe })),
    authorities: snapshot.authorities.map((authority) => ({
      ...authority,
      relations: [...authority.relations],
      receiptIds: [...authority.receiptIds],
    })),
    safeCompatibleMultisigs: snapshot.safeCompatibleMultisigs.map((multisig) => ({
      ...multisig,
      ...(multisig.owners ? { owners: [...multisig.owners] } : {}),
      receiptIds: [...multisig.receiptIds],
    })),
    receipts: snapshot.receipts.map((receipt) => ({ ...receipt })),
    limitations: [...snapshot.limitations],
  };
}
