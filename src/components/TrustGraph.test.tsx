import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrustGraph } from "./TrustGraph";

describe("TrustGraph relationship depth", () => {
  it("renders an affiliated fund and its portfolio company as a true second hop", () => {
    const html = renderToStaticMarkup(<TrustGraph
      nodes={[
        { type: "Person", key: "@subject", subject: true },
        { type: "Company", key: "@fund", label: "Fund" },
        { type: "Company", key: "project.example", label: "Project" },
      ]}
      edges={[
        { src: "@subject", dst: "@fund", type: "AFFILIATED_WITH" },
        { src: "@fund", dst: "project.example", type: "INVESTED_IN" },
      ]}
    />);

    expect(html).toContain("affiliated with");
    expect(html).toContain("invested in");
    expect(html).toContain("project.example");
  });
});
