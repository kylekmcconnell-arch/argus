import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier } from "./dossier";
import { emptyEvidence } from "./evidence";
import type { EvmControlRealitySnapshot } from "./evmControlReality";

const TARGET = "0x1000000000000000000000000000000000000001";
const IMPLEMENTATION = "0x2000000000000000000000000000000000000002";
const ADMIN = "0x3000000000000000000000000000000000000003";
const OWNER = "0x4000000000000000000000000000000000000004";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;

function controlSnapshot(): EvmControlRealitySnapshot {
  return {
    schemaVersion: 1,
    state: "observed",
    chain: "ethereum",
    target: TARGET,
    mode: "point_in_time",
    scoringImpact: "none",
    capture: {
      blockNumber: 100,
      blockHash: BLOCK_HASH,
      blockTimestamp: "2026-08-01T10:00:00.000Z",
      providerHost: "rpc.test",
    },
    collection: {
      sourceClass: "direct_chain_rpc",
      rpcCalls: 12,
      modelCalls: 0,
      marginalUsd: 0,
    },
    targetCode: {
      address: TARGET,
      accountType: "contract",
      byteLength: 10,
      sha256Fingerprint: "a".repeat(64),
      receiptId: "evm-read-001",
    },
    proxy: {
      state: "standard_proxy_observed",
      indicators: ["erc_1967_implementation_slot", "erc_1967_admin_slot"],
      implementationCandidates: [{
        address: IMPLEMENTATION,
        evidence: "erc_1967_implementation_slot",
        receiptIds: ["evm-read-002", "evm-read-005"],
        code: {
          address: IMPLEMENTATION,
          accountType: "contract",
          byteLength: 8,
          sha256Fingerprint: "b".repeat(64),
          receiptId: "evm-read-005",
        },
      }],
      beacon: { address: IMPLEMENTATION, receiptId: "evm-read-003" },
      admin: { address: ADMIN, receiptId: "evm-read-004" },
    },
    ownerProbes: [{
      subject: TARGET,
      purpose: "target_owner",
      state: "observed",
      owner: OWNER,
      receiptId: "evm-read-006",
    }],
    authorities: [{
      address: ADMIN,
      relations: ["proxy_admin", "target_owner"],
      accountType: "contract",
      receiptIds: ["evm-read-004", "evm-read-007"],
      qualification: "standard_role_observation_not_complete_permission_map",
    }],
    safeCompatibleMultisigs: [{
      address: ADMIN,
      state: "observed",
      owners: [OWNER, IMPLEMENTATION],
      threshold: 2,
      receiptIds: ["evm-read-008", "evm-read-009"],
      qualification: "safe_compatible_interface_only",
    }],
    receipts: [{
      id: "evm-read-001",
      method: "eth_getCode",
      target: TARGET,
      blockNumber: 100,
      blockHash: BLOCK_HASH,
      state: "returned",
      resultSha256: "a".repeat(64),
      byteLength: 10,
    }],
    limitations: ["Custom permission paths were not assessed."],
  };
}

describe("assembleDossier EVM control reality freeze", () => {
  it("copies every nested control receipt and observation", () => {
    const evidence = emptyEvidence("@argus");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.evmControlReality = controlSnapshot();

    const dossier = assembleDossier(evidence, true);
    const frozen = dossier.evmControlReality;
    expect(frozen).toEqual(evidence.evmControlReality);
    expect(frozen).not.toBe(evidence.evmControlReality);

    evidence.evmControlReality.capture!.providerHost = "rewritten.test";
    evidence.evmControlReality.collection.rpcCalls = 0;
    evidence.evmControlReality.targetCode!.byteLength = 0;
    evidence.evmControlReality.proxy!.indicators.length = 0;
    evidence.evmControlReality.proxy!.implementationCandidates[0]!.receiptIds.length = 0;
    evidence.evmControlReality.proxy!.implementationCandidates[0]!.code!.byteLength = 0;
    evidence.evmControlReality.proxy!.beacon!.receiptId = "rewritten";
    evidence.evmControlReality.proxy!.admin!.receiptId = "rewritten";
    evidence.evmControlReality.ownerProbes[0]!.state = "malformed";
    evidence.evmControlReality.authorities[0]!.relations.length = 0;
    evidence.evmControlReality.authorities[0]!.receiptIds.length = 0;
    evidence.evmControlReality.safeCompatibleMultisigs[0]!.owners!.length = 0;
    evidence.evmControlReality.safeCompatibleMultisigs[0]!.receiptIds.length = 0;
    evidence.evmControlReality.receipts[0]!.state = "rpc_error";
    evidence.evmControlReality.limitations.length = 0;

    expect(frozen).toMatchObject({
      capture: { providerHost: "rpc.test" },
      collection: { rpcCalls: 12 },
      targetCode: { byteLength: 10 },
      proxy: {
        indicators: ["erc_1967_implementation_slot", "erc_1967_admin_slot"],
        implementationCandidates: [{
          receiptIds: ["evm-read-002", "evm-read-005"],
          code: { byteLength: 8 },
        }],
        beacon: { receiptId: "evm-read-003" },
        admin: { receiptId: "evm-read-004" },
      },
      ownerProbes: [{ state: "observed" }],
      authorities: [{
        relations: ["proxy_admin", "target_owner"],
        receiptIds: ["evm-read-004", "evm-read-007"],
      }],
      safeCompatibleMultisigs: [{
        owners: [OWNER, IMPLEMENTATION],
        receiptIds: ["evm-read-008", "evm-read-009"],
      }],
      receipts: [{ state: "returned" }],
      limitations: ["Custom permission paths were not assessed."],
    });
  });
});
