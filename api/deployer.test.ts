import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ attachPanelCost, resolvePanelCostVersion }));

import handler, {
  formatSol,
  fundingTrailNote,
  inboundFundingFromInstructions,
  launchOriginNote,
  parseMintedAt,
  walletAgeAtLaunch,
} from "./deployer";

// The trace is strictly inbound, so no sentence built from it may claim the money
// left anywhere. This is the pattern that shipped the "cashes out at a KYC'd
// Coinbase account" copy on top of a funded-from fact.
const CASHES_OUT = /cash(es|ed)?\s*out/i;
const CASHES_OUT_HYPHENATED = /cash(es|ed)?-out/i; // same claim, spelling the first pattern cannot see

const CEX_ORIGIN = { address: "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE", label: "Coinbase", kind: "cex" as const };
const ANON_ORIGIN = { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: null, kind: "wallet" as const };

// Observed on the public Solana RPC for deployer BpH4h6pd… (mint 5NHPWfma…pump):
// oldest signature blockTime 1785444844 = 2026-07-30 20:54:04 UTC, a 2000000000
// lamport transfer from Coinbase hot wallet GJRs4FwH…; the mint landed at
// 1785450548 = 22:29:08 UTC, 5704 seconds (95 minutes) later.
const FIRST_FUNDED_AT = 1785444844;
const MINTED_AT = 1785450548;
const SEED = { lamports: 2_000_000_000, fundedAt: FIRST_FUNDED_AT };

function everyBranch(): string[] {
  const trails = [
    fundingTrailNote({ funder: null, fundedFrom: null, hops: 0, anonHops: 0, truncatedAt: null, walletTooActive: true }),
    fundingTrailNote({ funder: null, fundedFrom: null, hops: 0, anonHops: 0, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: CEX_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 1, anonHops: 0, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 2, anonHops: 1, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 4, anonHops: 3, truncatedAt: null, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 3, anonHops: 3, truncatedAt: ANON_ORIGIN.address, walletTooActive: false }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 4, anonHops: 4, truncatedAt: null, walletTooActive: false }),
    // the same branches once the seed facts are known and stated
    fundingTrailNote({ funder: CEX_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 1, anonHops: 0, truncatedAt: null, walletTooActive: false, seedStated: true }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 2, anonHops: 1, truncatedAt: null, walletTooActive: false, seedStated: true }),
    fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: ANON_ORIGIN, hops: 4, anonHops: 4, truncatedAt: null, walletTooActive: false, seedStated: true }),
  ];
  const origins = [
    launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: MINTED_AT }),
    launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: null }),
    launchOriginNote({ funder: ANON_ORIGIN, seed: SEED, mintedAt: MINTED_AT }),
    launchOriginNote({ funder: ANON_ORIGIN, seed: { lamports: null, fundedAt: FIRST_FUNDED_AT }, mintedAt: MINTED_AT }),
  ];
  return [...trails, ...origins];
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

  it("keeps the intermediary count even when the seed sentence already ran", () => {
    const one = fundingTrailNote({ funder: ANON_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 2, anonHops: 1, truncatedAt: null, walletTooActive: false, seedStated: true });
    expect(one).toContain("funded from a KYC'd Coinbase account through 1 intermediary wallet.");
    // Only the restatement of a fact the seed sentence already carried is dropped.
    const direct = fundingTrailNote({ funder: CEX_ORIGIN, fundedFrom: CEX_ORIGIN, hops: 1, anonHops: 0, truncatedAt: null, walletTooActive: false, seedStated: true });
    expect(direct).toBe("Funding trail: deployer ← Coinbase.");
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

  it("returns the payer and the amount when the wallet is the destination", () => {
    const instrs = [{ parsed: { type: "transfer", info: { source: OTHER, destination: WALLET, lamports: 2_000_000_000 } } }];
    expect(inboundFundingFromInstructions(instrs, WALLET)).toEqual({ source: OTHER, lamports: 2_000_000_000 });
  });

  it("ignores a transfer where the wallet is the source", () => {
    const instrs = [{ parsed: { type: "transfer", info: { source: WALLET, destination: OTHER, lamports: 2_000_000 } } }];
    expect(inboundFundingFromInstructions(instrs, WALLET)).toBeNull();
  });

  it("returns the rent payer that created the wallet account", () => {
    const instrs = [{ parsed: { type: "createAccount", info: { source: OTHER, newAccount: WALLET, lamports: 1_500_000 } } }];
    expect(inboundFundingFromInstructions(instrs, WALLET)).toEqual({ source: OTHER, lamports: 1_500_000 });
  });

  it("reports an unstated amount as unknown rather than zero", () => {
    const instrs = [{ parsed: { type: "transfer", info: { source: OTHER, destination: WALLET } } }];
    expect(inboundFundingFromInstructions(instrs, WALLET)).toEqual({ source: OTHER, lamports: null });
  });

  it("ignores self-funding and unparsed instructions", () => {
    expect(inboundFundingFromInstructions([{ parsed: { type: "transfer", info: { source: WALLET, destination: WALLET } } }], WALLET)).toBeNull();
    expect(inboundFundingFromInstructions([{ programId: "Vote111" }], WALLET)).toBeNull();
    expect(inboundFundingFromInstructions(undefined as unknown as any[], WALLET)).toBeNull();
  });
});

describe("wallet age at launch", () => {
  it("measures the wallet's age at the mint, not at read time", () => {
    const age = walletAgeAtLaunch({ firstActivityAt: FIRST_FUNDED_AT, mintedAt: MINTED_AT, nowSeconds: MINTED_AT + 86_400 * 30 });
    expect(age.basis).toBe("mint");
    expect(age.ageSeconds).toBe(5704);
    expect(age.ageMinutes).toBe(95);
    expect(age.ageDays).toBe(0);
    expect(age.asOf).toBe(MINTED_AT);
  });

  it("returns the same age a month later, because the launch instant does not move", () => {
    const atScan = walletAgeAtLaunch({ firstActivityAt: FIRST_FUNDED_AT, mintedAt: MINTED_AT, nowSeconds: MINTED_AT + 120 });
    const muchLater = walletAgeAtLaunch({ firstActivityAt: FIRST_FUNDED_AT, mintedAt: MINTED_AT, nowSeconds: MINTED_AT + 86_400 * 365 });
    expect(muchLater).toEqual(atScan);
  });

  it("labels and dates a scan-time age when no mint instant was supplied", () => {
    const now = MINTED_AT + 86_400 * 30;
    const age = walletAgeAtLaunch({ firstActivityAt: FIRST_FUNDED_AT, mintedAt: null, nowSeconds: now });
    expect(age.basis).toBe("scan");
    expect(age.asOf).toBe(now);
    expect(age.ageDays).toBe(30);
  });

  it("reports an unknown age rather than a negative one when the mint predates the oldest signature we reached", () => {
    const age = walletAgeAtLaunch({ firstActivityAt: MINTED_AT, mintedAt: FIRST_FUNDED_AT, nowSeconds: MINTED_AT + 600 });
    expect(age.ageSeconds).toBeNull();
    expect(age.ageMinutes).toBeNull();
    expect(age.ageDays).toBeNull();
  });

  it("has no age at all without a first activity", () => {
    expect(walletAgeAtLaunch({ firstActivityAt: null, mintedAt: MINTED_AT, nowSeconds: MINTED_AT }).ageDays).toBeNull();
  });
});

describe("mint instant parsing", () => {
  const now = MINTED_AT + 86_400;

  it("accepts seconds, milliseconds and ISO", () => {
    expect(parseMintedAt(String(MINTED_AT), now)).toBe(MINTED_AT);
    expect(parseMintedAt(String(MINTED_AT * 1000), now)).toBe(MINTED_AT);
    expect(parseMintedAt("2026-07-30T22:29:08Z", now)).toBe(MINTED_AT);
  });

  it("refuses a value that cannot be a Solana mint instant", () => {
    expect(parseMintedAt("not-a-time", now)).toBeNull();
    expect(parseMintedAt("0", now)).toBeNull();
    expect(parseMintedAt(String(now + 86_400), now)).toBeNull(); // the future
    expect(parseMintedAt(undefined, now)).toBeNull();
    expect(parseMintedAt(["1785450548"], now)).toBeNull();
  });
});

describe("seed amount formatting", () => {
  it("states whole and fractional SOL the way a reader checks it", () => {
    expect(formatSol(2_000_000_000)).toBe("2.0 SOL");
    expect(formatSol(2_500_000_000)).toBe("2.5 SOL");
    expect(formatSol(2_350_000_000)).toBe("2.35 SOL");
    expect(formatSol(50_000_000)).toBe("0.05 SOL");
    expect(formatSol(2_100_000)).toBe("0.0021 SOL");
    expect(formatSol(250_000_000_000)).toBe("250 SOL");
  });
});

describe("launch origin note", () => {
  it("states when the wallet was funded, with how much, by whom, and how long before the mint", () => {
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: MINTED_AT }))
      .toBe("Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It minted this token 95 minutes later.");
  });

  it("names an anonymous payer as an address, never as an exchange", () => {
    const note = launchOriginNote({ funder: ANON_ORIGIN, seed: SEED, mintedAt: MINTED_AT });
    expect(note).toContain("from 9WzDXw…AWWM.");
    expect(note).not.toContain("KYC'd");
  });

  // A Coinbase withdrawal 95 minutes before a launch is also the most common
  // legitimate first-time-launcher pattern. The fact is the deliverable; the
  // adjective would be an accusation ARGUS cannot support.
  it("reports the pattern as fact, with no alarm word and no verdict", () => {
    const alarming = /\bonly\b|\bjust\b|\bmere(ly)?\b|fresh|brand.new|suspicious|red flag|warning|risk|rug|scam|immediately|minutes before/i;
    for (const note of [
      launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: MINTED_AT }),
      launchOriginNote({ funder: ANON_ORIGIN, seed: SEED, mintedAt: MINTED_AT }),
      launchOriginNote({ funder: CEX_ORIGIN, seed: { lamports: 20_000_000, fundedAt: MINTED_AT - 61 }, mintedAt: MINTED_AT }),
    ]) {
      expect(note, `origin fact read as a flag: ${note}`).not.toMatch(alarming);
    }
  });

  it("omits the gap it cannot state, and says nothing at all without a funding time", () => {
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: null }))
      .toBe("Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account.");
    // mint before the funding transaction we matched: no gap can be asserted
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: FIRST_FUNDED_AT - 60 }))
      .not.toContain("later");
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: { lamports: 2_000_000_000, fundedAt: null }, mintedAt: MINTED_AT })).toBe("");
    expect(launchOriginNote({ funder: null, seed: SEED, mintedAt: MINTED_AT })).toBe("");
  });

  it("states the source without the amount when the amount is unknown", () => {
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: { lamports: null, fundedAt: FIRST_FUNDED_AT }, mintedAt: MINTED_AT }))
      .toBe("Wallet first funded 2026-07-30 20:54 UTC from a KYC'd Coinbase account. It minted this token 95 minutes later.");
  });

  it("reads sub-minute and multi-day gaps without inventing precision", () => {
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: FIRST_FUNDED_AT + 30 })).toContain("less than a minute later");
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: FIRST_FUNDED_AT + 7200 })).toContain("2 hours later");
    expect(launchOriginNote({ funder: CEX_ORIGIN, seed: SEED, mintedAt: FIRST_FUNDED_AT + 86_400 * 9 })).toContain("9 days later");
  });
});

// End to end over the real transactions this wallet actually has on Solana, so
// the age, the amount and the sentence are all checked against chain data rather
// than against the shape of the code.
describe("GET /api/deployer", () => {
  const DEPLOYER = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
  const COINBASE = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
  const FUNDING_SIG = "5H5eLiPbgUcKCuhbMg3AgocUbQYsRnkNsk6iQPLZpvLfszh3p1LBrtSVaxoJcNbYsv5TjTPYfpNxeraqxH7X9ZEy";
  const MINT_SIG = "4smaaJ48RMbo8WHggQZGSbLhUDVavprfVbsFWNzhGZw8fu4CisToCTzABmuAwYn5QmBtcWrE39NY9ixKvQxbYaDT";
  const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";

  function chainFetch(options?: { enhancedTx?: unknown }) {
    return vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      if (url.startsWith("https://api.helius.xyz/")) {
        return new Response(JSON.stringify(options?.enhancedTx ?? [
          { type: "TOKEN_MINT", tokenTransfers: [{ mint: MINT }] },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(init?.body ?? "{}") as { method: string; params: any[] };
      if (body.method === "getSignaturesForAddress") {
        if (body.params[0] !== DEPLOYER) return jsonRpc([]);
        return jsonRpc([
          { signature: MINT_SIG, blockTime: MINTED_AT },
          { signature: FUNDING_SIG, blockTime: FIRST_FUNDED_AT },
        ]);
      }
      if (body.method === "getTransaction") {
        if (body.params[0] !== FUNDING_SIG) return jsonRpc(null);
        return jsonRpc({
          blockTime: FIRST_FUNDED_AT,
          transaction: {
            message: {
              accountKeys: [{ pubkey: COINBASE }, { pubkey: DEPLOYER }],
              instructions: [{ parsed: { type: "transfer", info: { source: COINBASE, destination: DEPLOYER, lamports: 2_000_000_000 } } }],
            },
          },
          meta: { preBalances: [45672521288118, 0], postBalances: [45670521280118, 2_000_000_000] },
        });
      }
      throw new Error(`unexpected rpc ${body.method}`);
    });
  }

  function jsonRpc(result: unknown) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  }

  async function run(query: Record<string, string>) {
    const captured: { status?: number; body?: any } = {};
    const res = {
      status(code: number) { captured.status = code; return this; },
      json(body: unknown) { captured.body = body; return this; },
    };
    await handler({ method: "GET", query, headers: { "x-argus-panel-token": "signed" } } as never, res as never);
    return captured;
  }

  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: "org", userId: "user" });
    resolvePanelCostVersion.mockReset().mockReturnValue("version");
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("dates the wallet's age to the mint and states the seed amount", async () => {
    vi.setSystemTime((MINTED_AT + 86_400) * 1000);
    vi.stubGlobal("fetch", chainFetch());

    const { status, body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(status).toBe(200);
    expect(body.walletAgeBasis).toBe("mint");
    expect(body.walletAgeMinutes).toBe(95);
    expect(body.walletAgeDays).toBe(0);
    expect(body.walletAgeAsOf).toBe("2026-07-30T22:29:08.000Z");
    expect(body.seedFunding).toMatchObject({ from: COINBASE, label: "Coinbase", lamports: 2_000_000_000, sol: 2, at: "2026-07-30T20:54:04.000Z" });
    expect(body.note).toBe(
      "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It minted this token 95 minutes later. Funding trail: deployer ← Coinbase.",
    );
  });

  // The regression: the age used to be measured against Date.now(), so reopening
  // the same frozen report a month later re-read the same launch as older.
  it("reads the same age whenever the report is opened", async () => {
    vi.setSystemTime((MINTED_AT + 3_600) * 1000);
    vi.stubGlobal("fetch", chainFetch());
    const fresh = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    vi.setSystemTime((MINTED_AT + 86_400 * 45) * 1000);
    vi.stubGlobal("fetch", chainFetch());
    const reopened = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(reopened.body.walletAgeMinutes).toBe(fresh.body.walletAgeMinutes);
    expect(reopened.body.walletAgeDays).toBe(fresh.body.walletAgeDays);
    expect(reopened.body.note).toBe(fresh.body.note);
  });

  it("dates a scan-time age instead of passing it off as a launch fact", async () => {
    vi.setSystemTime((FIRST_FUNDED_AT + 86_400 * 3) * 1000);
    vi.stubGlobal("fetch", chainFetch());

    const { body } = await run({ wallet: DEPLOYER });

    expect(body.walletAgeBasis).toBe("scan");
    expect(body.walletAgeDays).toBe(3);
    expect(body.walletAgeAsOf).toBe("2026-08-02T20:54:04.000Z");
    expect(body.mintedAt).toBeNull();
    expect(body.note).toContain("Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account.");
    expect(body.note).not.toContain("later");
  });

  it("reports an unavailable mint count as unknown, never as not-serial", async () => {
    vi.setSystemTime((MINTED_AT + 60) * 1000);
    vi.stubGlobal("fetch", chainFetch({ enhancedTx: { error: "helius down" } }));

    const { body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(body.tokensCreated).toBeNull();
    expect(body.serialMinter).toBeNull();
    expect(body.serialDeployer).toBeNull();
  });

  it("counts the deployer's own mints under the name of what it measures", async () => {
    vi.setSystemTime((MINTED_AT + 60) * 1000);
    vi.stubGlobal("fetch", chainFetch({
      enhancedTx: Array.from({ length: 6 }, (_, i) => ({ type: "TOKEN_MINT", tokenTransfers: [{ mint: `mint-${i}` }] })),
    }));

    const { body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(body.tokensCreated).toBe(6);
    expect(body.serialMinter).toBe(true);
    expect(body.serialDeployer).toBe(true);
  });
});
