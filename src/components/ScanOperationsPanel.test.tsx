// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanOperationsPanel } from "./ScanOperationsPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

describe("ScanOperationsPanel", () => {
  it("puts quota failures and scan economics in plain language", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      totals: { scans: 1, running: 0, degraded: 1, failed: 0, credits: 1, providerCostUsd: 0.12, unknownCostScans: 0 },
      alerts: [{ id: "a", scanId: "s", scanLabel: "$ARGUS", severity: "critical", title: "X failed during post search", detail: "The provider reported exhausted credits or quota." }],
      scans: [{ id: "s", label: "$ARGUS", kind: "token", status: "degraded", actor: "Kyle", creditsCharged: 1, providerCostUsd: 0.12, costBasis: "estimated", startedAt: "2026-08-23T20:00:00Z", durationMs: 2000, failureDetail: null, alerts: [], checks: [], providers: [{ id: "p", provider: "X", operation: "post_search", calls: 1, usd: 0.12, status: "failed", detail: "The provider reported exhausted credits or quota." }] }],
    }), { status: 200 })));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ScanOperationsPanel />); });
    await act(async () => {});
    expect(container.textContent).toContain("Scan operations");
    expect(container.textContent).toContain("The provider reported exhausted credits or quota.");
    expect(container.textContent).toContain("1 credit");
    expect(container.textContent).toContain("$0.120 estimated");
    act(() => root.unmount());
    container.remove();
  });
});
