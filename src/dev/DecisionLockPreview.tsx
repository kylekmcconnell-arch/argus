import { InvestigationDecisionCanvas } from "../components/InvestigationDecisionCanvas";

export function DecisionLockPreview() {
  return (
    <main className="min-h-screen bg-void px-4 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-[1440px] rounded-xl border border-line bg-panel px-5 py-6 shadow-sm sm:px-8">
        <header className="border-b border-line/70 pb-5">
          <p className="eyebrow text-signal-lift">Token investigation</p>
          <h1 className="display mt-1 text-[32px] text-ink">$EXAMPLE</h1>
          <p className="mt-2 text-[13.5px] text-ink-dim">Saved report · decision-boundary preview</p>
        </header>
        <InvestigationDecisionCanvas
          verdictLabel="Caution"
          score={35}
          favorable={false}
          verdictTone="caution"
          composition={[
            { axis: "T2", label: "Contract safety", score: 8, weight: 26, rationale: "Mint authority remains active.", tone: "fail" },
            { axis: "T3", label: "Taxes and tradeability", score: 12, weight: 12, rationale: "Buying and selling worked in the saved test.", tone: "pass" },
            { axis: "T1", label: "Liquidity", score: 18, weight: 24, rationale: "Trading funds are not locked.", tone: "caution" },
            { axis: "T6", label: "Maturity", score: 10, weight: 10, rationale: "The project has a public footprint.", tone: "pass" },
          ]}
          discovery={{
            id: "control-path:token-project-person",
            headline: "$EXAMPLE connects to a named operator through the official project account",
            consequence: "Two saved primary records bind the token to the project and the project to its operator.",
            reversalCondition: "A newer primary record that breaks or reattributes either link would change this read.",
            evidenceHref: "#relationships",
          }}
          decisionBoundary={{
            schemaVersion: 1,
            kind: "cap",
            controllingFact: "More tokens can still be created by an active mint authority.",
            boundary: "This finding caps the score at 35/100, even if every other scored area improves.",
            willNotChange: "Higher price, volume, liquidity, followers, or social activity cannot override this safety limit.",
            unlockCondition: "A current chain receipt must show that the mint authority was permanently revoked.",
            evidenceArea: "contract",
          }}
          decisionBoundaryEvidenceHref="#token-methodology"
          supports={[{ label: "Buying and selling worked in the saved test." }]}
          concerns={[{ label: "Mint authority remains active." }]}
          nextSteps={[{ label: "Verify the current mint-authority account on-chain." }]}
          verified={[{ label: "Official token contract is bound to the project." }]}
          coveragePercent={100}
          successful={7}
          applicable={7}
          checkScopeLabel="Token safety checks"
        />
      </div>
    </main>
  );
}
