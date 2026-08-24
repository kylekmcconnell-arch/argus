import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvestigationDecisionCanvas } from "./InvestigationDecisionCanvas";

describe("InvestigationDecisionCanvas public states", () => {
  it("explains a report with no saved check register without showing 0/0 as completion", () => {
    const html = renderToStaticMarkup(
      <InvestigationDecisionCanvas
        verdictLabel="Not ready"
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
    expect(html).toContain("No check results were saved");
    expect(html).not.toContain("0/0 checks");
    expect(html).not.toContain('role="progressbar"');
  });
});
