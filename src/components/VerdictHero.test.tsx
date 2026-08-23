// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerdictHero } from "./VerdictHero";

describe("VerdictHero", () => {
  it("explains a passing score in plain language without changing the recorded figures", () => {
    const html = renderToStaticMarkup(
      <VerdictHero
        token={{
          score: 93,
          verdict: "PASS",
          capApplied: null,
          axes: [
            {
              key: "T2",
              label: "Contract safety",
              score: 26,
              weight: 26,
              rationale: "verified source, ownership renounced.",
            },
            {
              key: "T1",
              label: "Liquidity & lock",
              score: 18,
              weight: 24,
              rationale: "$3,071,603 pooled, LP mostly in one wallet.",
            },
          ],
        } as never}
        savedLabel="Saved Aug 22, 2026"
      />,
    );

    const host = document.createElement("div");
    host.innerHTML = html;

    expect(host.textContent).toContain("Most checks passed. Review the remaining risks.");
    expect(host.textContent).toContain("Why it scored 93:");
    expect(host.textContent).toContain("Contract safety scored 26 of 26 points.");
    expect(host.textContent).toContain("The source code is verified, and ownership has been renounced.");
    expect(host.textContent).toContain("The main concern is liquidity setup, which scored 18 of 24 points.");
    expect(host.textContent).toContain("The liquidity pool holds $3,071,603, but most liquidity-provider tokens are held in one wallet.");
    expect(host.textContent).toContain("Open the evidence below for every source and calculation.");

    expect(host.textContent).not.toMatch(/record holds|carries the file|the drag is|full basis sits/i);
    expect(host.textContent).not.toMatch(/a document or the chain says so|ARGUS worked it out|nobody has evidenced this/i);
    expect(host.querySelector('[aria-label="How to read the dotted figures"]')).toBeNull();
    expect(host.querySelectorAll('.prov-value[title="Derived by ARGUS"]')).toHaveLength(2);
  });
});
