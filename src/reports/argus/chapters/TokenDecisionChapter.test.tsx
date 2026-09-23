import { describe, expect, it } from "vitest";
import { tokenDecisionView } from "./TokenDecisionChapter";
import type { TokenDossier } from "../../../token/audit";

const base: Parameters<typeof tokenDecisionView>[0] = {
  token: { name: "Saved token", symbol: "SAVE", address: "0x123", chain: "base", socials: [] } as unknown as TokenDossier,
  score: 21, verdictLabel: "AVOID", verdictTone: "avoid", favorable: false,
  supports: [], concerns: [], nextSteps: [], verified: [], coveragePercent: 100,
  successful: 6, applicable: 6, openChecks: [], currentDataEnabled: false,
  onCheckCurrentData: () => undefined, privateReport: false, saving: false, persistenceFailed: false,
};

describe("saved token decision adapter", () => {
  it("preserves a capped saved result instead of recomputing it from its dimensions", () => {
    const view = tokenDecisionView({ ...base, composition: [{ axis: "contract", label: "Contract", score: 90, weight: 100, rationale: "Raw result before the saved safety limit." }] });
    expect(view.tokenScore).toMatchObject({ score: 21, verdictWord: "AVOID", tone: "red" });
    expect(view.tokenScore?.rows[0]?.awarded).toBe(90);
    expect(view.primary).toMatchObject({ score: null, verdictWord: "Not assessed" });
  });

  it("keeps a missing project assessment distinct from a measured zero", () => {
    const view = tokenDecisionView({ ...base, secondaryScore: { label: "Project", score: 0, verdictLabel: "FAIL" } });
    expect(view.primary).toMatchObject({ score: 0, verdictWord: "FAIL", tone: "red" });
    expect(view.primary?.withheldReason).toBeUndefined();
  });

  it("keeps partial coverage visible without changing the saved score", () => {
    const view = tokenDecisionView({ ...base, score: 88, verdictLabel: "PASS", favorable: true, scoreIsProvisional: true, successful: 5, openChecks: [{ label: "Holder identities", note: "Provider unavailable" }] });
    expect(view.tokenScore).toMatchObject({ score: 88, provisional: true, tone: "amber", status: "5/6 required checks complete · provisional" });
    expect(view.checkRail?.open).toEqual([{ label: "Holder identities", note: "Provider unavailable" }]);
  });

  it("retains the resolved account and distinct official product surfaces", () => {
    const links = [{ label: "Project site", url: "https://project.example" }, { label: "Docs", url: "https://docs.example" }];
    const view = tokenDecisionView({ ...base, xHandle: "resolved", website: "https://token.example", additionalLinks: links });
    expect(view).toMatchObject({ xHandle: "resolved", website: "https://token.example", additionalLinks: links });
  });
});
