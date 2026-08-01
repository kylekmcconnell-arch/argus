import { describe, expect, it, vi } from "vitest";

const { attachPanelCost, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ attachPanelCost, resolvePanelCostVersion }));

import { fundingTrailNote, inboundFunderFromInstructions } from "./deployer";

// The trace is strictly inbound, so no sentence built from it may claim the money
// left anywhere. This is the pattern that shipped the "cashes out at a KYC'd
// Coinbase account" copy on top of a funded-from fact.
const CASHES_OUT = /cash(es|ed)?\s*out/i;
const CASHES_OUT_HYPHENATED = /cash(es|ed)?-out/i; // same claim, spelling the first pattern cannot see

const CEX_ORIGIN = { address: "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE", label: "Coinbase", kind: "cex" as const };
const ANON_ORIGIN = { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: null, kind: "wallet" as const };

function everyBranch(): string[] {
  return [
    fundingTrailNote({ funder: null, fundedFrom: null, hops: 0, anonHops: 0, truncatedAt: null, walletTooActive: true }),
    fundingTrailNote({ funder: null, fundedFrom: null, hops: 0, anonHops: 0, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: CEX_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 1, anonHops: 0, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 2, anonHops: 1, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 4, anonHops: 3, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 3, anonHops: 3, truncatedAt: ANON_ORIGIN.address, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 4, anonHops: 4, truncatedAt: null, walletTooActive: false }),
  ];
}

describe("deployer funding-trail copy policy", () => {
  it("never claims a cash-out, in any branch", () => {
    for (const note of everyBranch()) {
      const failure = `upstream-origin copy asserted a downstream terminus: ${note}`;
      expect(note, failure).not.toMatch(CASHES_OUT);
      expect(note, failure).not.toMatch(CASHES_OUT_HYPHENATED);
    }
  });

  it("states the exchange as the source of the money, not its destination", () => {
    const note = fundingTrailNote({ funder: CEX_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 1, anonHops: 0, truncatedAt: null, walletTooActive: false });
    expect(note).toContain("The deployer wallet was funded from a KYC'd Coinbase account.");
    expect(note).not.toMatch(CASHES_OUT);
  });

  it("keeps the intermediary count on the funded-from sentence", () => {
    const one = fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 2, anonHops: 1, truncatedAt: null, walletTooActive: false });
    const three = fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 4, anonHops: 3, truncatedAt: null, walletTooActive: false });
    expect(one).toContain("funded from a KYC'd Coinbase account through 1 intermediary wallet.");
    expect(three).toContain("funded from a KYC'd Coinbase account through 3 intermediary wallets.");
  });

  it("reports a trail that reached no exchange as unreached, not as clean", () => {
    const cold = fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 3, anonHops: 3, truncatedAt: ANON_ORIGIN.address, walletTooActive: false });
    const anon = fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 1, anonHops: 1, truncatedAt: null, walletTooActive: false });
    expect(cold).toContain("goes cold at a high-activity wallet");
    expect(cold).toContain("No KYC'd exchange origin reached.");
    expect(anon).toContain("Funding trail runs 1 hop back to an anonymous wallet");
    expect(anon).toContain("with no KYC'd exchange origin");
  });

  it("does not invent a funder when the trace found none", () => {
    expect(fundingTrailNote({ funder: null, fundedFrom: null, hops: 0, anonHops: 0, truncatedAt: null, walletTooActive: false }))
      .toBe("No clear funding source found on-chain.");
    expect(fundingTrailNote({ funder: null, fundedFrom: null, hops: 0, anonHops: 0, truncatedAt: null, walletTooActive: true }))
      .toBe("Wallet too active to trace the original funder within limits.");
  });
});

describe("deployer funder scan direction", () => {
  const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
  const OTHER = "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S";

  it("returns the payer when the wallet is the destination", () => {
    const instrs = [{ parsed: { type: "transfer", info: { source: OTHER, destination: WALLET, lamports: 2_000_000 } } }];
    expect(inboundFunderFromInstructions(instrs, WALLET)).toBe(OTHER);
  });

  it("ignores a transfer where the wallet is the source", () => {
    const instrs = [{ parsed: { type: "transfer", info: { source: WALLET, destination: OTHER, lamports: 2_000_000 } } }];
    expect(inboundFunderFromInstructions(instrs, WALLET)).toBeNull();
  });

  it("returns the rent payer that created the wallet account", () => {
    const instrs = [{ parsed: { type: "createAccount", info: { source: OTHER, newAccount: WALLET } } }];
    expect(inboundFunderFromInstructions(instrs, WALLET)).toBe(OTHER);
  });

  it("ignores self-funding and unparsed instructions", () => {
    expect(inboundFunderFromInstructions([{ parsed: { type: "transfer", info: { source: WALLET, destination: WALLET } } }], WALLET)).toBeNull();
    expect(inboundFunderFromInstructions([{ programId: "Vote111" }], WALLET)).toBeNull();
    expect(inboundFunderFromInstructions(undefined as unknown as any[], WALLET)).toBeNull();
  });
});
