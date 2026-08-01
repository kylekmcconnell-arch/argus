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
const higherFunder = "0x5555555555555555555555555555555555555555";

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

  // The sweep of the known hub can finish while the walk UP from it never runs.
  // The wallet above the hub is then never discovered, so it is never swept, and
  // the cousins it may have seeded are unknown.
  it("reports a funding trail we stopped walking as unknown, not as isolated", async () => {
    stubRoutes([
      {
        match: `evm-deployer?wallet=${root}`,
        body: {
          available: true,
          deployments: 1,
          funder: { address: anonFunder, label: null, kind: "wallet" },
        },
      },
      { match: `evm-funder?wallet=${anonFunder}`, body: { available: true, seededCount: 0, seededDeployers: [] } },
      {
        match: `evm-deployer?wallet=${anonFunder}`,
        body: { available: true, funder: { address: higherFunder, label: null, kind: "wallet" } },
      },
    ]);

    // One trace call covers the root, leaving the hub's own funder untraced.
    const cluster = await traceOperator(root, { ...opts, maxTraces: 1 }, () => {});

    expect(cluster?.stats.sweeps).toBe(1);
    expect(cluster?.verdict.tone).toBe("neutral");
    expect(cluster?.verdict.line).toContain("not followed to its end");
    expect(cluster?.verdict.line).toContain("neither found nor ruled out");
    expect(cluster?.verdict.line).not.toContain("Isolated and traceable");
    expect(cluster?.verdict.line).not.toContain("no serial-launch cluster");
  });

  // Same evidence state, reported by the server instead of hit locally: the
  // deployer route walked up as far as its own budget allowed and said so.
  it("treats a server-truncated trail as unfinished, whatever the client budget allowed", async () => {
    stubRoutes([
      {
        match: `evm-deployer?wallet=${root}`,
        body: {
          available: true,
          deployments: 1,
          funder: { address: anonFunder, label: null, kind: "wallet" },
          trailTruncatedAt: anonFunder,
        },
      },
      { match: `evm-funder?wallet=${anonFunder}`, body: { available: true, seededCount: 0, seededDeployers: [] } },
      { match: `evm-deployer?wallet=${anonFunder}`, body: { available: true } },
    ]);

    const cluster = await traceOperator(root, opts, () => {});

    expect(cluster?.stats.sweeps).toBe(1);
    expect(cluster?.budgetExhausted).toBe(false);
    expect(cluster?.verdict.tone).toBe("neutral");
    expect(cluster?.verdict.line).toContain("neither found nor ruled out");
    expect(cluster?.verdict.line).not.toContain("no serial-launch cluster");
  });

  // The root's age is a fact about the launch, so it is measured at the mint. A
  // funder upstream did not mint this token, so that instant says nothing about it.
  it("asks for the root deployer's age at the mint, and only the root's", async () => {
    const fetchMock = stubRoutes([
      {
        match: `evm-deployer?wallet=${root}`,
        body: { available: true, deployments: 1, funder: { address: anonFunder, label: null, kind: "wallet" } },
      },
      { match: `evm-funder?wallet=${anonFunder}`, body: { available: true, seededCount: 0, seededDeployers: [] } },
      { match: `evm-deployer?wallet=${anonFunder}`, body: { available: true } },
    ]);

    await traceOperator(root, { ...opts, mintedAt: 1785450548 }, () => {});

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.find((u) => u.includes(`wallet=${root}`))).toContain("mintedAt=1785450548");
    expect(urls.find((u) => u.includes(`wallet=${anonFunder}`) && u.includes("deployer"))).not.toContain("mintedAt");
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
