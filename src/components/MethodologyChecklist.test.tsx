// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MethodologyChecklist } from "./MethodologyChecklist";

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
});

describe("MethodologyChecklist", () => {
  it("summarizes finished, concerning, open, and irrelevant checks in plain language", () => {
    act(() => {
      root.render(
        <MethodologyChecklist
          summaryLabel="Token checks"
          checks={[
            { label: "Contract safety", status: "confirmed" },
            { label: "Ownership risk", status: "finding" },
            { label: "Code history", status: "unknown" },
            { label: "Solana authority", status: "not-applicable" },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Token checks");
    expect(container.textContent).toContain(
      "2 of 3 relevant checks finished · 1 needs attention · 1 still open · 1 did not apply",
    );
  });
});
