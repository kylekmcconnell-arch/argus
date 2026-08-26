import { describe, expect, it } from "vitest";
import { reportStyleFromSearch, searchForReportStyle } from "./reportStyle";

describe("report style routing", () => {
  it("defaults every report to Style 2", () => {
    expect(reportStyleFromSearch("")).toBe(2);
    expect(reportStyleFromSearch("?s=%40strategicsuperr&kind=person")).toBe(2);
    expect(reportStyleFromSearch("?reportStyle=2")).toBe(2);
  });

  it("keeps Style 1 available as an explicit URL choice", () => {
    expect(reportStyleFromSearch("?reportStyle=1")).toBe(1);
    expect(searchForReportStyle("?s=%24EARN&kind=token", 1)).toContain("reportStyle=1");
    expect(searchForReportStyle("?s=%24EARN&kind=token&reportStyle=1", 2)).toBe("?s=%24EARN&kind=token");
  });
});
