// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Counterparties } from "./Counterparties";
import { EvmDeployer } from "./EvmDeployer";
import { GithubForensics } from "./GithubForensics";
import { HolderForensics } from "./HolderForensics";
import { Holdings } from "./Holdings";
import { IdentitySweep } from "./IdentitySweep";
import { MarketIntel } from "./MarketIntel";
import { PersonGithub } from "./PersonGithub";
import { RiskPaths } from "./RiskPaths";
import { WalletClusters } from "./WalletClusters";
import { OperatorNetwork } from "./OperatorNetwork";
import { useArkhamLabels } from "../lib/useArkhamLabels";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../graph/store", () => ({ recordForensicEntities: vi.fn() }));
vi.mock("./HolderBubbleMap", () => ({ HolderBubbleMap: () => null }));
vi.mock("./ArkhamName", () => ({ ArkhamName: () => null }));
vi.mock("./ArkhamGraphBridge", () => ({ ArkhamGraphBridge: () => null }));

const address = "0x4444444444444444444444444444444444444444";
const capability = "signed-panel-capability";
const expectedPaths = [
  "/api/cryptorank",
  "/api/arkham?",
  "/api/arkham-counterparties",
  "/api/arkham-risk-paths",
  "/api/arkham-holdings",
  "/api/evm-deployer",
  "/api/resolve-github",
  "/api/identity-sweep",
  "/api/github-forensics",
  "/api/evm-cluster",
];

function Panels({ panelCostToken }: { panelCostToken?: string }) {
  return (
    <>
      <MarketIntel symbol="ARG" contract={address} chain="ethereum" panelCostToken={panelCostToken} />
      <HolderForensics
        address={address}
        chain="ethereum"
        holderCount={1}
        evmTop={[{ pct: 1, address }]}
        insiderPct={0}
        panelCostToken={panelCostToken}
      />
      <Counterparties address={address} subject="$ARG" panelCostToken={panelCostToken} />
      <RiskPaths address={address} panelCostToken={panelCostToken} />
      <Holdings address={address} symbol="ARG" panelCostToken={panelCostToken} />
      <EvmDeployer address={address} chain="ethereum" panelCostToken={panelCostToken} />
      <PersonGithub handle="argus" panelCostToken={panelCostToken} />
      <IdentitySweep handle="argus" auto panelCostToken={panelCostToken} />
      <GithubForensics org="argus" panelCostToken={panelCostToken} />
      <WalletClusters mint={address} chain="ethereum" panelCostToken={panelCostToken} />
    </>
  );
}

function ArkhamProbe({ address: probeAddress, panelCostToken }: { address: string; panelCostToken?: string }) {
  useArkhamLabels([probeAddress], panelCostToken);
  return null;
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith("/api/identity-sweep")
      ? { available: true, priorHandles: [], footprint: [], archivedBios: [] }
      : { available: false };
    return { ok: true, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("provider panel capability boundary", () => {
  it("makes no keyed-provider request without a signed report capability", async () => {
    await act(async () => {
      root.render(<Panels />);
      await Promise.resolve();
    });

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.filter((button) => button.disabled).map((button) => button.textContent)).toEqual(
      expect.arrayContaining(["saved report required", "saved report required"]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds every automatic and on-demand keyed-provider request to the capability", async () => {
    await act(async () => {
      root.render(<Panels panelCostToken={capability} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionButtons = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => /reveal the devs|cluster/.test(button.textContent ?? ""));
    await act(async () => {
      for (const button of actionButtons) button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      headers: (init as RequestInit | undefined)?.headers,
    }));
    for (const path of expectedPaths) {
      const request = requests.find(({ url }) => url.startsWith(path));
      expect(request, `missing ${path}`).toBeDefined();
      expect(request?.headers).toEqual({
        "x-argus-panel-context": "required",
        "x-argus-panel-token": capability,
      });
    }
  });

  it("preserves case-sensitive Solana addresses in the Arkham request", async () => {
    const solanaAddress = "SoLanaMixedCaseAddress111111111111111111111";
    await act(async () => {
      root.render(<ArkhamProbe address={solanaAddress} panelCostToken={capability} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const request = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/arkham?"));
    expect(request).toBeDefined();
    expect(decodeURIComponent(String(request?.[0]))).toContain(solanaAddress);
  });

  it("surfaces expired panel context instead of empty or clean provider findings", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: "invalid_panel_context",
        message: "This paid supplemental check needs a fresh persisted report. Rescan before running it.",
      }),
    }));

    await act(async () => {
      root.render(<Panels panelCostToken={capability} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionButtons = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => /reveal the devs|cluster/.test(button.textContent ?? ""));
    await act(async () => {
      for (const button of actionButtons) button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(container.querySelectorAll('[role="alert"]').length).toBeGreaterThanOrEqual(10));
    expect(container.textContent).toContain("Rescan required");
    expect(container.textContent).not.toContain("wallets analyzed");
    for (const path of expectedPaths) {
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(path)), `missing ${path}`).toBe(true);
    }

    const freshCapability = "fresh-panel-capability";
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).startsWith("/api/identity-sweep")
        ? { available: true, priorHandles: [], footprint: [], archivedBios: [] }
        : { available: false },
    }));
    await act(async () => {
      root.render(<Panels panelCostToken={freshCapability} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(container.textContent).not.toContain("Rescan required"));
    const freshRequest = fetchMock.mock.calls.find(([url, init]) => (
      String(url).startsWith("/api/cryptorank")
      && (init as RequestInit | undefined)?.headers
      && ((init as RequestInit).headers as Record<string, string>)["x-argus-panel-token"] === freshCapability
    ));
    expect(freshRequest).toBeDefined();
  });

  it("shows a rescan-required operator state instead of a clean trace verdict", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "invalid_panel_context", message: "Rescan before running it." }),
    }));

    await act(async () => {
      root.render(<OperatorNetwork deployer={address} chain="ethereum" panelCostToken={capability} />);
    });
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes("Trace the operator"));
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(container.textContent).toContain("Rescan required"));
    expect(container.textContent).toContain("saved report context for operator trace expired");
    expect(container.textContent).not.toContain("No serial-launch cluster found");
  });
});
