// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../graph/store", () => ({ recordForensicEntities: vi.fn() }));

import { recordForensicEntities } from "../graph/store";
import { VcReport } from "./VcReport";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("VC portfolio spend boundary", () => {
  it("does not run the paid portfolio search merely because a report opened", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <VcReport
          handle="@investor"
          name="Investor Example"
          panelCostToken="report-bound-capability"
        />,
      );
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("paid Grok search");

    const run = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Run portfolio analysis"));
    expect(run).toBeDefined();

    await act(async () => run?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/vc-portfolio?handle=investor&name=Investor+Example",
      { headers: { "x-argus-panel-token": "report-bound-capability" } },
    );
    expect(container.textContent).toContain("not evidence that the investor has no portfolio");
    expect(container.textContent).toContain("may incur another paid Grok search");
  });

  it("keeps the action disabled without a fresh report capability", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<VcReport handle="@investor" name="Investor Example" />);
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("Saved report required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps model-discovered portfolio rows as unverified leads outside the graph", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      available: true,
      evidence_state: "model_lead",
      candidates: [{
        project: "Candidate Labs",
        ticker: null,
        contract: null,
        chain: null,
        x_handle: "@candidate",
        stage: "Seed",
        year: "2025",
        outcome: "active",
        source_url: "https://example.com/round",
        source_title: "Round announcement",
        evidence_state: "model_lead",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<VcReport handle="@investor" name="Investor Example" panelCostToken="report-bound-capability" />);
    });
    const run = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Run portfolio analysis"));
    await act(async () => run?.click());
    await settle();

    expect(container.textContent).toContain("1 unverified current-search portfolio candidate");
    expect(container.textContent).toContain("Every panel row remains outside the trust graph and verdict");
    expect(container.textContent).not.toContain("same project appears in frozen evidence");
    expect(container.textContent).toContain("Candidate source · Round announcement");
    expect(recordForensicEntities).not.toHaveBeenCalled();
  });

  it("labels a project-name overlap without claiming the panel verified attribution", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      available: true,
      evidence_state: "model_lead",
      candidates: [{
        project: "Candidate Labs",
        source_url: "https://example.com/round",
        source_title: "Round announcement",
        evidence_state: "model_lead",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <VcReport
          handle="@investor"
          name="Investor Example"
          verifiedProjects={["Candidate Labs"]}
          panelCostToken="report-bound-capability"
        />,
      );
    });
    const run = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Run portfolio analysis"));
    await act(async () => run?.click());
    await settle();

    expect(container.textContent).toContain("1 unverified current-search portfolio candidate");
    expect(container.textContent).toContain("same project appears in frozen evidence");
    expect(container.textContent).toContain("this panel does not verify the investor attribution");
    expect(recordForensicEntities).not.toHaveBeenCalled();
  });

  it("shows expired report context separately and does not offer another paid retry", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "invalid_panel_context",
      message: "This paid supplemental check needs a fresh persisted report. Rescan before running it.",
    }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<VcReport handle="@investor" name="Investor Example" panelCostToken="expired-capability" />);
    });
    const run = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Run portfolio analysis"));
    await act(async () => run?.click());
    await settle();

    expect(container.textContent).toContain("Fresh saved report required");
    expect(container.textContent).toContain("Rescan before running it");
    expect(container.textContent).not.toContain("Retry paid search");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("labels provider failure and asks for explicit paid-retry consent", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "portfolio_search_failed",
      message: "The paid portfolio search failed. No portfolio conclusion or graph relationship was recorded.",
    }), { status: 502, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<VcReport handle="@investor" name="Investor Example" panelCostToken="report-bound-capability" />);
    });
    const run = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Run portfolio analysis"));
    await act(async () => run?.click());
    await settle();

    expect(container.textContent).toContain("paid portfolio search failed");
    expect(container.textContent).toContain("Retry paid search (may incur cost)");
    expect(container.textContent).not.toContain("No source-linked portfolio candidates");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
