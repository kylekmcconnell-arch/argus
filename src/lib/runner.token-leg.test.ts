import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import type { ThreatScan } from "../threat/types";

const mocks = vi.hoisted(() => ({
  streamAudit: vi.fn(),
  threatScan: vi.fn(),
  resolveProjectToken: vi.fn(),
}));

vi.mock("./live", () => ({ streamAudit: mocks.streamAudit }));
vi.mock("../threat/scan", () => ({ threatScan: mocks.threatScan }));
vi.mock("./resolveProjectToken", () => ({ resolveProjectToken: mocks.resolveProjectToken }));

import { getRun, setOnComplete, startPersonAudit } from "./runner";

function anyoneDossier(): Dossier {
  return {
    handle: "@AnyoneFDN",
    display_name: "Anyone Protocol",
    avatar: "",
    bio: "DePIN-powered privacy network.",
    followers: "100K",
    joined: "2022",
    identity_note: "Official project identity confirmed.",
    headline: "Anyone Protocol runs a decentralized privacy network.",
    live: true,
    roles: ["PROJECT"],
    projectToken: {
      verified: true,
      verification: "official_domain",
      name: "Anyone Protocol",
      symbol: "ANYONE",
      rank: null,
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chain: "ethereum",
      sourceUrl: "https://www.anyone.io/",
      capturedAt: "2026-08-26T22:00:00.000Z",
    },
  } as unknown as Dossier;
}

describe("project report token-safety leg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnComplete(() => undefined);
    mocks.resolveProjectToken.mockResolvedValue(null);
  });

  it("scans the verified canonical token even when the bio has no contract and CoinGecko name lookup is unavailable", async () => {
    const dossier = anyoneDossier();
    const tokenSafety = {
      symbol: "ANYONE",
      call: { verdict: "PASS", risk: 18 },
      dossier: { score: 82, verdict: "PASS", axes: [] },
    } as unknown as ThreatScan;
    mocks.threatScan.mockResolvedValue(tokenSafety);
    mocks.streamAudit.mockImplementation((
      _handle: string,
      _priv: boolean,
      handlers: { onDone: (value: Dossier) => void },
    ) => {
      handlers.onDone(dossier);
      return () => undefined;
    });

    startPersonAudit("@AnyoneFDN");
    await vi.waitFor(() => expect(getRun("@AnyoneFDN")?.status).toBe("done"));

    expect(mocks.threatScan).toHaveBeenCalledOnce();
    expect(mocks.threatScan).toHaveBeenCalledWith({
      kind: "token",
      ref: "0x1234567890abcdef1234567890abcdef12345678",
      via: "evm",
    }, expect.any(Function));
    expect(mocks.resolveProjectToken).not.toHaveBeenCalled();
    expect(getRun("@AnyoneFDN")?.dossier?.threat).toBe(tokenSafety);
    expect(getRun("@AnyoneFDN")?.dossier?.threatNote).toContain("canonical $ANYONE project token");
    expect(getRun("@AnyoneFDN")?.dossier?.threatNote).toContain("PASS · 18/100 risk");
  });

  it("does not mark the report done until the token-enriched version is durably saved", async () => {
    const dossier = anyoneDossier();
    const tokenSafety = {
      symbol: "ANYONE",
      call: { verdict: "PASS", risk: 18 },
      dossier: { score: 82, verdict: "PASS", axes: [] },
    } as unknown as ThreatScan;
    let releaseSave: (() => void) | undefined;
    const saveFinished = new Promise<void>((resolve) => { releaseSave = resolve; });
    setOnComplete(() => saveFinished);
    mocks.threatScan.mockResolvedValue(tokenSafety);
    mocks.streamAudit.mockImplementation((
      _handle: string,
      _priv: boolean,
      handlers: { onDone: (value: Dossier) => void },
    ) => {
      handlers.onDone(dossier);
      return () => undefined;
    });

    startPersonAudit("@AnyoneFDN");
    await vi.waitFor(() => expect(mocks.threatScan).toHaveBeenCalledOnce());
    expect(getRun("@AnyoneFDN")?.status).toBe("running");
    expect(getRun("@AnyoneFDN")?.pct).toBeLessThan(100);

    releaseSave?.();
    await vi.waitFor(() => expect(getRun("@AnyoneFDN")?.status).toBe("done"));
    expect(getRun("@AnyoneFDN")?.dossier?.threat).toBe(tokenSafety);
  });

  it("retries a newly indexed verified token once without the cached empty result", async () => {
    const dossier = anyoneDossier();
    const tokenSafety = {
      symbol: "ANYONE",
      call: { verdict: "PASS", risk: 18 },
      dossier: { score: 82, verdict: "PASS", axes: [] },
    } as unknown as ThreatScan;
    mocks.threatScan
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tokenSafety);
    mocks.streamAudit.mockImplementation((
      _handle: string,
      _priv: boolean,
      handlers: { onDone: (value: Dossier) => void },
    ) => {
      handlers.onDone(dossier);
      return () => undefined;
    });

    startPersonAudit("@AnyoneFDN");
    await vi.waitFor(() => expect(getRun("@AnyoneFDN")?.status).toBe("done"));

    expect(mocks.threatScan).toHaveBeenCalledTimes(2);
    expect(mocks.threatScan).toHaveBeenNthCalledWith(2, {
      kind: "token",
      ref: "0x1234567890abcdef1234567890abcdef12345678",
      via: "evm",
    }, expect.any(Function), { force: true });
    expect(getRun("@AnyoneFDN")?.dossier?.threat).toBe(tokenSafety);
    expect(getRun("@AnyoneFDN")?.steps.some((step) => step.label === "Retrying the token safety check")).toBe(true);
  });

  it("surfaces a final persistence failure instead of publishing the project-only version", async () => {
    const dossier = anyoneDossier();
    mocks.threatScan.mockResolvedValue({
      symbol: "ANYONE",
      call: { verdict: "PASS", risk: 18 },
      dossier: { score: 82, verdict: "PASS", axes: [] },
    } as unknown as ThreatScan);
    setOnComplete(async () => {
      throw new Error("The combined project and token report could not be saved.");
    });
    mocks.streamAudit.mockImplementation((
      _handle: string,
      _priv: boolean,
      handlers: { onDone: (value: Dossier) => void },
    ) => {
      handlers.onDone(dossier);
      return () => undefined;
    });

    startPersonAudit("@AnyoneFDN");
    await vi.waitFor(() => expect(getRun("@AnyoneFDN")?.status).toBe("error"));
    expect(getRun("@AnyoneFDN")?.error).toContain("combined project and token report");
    expect(getRun("@AnyoneFDN")?.dossier).toBeUndefined();
  });
});
