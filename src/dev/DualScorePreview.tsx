import { InvestigationDecisionCanvas } from "../components/InvestigationDecisionCanvas";

const projectComposition = [
  { axis: "P1", label: "Team and leadership", score: 9, weight: 16, rationale: "One creator is linked; the operating team is only partly disclosed." },
  { axis: "P2", label: "Product and execution", score: 13, weight: 24, rationale: "A live product surface and product claims are visible." },
  { axis: "P3", label: "Token design and conduct", score: 15, weight: 20, rationale: "The official account resolves to the assessed token." },
  { axis: "P4", label: "Backers and partnerships", score: 3, weight: 14, rationale: "No verified institutional backer was captured." },
  { axis: "P5", label: "Traction and usage", score: 11, weight: 14, rationale: "Current market and social activity are measurable." },
  { axis: "P6", label: "Transparency and integrity", score: 3, weight: 12, rationale: "Governance and legal disclosures remain limited." },
];

const tokenComposition = [
  { axis: "T1", label: "Liquidity", score: 18, weight: 24, rationale: "A usable pool is visible; protection remains to be proven." },
  { axis: "T2", label: "Contract safety", score: 16, weight: 26, rationale: "No critical mechanical trap was recorded." },
  { axis: "T3", label: "Token mechanics", score: 12, weight: 12, rationale: "The saved tradeability checks completed." },
  { axis: "T4", label: "Holders", score: 13, weight: 16, rationale: "The holder set is measurable without a governing concentration failure." },
  { axis: "T5", label: "Market activity", score: 11, weight: 12, rationale: "The selected market has current activity." },
  { axis: "T6", label: "Maturity and presence", score: 9, weight: 10, rationale: "Official channels resolve to the token." },
];

export function DualScorePreview() {
  return (
    <main className="min-h-screen bg-void px-6 py-8 text-ink">
      <div className="report-frame report-style-2 mx-auto max-w-[1500px] rounded-2xl border border-line bg-panel px-8 shadow-sm">
        <InvestigationDecisionCanvas
          presentationStyle={2}
          subjectName="EARN on Hood"
          subjectSummary="A live onchain yield product with an official token, observable market activity and sustained public interest. The product and the asset are related, but they answer different diligence questions."
          verdictLabel="Caution"
          score={54}
          scoreLabel="Project diligence score"
          scoreContext="Team, product, token conduct, backers, traction and transparency."
          composition={projectComposition}
          secondaryScore={{
            label: "Token safety score",
            score: 79,
            verdictLabel: "Pass",
            context: "Contract, tradeability, liquidity, holders, market data and sanctions.",
            composition: tokenComposition,
          }}
          favorable={false}
          verdictTone="caution"
          supports={[
            { label: "A live product surface and active public market create a real subject worth investigating." },
            { label: "The token completed the saved mechanical safety checks without a critical trap." },
          ]}
          concerns={[
            { label: "The accountable operating team and independent assurance remain only partly evidenced." },
            { label: "Liquidity protection and ownership controls still need stronger verification." },
          ]}
          nextSteps={[{ label: "Verify the operating team, review the deployed contract and reconcile token control." }]}
          verified={[{ label: "Official project identity and token binding" }]}
          coveragePercent={100}
          successful={7}
          applicable={7}
        />
      </div>
    </main>
  );
}
