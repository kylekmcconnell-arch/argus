// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportLookup } from "../lib/reports";
import type { ReportCompletenessState } from "../lib/reportVersion";
import type { WatchItem } from "../lib/watchlist";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  items: [] as WatchItem[],
  fetchReportState: vi.fn(),
  auditToken: vi.fn(),
  rebaseline: vi.fn(),
}));

vi.mock("../lib/watchlist", () => ({
  getWatchlist: () => harness.items,
  removeWatch: vi.fn(),
  rebaseline: harness.rebaseline,
  hydrateSharedWatchlist: vi.fn(async () => {}),
}));

vi.mock("../lib/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/reports")>();
  return { ...actual, fetchReportState: harness.fetchReportState };
});

vi.mock("../token/audit", () => ({ auditToken: harness.auditToken }));

import { WatchlistPage } from "./WatchlistPage";

let container: HTMLDivElement;
let root: Root;

function watchedPerson(): WatchItem {
  return {
    id: "@founder",
    kind: "person",
    label: "@founder",
    addedAt: 0,
    snapshot: { verdict: "PASS", score: 90 },
  };
}

function personLookup(
  verdict: string,
  score: number,
  completenessState?: ReportCompletenessState,
): ReportLookup {
  return {
    status: "open",
    report: {
      kind: "person",
      payload: {
        report: { composite_verdict: verdict, governing_score: score },
      },
      ...(completenessState ? {
        versionContext: {
          caseId: "00000000-0000-4000-8000-000000000101",
          reportVersionId: "00000000-0000-4000-8000-000000000201",
          version: 2,
          completenessState,
          attestationState: "server_collected",
          methodologyVersion: "person-v2",
          createdAt: "2026-07-11T12:00:00.000Z",
          checks: [{
            label: "Identity resolution",
            status: completenessState === "complete" ? "confirmed" : "unknown",
          }],
        },
      } : {}),
    },
  };
}

async function renderPage(): Promise<HTMLElement> {
  await act(async () => {
    root.render(<WatchlistPage onAudit={vi.fn()} />);
  });
  await vi.waitFor(() => {
    const badge = container.querySelector<HTMLElement>("[aria-label^='Current assessment:']");
    expect(badge?.textContent).not.toBe("…");
  });
  return container.querySelector<HTMLElement>("[aria-label^='Current assessment:']")!;
}

beforeEach(() => {
  harness.items = [watchedPerson()];
  harness.fetchReportState.mockReset();
  harness.auditToken.mockReset();
  harness.rebaseline.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("WatchlistPage decision-safe verdicts", () => {
  it.each(["partial", "failed"] as const)(
    "never renders a %s positive report as PASS",
    async (completenessState) => {
      harness.fetchReportState.mockResolvedValue(personLookup("PASS", 94, completenessState));

      const badge = await renderPage();

      expect(badge.textContent).toBe(completenessState === "failed" ? "INCOMPLETE · FAILED" : "INCOMPLETE");
      expect(badge.textContent).not.toContain("PASS");
      expect(badge.getAttribute("aria-label")).toContain(
        completenessState === "failed" ? "INVESTIGATION FAILED" : "INVESTIGATION INCOMPLETE",
      );
    },
  );

  it("keeps a partial adverse result visible as a risk signal", async () => {
    harness.fetchReportState.mockResolvedValue(personLookup("FAIL", 22, "partial"));

    const badge = await renderPage();

    expect(badge.textContent).toBe("RISK · FAIL");
    expect(badge.getAttribute("aria-label")).toContain("RISK SIGNAL");
    expect(badge.getAttribute("aria-label")).toContain("INVESTIGATION INCOMPLETE");
  });

  it("keeps a complete valid report final", async () => {
    harness.fetchReportState.mockResolvedValue(personLookup("PASS", 91, "complete"));

    const badge = await renderPage();

    expect(badge.textContent).toBe("PASS");
    expect(badge.getAttribute("aria-label")).toContain("VERDICT");
    expect(badge.getAttribute("aria-label")).toContain("EVIDENCE COVERAGE COMPLETE");
  });

  it("flags the loss of complete coverage even when the model signal stays PASS", async () => {
    harness.items = [{
      ...watchedPerson(),
      snapshot: { verdict: "PASS", score: 91, completenessState: "complete" },
    }];
    harness.fetchReportState.mockResolvedValue(personLookup("PASS", 91, "partial"));

    const badge = await renderPage();

    expect(badge.textContent).toBe("INCOMPLETE");
    expect(container.textContent).toContain("⚠ changed");
  });

  it("flags partial-to-failed coverage drift even when verdict and score do not move", async () => {
    harness.items = [{
      ...watchedPerson(),
      snapshot: { verdict: "PASS", score: 91, completenessState: "partial" },
    }];
    harness.fetchReportState.mockResolvedValue(personLookup("PASS", 91, "failed"));

    const badge = await renderPage();

    expect(badge.textContent).toBe("INCOMPLETE · FAILED");
    expect(container.textContent).toContain("⚠ changed");
  });
});
