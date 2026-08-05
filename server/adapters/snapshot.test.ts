import { describe, expect, it, vi } from "vitest";
import {
  candidateSpaceIds,
  describeGovernance,
  fetchGovernance,
  spaceBinding,
  summarizeProposal,
  usesDelegation,
  type GovernanceReading,
} from "./snapshot";

const UNI = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

const space = (overrides: Record<string, unknown> = {}) => ({
  id: "uniswapgovernance.eth",
  name: "Uniswap",
  verifiedBySnapshot: true,
  followers: 125274,
  proposalCount: 197,
  twitter: "uniswapfnd",
  website: "https://uniswapfoundation.org",
  strategyNames: ["uni"],
  strategyAddresses: [UNI],
  ...overrides,
});

describe("candidate space ids are discovery and never evidence", () => {
  it("generates the conventions real DAO spaces use", () => {
    const ids = candidateSpaceIds("Uniswap");
    expect(ids).toContain("uniswapgovernance.eth");
    expect(ids).toContain("uniswapdao.eth");
    expect(ids).toContain("uniswap.eth");
  });

  it("refuses a stem too short to be distinctive", () => {
    expect(candidateSpaceIds("AB")).toEqual([]);
    expect(candidateSpaceIds("")).toEqual([]);
  });
});

describe("binding a space to the subject", () => {
  it("binds on a strategy that reads the audited token contract", () => {
    // Uniswap's space twitter is the Foundation account and its site is
    // uniswapfoundation.org, so neither matches @Uniswap or uniswap.org. The
    // contract is what ties them.
    expect(spaceBinding(space(), {
      name: "Uniswap",
      tokenAddress: UNI.toLowerCase(),
      handle: "@Uniswap",
      website: "https://uniswap.org",
    })).toBe("token_contract");
  });

  it("binds on the official X account when no contract matches", () => {
    expect(spaceBinding(space({
      id: "gitcoindao.eth",
      twitter: "gitcoin",
      website: "https://gitcoin.co",
      strategyNames: ["with-delegation"],
      strategyAddresses: [],
    }), { name: "Gitcoin", handle: "@gitcoin" })).toBe("official_x");
  });

  it("binds on the official domain, including a subdomain of it", () => {
    expect(spaceBinding(space({ twitter: null, website: "https://gov.example.org" }), {
      name: "Example",
      website: "https://example.org",
    })).toBe("official_domain");
  });

  // The live trap: dodus.eth is named "uniswap", has zero followers, and its
  // voting strategy points at the genuine UNI contract. A strategy address is
  // chosen by whoever made the space, so it proves nothing on its own.
  it("refuses an unverified space even when it votes on the real token", () => {
    expect(spaceBinding(space({
      id: "dodus.eth",
      name: "uniswap",
      verifiedBySnapshot: false,
      followers: 0,
      twitter: null,
      website: null,
    }), { name: "Uniswap", tokenAddress: UNI })).toBeNull();
  });

  it("refuses a verified space that only matches the name", () => {
    // Verified says Snapshot vouches the space is real, not that it is THIS
    // project's. The candidate id was generated from the name, so accepting on
    // verified alone would still be a name match.
    expect(spaceBinding(space({ twitter: "someoneelse", website: "https://other.example" }), {
      name: "Uniswap",
    })).toBeNull();
  });

  it("accepts a space the caller already established", () => {
    expect(spaceBinding(space({ verifiedBySnapshot: false }), { spaceId: "uniswapgovernance.eth" })).toBe("supplied");
  });
});

describe("delegation detection is positive only", () => {
  it("recognises the delegation-aware strategies", () => {
    expect(usesDelegation(["uni"])).toBe(true);
    expect(usesDelegation(["with-delegation"])).toBe(true);
    expect(usesDelegation(["erc20-votes"])).toBe(true);
  });

  it("does not claim a custom strategy is delegation free", () => {
    // Aave runs opaque contract-call strategies. False here means "not
    // recognised", and the caveat must never be withheld because of it.
    expect(usesDelegation(["contract-call"])).toBe(false);
  });
});

describe("summarizing one proposal", () => {
  const proposal = {
    id: "0xabc",
    title: "[Temp Check] - Four for V4",
    votes: 118,
    scores: [5347714, 0, 1814],
    scores_total: 5349528,
    quorum: 10000000,
    end: 1770000000,
  };
  const votes = [
    { voter: "0x8d07D2251", vp: 2301704 },
    { voter: "0x683a4F991", vp: 2002445 },
    { voter: "0xB933AEe41", vp: 453273 },
  ];

  it("reports concentration over the voting power actually cast", () => {
    const summary = summarizeProposal(proposal, votes)!;
    expect(summary.voters).toBe(118);
    expect(summary.top1Pct).toBeCloseTo(43.0, 0);
    // The reported shape: two addresses carried 80% of this vote.
    expect(summary.top2Pct).toBeCloseTo(80.5, 0);
  });

  it("calls a proposal below its own quorum exactly that", () => {
    const summary = summarizeProposal(proposal, votes)!;
    expect(summary.quorumMet).toBe(false);
  });

  it("leaves quorum unmeasured when the space sets none, rather than passed", () => {
    const summary = summarizeProposal({ ...proposal, quorum: 0 }, votes)!;
    expect(summary.quorum).toBeNull();
    expect(summary.quorumMet).toBeNull();
  });

  it("does not ask whether one voter could flip an uncontested vote", () => {
    const summary = summarizeProposal({ ...proposal, scores: [5349528, 0, 0] }, votes)!;
    expect(summary.contested).toBe(false);
    expect(summary.topVoterCouldHaveFlipped).toBeNull();
  });

  it("flags a contested vote the largest voter could have decided", () => {
    // Winner 600k, runner-up 500k: a margin of 100k, and the top voter cast
    // 2.3M, so that address alone could have changed the result.
    const summary = summarizeProposal(
      { ...proposal, scores: [600000, 500000, 0], scores_total: 1100000 },
      votes,
    )!;
    expect(summary.contested).toBe(true);
    expect(summary.topVoterCouldHaveFlipped).toBe(true);
  });

  it("publishes no share when nothing was cast", () => {
    const summary = summarizeProposal({ ...proposal, scores_total: 0, scores: [] }, [])!;
    expect(summary.top1Pct).toBeNull();
    expect(summary.top2Pct).toBeNull();
  });
});

describe("what the reading supports saying", () => {
  const reading = (overrides: Partial<GovernanceReading> = {}): GovernanceReading => ({
    available: true,
    note: null,
    space: { ...space(), binding: "token_contract" } as GovernanceReading["space"],
    proposals: [
      summarizeProposal(
        { id: "0x1", title: "Four for V4", votes: 118, scores: [5347714, 0, 1814], scores_total: 5349528, quorum: 10000000, end: 1 },
        [{ voter: "0xA", vp: 2301704 }, { voter: "0xB", vp: 2002445 }],
      )!,
    ],
    delegationDetected: true,
    ...overrides,
  });

  it("states the concentration over the addresses that voted", () => {
    const claims = describeGovernance(reading());
    expect(claims[0]).toContain("uniswapgovernance.eth");
    expect(claims[0]).toContain("118 addresses voted");
  });

  it("always says voting power is not a holding, even with no delegation detected", () => {
    for (const detected of [true, false]) {
      const claims = describeGovernance(reading({ delegationDetected: detected }));
      expect(claims.some((claim) => claim.includes("not of tokens held"))).toBe(true);
    }
  });

  it("always says a Snapshot result is signalling rather than binding execution", () => {
    expect(describeGovernance(reading()).some((claim) => claim.includes("off-chain signalling"))).toBe(true);
  });

  it("never concludes that the project is captured or centralised", () => {
    for (const claim of describeGovernance(reading())) {
      expect(claim).not.toMatch(/captur|centrali|controlled by|cartel/i);
    }
  });

  it("publishes nothing from a reading that did not happen", () => {
    expect(describeGovernance({
      available: false, note: "down", space: null, proposals: [], delegationDetected: false,
    })).toEqual([]);
  });
});

describe("fetching, end to end", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  it("publishes nothing when only an unbindable namesake space exists", async () => {
    const fetchImpl = vi.fn(async () => json({
      data: {
        spaces: [{
          id: "dodus.eth",
          name: "uniswap",
          verified: false,
          followersCount: 0,
          proposalsCount: 1,
          twitter: null,
          website: null,
          strategies: [{ name: "erc20-balance-of", params: { address: UNI } }],
        }],
      },
    })) as unknown as typeof fetch;

    const reading = await fetchGovernance({ name: "Uniswap", tokenAddress: UNI }, { fetchImpl });
    expect(reading.available).toBe(false);
    expect(reading.space).toBeNull();
    expect(reading.note).toContain("nothing ties it to this project");
    // One call: it must not go on to read proposals from a space it refused.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a bound space with no closed proposals as unmeasured, not clean", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const body = String((init as RequestInit).body);
      if (body.includes("spaces(")) {
        return json({ data: { spaces: [{ id: "x.eth", name: "X", verified: true, followersCount: 9, proposalsCount: 0, twitter: "xproject", website: null, strategies: [] }] } });
      }
      return json({ data: { proposals: [] } });
    }) as unknown as typeof fetch;

    const reading = await fetchGovernance({ name: "XProject", handle: "@xproject" }, { fetchImpl });
    expect(reading.available).toBe(true);
    expect(reading.proposals).toEqual([]);
    expect(reading.note).toContain("no closed proposals");
    expect(describeGovernance(reading)).toEqual([]);
  });

  it("treats an unreachable hub as a gap rather than an absence of concentration", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;
    const reading = await fetchGovernance({ name: "Uniswap" }, { fetchImpl });
    expect(reading.available).toBe(false);
    expect(reading.note).toContain("did not respond");
  });
});
