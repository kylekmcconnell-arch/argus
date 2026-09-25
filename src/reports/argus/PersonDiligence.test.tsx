import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonDiligence } from "./PersonDiligence";
import { CompanyEdge } from "./CompanyEdge";
import type { Dossier } from "../../data/dossier";

describe("subject-specific diligence presentation", () => {
  it("does not treat a display name or resolved name without binding as doxxed", () => {
    const html = renderToStaticMarkup(<PersonDiligence dossier={{ display_name: "Example", resolved_name: "Example Person" } as Dossier} facts={[]} />);
    expect(html).toContain("Public identity unresolved");
    expect(html).toContain("not a completed background check");
    expect(html).toContain("Co-founders and collaborators");
    expect(html).toContain("Engineering and shipped work");
    expect(html).not.toContain("Example Person");
  });
  it("distinguishes linked public identity from speculative names", () => {
    const html = renderToStaticMarkup(<PersonDiligence dossier={{ resolved_name: "Example Person", identity_binding: "independent_exact_handle" } as Dossier} facts={[]} />);
    expect(html).toContain("Public identity linked");
    expect(html).toContain("Example Person");
  });
  it("does not invent a privacy mechanism or moat for an empty report", () => {
    const html = renderToStaticMarkup(<CompanyEdge facts={[]} />);
    expect(html).toContain("their edge?");
    expect(html).toContain("Not established in this saved report");
    expect(html).not.toContain("Evidence recorded");
  });
  it("keeps a claimed mechanism and contradiction alongside their sources", () => {
    const html = renderToStaticMarkup(<CompanyEdge facts={[{ predicate: "product", value: "FHE", status: "conflicted", sources: [{ url: "https://example.com/docs", excerpt: "The product plans FHE.", relation: "supports" }, { url: "https://example.com/review", excerpt: "The live version uses a mixer.", relation: "contradicts" }] }]} />);
    expect(html).toContain("plans FHE");
    expect(html).toContain("live version uses a mixer");
    expect(html).toContain("conflicted");
    expect(html).toContain("does not establish a durable moat");
  });
});
