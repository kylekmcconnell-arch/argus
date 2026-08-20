import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";

const live = vi.hoisted(() => {
  const state = {
    handlers: null as null | {
      onStep: (step: unknown) => void;
      onDone: (dossier: unknown) => void;
      onError: (error: string) => void;
    },
    streamAudit: vi.fn(),
  };
  state.streamAudit.mockImplementation((
    _handle: unknown,
    _priv: unknown,
    handlers: typeof state.handlers,
  ) => {
    state.handlers = handlers;
    return vi.fn();
  });
  return state;
});

const resolver = vi.hoisted(() => ({
  resolveProjectToken: vi.fn(async () => ({
    name: "No Domain Project",
    symbol: "NDP",
    contract: "0x1111111111111111111111111111111111111111",
    chain: "ethereum",
    homepage: "https://unrelated.example",
  })),
}));

const threat = vi.hoisted(() => ({
  threatScan: vi.fn(async () => null),
}));

vi.mock("./live", () => ({ streamAudit: live.streamAudit }));
vi.mock("./resolveProjectToken", () => ({ resolveProjectToken: resolver.resolveProjectToken }));
vi.mock("../threat/scan", () => ({ threatScan: threat.threatScan }));

import { cancelRun, getRun, startPersonAudit } from "./runner";

const EVM = "0x2222222222222222222222222222222222222222";

function minimalDossier(handle: string, extra: Partial<Dossier> = {}): Dossier {
  return {
    handle,
    display_name: "No Domain Project",
    bio: "",
    evidence: { promotions: [] },
    ...extra,
  } as unknown as Dossier;
}

afterEach(() => {
  cancelRun("@no-domain-project");
  cancelRun("@bound-project");
  cancelRun("@solana-project");
  cancelRun("@unsupported-chain-project");
  live.handlers = null;
  live.streamAudit.mockClear();
  resolver.resolveProjectToken.mockClear();
  threat.threatScan.mockClear();
});

describe("background token identity hydration", () => {
  it("does not bind a same-name CoinGecko result when the server froze no canonical token", async () => {
    startPersonAudit("@no-domain-project");
    live.handlers?.onDone(minimalDossier("@no-domain-project"));

    await vi.waitFor(() => {
      expect(getRun("@no-domain-project")?.status).toBe("done");
    });

    expect(resolver.resolveProjectToken).not.toHaveBeenCalled();
    expect(threat.threatScan).not.toHaveBeenCalled();
    expect(getRun("@no-domain-project")?.dossier?.threatNote).toContain(
      "No project token was hard-bound by the server",
    );
  });

  it("uses the server-frozen canonical token without client-side name discovery", async () => {
    startPersonAudit("@bound-project");
    live.handlers?.onDone(minimalDossier("@bound-project", {
      projectToken: {
        verified: true,
        verification: "official_x",
        name: "Bound Project",
        symbol: "BOUND",
        rank: null,
        address: EVM,
        chain: "ethereum",
        sourceUrl: "https://example.test/token-receipt",
        capturedAt: "2026-08-20T00:00:00.000Z",
      },
    }));

    await vi.waitFor(() => {
      expect(getRun("@bound-project")?.status).toBe("done");
    });

    expect(resolver.resolveProjectToken).not.toHaveBeenCalled();
    expect(threat.threatScan).toHaveBeenCalledWith(
      { kind: "token", ref: EVM, via: "evm" },
      expect.any(Function),
    );
    expect(getRun("@bound-project")?.dossier?.threatNote).toContain(
      "server-frozen canonical project token",
    );
  });

  it("preserves the dedicated Solana route for a frozen canonical token", async () => {
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    startPersonAudit("@solana-project");
    live.handlers?.onDone(minimalDossier("@solana-project", {
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Solana Project",
        symbol: "SOLP",
        rank: null,
        address: mint,
        chain: "solana",
        sourceUrl: "https://example.test/solana-token-receipt",
        capturedAt: "2026-08-20T00:00:00.000Z",
      },
    }));

    await vi.waitFor(() => {
      expect(getRun("@solana-project")?.status).toBe("done");
    });

    expect(threat.threatScan).toHaveBeenCalledWith(
      { kind: "token", ref: mint, via: "solana" },
      expect.any(Function),
    );
  });

  it("does not reinterpret an unsupported frozen chain or fall through to address-format guessing", async () => {
    // A Tron address is valid base58 and can resemble a Solana mint. The frozen
    // chain receipt must govern, so this cannot silently launch either route.
    const tronAddress = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8";
    startPersonAudit("@unsupported-chain-project");
    live.handlers?.onDone(minimalDossier("@unsupported-chain-project", {
      bio: `Official contract: ${tronAddress}`,
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Tron Project",
        symbol: "TRONX",
        rank: null,
        address: tronAddress,
        chain: "tron",
        sourceUrl: "https://example.test/tron-token-receipt",
        capturedAt: "2026-08-20T00:00:00.000Z",
      },
    }));

    await vi.waitFor(() => {
      expect(getRun("@unsupported-chain-project")?.status).toBe("done");
    });

    expect(resolver.resolveProjectToken).not.toHaveBeenCalled();
    expect(threat.threatScan).not.toHaveBeenCalled();
    expect(getRun("@unsupported-chain-project")?.dossier?.threatNote).toContain(
      "does not support that chain",
    );
  });
});
