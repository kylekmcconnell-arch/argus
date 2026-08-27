import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenDossier } from "../token/audit";
import type { Investigation } from "./investigation";

const harness = vi.hoisted(() => ({
  auditToken: vi.fn(),
  runRecon: vi.fn(),
  probeBackend: vi.fn(),
  streamAudit: vi.fn(),
}));

vi.mock("../token/audit", () => ({ auditToken: harness.auditToken }));
vi.mock("../collect/recon", () => ({ runRecon: harness.runRecon }));
vi.mock("./live", () => ({ probeBackend: harness.probeBackend, streamAudit: harness.streamAudit }));

import { streamInvestigation } from "./investigation";

const MEME_ADDRESS = "0x9999999999999999999999999999999999999999";

function thinMemecoin(): TokenDossier {
  return {
    address: MEME_ADDRESS,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "MEME",
    name: "Unknown Meme",
    verdict: "CAUTION",
    score: 42,
    capApplied: null,
    headline: "Thin public identity; token evidence only.",
    axes: [],
    safety: { available: false, simChecked: false },
    socials: [],
    projectX: null,
    deployer: null,
    topHolders: [],
    insiderPct: 0,
    bundleCount: 0,
    bundleRisk: "low",
    graph: { nodes: [], edges: [] },
    cg: null,
    findings: [],
    trace: [],
    live: true,
    safetyChecked: false,
  } as unknown as TokenDossier;
}

beforeEach(() => {
  harness.auditToken.mockReset().mockResolvedValue(thinMemecoin());
  harness.runRecon.mockReset().mockResolvedValue(null);
  harness.probeBackend.mockReset().mockResolvedValue([]);
  harness.streamAudit.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("combined token investigation fallback", () => {
  it("keeps a thin memecoin as an honest token-only result when no project identity resolves", async () => {
    const steps: string[] = [];
    const result = await new Promise<Investigation>((resolve, reject) => {
      streamInvestigation({ kind: "token", via: "evm", ref: MEME_ADDRESS }, {
        onStep: (step) => steps.push(`${step.label}: ${step.detail}`),
        onHop: () => {},
        onDone: resolve,
        onError: reject,
      });
    });

    expect(result.token.address).toBe(MEME_ADDRESS);
    expect(result.projectX).toBeNull();
    expect(result.siteUrl).toBeNull();
    expect(result.recon).toBeNull();
    expect(result.projectAccount).toBeNull();
    expect(result.projectAccountAudit).toEqual(expect.objectContaining({ state: "unavailable" }));
    expect(result.founderNote).toContain("No project website surfaced");
    expect(steps.join("\n")).toContain("No project website surfaced from the token's sources");
    expect(steps.join("\n")).toContain("No project X account to background");
    expect(harness.runRecon).not.toHaveBeenCalled();
    expect(harness.streamAudit).not.toHaveBeenCalled();
  });
});
