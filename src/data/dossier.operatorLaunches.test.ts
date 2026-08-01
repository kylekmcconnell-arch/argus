// The operator's launch record is the join nothing else in the market makes:
// an X following edge to a bio claim to a launch announcement to a launchpad
// creator index. It used to reach the client as one grey sentence. These tests
// pin the STRUCTURE onto the frozen payload, because a saved report has to be
// able to render that record years after the pools it describes are gone.
//
// Fixtures are the real recorded $LINKR audit (eval/recordings/linkrbot):
// token 5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump, operator @S0Ldev,
// prior launch uAPE (5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump).
import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier, type OperatorLaunchHistory } from "./dossier";
import { emptyEvidence } from "./evidence";

const LINKR_HISTORY = (): OperatorLaunchHistory => ({
  creatorWallet: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
  totalLaunches: 2,
  launches: [{
    symbol: "uAPE",
    name: "Hold to Mint",
    mint: "5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump",
    chain: "solana",
    // dexscreener returned fdv 7082 / liquidity 7248.16 for this mint.
    fdvUsd: 7082,
    liquidityUsd: 7248.16,
    xHandle: "uapenfts",
    url: "https://dexscreener.com/solana/9b9ftcwjuutdsf9zd79qysb9aprinfiuj4bsbggbwrye",
    link: "operator_announcement",
    announcement: { text: "uAPE is now live", at: "2026-05-13T00:00:00.000Z" },
  }],
  claimedProjects: [
    { label: "@pmpr_bot", at: "2026-03-04T00:00:00.000Z", quote: "Why I built @pmpr_bot" },
    { label: "Splitr", at: "2025-12-02T00:00:00.000Z", quote: "Splitr is now live" },
  ],
});

const evidenceWithHistory = (history?: OperatorLaunchHistory) => {
  const evidence = emptyEvidence("@linkrbot");
  evidence.roles = [SubjectClass.PROJECT];
  if (history) evidence.operatorLaunches = history;
  return evidence;
};

describe("assembleDossier operator launch history", () => {
  it("carries every launch, its current value and how it was tied to the operator", () => {
    const dossier = assembleDossier(evidenceWithHistory(LINKR_HISTORY()), true);

    expect(dossier.operatorLaunches).toEqual(LINKR_HISTORY());
    // The count is the operator's record including this launch, not the
    // length of the prior-launch list.
    expect(dossier.operatorLaunches?.totalLaunches).toBe(2);
    expect(dossier.operatorLaunches?.launches[0]).toMatchObject({
      symbol: "uAPE",
      fdvUsd: 7082,
      link: "operator_announcement",
      mint: "5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump",
    });
  });

  it("keeps a dead prior project as the operator's own dated claim, with their words", () => {
    const dossier = assembleDossier(evidenceWithHistory(LINKR_HISTORY()), true);

    // ARGUS never asserts abandonment: what survives is the claim, its date,
    // and the sentence the operator wrote.
    expect(dossier.operatorLaunches?.claimedProjects).toEqual([
      { label: "@pmpr_bot", at: "2026-03-04T00:00:00.000Z", quote: "Why I built @pmpr_bot" },
      { label: "Splitr", at: "2025-12-02T00:00:00.000Z", quote: "Splitr is now live" },
    ]);
  });

  it("carries an operator whose only record is claims no live pool backs", () => {
    const history = LINKR_HISTORY();
    history.launches = [];
    history.totalLaunches = 1;

    const dossier = assembleDossier(evidenceWithHistory(history), true);

    expect(dossier.operatorLaunches?.launches).toEqual([]);
    expect(dossier.operatorLaunches?.claimedProjects).toHaveLength(2);
  });

  it("omits the field entirely when the operator has no record at all", () => {
    const empty = assembleDossier(
      evidenceWithHistory({ launches: [], totalLaunches: 1, claimedProjects: [] }),
      true,
    );
    const absent = assembleDossier(evidenceWithHistory(), true);

    // An empty record must not render an empty track-record panel.
    expect(empty).not.toHaveProperty("operatorLaunches");
    expect(absent).not.toHaveProperty("operatorLaunches");
  });

  it("freezes its own copy so a later mutation of the evidence bag cannot rewrite a report", () => {
    const evidence = evidenceWithHistory(LINKR_HISTORY());
    const dossier = assembleDossier(evidence, true);

    evidence.operatorLaunches!.launches[0].fdvUsd = 0;
    evidence.operatorLaunches!.launches.push({
      symbol: "LATER",
      mint: "later",
      chain: "solana",
      fdvUsd: null,
      liquidityUsd: null,
      url: "https://pump.fun/coin/later",
      link: "same_creator_wallet",
    });
    evidence.operatorLaunches!.claimedProjects.push({ label: "$LATER", quote: "later" });

    expect(dossier.operatorLaunches?.launches).toHaveLength(1);
    expect(dossier.operatorLaunches?.launches[0].fdvUsd).toBe(7082);
    expect(dossier.operatorLaunches?.claimedProjects).toHaveLength(2);
  });

  it("carries per-launch detail the collector attaches later, without a field-by-field rebuild", () => {
    // The collector keeps enriching a launch (mint date, verified peak, the
    // permalink to the operator's own post). The assembler must not be the
    // place each new field quietly disappears.
    const history = LINKR_HISTORY();
    history.subjectMintedAt = "2026-07-30T22:29:08.000Z";
    history.launches[0].mintedAt = "2026-05-13T18:26:55.000Z";
    history.launches[0].athUsd = 412_000;
    history.launches[0].athAt = "2026-05-14T02:00:00.000Z";
    history.launches[0].permalink = "https://x.com/S0Ldev/status/1922000000000000000";
    history.launches[0].announcement!.url = "https://x.com/S0Ldev/status/1922000000000000000";
    history.claimedProjects[0].url = "https://x.com/S0Ldev/status/1897000000000000000";

    const dossier = assembleDossier(evidenceWithHistory(history), true);

    expect(dossier.operatorLaunches).toEqual(history);
    expect(dossier.operatorLaunches?.subjectMintedAt).toBe("2026-07-30T22:29:08.000Z");
    expect(dossier.operatorLaunches?.launches[0].athUsd).toBe(412_000);
    expect(dossier.operatorLaunches?.launches[0].permalink).toContain("/status/");
    expect(dossier.operatorLaunches?.claimedProjects[0].url).toContain("/status/");
  });

  it("survives a JSON round trip, which is how a frozen report is stored and reopened", () => {
    const dossier = assembleDossier(evidenceWithHistory(LINKR_HISTORY()), true);
    const reopened = JSON.parse(JSON.stringify(dossier)) as typeof dossier;

    expect(reopened.operatorLaunches).toEqual(LINKR_HISTORY());
  });
});
