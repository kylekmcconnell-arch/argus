// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportListing } from "../lib/reports";
import type { CaseBriefTarget } from "../lib/caseBrief";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  active: [] as ReportListing[],
  archived: [] as ReportListing[],
  changeReportLifecycle: vi.fn(),
}));

vi.mock("../lib/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/reports")>();
  return {
    ...actual,
    listReports: vi.fn(async (status?: string) => status === "archived" ? harness.archived : harness.active),
    changeReportLifecycle: harness.changeReportLifecycle,
  };
});

vi.mock("../lib/auditlog", () => ({ mergedLog: () => [] }));
vi.mock("../lib/scanstats", () => ({ scanStats: () => [], totalScans: () => 0 }));
vi.mock("../lib/analyst", () => ({ getAnalyst: () => "Kyle" }));
vi.mock("../graph/network", () => ({ buildAliasResolver: () => (key: string) => key }));
vi.mock("../graph/store", () => ({ getContributions: () => [] }));
vi.mock("../auth-context", () => ({ useArgusAuth: () => ({ role: "owner" }) }));

import { DossiersPage } from "./DossiersPage";

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function renderPage(onOpenBrief: (target: CaseBriefTarget) => void): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DossiersPage onOpen={vi.fn()} onOpenBrief={onOpenBrief} />);
  });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.active = [];
  harness.archived = [];
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe("DossiersPage case brief actions", () => {
  it("opens a separate exact brief for every grouped token and investigation facet", async () => {
    harness.active = [
      {
        caseId: "case-investigation",
        reportVersionId: "version-investigation",
        kind: "investigation",
        ref: "ExactContractAddress",
        query: "$EXACT",
        verdict: "CAUTION",
        score: 56,
      },
      {
        caseId: "case-token",
        reportVersionId: "version-token",
        kind: "token",
        ref: "ExactContractAddress",
        query: "$EXACT",
        verdict: "FAIL",
        score: 24,
      },
    ];
    const onOpenBrief = vi.fn<(target: CaseBriefTarget) => void>();
    await renderPage(onOpenBrief);

    const investigationBrief = container.querySelector<HTMLButtonElement>("[aria-label='Open case brief for the investigation facet $EXACT']");
    const tokenBrief = container.querySelector<HTMLButtonElement>("[aria-label='Open case brief for the token facet $EXACT']");
    expect(investigationBrief).not.toBeNull();
    expect(tokenBrief).not.toBeNull();

    await act(async () => investigationBrief?.click());
    await act(async () => tokenBrief?.click());
    expect(onOpenBrief).toHaveBeenNthCalledWith(1, {
      caseId: "case-investigation",
      expectedReportVersionId: "version-investigation",
    });
    expect(onOpenBrief).toHaveBeenNthCalledWith(2, {
      caseId: "case-token",
      expectedReportVersionId: "version-token",
    });
  });

  it("keeps archived case briefs readable even while the stored report is closed", async () => {
    harness.archived = [{
      caseId: "case-archived",
      reportVersionId: "version-archived",
      kind: "person",
      ref: "archived_founder",
      query: "@archived_founder",
      status: "archived",
    }];
    const onOpenBrief = vi.fn<(target: CaseBriefTarget) => void>();
    await renderPage(onOpenBrief);
    await act(async () => {
      const archivedTab = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Archived"));
      archivedTab?.click();
    });

    const brief = container.querySelector<HTMLButtonElement>("[aria-label='Open case brief for the person report @archived_founder']");
    expect(brief).not.toBeNull();
    await act(async () => brief?.click());
    expect(onOpenBrief).toHaveBeenCalledWith({
      caseId: "case-archived",
      expectedReportVersionId: "version-archived",
    });
  });
});
