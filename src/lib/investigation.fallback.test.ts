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

function namesakeRecon(content: string) {
  return {
    retrieval: { status: "ok", content, title: "Namesake Project" },
    title: "Namesake Project",
    team: { state: "named", names: ["Alice Namesake", "Bob Namesake"], note: "Team page named two people." },
    socials: [{ label: "x", url: "https://x.com/alice_namesake" }],
    funding: [],
    tokenSignals: [],
    findings: [],
    identityLine: "Namesake Project names a two-person team.",
  };
}

function modelLeadFetch(website: string) {
  return vi.fn(async (input: string | URL | Request) => {
    if (String(input).startsWith("/api/token-identity?")) {
      return new Response(JSON.stringify({ available: true, website, x_handle: null, founder: null, founder_handle: null, confidence: "low" }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
}

async function runInvestigation(): Promise<{ result: Investigation; steps: string[] }> {
  const steps: string[] = [];
  const result = await new Promise<Investigation>((resolve, reject) => {
    streamInvestigation({ kind: "token", via: "evm", ref: MEME_ADDRESS }, {
      onStep: (step) => steps.push(`${step.label}: ${step.detail}`),
      onHop: () => {},
      onDone: resolve,
      onError: reject,
    });
  });
  return { result, steps };
}

describe("model-suggested site provenance", () => {
  it("keeps a model-suggested site as an unverified lead: no founders, no project claims, no paid team search", async () => {
    vi.stubGlobal("fetch", modelLeadFetch("https://namesake-project.example"));
    harness.runRecon.mockResolvedValue(namesakeRecon("Namesake Project. Meet the team: Alice Namesake, Bob Namesake."));

    const { result, steps } = await runInvestigation();

    expect(harness.runRecon).toHaveBeenCalledWith("https://namesake-project.example", expect.any(Function), expect.any(Function));
    expect(result.siteUrl).toBe("https://namesake-project.example");
    expect(result.siteUrlOrigin).toBe("model_lead");
    expect(result.siteBinding).toMatchObject({ origin: "model_lead", status: "unbound" });
    expect(result.founders).toEqual([]);
    expect(result.founderNote).toContain("model-suggested site");
    expect(result.founderNote).toContain("unverified");
    expect(result.founderNote).not.toContain("Named on the project site");
    expect(steps.join("\n")).toContain("Step 2b · Deep team search: Not scheduled");
    expect(steps.join("\n")).toContain("Step 2 · Recon a model-suggested site (unverified)");
  });

  it("binds a model-suggested site that publishes the scanned contract and only then names its team", async () => {
    vi.stubGlobal("fetch", modelLeadFetch("https://real-project.example"));
    harness.runRecon.mockResolvedValue(namesakeRecon(`Contract: ${MEME_ADDRESS.toUpperCase().replace("0X", "0x")} - Meet the team: Alice Namesake, Bob Namesake.`));

    const { result, steps } = await runInvestigation();

    expect(result.siteUrlOrigin).toBe("model_lead");
    expect(result.siteBinding).toMatchObject({ origin: "model_lead", status: "bound", via: "contract-on-page" });
    expect(result.founders.map((f) => f.name)).toEqual(["Alice Namesake", "Bob Namesake", "@alice_namesake"]);
    expect(result.founderNote).toContain("Named on the project site: Alice Namesake, Bob Namesake");
    expect(steps.join("\n")).toContain("Step 2b · Deep team search: Scheduled after the immutable investigation version is saved.");
  });

  it("records a listing-published site as bound by its token sources", async () => {
    harness.auditToken.mockResolvedValue({ ...thinMemecoin(), socials: [{ label: "website", url: "https://listed-site.example" }] });
    harness.runRecon.mockResolvedValue(namesakeRecon("Listed site. Meet the team: Alice Namesake, Bob Namesake."));

    const { result } = await runInvestigation();

    expect(result.siteUrlOrigin).toBe("token-sources");
    expect(result.siteBinding).toMatchObject({ origin: "token-sources", status: "bound", via: "token-sources" });
    expect(result.founders.map((f) => f.name)).toContain("Alice Namesake");
  });
});

describe("combined token investigation fallback", () => {
  it.each(["mismatch", "unavailable", "unknown"])("does not audit or embed an account whose token binding is %s", async (status) => {
    harness.auditToken.mockResolvedValue({ ...thinMemecoin(), projectX: "@unrelated" });
    harness.probeBackend.mockResolvedValue([{ id: "analyst", configured: true }]);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("/api/x-authenticity?")) return new Response(JSON.stringify({ available: true, status, note: "This account publishes a different contract." }), { status: 200 });
      return new Response(null, { status: 404 });
    }));
    const result = await new Promise<Investigation>((resolve, reject) => {
      streamInvestigation({ kind: "token", via: "evm", ref: MEME_ADDRESS }, { onStep: () => {}, onHop: () => {}, onDone: resolve, onError: reject });
    });
    expect(harness.streamAudit).not.toHaveBeenCalled();
    expect(result.projectAccount).toBeNull();
    expect(result.projectAccountAudit).toMatchObject({ state: "unavailable", note: expect.stringContaining("was not verified") });
  });

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
