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
    expect(html).toContain("<svg");
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
    expect(html).toContain("Research and follow-up");
  });
});
