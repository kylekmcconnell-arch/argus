// The collector already resolved the operator's full launch record and then
// threw the structure away, pushing one flattened sentence into findings. The
// client had no way to render a launch, its current value, or how it was tied
// to the operator. These tests pin the structured record onto the evidence bag
// so it travels with the frozen payload, WITHOUT removing the sentence a
// stored report already carries.
//
// Fixture bodies are the real recorded $LINKR audit (eval/recordings/linkrbot):
//   GET frontend-api-v3.pump.fun/coins/5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump
//     -> {"mint":"5NHPW...pump","creator":"BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
//         "symbol":"LINKR","name":"linkrbot","twitter":"https://x.com/linkrbot",
//         "created_timestamp":1785450548000,"usd_market_cap":15216.499771986833}
//   GET frontend-api-v3.pump.fun/coins?creator=BpH4h...&offset=0&limit=50
//     -> [ the same LINKR row ]   (the subject is excluded from its own history)
// The prior uAPE launch is added to the creator index here so the same-wallet
// path has something to resolve without any keyed provider.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence, type CollectedEvidence, type ProjectTokenSnapshot } from "../src/data/evidence";
import { coldIntake } from "./orchestrate";
// Importing the assembler registers the CollectedEvidence.operatorLaunches
// declaration this stamp writes to, and is the read side of the contract.
import { assembleDossier } from "../src/data/dossier";
import { prepareProvenanceRows } from "../api/_provenance";

const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "COINGECKO_API_KEY",
  "CRYPTORANK_API_KEY",
  "GITHUB_TOKEN",
  "HELIUS_API_KEY",
  "MONID_API_KEY",
  "OPENROUTER_API_KEY",
  "PDL_API_KEY",
  "SERPER_API_KEY",
  "TWITTERAPI_KEY",
  "XAI_API_KEY",
];

const LINKR_MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const UAPE_MINT = "5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump";
const CREATOR = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";

const LINKR_COIN = {
  mint: LINKR_MINT,
  creator: CREATOR,
  symbol: "LINKR",
  name: "linkrbot",
  twitter: "https://x.com/linkrbot",
  created_timestamp: 1785450548000,
  usd_market_cap: 15216.499771986833,
};

const UAPE_COIN = {
  mint: UAPE_MINT,
  creator: CREATOR,
  symbol: "uAPE",
  name: "Hold to Mint",
  twitter: "https://x.com/uapenfts",
  created_timestamp: 1778711215000,
  usd_market_cap: 7082,
};

const projectToken = (): ProjectTokenSnapshot => ({
  verified: true,
  verification: "official_x",
  name: "linkrbot",
  symbol: "LINKR",
  rank: null,
  address: LINKR_MINT,
  chain: "solana",
  sourceUrl: "https://pump.fun/coin/" + LINKR_MINT,
  capturedAt: "2026-07-30T00:00:00.000Z",
});

const stubPumpfun = (creatorIndex: unknown[]) => {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes("pump.fun/coins?creator=")) {
      return Promise.resolve(new Response(JSON.stringify(creatorIndex), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url.includes("pump.fun/coins/")) {
      return Promise.resolve(new Response(JSON.stringify(LINKR_COIN), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    // Every other provider is dead in this test: the prior-launch path is
    // keyless and must stand on the launchpad's own index alone.
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const runIntake = async (evidence: CollectedEvidence) => {
  await coldIntake({ handle: evidence.profile.handle, evidence, emit: () => undefined }, true);
};

const linkrEvidence = () => {
  const evidence = emptyEvidence("@linkrbot");
  evidence.projectToken = projectToken();
  return evidence;
};

describe("operator launch history reaches the client", () => {
  beforeEach(() => {
    for (const key of PROVIDER_ENV) vi.stubEnv(key, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stamps the structured record onto the evidence bag, not just a sentence", async () => {
    stubPumpfun([LINKR_COIN, UAPE_COIN]);
    const evidence = linkrEvidence();

    await runIntake(evidence);

    expect(evidence.operatorLaunches).toBeDefined();
    expect(evidence.operatorLaunches?.creatorWallet).toBe(CREATOR);
    // This launch plus the one prior launch the creator index named.
    expect(evidence.operatorLaunches?.totalLaunches).toBe(2);
    expect(evidence.operatorLaunches?.launches).toEqual([
      expect.objectContaining({
        symbol: "uAPE",
        mint: UAPE_MINT,
        chain: "solana",
        fdvUsd: 7082,
        xHandle: "uapenfts",
        url: `https://pump.fun/coin/${UAPE_MINT}`,
        // The tie is stated by pump.fun's own creator index, never inferred.
        link: "same_creator_wallet",
      }),
    ]);
    // The subject's own token is never part of its operator's prior record.
    expect(evidence.operatorLaunches?.launches.some((launch) => launch.mint === LINKR_MINT)).toBe(false);
  });

  it("keeps the existing narrative finding alongside the structure", async () => {
    stubPumpfun([LINKR_COIN, UAPE_COIN]);
    const evidence = linkrEvidence();

    await runIntake(evidence);

    const finding = evidence.findings.find((entry) => entry.finding_type === "OperatorLaunchHistory");
    expect(finding).toMatchObject({
      source_url: `https://pump.fun/coin/${UAPE_MINT}`,
      verification_status: "Verified",
      evidence_origin: "deterministic",
      artifact_verified: true,
      // Informational base rate, never an accusation.
      polarity: 0,
      independent_source_count: 1,
    });
    // The narrative wording belongs to describeLaunchHistory and keeps growing;
    // what must not regress is that a stored report still carries the count and
    // the earlier launch's CURRENT value in prose.
    expect(finding?.claim).toContain("This is launch 2 tied to the same operator.");
    expect(finding?.claim).toContain("uAPE now $7.1K");
  });

  it("carries the record through assembleDossier onto the frozen payload", async () => {
    stubPumpfun([LINKR_COIN, UAPE_COIN]);
    const evidence = linkrEvidence();

    await runIntake(evidence);
    const dossier = assembleDossier(evidence, true);

    expect(dossier.operatorLaunches?.launches[0]).toMatchObject({ symbol: "uAPE", fdvUsd: 7082 });
    // A saved report is JSON on disk; the structure has to survive that.
    const reopened = JSON.parse(JSON.stringify(dossier)) as typeof dossier;
    expect(reopened.operatorLaunches).toEqual(evidence.operatorLaunches);
  });

  it("passes the strict lineage validator, and each prior launch becomes its own provenance row", async () => {
    stubPumpfun([LINKR_COIN, UAPE_COIN]);
    const evidence = linkrEvidence();

    await runIntake(evidence);
    const dossier = assembleDossier(evidence, true);

    const prepared = prepareProvenanceRows(
      { organizationId: "00000000-0000-4000-8000-000000000011", attestationState: "analyst_submitted" },
      dossier,
      [],
    );

    // The launch URL is a real public source, so persisting the structure adds
    // lineage rather than costing it: the reader can open what was cited.
    const launchRow = prepared.evidenceItems.find((row) =>
      String(row.source_url ?? "").includes(UAPE_MINT));
    expect(launchRow).toBeDefined();
    expect(String(launchRow?.title ?? "")).toContain("uAPE");
  });

  it("stays silent for a first-time operator with nothing behind them", async () => {
    // The creator index names only this token: no prior launch, no claim.
    stubPumpfun([LINKR_COIN]);
    const evidence = linkrEvidence();

    await runIntake(evidence);

    expect(evidence.operatorLaunches).toBeUndefined();
    expect(evidence.findings.some((entry) => entry.finding_type === "OperatorLaunchHistory")).toBe(false);
    expect(assembleDossier(evidence, true)).not.toHaveProperty("operatorLaunches");
  });

  it("never runs the launchpad path for a token that is not a verified solana launch", async () => {
    const fetchMock = stubPumpfun([LINKR_COIN, UAPE_COIN]);
    const evidence = linkrEvidence();
    evidence.projectToken = { ...projectToken(), chain: "ethereum" };

    await runIntake(evidence);

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("pump.fun"))).toBe(false);
    expect(evidence.operatorLaunches).toBeUndefined();
  });
});
