// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RawEvidenceDecisionCanvas } from "./RawEvidenceDecisionCanvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("Raw Evidence decision canvas", () => {
  it("identifies itself as a non-editorial verification view and preserves both scores", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <RawEvidenceDecisionCanvas
        subjectName="Fedi."
        verdictLabel="Pass"
        score={74}
        scoreLabel="Project diligence score"
        favorable
        verdictTone="pass"
        supports={[{ label: "Live product" }]}
        concerns={[{ label: "Audit publication unresolved" }]}
        nextSteps={[]}
        verified={[{ label: "Official site" }, { label: "Official X" }]}
        coveragePercent={100}
        successful={7}
        applicable={7}
        secondaryScore={{ label: "Token safety score", score: 81, verdictLabel: "Pass" }}
      />,
    ));

    expect(container.textContent).toContain("Raw evidence");
    expect(container.textContent).toContain("without adding a lane-specific narrative");
    expect(container.textContent).toContain("Project diligence score");
    expect(container.textContent).toContain("Token safety score");
    expect(container.textContent).toContain("7/7 required report checks");
    expect(container.querySelector("[data-raw-evidence-record='true']")).not.toBeNull();
  });
});
