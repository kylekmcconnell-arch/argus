// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PfpCheck } from "./PfpCheck";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("legacy profile-photo integrity overlay", () => {
  it("renders provider failure as unavailable instead of a clean result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: false,
      imageData: "data:image/jpeg;base64,YWJj",
      classification: "ai_generated",
      confidence: 0.99,
      flag: true,
      tells: ["stale model output"],
      note: "Official avatar bytes could not be fetched; no conclusion was recorded.",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await act(async () => {
      root.render(<PfpCheck handle="@alice" panelCostToken="signed-panel" />);
    });

    expect(container.textContent).toContain("unavailable · no conclusion");
    expect(container.textContent).toContain("no conclusion was recorded");
    expect(container.textContent).not.toContain("AI-generated image lead");
    expect(container.textContent).not.toContain("review lead · verify independently");
    expect(container.textContent).not.toContain("99%");
    expect(container.textContent).not.toContain("stale model output");
    expect(container.querySelector("img")).toBeNull();
  });

  it("labels model output as a review lead and shows the exact inspected bytes", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: true,
      imageData: "data:image/jpeg;base64,YWJj",
      classification: "ai_generated",
      confidence: 0.93,
      flag: true,
      tells: ["warped glasses"],
      note: "Synthetic-image characteristics warrant independent review.",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    await act(async () => {
      root.render(<PfpCheck handle="@alice" panelCostToken="signed-panel" />);
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/pfp-check?handle=alice",
      { headers: { "x-argus-panel-token": "signed-panel" } },
    );
    expect(container.querySelector('img[src="data:image/jpeg;base64,YWJj"]')).not.toBeNull();
    expect(container.textContent).toContain("AI-generated image lead");
    expect(container.textContent).toContain("review lead · verify independently");
    expect(container.textContent).not.toContain("not a real founder photo");
  });

  it("fails closed when a successful HTTP response has no valid classification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: true,
      flag: false,
      note: "No concern found.",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await act(async () => {
      root.render(<PfpCheck handle="@alice" panelCostToken="signed-panel" />);
    });

    expect(container.textContent).toContain("unavailable · no conclusion");
    expect(container.textContent).toContain("provider returned no usable conclusion");
    expect(container.textContent).not.toContain("No concern found");
  });
});
