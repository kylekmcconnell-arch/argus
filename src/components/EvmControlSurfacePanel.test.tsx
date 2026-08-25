// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvmControlRealitySnapshot } from "../data/evmControlReality";
import type { Dossier } from "../data/dossier";
import type { Investigation } from "../lib/investigation";
import type { TokenDossier } from "../token/audit";
import { buildReport, SUBJECTS } from "../data/subjects";
import { SubjectClass } from "../engine";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../auth-context", () => ({ useArgusAuth: () => ({ role: "owner" }) }));
vi.mock("../lib/useArkhamLabels", () => ({ useArkhamLabels: () => ({ labels: {}, state: "idle" }) }));
vi.mock("../graph/store", () => ({ getContributions: () => [], investigationContribution: () => null }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./ProjectLinks", () => ({ ProjectLinks: () => null }));
vi.mock("./MethodologyChecklist", () => ({ MethodologyChecklist: () => null }));
vi.mock("./ArkhamName", () => ({ ArkhamName: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./ArgusEyeAssistant", () => ({ ArgusEyeAssistant: () => null }));
vi.mock("./ArkhamGraphBridge", () => ({ ArkhamGraphBridge: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: () => null }));
vi.mock("./RiskPaths", () => ({ RiskPaths: () => null }));
vi.mock("./Holdings", () => ({ Holdings: () => null }));
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: () => null }));
vi.mock("./TokenSparkline", () => ({ TokenSparkline: () => null }));
vi.mock("./NamesakeCheck", () => ({ NamesakeCheck: () => null }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => null }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("./SnapshotEvidenceControl", () => ({
  LiveSupplementalNotice: () => null,
  SnapshotEvidenceControl: () => null,
}));
vi.mock("./SanctionsNameScreen", () => ({ SanctionsNameScreen: () => null }));
vi.mock("./LegalScreen", () => ({ LegalScreen: () => null }));
vi.mock("./PfpCheck", () => ({ PfpCheck: () => null, PfpAvatar: () => null }));
vi.mock("./PersonGithub", () => ({ PersonGithub: () => null }));
vi.mock("./VcReport", () => ({ VcReport: () => null }));
vi.mock("./KolReport", () => ({ KolReport: () => null }));
vi.mock("./ProjectIntel", () => ({ ProjectIntel: () => null }));
vi.mock("./NewsSection", () => ({ NewsSection: () => null }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: () => null }));

import { EvmControlSurfacePanel } from "./EvmControlSurfacePanel";
import { InvestigationReport } from "./InvestigationReport";
import { Report } from "./Report";

const TARGET = "0x1000000000000000000000000000000000000001";
const IMPLEMENTATION = "0x2000000000000000000000000000000000000002";
const BEACON = "0x3000000000000000000000000000000000000003";
const ADMIN = "0x4000000000000000000000000000000000000004";
const OWNER_A = "0x5000000000000000000000000000000000000005";
const OWNER_B = "0x6000000000000000000000000000000000000006";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;

function controlSnapshot(): EvmControlRealitySnapshot {
  return {
    schemaVersion: 1,
    state: "observed",
    chain: "ethereum",
    target: TARGET,
    mode: "point_in_time",
    scoringImpact: "none",
    chainIdentity: {
      id: "evm-chain-identity",
      method: "eth_chainId",
      providerHost: "rpc.saved.test",
      expectedChain: "ethereum",
      expectedChainId: "0x1",
      state: "verified",
      observedChainId: "0x1",
      rawResult: "0x1",
    },
    capture: {
      blockNumber: 22_345_678,
      blockHash: BLOCK_HASH,
      blockTimestamp: "2026-08-01T10:00:00.000Z",
      providerHost: "rpc.saved.test",
    },
    collection: {
      sourceClass: "direct_chain_rpc",
      rpcCalls: 14,
      modelCalls: 0,
      marginalUsd: 0,
    },
    targetCode: {
      address: TARGET,
      accountType: "contract",
      byteLength: 1_248,
      sha256Fingerprint: "a".repeat(64),
      receiptId: "evm-read-code-target",
    },
    proxy: {
      state: "standard_proxy_observed",
      indicators: ["erc_1967_implementation_slot", "erc_1967_beacon_slot", "erc_1967_admin_slot"],
      implementationCandidates: [{
        address: IMPLEMENTATION,
        evidence: "erc_1967_implementation_slot",
        receiptIds: ["evm-read-implementation-slot", "evm-read-code-implementation"],
        code: {
          address: IMPLEMENTATION,
          accountType: "contract",
          byteLength: 9_500,
          sha256Fingerprint: "b".repeat(64),
          receiptId: "evm-read-code-implementation",
        },
      }],
      beacon: { address: BEACON, receiptId: "evm-read-beacon-slot" },
      admin: { address: ADMIN, receiptId: "evm-read-admin-slot" },
    },
    ownerProbes: [{
      subject: TARGET,
      purpose: "target_owner",
      state: "observed",
      owner: ADMIN,
      receiptId: "evm-read-target-owner",
    }],
    authorities: [{
      address: ADMIN,
      relations: ["proxy_admin", "target_owner"],
      accountType: "contract",
      receiptIds: ["evm-read-admin-slot", "evm-read-target-owner", "evm-read-code-admin"],
      qualification: "standard_role_observation_not_complete_permission_map",
    }],
    safeCompatibleMultisigs: [{
      address: ADMIN,
      state: "observed",
      owners: [OWNER_A, OWNER_B],
      threshold: 2,
      receiptIds: ["evm-read-safe-owners", "evm-read-safe-threshold"],
      qualification: "safe_compatible_interface_only",
    }],
    receipts: [{
      id: "evm-read-code-target",
      method: "eth_getCode",
      target: TARGET,
      blockNumber: 22_345_678,
      blockHash: BLOCK_HASH,
      state: "returned",
      resultSha256: "a".repeat(64),
      byteLength: 1_248,
    }, {
      id: "evm-read-implementation-slot",
      method: "eth_getStorageAt",
      target: TARGET,
      blockNumber: 22_345_678,
      blockHash: BLOCK_HASH,
      locator: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      state: "returned",
      rawResult: `0x${"00".repeat(12)}${IMPLEMENTATION.slice(2)}`,
      resultSha256: "c".repeat(64),
      byteLength: 32,
    }],
    limitations: [
      "Custom permission paths were not assessed.",
      "A standard owner response is not a complete role enumeration.",
    ],
    note: "Fixed-block standard interface capture completed.",
  };
}

function token(): TokenDossier {
  return {
    address: TARGET,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "ARG",
    name: "Argus",
    verdict: "PASS",
    score: 88,
    capApplied: null,
    headline: "Saved control surface integration test",
    axes: [],
    safety: { available: false, simChecked: false } as TokenDossier["safety"],
    socials: [],
    projectX: null,
    deployer: null,
    topHolders: [],
    insiderPct: 0,
    bundleCount: 0,
    bundleRisk: "low",
    cg: null,
    graph: { nodes: [], edges: [] },
    findings: [],
    trace: [],
    live: false,
    safetyChecked: false,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EVM control surface saved snapshot", () => {
  it("shows the exact fixed-block identity, bytecode, paths, authority responses, receipts, and limits without fetching", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    act(() => root.render(<EvmControlSurfacePanel snapshot={controlSnapshot()} />));

    const panel = container.querySelector('[data-testid="evm-control-surface"]');
    expect(panel?.textContent).toContain("ethereum");
    expect(panel?.textContent).toContain(TARGET);
    expect(panel?.textContent).toContain("22,345,678");
    expect(panel?.textContent).toContain(BLOCK_HASH);
    expect(panel?.textContent).toContain("Aug 1, 2026");
    expect(panel?.textContent).toContain("rpc.saved.test");
    expect(panel?.textContent).toContain("1,248");
    expect(panel?.textContent).toContain("a".repeat(64));
    expect(panel?.textContent).toContain(IMPLEMENTATION);
    expect(panel?.textContent).toContain(BEACON);
    expect(panel?.textContent).toContain(ADMIN);
    expect(panel?.textContent).toContain(OWNER_A);
    expect(panel?.textContent).toContain(OWNER_B);
    expect(panel?.textContent).toContain("getThreshold() response");
    expect(panel?.textContent).toContain("evm-read-implementation-slot");
    expect(panel?.textContent).toContain("Custom permission paths were not assessed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps dense evidence in native disclosures and states the inference boundaries", () => {
    act(() => root.render(<EvmControlSurfacePanel snapshot={controlSnapshot()} />));

    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(4);
    expect([...details].every((node) => !node.hasAttribute("open"))).toBe(true);
    expect(container.querySelector('[data-testid="proxy-observations"] > summary')?.textContent).toContain("Standard proxy");
    expect(container.querySelector('[data-testid="authority-observations"] > summary')?.textContent).toContain("Authority addresses");
    expect(container.querySelector('[data-testid="safe-compatible-observations"] > summary')?.textContent).toContain("Safe-compatible");
    expect(container.querySelector('[data-testid="control-receipt-ledger"] > summary')?.textContent).toContain("receipt ledger");
    expect(container.textContent).toContain("do not establish an EOA");
    expect(container.textContent).toContain("not a complete permission map");
    expect(container.textContent).toContain("does not authenticate an official Safe deployment");
    expect(container.textContent).toContain("does not establish immutability");
  });

  it("renders the persisted control snapshot and jump link in the standalone project report", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier: Dossier = {
      ...base,
      evmControlReality: controlSnapshot(),
      report: {
        ...base.report,
        roles: [SubjectClass.PROJECT],
        governing_role: SubjectClass.PROJECT,
      },
    };

    act(() => root.render(<Report dossier={dossier} onReset={() => {}} />));

    expect(container.querySelector('a[href="#evm-control-surface"]')?.textContent).toContain("Control surface");
    expect(container.querySelectorAll('[data-testid="evm-control-surface"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="evm-control-surface"]')?.textContent).toContain(TARGET);
  });

  it("renders the embedded project account control snapshot in a saved token investigation", () => {
    const projectAccount = buildReport(SUBJECTS[1]);
    projectAccount.evmControlReality = controlSnapshot();
    projectAccount.report.roles = [SubjectClass.PROJECT];
    projectAccount.report.governing_role = SubjectClass.PROJECT;
    const investigation: Investigation = {
      rootRef: TARGET,
      token: token(),
      projectX: "@argus",
      siteUrl: "https://argus.test",
      recon: null,
      projectAccount,
      founders: [],
      founderNote: "No founder identity was resolved.",
      deployerTrail: null,
      webTeam: [],
    };

    act(() => root.render(
      <InvestigationReport
        inv={investigation}
        onAudit={() => {}}
        onReset={() => {}}
        onOpenToken={() => {}}
        onOpenProjectAccount={() => {}}
      />,
    ));

    expect(container.querySelector('a[href="#evm-control-surface"]')?.textContent).toContain("Control surface");
    expect(container.querySelectorAll('[data-testid="evm-control-surface"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="evm-control-surface"]')?.textContent).toContain("rpc.saved.test");
  });
});
