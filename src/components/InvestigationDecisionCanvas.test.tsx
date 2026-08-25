import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvestigationDecisionCanvas } from "./InvestigationDecisionCanvas";

describe("InvestigationDecisionCanvas public states", () => {
  it("explains a report with no saved check register without showing 0/0 as completion", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Not ready"
        score={null}
        favorable={false}
        verdictTone="caution"
        supports={[]}
        concerns={[{ label: "Early funding origin remains unresolved" }]}
        nextSteps={[]}
        verified={[]}
        coveragePercent={0}
        successful={0}
        applicable={0}
      />,
    );

    expect(html).toContain("No checks saved");
    expect(html).toContain("Score withheld");
    expect(html).toContain('data-report-score="prominent"');
    expect(html).toContain('width:240px');
    expect(html).toContain('height:240px');
    expect(html).toContain("ARGUS risk score withheld");
    expect(html).toContain("No check results were saved");
    expect(html).not.toContain("0/0 checks");
    expect(html).not.toContain('role="progressbar"');
  });

  it("keeps the saved risk score separate from completed-check coverage", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Caution"
        score={45}
        favorable={false}
        verdictTone="caution"
        supports={[]}
        concerns={[{ label: "Liquidity remains concentrated" }]}
        nextSteps={[]}
        verified={[{ label: "Official identity confirmed" }]}
        coveragePercent={100}
        successful={7}
        applicable={7}
      />,
    );

    expect(html).toContain("ARGUS risk score 45 out of 100");
    expect(html).toContain('data-report-score="prominent"');
    expect(html).toContain("ARGUS risk score");
    expect(html).toContain('<svg width="240" height="240"');
    expect(html).toContain("7/7 required report checks complete");
    expect(html).not.toContain(">100%</p>");
  });

  it("labels an early score when required checks remain open", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Review with gaps"
        score={20}
        scoreIsProvisional
        favorable={false}
        verdictTone="caution"
        supports={[]}
        concerns={[]}
        nextSteps={[{ label: "Confirm the audit" }]}
        verified={[]}
        coveragePercent={71}
        successful={5}
        applicable={7}
        checkScopeLabel="Token safety checks"
      />,
    );

    expect(html).toContain("ARGUS risk score 20 out of 100");
    expect(html).toContain("Early risk score");
    expect(html).toContain("5/7 token safety checks complete · provisional");
    expect(html).toContain("Token safety checks");
    expect(html).toContain("What is still open");
  });

  it("shows one evidence-bound discovery with its proof and reversal condition", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Caution"
        score={62}
        favorable={false}
        verdictTone="caution"
        discovery={{
          id: "usage-capital-divergence",
          headline: "Usage and locked capital are moving in opposite directions",
          consequence: "Fees fell 24% while locked value rose 18% over 30 days.",
          reversalCondition: "A later 30-day window where fees and locked value move together would change this read.",
          evidenceHref: "#token-market",
        }}
        supports={[]}
        concerns={[]}
        nextSteps={[]}
        verified={[]}
        coveragePercent={100}
        successful={7}
        applicable={7}
      />,
    );

    expect(html).toContain('data-testid="decision-discovery"');
    expect(html).toContain("ARGUS found");
    expect(html).toContain("Open the proof");
    expect(html).toContain("What would change it:");
    expect(html).toContain('href="#token-market"');
  });

  it("renders a source-receipted relationship path without hiding the graph", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Caution"
        score={62}
        favorable={false}
        verdictTone="caution"
        discovery={{
          id: "control-path:token>project>person",
          headline: "$ARGUS connects to Ada through @argus",
          consequence: "This source-backed path binds a named operator to the official project identity.",
          reversalCondition: "A newer primary source that breaks a link would change this read.",
          evidenceHref: "#relationships",
          path: ["$ARGUS", "@argus", "Ada"],
          receipts: [
            { label: "Account receipt 1", href: "https://x.com/argus" },
            { label: "Team receipt 2", href: "https://argus.example/team" },
          ],
        }}
        supports={[]}
        concerns={[]}
        nextSteps={[]}
        verified={[]}
        coveragePercent={100}
        successful={7}
        applicable={7}
      />,
    );

    expect(html).toContain("Source-backed path: $ARGUS to @argus to Ada");
    expect(html).toContain("Open relationship graph");
    expect(html).toContain('href="https://x.com/argus"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Team receipt 2");
  });

  it("shows a compact decision lock with the governing evidence link", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Caution"
        score={35}
        favorable={false}
        verdictTone="caution"
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
        supports={[]}
        concerns={[]}
        nextSteps={[]}
        verified={[]}
        coveragePercent={100}
        successful={7}
        applicable={7}
      />,
    );

    expect(html).toContain('data-testid="decision-boundary"');
    expect(html).toContain("Decision lock");
    expect(html).toContain("What controls this result");
    expect(html).toContain("What will not change it");
    expect(html).toContain("What would unlock it");
    expect(html).toContain('href="#token-methodology"');
  });
});
