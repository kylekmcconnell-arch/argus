// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to checked-in workspace sources.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspacePages = [
  "AboutPage.tsx",
  "AdminPage.tsx",
  "AlertsPage.tsx",
  "ApiPage.tsx",
  "ChangelogPage.tsx",
  "DossiersPage.tsx",
  "FoundersPage.tsx",
  "GraphPage.tsx",
  "KolsPage.tsx",
  "ProjectsPage.tsx",
  "ProvidersPage.tsx",
  "RadarPage.tsx",
  "ReconPage.tsx",
  "ReferralsPage.tsx",
  "TrackRecordPage.tsx",
  "TrendingPage.tsx",
  "VcsPage.tsx",
  "WatchlistPage.tsx",
] as const;

const fluidWorkflowSurfaces = [
  ["DossierReport.tsx", "report-frame"],
  ["FindWallet.tsx", "report-frame"],
  ["PolymarketTraderRun.tsx", "workspace-frame"],
  ["ProjectView.tsx", "report-frame"],
  ["ThreatScanPage.tsx", "report-frame"],
  ["WalletScanPage.tsx", "report-frame"],
] as const;

describe("fluid workspace canvas", () => {
  it("defines a full-width frame with responsive gutters", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const frame = css.match(/\.workspace-frame\s*\{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";

    expect(frame).toContain("width: 100%");
    expect(frame).toMatch(/padding:\s*clamp\([^;]+\)\s+clamp\(/);
    expect(frame).not.toContain("max-width");
  });

  it.each(workspacePages)("uses the shared frame on %s", (page) => {
    const source = readFileSync(new URL(`../components/${page}`, import.meta.url), "utf8");
    expect(source).toContain('className="workspace-frame"');
  });

  it.each(fluidWorkflowSurfaces)("keeps %s on a fluid canvas", (page, frame) => {
    const source = readFileSync(new URL(`../components/${page}`, import.meta.url), "utf8");
    expect(source).toContain(frame);
  });
});
