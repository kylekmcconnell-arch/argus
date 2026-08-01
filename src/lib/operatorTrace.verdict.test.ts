import { afterEach, describe, expect, it, vi } from "vitest";
import { traceOperator } from "./operatorTrace";

// The operator trace's clean verdict is an absence claim, and an absence claim is
// only worth anything when the forward sweep that would have found siblings
// actually ran. A CEX terminal ends the trail with an empty sweep queue, which
// looks identical to "swept everything, found nothing" unless the verdict tracks
// which one happened.
const root = "0x1111111111111111111111111111111111111111";
const anonFunder = "0x2222222222222222222222222222222222222222";
const exchange = "0x3333333333333333333333333333333333333333";

const opts = { chain: "ethereum", panelCostToken: "signed-panel-capability", checkLiveness: false, record: false };

function stubRoutes(routes: Array<{ match: string; body: unknown }>) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`unexpected request: ${url}`);
    return { ok: true, json: async () => hit.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator trace verdict", () => {
  it("calls a deployer isolated only after a forward sweep completed", async () => {
    stubRoutes([
      {
        match: `evm-deployer?wallet=${root}`,
        body: {
          available: true,
          deployments: 1,
          chain: [
            { from: root, to: anonFunder, label: null, kind: "wallet" },
            { from: anonFunder, to: exchange, label: "Coinbase", kind: "cex" },
          ],
          origin: { address: exchange, label: "Coinbase", kind: "cex" },
        },
      },
      { match: `evm-funder?wallet=${anonFunder}`, body: { available: true, seededCount: 0, seededDeployers: [] } },
      {
        match: `evm-deployer?wallet=${anonFunder}`,
        body: { available: true, chain: [{ from: anonFunder, to: exchange, label: "Coinbase", kind: "cex" }] },
      },
    ]);

    const cluster = await traceOperator(root, opts, () => {});

    expect(cluster?.stats.sweeps).toBe(1);
    expect(cluster?.budgetExhausted).toBe(false);
    expect(cluster?.verdict.tone).toBe("good");
    expect(cluster?.verdict.line).toContain("completed forward sweep");
    expect(cluster?.verdict.line).toContain("Isolated and traceable");
  });

  it("reports a CEX-terminated trail as unknown, never as no siblings found", async () => {
    const fetchMock = stubRoutes([
      {
        match: `evm-deployer?wallet=${root}`,
        body: {
          available: true,
          deployments: 1,
          funder: { address: exchange, label: "Coinbase", kind: "cex" },
        },
      },
    ]);

    const cluster = await traceOperator(root, opts, () => {});

    // The exchange is never expanded, so nothing was ever swept forward.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cluster?.stats.sweeps).toBe(0);
    expect(cluster?.verdict.tone).toBe("neutral");
    expect(cluster?.verdict.line).toContain("exchange hop ends the trail");
    expect(cluster?.verdict.line).toContain("neither found nor ruled out");
    // Not a clean bill, and not an accusation either.
    expect(cluster?.verdict.line).not.toContain("Isolated and traceable");
    expect(cluster?.verdict.line).not.toContain("no sibling launches");
  });

  it("reports an abandoned sweep queue as unknown rather than clean", async () => {
    stubRoutes([
      {
        match: `evm-deployer?wallet=${root}`,
        body: {
          available: true,
          deployments: 1,
          funder: { address: anonFunder, label: null, kind: "wallet" },
        },
      },
    ]);

    // maxSweeps 0 leaves a known hub unswept, the same evidence state as a
    // deadline expiring mid-trace.
    const cluster = await traceOperator(root, { ...opts, maxSweeps: 0 }, () => {});

    expect(cluster?.stats.sweeps).toBe(0);
    expect(cluster?.budgetExhausted).toBe(true);
    expect(cluster?.verdict.tone).toBe("neutral");
    expect(cluster?.verdict.line).toContain("neither found nor ruled out");
  });
});
