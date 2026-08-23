import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import { stripArkhamScreenForScoring } from "../orchestrate";
import { arkhamAdapter, probeEvmControl, screenableWallets } from "./arkham";
import type { CollectContext } from "./types";

const EOA = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x2222222222222222222222222222222222222222";

function context(wallets: CollectContext["evidence"]["wallets"] = []) {
  const evidence = emptyEvidence("@alice");
  evidence.wallets = wallets;
  const steps: Parameters<CollectContext["emit"]>[0][] = [];
  return {
    evidence,
    steps,
    ctx: { handle: "@alice", evidence, emit: (step) => steps.push(step) } satisfies CollectContext,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rpcCode = (code: string) => json({ jsonrpc: "2.0", id: 1, result: code });

function routes(options: {
  code?: Record<string, string>;
  labels?: Record<string, unknown>;
  risk?: Record<string, unknown>;
  riskStatus?: number;
  paths?: unknown;
} = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/intelligence/address_enriched/batch")) return json({ addresses: options.labels ?? {} });
    if (url.includes("/risk/address/batch")) {
      if (options.riskStatus && options.riskStatus !== 200) return json({ error: "no" }, options.riskStatus);
      return json(options.risk ?? {});
    }
    if (url.includes("/risk/address/")) return json(options.paths ?? { risk_level: "SEVERE", top_sources: [] });
    const body = JSON.parse(String(init?.body ?? "{}")) as { params?: string[] };
    return rpcCode(options.code?.[(body.params?.[0] ?? "").toLowerCase()] ?? "0x");
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Arkham binding and control gates", () => {
  it("reaches only attributable markers and caps the strongest four", () => {
    const { evidence } = context([
      { address: EOA, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" },
      { address: "0xaaa", chain: "evm", link_tier: "InvestigatorAttributed", binding: "farcaster_verified" },
      { address: "0xbbb", chain: "evm", link_tier: "InvestigatorAttributed", binding: "handle_name_guess" },
      { address: "0xccc", chain: "evm", link_tier: "SelfDoxxed" },
      ...Array.from({ length: 5 }, (_, index) => ({
        address: `0x${String(index).repeat(40)}`,
        chain: "evm",
        link_tier: "SelfDoxxed",
        binding: "self_disclosed" as const,
      })),
    ]);
    const screened = screenableWallets(evidence);
    expect(screened).toHaveLength(4);
    expect(screened[0].address).toBe("0xaaa");
    expect(screened.some((wallet) => wallet.address === "0xbbb" || wallet.address === "0xccc")).toBe(false);
  });

  it("does not reopen attribution from link_tier without a binding marker", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, evidence } = context([{ address: EOA, chain: "evm", link_tier: "SelfDoxxed" }]);
    expect(screenableWallets(evidence)).toEqual([]);
    await expect(arkhamAdapter.run(ctx)).resolves.toMatchObject({ state: "skipped", attempts: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads bytecode as a contract, empty code as EOA, and no response as inconclusive", async () => {
    vi.stubGlobal("fetch", routes({ code: { [CONTRACT.toLowerCase()]: "0x60806040" } }));
    await withCostLedger(async () => {
      expect(await probeEvmControl(CONTRACT)).toBe("contract");
      expect(await probeEvmControl(EOA)).toBe("eoa");
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await withCostLedger(async () => expect(await probeEvmControl(EOA)).toBe("inconclusive"));
  });

  it("never attributes exposure to a self-disclosed contract", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    vi.stubGlobal("fetch", routes({
      code: { [CONTRACT.toLowerCase()]: "0x60806040" },
      risk: { [CONTRACT]: { risk_level: "SEVERE", max_score: 100 } },
    }));
    const { ctx, evidence } = context([
      { address: CONTRACT, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" },
    ]);
    await withCostLedger(() => arkhamAdapter.run(ctx));
    expect(evidence.wallets[0].screen?.status).toBe("not_attributable");
    expect(evidence.wallets[0].screen?.risk).toBeUndefined();
  });

  it("honours Arkham's contract flag and skips RPC for Farcaster proof", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    const contractFetch = routes({
      labels: { [EOA]: { isUserAddress: false, arkhamEntity: { name: "Some Token" } } },
      risk: { [EOA]: { risk_level: "SEVERE", max_score: 100 } },
    });
    vi.stubGlobal("fetch", contractFetch);
    const first = context([{ address: EOA, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" }]);
    await withCostLedger(() => arkhamAdapter.run(first.ctx));
    expect(first.evidence.wallets[0].screen?.status).toBe("not_attributable");

    const farcasterFetch = routes({ risk: { [EOA]: { risk_level: "NONE", max_score: 0 } } });
    vi.stubGlobal("fetch", farcasterFetch);
    const second = context([{ address: EOA, chain: "evm", link_tier: "InvestigatorAttributed", binding: "farcaster_verified" }]);
    await withCostLedger(() => arkhamAdapter.run(second.ctx));
    expect(farcasterFetch.mock.calls.some(([url]) => !String(url).includes("arkm.com"))).toBe(false);
    expect(second.evidence.wallets[0].screen?.status).toBe("no_exposure_found");
  });
});

describe("Arkham outcomes and scoring isolation", () => {
  it("keeps unentitled, failed, and missing risk reads visibly unavailable", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    for (const riskStatus of [403, 503]) {
      vi.stubGlobal("fetch", routes({ riskStatus }));
      const { ctx, evidence } = context([{ address: EOA, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" }]);
      await withCostLedger(() => arkhamAdapter.run(ctx));
      expect(evidence.wallets[0].screen?.status).toBe("unavailable");
      expect(evidence.wallets[0].screen?.detail).toMatch(/not a clean/i);
    }
    vi.stubGlobal("fetch", routes({ risk: {} }));
    const missing = context([{ address: EOA, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" }]);
    await withCostLedger(() => arkhamAdapter.run(missing.ctx));
    expect(missing.evidence.wallets[0].screen?.status).toBe("unavailable");
  });

  it("records entitlement and honest non-USD cost semantics", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    vi.stubGlobal("fetch", routes({ riskStatus: 402 }));
    const { ctx } = context([{ address: EOA, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" }]);
    const ledger = await withCostLedger(async () => {
      await arkhamAdapter.run(ctx);
      return getCost();
    });
    const risk = ledger.calls.find((row) => row.op === "scan:risk-batch");
    expect(risk).toMatchObject({ usd: 0, status: "failed" });
    expect(risk?.meta).toContain("risk-addon/not-entitled");
    expect(risk?.meta).toContain("not converted to USD");
  });

  it("stores exposure chain-of-custody but strips it from the scoring packet", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    vi.stubGlobal("fetch", routes({
      labels: { [EOA]: { arkhamEntity: { name: "Jane Doe", type: "individual" } } },
      risk: { [EOA]: { risk_level: "SEVERE", max_score: 96, greatest_risk_category: "mixer" } },
      paths: { risk_level: "SEVERE", max_score: 96, top_sources: [{
        seed_address: "0x9999999999999999999999999999999999999999",
        risk_category: "mixer",
        direction: "backward",
        contribution_usd: 72_000_000,
        hop_distance: 1,
      }] },
    }));
    const { ctx, evidence } = context([{
      address: EOA,
      chain: "evm",
      link_tier: "SelfDoxxed",
      binding: "self_disclosed",
      notes: "published in the subject's own post",
    }]);
    await withCostLedger(() => arkhamAdapter.run(ctx));
    expect(evidence.wallets[0].screen).toMatchObject({
      status: "screened",
      provider: "arkham",
      binding: "self_disclosed",
      entity: { name: "Jane Doe" },
      risk: { level: "SEVERE", topSources: [expect.objectContaining({ usd: 72_000_000, hops: 1 })] },
    });
    expect(stripArkhamScreenForScoring(evidence.wallets[0])).not.toHaveProperty("screen");
  });

  it("uses one Arkham batch call per lane for several clear wallets", async () => {
    vi.stubEnv("ARKHAM_API_KEY", "key");
    const other = "0x3333333333333333333333333333333333333333";
    const fetchMock = routes({ risk: {
      [EOA]: { risk_level: "NONE", max_score: 0 },
      [other]: { risk_level: "NONE", max_score: 0 },
    } });
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context([
      { address: EOA, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" },
      { address: other, chain: "evm", link_tier: "SelfDoxxed", binding: "self_disclosed" },
    ]);
    await withCostLedger(() => arkhamAdapter.run(ctx));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("arkm.com"))).toHaveLength(2);
  });
});
