import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TeamDiligencePanel } from "./TeamDiligencePanel";
import { ProviderDiscovery, InvestigationEvidence } from "./InvestigationEvidence";
import { buildTeamDiligence } from "../../lib/relationshipDiligence";
it("does not backfill a historical team assessment", () => {
  expect(renderToStaticMarkup(<TeamDiligencePanel />)).toContain("new investigation is required");
});
it("retains uncertain capacity, financial scope gaps and source evidence", () => {
  const team = buildTeamDiligence([{ name: "Cloud Example", role: "Investor", source: "team-page", evidence: "Startup credits", sourceUrl: "https://example.com/team", artifact_verified: true, evidence_origin: "deterministic", kind: "org" }], []);
  const html = renderToStaticMarkup(<TeamDiligencePanel team={team} />);
  expect(html).toContain("neither fraud nor financial backing"); expect(html).toContain("Capacity: unknown"); expect(html).toContain("https://example.com/team");
});
it("renders provider failures and discoveries distinctly without adverse attribution", () => {
  const html = renderToStaticMarkup(<ProviderDiscovery receipts={[{ provider: "courtlistener", status: "completed", capturedAt: "2026-09-25", calls: 1, estimatedUsd: null, note: "Coverage incomplete", candidates: [{ id: "1", title: "Possible namesake", url: "https://www.courtlistener.com/docket/123/example/", excerpt: "Identity unverified", attribution: "unresolved" }] }]} />);
  expect(html).toContain("Identity attribution unresolved"); expect(html).not.toContain("Verified record");
  expect(renderToStaticMarkup(<InvestigationEvidence />)).toContain("not saved in this version");
});
