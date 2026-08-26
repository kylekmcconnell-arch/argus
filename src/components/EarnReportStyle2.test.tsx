// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EarnReportStyle2 } from "./EarnReportStyle2";

describe("EarnReportStyle2", () => {
  it("keeps project diligence and token safety visibly separate", () => {
    const html = renderToStaticMarkup(<EarnReportStyle2 />);

    expect(html).toContain("Project diligence");
    expect(html).toContain("Token safety");
    expect(html).toContain(">54<");
    expect(html).toContain(">79<");
    expect(html).toContain("These are related but different scores");
    expect(html).not.toContain("6/7");
  });

  it("makes the web analysis and real team profile visible", () => {
    const html = renderToStaticMarkup(<EarnReportStyle2 />);

    expect(html).toContain("Web analysis");
    expect(html).toContain("This is the @earnonhood ARGUS audited");
    expect(html).toContain("https://unavatar.io/x/0xTharmas");
    expect(html).toContain("alt=\"Tharmas profile\"");
  });

  it("states incomplete social coverage and uses a market-size band", () => {
    const html = renderToStaticMarkup(<EarnReportStyle2 />);

    expect(html).toContain("Coverage incomplete — score withheld");
    expect(html).toContain("market-size band · not a global rank");
    expect(html).toContain("Activity score withheld");
  });

  it("names every loading phase and the score composition dimensions", () => {
    const html = renderToStaticMarkup(<EarnReportStyle2 />);

    expect(html).toContain("Binding EARN on Hood to $EARN");
    expect(html).toContain("Checking contract, holders and liquidity");
    expect(html).toContain("Writing the decision memo");
    expect(html).toContain("Building score composition");
    expect(html).toContain("Transparency");
    expect(html).toContain("Maturity &amp; presence");
  });

  it("preserves the complete project, web, token, connection, and method file", () => {
    const html = renderToStaticMarkup(<EarnReportStyle2 />);

    expect(html).toContain("earnonhood.com");
    expect(html).toContain("One creator is source-grounded");
    expect(html).toContain("Six chapters. Two governing gaps.");
    expect(html).toContain("Holder concentration");
    expect(html).toContain("Seven recorded links form the current relationship map");
    expect(html).toContain("Every topic ARGUS checked");
    expect(html).toContain("Challenge this report");
    expect(html).toContain("51 source references");
  });
});
