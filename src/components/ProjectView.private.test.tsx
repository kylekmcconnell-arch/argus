// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  recordContribution: vi.fn(),
  projectPeopleContribution: vi.fn(() => ({ id: "project-contribution" })),
}));

vi.mock("../graph/store", () => ({
  getContributions: () => [],
  projectPeopleContribution: harness.projectPeopleContribution,
  recordContribution: harness.recordContribution,
}));

vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./Avatar", () => ({ Avatar: () => <span /> }));

import { ProjectView } from "./ProjectView";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    people: [{ name: "Private Founder", handle: "@private_founder", role: "founder" }],
  }), { status: 200, headers: { "content-type": "application/json" } })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ProjectView graph privacy", () => {
  it("does not launch paid team discovery or graph writes from a private project", async () => {
    await act(async () => {
      root.render(
        <ProjectView
          project={{ name: "Private Project", domain: "private.example" }}
          onAudit={() => {}}
          onReset={() => {}}
          record={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Paid deep-team discovery is paused");
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.projectPeopleContribution).not.toHaveBeenCalled();
    expect(harness.recordContribution).not.toHaveBeenCalled();
  });

  it("binds public team discovery to the parent report capability", async () => {
    await act(async () => {
      root.render(
        <ProjectView
          project={{ name: "Public Project", domain: "public.example" }}
          onAudit={() => {}}
          onReset={() => {}}
          panelCostToken="signed-parent-capability"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Private Founder");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/recon-team?"),
      expect.objectContaining({
        headers: {
          "x-argus-panel-context": "required",
          "x-argus-panel-token": "signed-parent-capability",
        },
      }),
    );
    expect(harness.recordContribution).toHaveBeenCalled();
  });
});
