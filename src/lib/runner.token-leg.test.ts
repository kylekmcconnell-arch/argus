import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import type { ThreatScan } from "../threat/types";

const mocks = vi.hoisted(() => ({
  streamAudit: vi.fn(),
  threatScan: vi.fn(),
  resolveProjectToken: vi.fn(),
  fetchPersonRun: vi.fn(),
}));

vi.mock("./reports", () => ({ fetchPersonRun: mocks.fetchPersonRun }));
vi.mock("./live", () => ({ streamAudit: mocks.streamAudit }));
vi.mock("../threat/scan", () => ({ threatScan: mocks.threatScan }));
// The runner must never import this: a CoinGecko name match is not evidence
// that a token belongs to the subject (#321). The mock stays so a regression
// that reintroduces the import is caught by the assertion below.
vi.mock("./resolveProjectToken", () => ({ resolveProjectToken: mocks.resolveProjectToken }));

import { cancelRun, getRun, setOnComplete, startPersonAudit } from "./runner";

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
    }, expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.resolveProjectToken).not.toHaveBeenCalled();
    expect(getRun("@AnyoneFDN")?.dossier?.threat).toBe(tokenSafety);
    expect(getRun("@AnyoneFDN")?.dossier?.threatNote).toContain("canonical $ANYONE project token");
    expect(getRun("@AnyoneFDN")?.dossier?.threatNote).toContain("PASS · 18/100 risk");
  });

  it("never attaches a token by CoinGecko name match when nothing first-party names one", async () => {
    const dossier = { ...anyoneDossier(), projectToken: undefined, bio: "Privacy network.", evidence: { promotions: [] } } as unknown as Dossier;
    mocks.resolveProjectToken.mockResolvedValue({
      name: "Anyone Protocol",
      symbol: "ANYONE",
      contract: "0x1234567890abcdef1234567890abcdef12345678",
      chain: "ethereum",
      homepage: "https://www.anyone.io/",
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
    await vi.waitFor(() => expect(getRun("@AnyoneFDN")?.status).toBe("done"));

    expect(mocks.resolveProjectToken).not.toHaveBeenCalled();
    expect(mocks.threatScan).not.toHaveBeenCalled();
    expect(getRun("@AnyoneFDN")?.dossier?.threat).toBeUndefined();
    expect(getRun("@AnyoneFDN")?.dossier?.threatNote).toContain("does not attach tokens by name match");
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
    }, expect.any(Function), expect.objectContaining({ force: true, signal: expect.any(AbortSignal) }));
    expect(getRun("@AnyoneFDN")?.dossier?.threat).toBe(tokenSafety);
    expect(getRun("@AnyoneFDN")?.steps.some((step) => step.label === "Retrying the token safety check")).toBe(true);
  });

  it("aborts a merely slow threat leg at the wall clock instead of overlapping it with a forced retry", async () => {
    vi.useFakeTimers();
    try {
      const dossier = anyoneDossier();
      const signals: AbortSignal[] = [];
      mocks.threatScan.mockImplementation((_input: unknown, _emit: unknown, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        // A scanner that only ends when it is told to stop.
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted by the runner")));
        });
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
      await vi.advanceTimersByTimeAsync(119_000);
      expect(getRun("@AnyoneFDN")?.status).toBe("running");
      expect(signals[0]?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(getRun("@AnyoneFDN")?.status).toBe("done"));

      expect(signals[0]?.aborted).toBe(true);
      // The slow leg was cut off, not retried alongside itself.
      expect(mocks.threatScan).toHaveBeenCalledOnce();
      expect(getRun("@AnyoneFDN")?.dossier?.threat).toBeNull();
      expect(getRun("@AnyoneFDN")?.dossier?.threatNote).toContain("did not complete");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the threat leg when the run is cancelled", async () => {
    const signals: AbortSignal[] = [];
    mocks.threatScan.mockImplementation((_input: unknown, _emit: unknown, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return new Promise(() => {});
    });
    mocks.streamAudit.mockImplementation((
      _handle: string,
      _priv: boolean,
      handlers: { onStep: (step: { phase: string; label: string; detail: string; source: string; token: unknown }) => void },
    ) => {
      handlers.onStep({
        phase: "ARGUS", label: "token", detail: "announced", source: "argus",
        token: { address: "0x1234567890abcdef1234567890abcdef12345678", via: "evm", source: "bio" },
      });
      return () => undefined;
    });

    startPersonAudit("@AnyoneFDN");
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    cancelRun("@AnyoneFDN");

    expect(signals[0].aborted).toBe(true);
    expect(getRun("@AnyoneFDN")).toBeUndefined();
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

describe("exact-run recovery and token finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelRun("@AnyoneFDN");
    setOnComplete(() => undefined);
  });
  it("recovers a duplicate or dropped stream through the original run and saves its token leg once", async () => {
    const d = anyoneDossier();
    const safety = { symbol: "ANYONE", call: { verdict: "PASS", risk: 18 }, dossier: { score: 82, verdict: "PASS", axes: [] } } as unknown as ThreatScan;
    mocks.threatScan.mockResolvedValue(safety);
    mocks.fetchPersonRun.mockResolvedValue({ state: "saved", dossier: d });
    let handlers!: { onError: (message: string, failure: { kind: string }) => void; onDone: (value: Dossier) => void };
    mocks.streamAudit.mockImplementation((_handle, _priv, h) => { handlers = h; return vi.fn(); });
    let finishSave!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
    setOnComplete(save);
    const run = startPersonAudit("@AnyoneFDN");
    handlers.onError("already started", { kind: "stream_dropped" });
    handlers.onError("connection lost", { kind: "stream_dropped" });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(run.status).toBe("running");
    expect(mocks.fetchPersonRun).toHaveBeenCalledWith(run.runKey, "@AnyoneFDN", expect.any(AbortSignal));
    expect(mocks.streamAudit.mock.calls[0][5]).toBe(run.runKey);
    expect(mocks.streamAudit).toHaveBeenCalledOnce();
    expect(mocks.threatScan).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ threat: safety }), false);
    handlers.onDone(d);
    finishSave();
    await vi.waitFor(() => expect(run.status).toBe("done"));
    expect(save).toHaveBeenCalledOnce();
  });
  it("does not resurrect cancelled recovery or start token work after cancellation", async () => {
    let reply!: (value: unknown) => void;
    mocks.fetchPersonRun.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
    let fail!: (message: string, failure: { kind: string }) => void;
    mocks.streamAudit.mockImplementation((_h, _p, handlers) => { fail = handlers.onError; return vi.fn(); });
    const save = vi.fn(); setOnComplete(save);
    startPersonAudit("@AnyoneFDN");
    fail("disconnected", { kind: "stream_dropped" });
    cancelRun("@AnyoneFDN");
    reply({ state: "saved", dossier: anyoneDossier() });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.threatScan).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(getRun("@AnyoneFDN")).toBeUndefined();
  });
  it("does not recover private scans from shared storage", () => {
    mocks.streamAudit.mockImplementation((_h, _p, handlers) => { handlers.onError("disconnected", { kind: "stream_dropped" }); return vi.fn(); });
    const run = startPersonAudit("@AnyoneFDN", true);
    expect(run.status).toBe("error");
    expect(mocks.fetchPersonRun).not.toHaveBeenCalled();
    expect(mocks.threatScan).not.toHaveBeenCalled();
    cancelRun("@AnyoneFDN");
  });
  it("keeps a recovered combined-save failure visible instead of reporting completion", async () => {
    mocks.fetchPersonRun.mockResolvedValue({ state: "saved", dossier: anyoneDossier() });
    mocks.threatScan.mockResolvedValue({ symbol: "ANYONE", call: { verdict: "PASS", risk: 18 } });
    setOnComplete(async () => { throw new Error("combined save failed"); });
    mocks.streamAudit.mockImplementation((_h, _p, handlers) => { handlers.onError("disconnected", { kind: "stream_dropped" }); return vi.fn(); });
    const run = startPersonAudit("@AnyoneFDN");
    await vi.waitFor(() => expect(run.status).toBe("error"));
    expect(run.error).toBe("combined save failed");
    expect(run.dossier).toBeUndefined();
    expect(mocks.streamAudit).toHaveBeenCalledOnce();
  });
});

it("reuses a token leg already running when the project stream disconnects", async () => {
  vi.clearAllMocks(); cancelRun("@AnyoneFDN");
  let completeToken!: (scan: ThreatScan) => void;
  mocks.threatScan.mockImplementation(() => new Promise<ThreatScan>(resolve => { completeToken = resolve; }));
  mocks.fetchPersonRun.mockResolvedValue({ state: "saved", dossier: anyoneDossier() });
  let handlers!: { onStep: (step: unknown) => void; onError: (message: string, failure: { kind: string }) => void };
  mocks.streamAudit.mockImplementation((_h, _p, h) => { handlers = h; return vi.fn(); });
  const save = vi.fn(); setOnComplete(save);
  const run = startPersonAudit("@AnyoneFDN");
  handlers.onStep({ phase: "Token", label: "Bound", detail: "Bound token", token: { address: "0x1234567890abcdef1234567890abcdef12345678", via: "evm", source: "official profile" } });
  handlers.onError("connection lost", { kind: "stream_dropped" });
  expect(startPersonAudit("@AnyoneFDN")).toBe(run);
  await vi.waitFor(() => expect(mocks.fetchPersonRun).toHaveBeenCalledOnce());
  completeToken({ symbol: "ANYONE", call: { verdict: "PASS", risk: 18 } } as unknown as ThreatScan);
  await vi.waitFor(() => expect(run.status).toBe("done"));
  expect(mocks.threatScan).toHaveBeenCalledOnce();
  expect(mocks.streamAudit).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
});

it("keeps the original scan active through delayed receipt recovery without relaunching", async () => {
  vi.clearAllMocks(); cancelRun("@AnyoneFDN"); vi.useFakeTimers();
  try {
    mocks.fetchPersonRun.mockResolvedValue({ state: "running" });
    mocks.threatScan.mockResolvedValue({ symbol: "ANYONE", call: { verdict: "PASS", risk: 18 } });
    let fail!: (message: string, failure: { kind: string }) => void;
    mocks.streamAudit.mockImplementation((_h, _p, h) => { fail = h.onError; return vi.fn(); });
    const save = vi.fn(); setOnComplete(save);
    const run = startPersonAudit("@AnyoneFDN");
    fail("disconnected", { kind: "stream_dropped" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.status).toBe("running");
    expect(startPersonAudit("@AnyoneFDN")).toBe(run);
    expect(save).not.toHaveBeenCalled();
    mocks.fetchPersonRun.mockResolvedValue({ state: "saved", dossier: anyoneDossier() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.status).toBe("done");
    expect(mocks.streamAudit).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  } finally { cancelRun("@AnyoneFDN"); vi.useRealTimers(); }
});

it("stops recovery at the original run deadline without substituting another report", async () => {
  vi.clearAllMocks(); cancelRun("@AnyoneFDN"); vi.useFakeTimers();
  try {
    mocks.fetchPersonRun.mockResolvedValue({ state: "unavailable" });
    let fail!: (message: string, failure: { kind: string }) => void;
    mocks.streamAudit.mockImplementation((_h, _p, h) => { fail = h.onError; return vi.fn(); });
    const save = vi.fn(); setOnComplete(save);
    const run = startPersonAudit("@AnyoneFDN");
    run.serverDeadlineAt = Date.now() + 100;
    fail("disconnected", { kind: "stream_dropped" });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(run.status).toBe("error");
    expect(run.error).toContain("could not be confirmed");
    expect(save).not.toHaveBeenCalled();
    expect(mocks.threatScan).not.toHaveBeenCalled();
    expect(mocks.streamAudit).toHaveBeenCalledOnce();
  } finally { cancelRun("@AnyoneFDN"); vi.useRealTimers(); }
});


it.each(["complete", "unavailable", "unattributed"] as const)("does not duplicate a server-owned %s token leg", async state => {
  vi.clearAllMocks(); cancelRun("@AnyoneFDN");
  const d = { ...anyoneDossier(), tokenAssessment: { owner: "server" as const, state, completedAt: "2026-09-23T00:00:00Z" } };
  const save = vi.fn(); setOnComplete(save);
  mocks.streamAudit.mockImplementation((_handle, _private, handlers) => {
    handlers.onStep({ phase: "ARGUS", label: "Server completion", detail: "", tokenExecution: "server" });
    handlers.onStep({ phase: "Token", label: "Bound", detail: "", token: { address: d.projectToken!.address, via: "evm", source: "official domain" } });
    handlers.onDone(d);
    return vi.fn();
  });
  const run = startPersonAudit("@AnyoneFDN");
  await vi.waitFor(() => expect(run.status).toBe("done"));
  expect(mocks.streamAudit.mock.calls[0][6]).toBe(true);
  expect(mocks.threatScan).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledWith(d, false);
});
