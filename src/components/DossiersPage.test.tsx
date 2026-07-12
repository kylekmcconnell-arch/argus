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
  logEntries: [] as Array<{ ref: string; query: string; flags: string[] }>,
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

vi.mock("../lib/auditlog", () => ({ mergedLog: () => harness.logEntries }));
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
  harness.logEntries = [];
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

describe("DossiersPage case library filters", () => {
  const openReportLabels = () => [...container.querySelectorAll<HTMLButtonElement>("button[aria-label^='Open stored report for']")]
    .map((button) => button.getAttribute("aria-label"));

  const clickFilter = async (name: string): Promise<void> => {
    const filter = [...container.querySelectorAll<HTMLButtonElement>("[aria-label='Case type filter'] button")]
      .find((button) => button.textContent?.includes(name));
    if (!filter) throw new Error(`Missing ${name} case filter`);
    await act(async () => filter.click());
  };

  const search = async (value: string): Promise<void> => {
    const input = container.querySelector<HTMLInputElement>("#dossier-search");
    if (!input) throw new Error("Missing case search input");
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
  };

  it("combines type and case-insensitive text filters without changing the stored result set", async () => {
    harness.active = [
      { kind: "person", ref: "alice_founder", query: "@alice", contributor: "Enigma" },
      { kind: "token", ref: "0xalpha", query: "$ALPHA", contributor: "Kyle" },
      { kind: "investigation", ref: "0xbeta", query: "$BETA", contributor: "Dana Analyst" },
      { kind: "site", ref: "alpha.xyz", query: "alpha.xyz", contributor: "Kyle" },
    ];
    await renderPage(vi.fn());

    expect(openReportLabels()).toEqual([
      "Open stored report for @alice",
      "Open stored report for $ALPHA",
      "Open stored report for $BETA",
      "Open stored report for alpha.xyz",
    ]);

    await clickFilter("People");
    expect(openReportLabels()).toEqual(["Open stored report for @alice"]);

    await clickFilter("Projects");
    expect(openReportLabels()).toEqual([
      "Open stored report for $ALPHA",
      "Open stored report for $BETA",
    ]);

    await search("dAnA aNaLySt");
    expect(openReportLabels()).toEqual(["Open stored report for $BETA"]);

    await search("");
    await clickFilter("Sites");
    expect(openReportLabels()).toEqual(["Open stored report for alpha.xyz"]);

    await clickFilter("All cases");
    await search("ALPHA");
    expect(openReportLabels()).toEqual([
      "Open stored report for $ALPHA",
      "Open stored report for alpha.xyz",
    ]);
  });

  it("classifies a PROJECT-role person report with projects instead of people", async () => {
    harness.active = [
      { kind: "person", ref: "project_account", query: "@project_account" },
      { kind: "person", ref: "alice_founder", query: "@alice" },
    ];
    harness.logEntries = [
      { ref: "project_account", query: "@project_account", flags: ["role:PROJECT"] },
      { ref: "alice_founder", query: "@alice", flags: ["role:FOUNDER"] },
    ];
    await renderPage(vi.fn());

    await clickFilter("People");
    expect(openReportLabels()).toEqual(["Open stored report for @alice"]);

    await clickFilter("Projects");
    expect(openReportLabels()).toEqual(["Open stored report for @project_account"]);
  });
});
